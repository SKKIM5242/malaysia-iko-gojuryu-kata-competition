-- Lets the Super Admin upload a kata recording on a participant's behalf
-- (e.g. their live-camera submission failed, or a technical issue means
-- they sent the organiser a video another way) — a backup path alongside
-- the normal in-app camera recorder, which stays the only option for
-- participants themselves.

drop policy if exists "kata_videos_admin_upload" on storage.objects;
create policy "kata_videos_admin_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'kata-videos' and public.is_admin());
