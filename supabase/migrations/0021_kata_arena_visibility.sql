-- Kata Arena: once a competition's registration deadline has passed, every
-- signed-in user may see that competition's recordings and scores (not just
-- the uploader, the assigned referee, or admin). Additive permissive
-- policies — Postgres OR-combines them with the existing ones on each table.

drop policy if exists "videos_select_after_deadline" on kata_videos;
create policy "videos_select_after_deadline" on kata_videos
  for select to authenticated using (
    exists (
      select 1 from registrations r
      join competitions c on c.id = r.competition_id
      where r.id = kata_videos.registration_id
        and c.registration_deadline is not null
        and c.registration_deadline::date < current_date
    )
  );

drop policy if exists "scores_select_after_deadline" on video_scores;
create policy "scores_select_after_deadline" on video_scores
  for select to authenticated using (
    exists (
      select 1 from kata_videos kv
      join registrations r on r.id = kv.registration_id
      join competitions c on c.id = r.competition_id
      where kv.id = video_scores.video_id
        and c.registration_deadline is not null
        and c.registration_deadline::date < current_date
    )
  );
