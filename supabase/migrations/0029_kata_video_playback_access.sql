-- Fix: nobody could ever watch a submitted kata recording. The
-- 'kata-videos' storage bucket has never had a SELECT policy on
-- storage.objects (only the upload/insert policy from migration 0012), so
-- every createSignedUrl/createSignedUrls call — on Kata Arena, Judging, and
-- the admin Participant Records page — silently returned null and the
-- Watch button never rendered, for every role including Admin.
--
-- Also broadens kata_videos / video_scores SELECT so Customer Support and
-- Referee accounts can see every recording + judge score (not just a
-- referee's own assigned videos), per the organiser's explicit request that
-- Admin, Organizer, Referee/judges, and Customer Support all need access —
-- previously only is_admin() (admin/staff/organizer) and the assigned
-- referee could see a video at all.

drop policy if exists "videos_select_staff_tier" on kata_videos;
create policy "videos_select_staff_tier" on kata_videos
  for select to authenticated using (
    exists (
      select 1 from profiles pr
      where pr.user_id = auth.uid() and pr.approved
        and pr.role in ('customer_support', 'referee')
    )
  );

drop policy if exists "scores_select_staff_tier" on video_scores;
create policy "scores_select_staff_tier" on video_scores
  for select to authenticated using (
    exists (
      select 1 from profiles pr
      where pr.user_id = auth.uid() and pr.approved
        and pr.role in ('customer_support', 'referee')
    )
  );

drop policy if exists "kata_videos_read" on storage.objects;
create policy "kata_videos_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'kata-videos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (
        select 1 from profiles pr
        where pr.user_id = auth.uid() and pr.approved
          and pr.role in ('customer_support', 'referee')
      )
      or exists (
        select 1 from kata_videos kv
        join registrations r on r.id = kv.registration_id
        join competitions c on c.id = r.competition_id
        where kv.storage_path = name
          and c.registration_deadline is not null
          and c.registration_deadline::date < current_date
      )
    )
  );
