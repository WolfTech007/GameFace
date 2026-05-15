-- Private friend matches: room metadata in Postgres; WebRTC still uses PeerJS ids in `peer_room_id`.

create table if not exists public.private_rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  game_slug text not null,
  host_user_id uuid not null references auth.users (id) on delete cascade,
  peer_room_id text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists private_rooms_host_idx on public.private_rooms (host_user_id);
create index if not exists private_rooms_invite_idx on public.private_rooms (invite_code);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.private_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists room_players_room_idx on public.room_players (room_id);

alter table public.private_rooms enable row level security;
alter table public.room_players enable row level security;

create policy "private_rooms_insert_host"
  on public.private_rooms for insert
  with check (auth.uid() = host_user_id);

create policy "private_rooms_select_host_or_player"
  on public.private_rooms for select
  using (
    auth.uid() = host_user_id
    or exists (
      select 1 from public.room_players rp
      where rp.room_id = private_rooms.id and rp.user_id = auth.uid()
    )
  );

create policy "private_rooms_update_host"
  on public.private_rooms for update
  using (auth.uid() = host_user_id);

create policy "room_players_insert_self"
  on public.room_players for insert
  with check (auth.uid() = user_id);

create policy "room_players_select_visible"
  on public.room_players for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.private_rooms r
      where r.id = room_players.room_id and r.host_user_id = auth.uid()
    )
  );

create or replace function public.join_private_room(p_invite text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.private_rooms%rowtype;
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_invite is null or length(trim(p_invite)) < 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid_invite');
  end if;

  select * into r
  from public.private_rooms
  where invite_code = trim(p_invite)
    and status = 'waiting';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if r.host_user_id = uid then
    return jsonb_build_object(
      'ok', true,
      'peer_room_id', r.peer_room_id,
      'game_slug', r.game_slug,
      'role', 'host'
    );
  end if;

  select count(*)::int into n from public.room_players where room_id = r.id;

  if n >= 2 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  insert into public.room_players (room_id, user_id, role)
  values (r.id, uid, 'guest')
  on conflict (room_id, user_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'peer_room_id', r.peer_room_id,
    'game_slug', r.game_slug,
    'role', 'guest'
  );
end;
$$;

revoke all on function public.join_private_room(text) from public;
grant execute on function public.join_private_room(text) to authenticated;
