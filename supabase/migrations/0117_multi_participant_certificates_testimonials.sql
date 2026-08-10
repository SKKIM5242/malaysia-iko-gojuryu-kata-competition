-- Extends the multi-participant-per-login feature (0116) to certificates
-- and testimonials: a login linked to several participants (a Sensei whose
-- email is on several students' registrations) can now submit/edit a
-- testimonial for ANY of its linked registrations, not just the primary
-- one. submitTestimonial inserts through the regular session client, so
-- RLS -- not just the app-level check already updated in
-- app/actions/account.ts -- has to recognize profile_participants too.
drop policy if exists "winner_testimonials_insert_own" on winner_testimonials;
create policy "winner_testimonials_insert_own" on winner_testimonials
  for insert to authenticated
  with check (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.registration_id = winner_testimonials.registration_id
    )
    or exists (
      select 1 from profile_participants pp
      where pp.user_id = auth.uid()
        and pp.registration_id = winner_testimonials.registration_id
    )
  );
