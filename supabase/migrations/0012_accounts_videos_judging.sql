-- Multi-role accounts (participant / referee / staff / admin), kata video
-- submissions, referee assignments and scoring.

-- ── Tables first (policies reference across tables, so create all tables
--    before any RLS policy is defined) ───────────────────────────────────────

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'participant'
    check (role in ('participant','referee','staff','admin')),
  full_name text,
  country text,
  email text,
  approved boolean not null default false,
  participant_id uuid references participants(id),
  registration_id uuid references registrations(id),
  record_attempts int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists kata_videos (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references registrations(id) on delete cascade,
  participant_id uuid references participants(id),
  user_id uuid not null references auth.users(id),
  storage_path text not null,
  mime text,
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);

create table if not exists referee_assignments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references kata_videos(id) on delete cascade,
  referee_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (video_id, referee_user_id)
);

create table if not exists video_scores (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references kata_videos(id) on delete cascade,
  referee_user_id uuid not null references auth.users(id) on delete cascade,
  score numeric(3,1) not null check (score >= 0 and score <= 10),
  created_at timestamptz not null default now(),
  unique (video_id, referee_user_id)
);

-- ── Enable RLS ───────────────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table kata_videos enable row level security;
alter table referee_assignments enable row level security;
alter table video_scores enable row level security;

-- ── Helper functions ─────────────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role in ('admin','staff') and approved
  );
$$;

create or replace function public.is_referee() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role = 'referee' and approved
  );
$$;

-- ── Profiles policies ────────────────────────────────────────────────────────
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Sensitive columns are protected by column grants: users may only change
-- their name and country; role/approved/links change via definer functions.
revoke update on profiles from authenticated;
grant update (full_name, country) on profiles to authenticated;

-- Auto-create a profile on signup from the metadata the form sends.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'participant');
begin
  if v_role not in ('participant','referee','staff') then
    v_role := 'participant';
  end if;
  insert into profiles (user_id, role, full_name, country, email, approved)
  values (
    new.id, v_role,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    false
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing accounts (the organiser's) become approved admins.
insert into profiles (user_id, role, full_name, email, approved)
select id, 'admin', coalesce(raw_user_meta_data->>'full_name', email), email, true
from auth.users
on conflict (user_id) do update set role = 'admin', approved = true;

-- Admin approval + participant claim + attempt counter run as definer so the
-- column grants above stay tight.
create or replace function public.approve_profile(p_user uuid, p_approve boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;
  update profiles set approved = p_approve where user_id = p_user;
  return found;
end;
$$;

create or replace function public.claim_registration(p_ref text, p_ic text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select r.* into v_reg
  from registrations r
  join participants p on p.id = r.participant_id
  where lower(r.id::text) like lower(p_ref) || '%'
    and p.ic_passport = p_ic
  limit 1;
  if v_reg.id is null then
    return 'No registration matches that reference ID + IC.';
  end if;
  if v_reg.payment_status <> 'paid' then
    return 'That registration is not paid yet — only paid participants can record.';
  end if;
  if exists (select 1 from profiles where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;
  select * into v_participant from participants where id = v_reg.participant_id;
  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = auth.uid() and role = 'participant';
  if not found then return 'Only participant accounts can claim a registration.'; end if;
  return 'OK';
end;
$$;

create or replace function public.increment_record_attempts()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update profiles
  set record_attempts = least(record_attempts + 1, 3)
  where user_id = auth.uid()
  returning record_attempts into v;
  return coalesce(v, 3);
end;
$$;

grant execute on function public.approve_profile(uuid, boolean) to authenticated;
grant execute on function public.claim_registration(text, text) to authenticated;
grant execute on function public.increment_record_attempts() to authenticated;

-- ── Kata videos policies ─────────────────────────────────────────────────────
drop policy if exists "videos_insert_own" on kata_videos;
create policy "videos_insert_own" on kata_videos
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "videos_select_own_admin_assigned" on kata_videos;
create policy "videos_select_own_admin_assigned" on kata_videos
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from referee_assignments ra
      where ra.video_id = kata_videos.id and ra.referee_user_id = auth.uid()
    )
  );
drop policy if exists "videos_admin_write" on kata_videos;
create policy "videos_admin_write" on kata_videos
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "videos_admin_delete" on kata_videos;
create policy "videos_admin_delete" on kata_videos
  for delete to authenticated using (public.is_admin());

-- ── Referee assignment policies ──────────────────────────────────────────────
drop policy if exists "assignments_admin_all" on referee_assignments;
create policy "assignments_admin_all" on referee_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "assignments_referee_select" on referee_assignments;
create policy "assignments_referee_select" on referee_assignments
  for select to authenticated using (referee_user_id = auth.uid());

-- ── Score policies (0.0 – 10.0 per referee per video) ───────────────────────
drop policy if exists "scores_referee_upsert" on video_scores;
create policy "scores_referee_upsert" on video_scores
  for insert to authenticated with check (
    referee_user_id = auth.uid() and public.is_referee()
    and exists (
      select 1 from referee_assignments ra
      where ra.video_id = video_scores.video_id and ra.referee_user_id = auth.uid()
    )
  );
drop policy if exists "scores_referee_update" on video_scores;
create policy "scores_referee_update" on video_scores
  for update to authenticated
  using (referee_user_id = auth.uid())
  with check (referee_user_id = auth.uid());
drop policy if exists "scores_select" on video_scores;
create policy "scores_select" on video_scores
  for select to authenticated using (
    referee_user_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from kata_videos kv where kv.id = video_scores.video_id and kv.user_id = auth.uid())
  );

-- ── Video storage (private; server-signed playback URLs only) ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kata-videos', 'kata-videos', false, 524288000,
        array['video/webm','video/mp4','video/quicktime'])
on conflict (id) do nothing;

drop policy if exists "kata_videos_upload_own_folder" on storage.objects;
create policy "kata_videos_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'kata-videos' and (storage.foldername(name))[1] = auth.uid()::text);
