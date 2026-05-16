-- Friend challenges v1: notification row points at existing private_rooms via invite_code.

create table if not exists public.friend_challenges (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  game_slug text not null,
  invite_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  updated_at timestamptz not null default now(),
  constraint friend_challenges_no_self check (from_user_id <> to_user_id)
);

create unique index if not exists friend_challenges_one_pending_pair_idx
  on public.friend_challenges (from_user_id, to_user_id)
  where status = 'pending';

create index if not exists friend_challenges_to_pending_idx
  on public.friend_challenges (to_user_id, status)
  where status = 'pending';

create index if not exists friend_challenges_from_idx
  on public.friend_challenges (from_user_id);

alter table public.friend_challenges enable row level security;

create policy "friend_challenges_select_participant"
  on public.friend_challenges for select
  using (auth.uid() in (from_user_id, to_user_id));

create or replace function public.expire_friend_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friend_challenges
  set status = 'expired', updated_at = now()
  where status = 'pending' and expires_at < now();
end;
$$;

create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friend_requests fr
    where fr.status = 'accepted'
      and (
        (fr.from_user_id = p_a and fr.to_user_id = p_b)
        or (fr.from_user_id = p_b and fr.to_user_id = p_a)
      )
  );
$$;

create or replace function public.create_friend_challenge(
  p_to_user_id uuid,
  p_game_slug text,
  p_invite_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  if p_to_user_id is null or p_to_user_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'invalid_user');
  end if;

  v_code := trim(coalesce(p_invite_code, ''));
  if length(v_code) < 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid_invite');
  end if;

  if p_game_slug is null or length(trim(p_game_slug)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_game');
  end if;

  if not exists (select 1 from public.profiles where id = p_to_user_id) then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  if not public.are_friends(v_uid, p_to_user_id) then
    return jsonb_build_object('ok', false, 'error', 'not_friends');
  end if;

  perform public.expire_friend_challenges();

  update public.friend_challenges
  set status = 'cancelled', updated_at = now()
  where from_user_id = v_uid
    and to_user_id = p_to_user_id
    and status = 'pending';

  insert into public.friend_challenges (
    from_user_id,
    to_user_id,
    game_slug,
    invite_code,
    status,
    expires_at
  )
  values (
    v_uid,
    p_to_user_id,
    trim(p_game_slug),
    v_code,
    'pending',
    now() + interval '30 minutes'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.respond_friend_challenge(
  p_challenge_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_challenges%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  perform public.expire_friend_challenges();

  select * into v_row
  from public.friend_challenges
  where id = p_challenge_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_row.to_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  if v_row.expires_at < now() then
    update public.friend_challenges
    set status = 'expired', updated_at = now()
    where id = p_challenge_id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  update public.friend_challenges
  set status = case when p_accept then 'accepted' else 'declined' end,
      updated_at = now()
  where id = p_challenge_id;

  return jsonb_build_object(
    'ok', true,
    'game_slug', v_row.game_slug,
    'invite_code', v_row.invite_code
  );
end;
$$;

create or replace function public.cancel_friend_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_challenges%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  select * into v_row
  from public.friend_challenges
  where id = p_challenge_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_row.from_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  update public.friend_challenges
  set status = 'cancelled', updated_at = now()
  where id = p_challenge_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_friend_challenges_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  perform public.expire_friend_challenges();

  return jsonb_build_object(
    'ok', true,
    'incoming', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fc.id,
          'from_user_id', fc.from_user_id,
          'username', p.username,
          'display_name', coalesce(nullif(trim(p.display_name), ''), p.username),
          'game_slug', fc.game_slug,
          'invite_code', fc.invite_code,
          'expires_at', fc.expires_at,
          'created_at', fc.created_at
        )
        order by fc.created_at desc
      )
      from public.friend_challenges fc
      join public.profiles p on p.id = fc.from_user_id
      where fc.to_user_id = v_uid and fc.status = 'pending' and fc.expires_at >= now()
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fc.id,
          'to_user_id', fc.to_user_id,
          'username', p.username,
          'display_name', coalesce(nullif(trim(p.display_name), ''), p.username),
          'game_slug', fc.game_slug,
          'invite_code', fc.invite_code,
          'expires_at', fc.expires_at,
          'created_at', fc.created_at
        )
        order by fc.created_at desc
      )
      from public.friend_challenges fc
      join public.profiles p on p.id = fc.to_user_id
      where fc.from_user_id = v_uid and fc.status = 'pending' and fc.expires_at >= now()
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.expire_friend_challenges() to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.create_friend_challenge(uuid, text, text) to authenticated;
grant execute on function public.respond_friend_challenge(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_challenge(uuid) to authenticated;
grant execute on function public.get_friend_challenges_state() to authenticated;
