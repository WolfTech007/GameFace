-- GameFace friends v1: requests + RPCs (profiles table must already exist).

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_no_self check (from_user_id <> to_user_id),
  constraint friend_requests_pair_unique unique (from_user_id, to_user_id)
);

create index if not exists friend_requests_from_idx on public.friend_requests (from_user_id);
create index if not exists friend_requests_to_idx on public.friend_requests (to_user_id);
create index if not exists friend_requests_status_idx on public.friend_requests (status);

alter table public.friend_requests enable row level security;

create policy "friend_requests_select_participant"
  on public.friend_requests for select
  using (auth.uid() in (from_user_id, to_user_id));

-- Writes go through security-definer RPCs only.

create or replace function public.search_users_by_username(p_query text, p_limit int default 10)
returns table (
  id uuid,
  username text,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q text;
  v_lim int;
begin
  if v_uid is null then
    return;
  end if;

  v_q := lower(trim(both '@' from coalesce(p_query, '')));
  if length(v_q) < 2 then
    return;
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 10), 20));

  return query
  select
    p.id,
    p.username,
    coalesce(nullif(trim(p.display_name), ''), p.username) as display_name
  from public.profiles p
  where p.id <> v_uid
    and p.username ilike v_q || '%'
  order by p.username
  limit v_lim;
end;
$$;

create or replace function public.send_friend_request(p_to_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_requests%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  if p_to_user_id is null or p_to_user_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'invalid_user');
  end if;

  if not exists (select 1 from public.profiles where id = p_to_user_id) then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  if exists (
    select 1 from public.friend_requests fr
    where fr.status = 'accepted'
      and (
        (fr.from_user_id = v_uid and fr.to_user_id = p_to_user_id)
        or (fr.from_user_id = p_to_user_id and fr.to_user_id = v_uid)
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_friends');
  end if;

  select * into v_row
  from public.friend_requests fr
  where (fr.from_user_id = v_uid and fr.to_user_id = p_to_user_id)
     or (fr.from_user_id = p_to_user_id and fr.to_user_id = v_uid)
  limit 1;

  if found then
    if v_row.status = 'accepted' then
      return jsonb_build_object('ok', false, 'error', 'already_friends');
    end if;

    if v_row.status = 'pending' then
      if v_row.from_user_id = v_uid then
        return jsonb_build_object('ok', false, 'error', 'already_sent');
      end if;
      -- They already sent us a request — accept automatically.
      update public.friend_requests
      set status = 'accepted', updated_at = now()
      where id = v_row.id;
      return jsonb_build_object('ok', true, 'auto_accepted', true);
    end if;

    -- declined — reopen from current user to target
    update public.friend_requests
    set from_user_id = v_uid,
        to_user_id = p_to_user_id,
        status = 'pending',
        updated_at = now()
    where id = v_row.id;
    return jsonb_build_object('ok', true);
  end if;

  insert into public.friend_requests (from_user_id, to_user_id, status)
  values (v_uid, p_to_user_id, 'pending');

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friend_requests%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  select * into v_row
  from public.friend_requests
  where id = p_request_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_row.to_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  update public.friend_requests
  set status = case when p_accept then 'accepted' else 'declined' end,
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_friends_state()
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

  return jsonb_build_object(
    'ok', true,
    'friends', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', other_id,
          'username', p.username,
          'display_name', coalesce(nullif(trim(p.display_name), ''), p.username),
          'since', fr.updated_at
        )
        order by p.username
      )
      from public.friend_requests fr
      cross join lateral (
        select case when fr.from_user_id = v_uid then fr.to_user_id else fr.from_user_id end as other_id
      ) o
      join public.profiles p on p.id = o.other_id
      where fr.status = 'accepted'
        and v_uid in (fr.from_user_id, fr.to_user_id)
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fr.id,
          'from_user_id', fr.from_user_id,
          'username', p.username,
          'display_name', coalesce(nullif(trim(p.display_name), ''), p.username),
          'created_at', fr.created_at
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.from_user_id
      where fr.to_user_id = v_uid and fr.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fr.id,
          'to_user_id', fr.to_user_id,
          'username', p.username,
          'display_name', coalesce(nullif(trim(p.display_name), ''), p.username),
          'created_at', fr.created_at
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.to_user_id
      where fr.from_user_id = v_uid and fr.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.search_users_by_username(text, int) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.get_friends_state() to authenticated;
