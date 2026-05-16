-- Allow rejoin via invite while room is waiting or playing; block closed.
-- Existing guests bypass the full-room check; third distinct users still get full.

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
  already_player boolean;
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
    and status in ('waiting', 'playing');

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

  select exists (
    select 1 from public.room_players rp
    where rp.room_id = r.id and rp.user_id = uid
  ) into already_player;

  if already_player then
    return jsonb_build_object(
      'ok', true,
      'peer_room_id', r.peer_room_id,
      'game_slug', r.game_slug,
      'role', 'guest'
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
