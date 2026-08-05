-- Winner testimonials: video, voice, or a typed message, given in exchange
-- for unlocking the Winner Certificate download and reward payout (see
-- app/api/certificates/[kind]/[id]/route.tsx and app/admin/commissions/page.tsx).
-- Replayable by anyone -- signed in or not -- per the organizer's explicit
-- "open to public" instruction, so this is the one media table in the app
-- with a genuinely public read policy.
create table if not exists winner_testimonials (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references registrations(id) on delete cascade,
  kind text not null check (kind in ('video', 'voice', 'message')),
  media_path text,
  message text,
  created_at timestamptz not null default now()
);

alter table winner_testimonials enable row level security;

drop policy if exists "winner_testimonials_public_read" on winner_testimonials;
create policy "winner_testimonials_public_read" on winner_testimonials
  for select to public using (true);

drop policy if exists "winner_testimonials_insert_own" on winner_testimonials;
create policy "winner_testimonials_insert_own" on winner_testimonials
  for insert to authenticated
  with check (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.registration_id = winner_testimonials.registration_id
    )
  );

-- ── Testimonial media storage (public; playable by anyone) ────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('testimonials', 'testimonials', true, 314572800,
        array['video/webm', 'video/mp4', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'])
on conflict (id) do nothing;

drop policy if exists "testimonials_public_read" on storage.objects;
create policy "testimonials_public_read" on storage.objects
  for select to public using (bucket_id = 'testimonials');

drop policy if exists "testimonials_upload_own_folder" on storage.objects;
create policy "testimonials_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'testimonials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
