-- Judge passport photo + self-written introduction, and a per-tier publish
-- gate for the new public "Confirmed Judges" section on /participants.
--
-- photo_path is nullable -- required going forward at the form/action level
-- (mirrors certificate_path), but can't be retroactively required for
-- already-registered judges. judge_self_intro is nullable free text, only
-- ever written by the judge's own account (enforced in
-- saveJudgeSelfIntro, not by RLS -- see that action's own comment for why).
alter table referees add column if not exists photo_path text;
alter table referees add column if not exists judge_self_intro text;

-- Confirmed Judges doesn't auto-appear the moment judges are approved --
-- Admin/Organizer/Staff must explicitly publish each tier via
-- setJudgesPublished. Defaults to false so nothing changes for any
-- already-open competition until someone deliberately turns it on.
alter table competitions add column if not exists judges_published boolean not null default false;

-- Small public bucket for judge headshots -- deliberately NOT the existing
-- private "certificates" bucket (which holds rank-certificate scans and
-- must stay private): this photo needs to render on a public page without
-- a signed-URL round trip. Mirrors the "branding" bucket from
-- 0075_certificates.sql. insert to anon+authenticated mirrors
-- certificates_insert_public (0006_address_certificate.sql), needed
-- because public self-registration is unauthenticated.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('judge-photos', 'judge-photos', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "judge_photos_public_read" on storage.objects;
create policy "judge_photos_public_read" on storage.objects
  for select to public using (bucket_id = 'judge-photos');

drop policy if exists "judge_photos_insert_public" on storage.objects;
create policy "judge_photos_insert_public" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'judge-photos');
