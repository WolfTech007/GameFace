-- GameFace profiles Phase 1: bio, avatar, public read for signed-in users, avatars storage.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_unique unique (username),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 280)
);

alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_length'
  ) then
    alter table public.profiles
      add constraint profiles_bio_length check (bio is null or char_length(bio) <= 280);
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists profiles_username_idx on public.profiles (username);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.get_profile_by_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_uname text;
  v_row public.profiles%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  v_uname := lower(trim(both '@' from coalesce(p_username, '')));
  if length(v_uname) < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_username');
  end if;

  select * into v_row from public.profiles where username = v_uname;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', v_row.id,
      'username', v_row.username,
      'display_name', coalesce(nullif(trim(v_row.display_name), ''), v_row.username),
      'bio', coalesce(v_row.bio, ''),
      'avatar_url', v_row.avatar_url
    )
  );
end;
$$;

create or replace function public.update_own_profile(
  p_display_name text,
  p_bio text,
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dn text;
  v_bio text;
  v_av text;
  v_row public.profiles%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'sign_in_required');
  end if;

  v_dn := nullif(trim(coalesce(p_display_name, '')), '');
  v_bio := nullif(trim(coalesce(p_bio, '')), '');
  v_av := nullif(trim(coalesce(p_avatar_url, '')), '');

  if v_dn is not null and char_length(v_dn) > 48 then
    return jsonb_build_object('ok', false, 'error', 'display_name_too_long');
  end if;

  if v_bio is not null and char_length(v_bio) > 280 then
    return jsonb_build_object('ok', false, 'error', 'bio_too_long');
  end if;

  update public.profiles
  set
    display_name = coalesce(v_dn, username),
    bio = v_bio,
    avatar_url = case when p_avatar_url is not null then v_av else avatar_url end,
    updated_at = now()
  where id = v_uid
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', v_row.id,
      'username', v_row.username,
      'display_name', coalesce(nullif(trim(v_row.display_name), ''), v_row.username),
      'bio', coalesce(v_row.bio, ''),
      'avatar_url', v_row.avatar_url
    )
  );
end;
$$;

grant execute on function public.get_profile_by_username(text) to authenticated;
grant execute on function public.update_own_profile(text, text, text) to authenticated;

-- Avatars bucket (public read for img src URLs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
