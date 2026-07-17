-- Kata Arena: every submitted recording is now visible to every signed-in
-- account as soon as it's submitted -- not just after a competition's
-- registration deadline, and not just to the uploader/admin/assigned
-- referee/staff-tier roles. Additive, permissive policies -- Postgres
-- OR-combines them with the existing narrower ones on each table, so
-- nothing already granted access loses it.
--
-- This supersedes the deadline-gated policies from 0021 (kept in place,
-- harmless, but no longer the only way in) and matches the organiser's
-- decision to make Kata Arena an open, always-visible activity feed.

drop policy if exists "videos_select_all_authenticated" on kata_videos;
create policy "videos_select_all_authenticated" on kata_videos
  for select to authenticated using (true);

drop policy if exists "scores_select_all_authenticated" on video_scores;
create policy "scores_select_all_authenticated" on video_scores
  for select to authenticated using (true);

drop policy if exists "kata_videos_read_all_authenticated" on storage.objects;
create policy "kata_videos_read_all_authenticated" on storage.objects
  for select to authenticated using (bucket_id = 'kata-videos');
