-- Security hardening (from Supabase advisor "rls_policy_always_true"):
-- every USING(true)/WITH CHECK(true) UPDATE/DELETE/ALL policy let ANY
-- signed-in account (participant, audience, self-signup school/sensei…)
-- write these tables directly over the REST API, bypassing all the
-- role checks in the app's Server Actions. Writes are now scoped to the
-- staff-side roles that actually perform them in the app. Public INSERT
-- policies (the registration front door) are deliberately left as-is,
-- as are all SELECT policies, so no read path or signup flow changes.

-- Staff-side roles: everyone who can operate the admin panel at all.
create or replace function public.is_staff_any() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid()
      and role in ('admin','organizer','staff','customer_support','referee')
      and approved
  );
$$;

-- ── ALL(true) policies → staff-scoped writes ────────────────────────────────
-- (each had bundled authenticated SELECT via ALL; a plain read policy is
-- re-created wherever the table doesn't already have one, so read access
-- for signed-in users is unchanged)

drop policy if exists "announcements_write_auth" on announcements;
create policy "announcements_write_staff" on announcements
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "audiences_all_auth" on audiences;
create policy "audiences_select_auth" on audiences for select to authenticated using (true);
create policy "audiences_write_staff" on audiences
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "categories_write_auth" on categories;
create policy "categories_write_staff" on categories
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "class_enrollments_auth_all" on class_enrollments;
create policy "class_enrollments_staff" on class_enrollments
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "class_invoices_auth_all" on class_invoices;
create policy "class_invoices_staff" on class_invoices
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

-- setJudgesRequired is open to referees too (judging managers), so
-- competitions writes use the judging-manager check rather than staff-any.
drop policy if exists "competitions_write_auth" on competitions;
create policy "competitions_write_managers" on competitions
  for all to authenticated using (public.is_judging_manager()) with check (public.is_judging_manager());

drop policy if exists "fee_plans_auth_all" on fee_plans;
create policy "fee_plans_staff" on fee_plans
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "referees_all_auth" on referees;
create policy "referees_select_auth" on referees for select to authenticated using (true);
create policy "referees_write_staff" on referees
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "schools_write_auth" on schools;
create policy "schools_write_staff" on schools
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "senseis_write_auth" on senseis;
create policy "senseis_write_staff" on senseis
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "staff_all_auth" on staff_applications;
create policy "staff_select_auth" on staff_applications for select to authenticated using (true);
create policy "staff_write_staff" on staff_applications
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "students_auth_all" on students;
create policy "students_staff" on students
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

-- ── UPDATE(true)/DELETE(true) policies → role-scoped ────────────────────────

drop policy if exists "participants_update_auth" on participants;
create policy "participants_update_staff" on participants
  for update to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "participants_delete_auth" on participants;
create policy "participants_delete_admin" on participants
  for delete to authenticated using (public.is_admin());

drop policy if exists "bank_details_update_auth" on participant_bank_details;
create policy "bank_details_update_staff" on participant_bank_details
  for update to authenticated using (public.is_staff_any()) with check (public.is_staff_any());

drop policy if exists "bank_details_delete_auth" on participant_bank_details;
create policy "bank_details_delete_admin" on participant_bank_details
  for delete to authenticated using (public.is_admin());

-- Customer Support can mark registrations paid/rejected in the app;
-- deleting registrations is Admin/Organizer only (mirrors canDelete).
drop policy if exists "registrations_update_auth" on registrations;
create policy "registrations_update_staff" on registrations
  for update to authenticated
  using (public.is_admin() or public.is_customer_support())
  with check (public.is_admin() or public.is_customer_support());

drop policy if exists "registrations_delete_auth" on registrations;
create policy "registrations_delete_admin" on registrations
  for delete to authenticated using (public.is_admin());

drop policy if exists "drafts_delete_auth" on registration_drafts;
create policy "drafts_delete_admin" on registration_drafts
  for delete to authenticated using (public.is_admin());
