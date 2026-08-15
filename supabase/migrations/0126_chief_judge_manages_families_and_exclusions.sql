-- The Judge Workload table on /admin/judging now lets a Chief Judge (not
-- just Admin/Organizer/Staff) edit kata_families/exclusions for the whole
-- roster, confirmed with the organizer. "Chief" is free text on
-- referees.judge_title (REFEREE_TITLE_OPTIONS: "Chief Referee", "Chief
-- Judge", "Chief Referee & Judge"), matched the same way the app already
-- does for self-assign eligibility (see isChiefJudge in
-- app/admin/judging/page.tsx) -- kept as one function so the two never
-- drift apart.
--
-- referees.kata_families itself needs no RLS change: is_staff_any() (the
-- table's existing ALL-command policy) already includes role 'referee'
-- outright, so any approved referee -- chief or not -- can already write
-- that column at the database level; app/actions/admin.ts's
-- requireRefereeConfigManager is what actually narrows that down, and is
-- updated separately (not in a migration) to add the Chief check.
--
-- referee_category_exclusions is the one table that needs a real RLS
-- change: its write policy (migration 0124) was deliberately is_admin()
-- only, which excludes every referee including a Chief. Widening it here.
create or replace function public.is_chief_judge()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from referees r
    where r.user_id = auth.uid()
      and r.judge_title ~* 'chief (referee|judge)'
  );
$$;

drop policy if exists "referee_category_exclusions_admin_all" on referee_category_exclusions;
create policy "referee_category_exclusions_admin_all" on referee_category_exclusions
  for all using (is_admin() or is_chief_judge()) with check (is_admin() or is_chief_judge());
