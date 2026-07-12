-- Participant home address, latest-certificate upload, and sensei rank
-- confirmation (bulk registrations).

alter table participants add column if not exists home_address text;
alter table participants add column if not exists home_country text;
alter table participants add column if not exists city_town text;
alter table participants add column if not exists certificate_path text;
-- 'certificate_uploaded' | 'sensei_confirmed' | 'pending_confirmation'
alter table participants add column if not exists rank_confirmation text;

-- Private storage bucket for certificate photos/scans. Anonymous registrants
-- upload during registration; only the authenticated owner can read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificates', 'certificates', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "certificates_insert_public" on storage.objects;
create policy "certificates_insert_public" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'certificates');

drop policy if exists "certificates_read_auth" on storage.objects;
create policy "certificates_read_auth" on storage.objects
  for select to authenticated
  using (bucket_id = 'certificates');
