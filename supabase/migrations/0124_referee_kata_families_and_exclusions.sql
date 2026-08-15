-- Two separate, small, structured additions rather than one shortcut
-- column: a judge naturally covers SEVERAL kata families (a multi-select),
-- while a conflict-of-interest exclusion is naturally a HANDFUL of
-- specific categories (kata + belt group + age group + gender group
-- together, not a whole family) -- different shapes, so they get different
-- storage instead of both being crammed into one free-text field.

-- Which of the 5 kata families (see lib/kata-families.ts: Elementary,
-- Intermediate, Advance, Mastery, Kobudo) a judge is eligible for.
-- Empty/unset means "not yet configured", which autoAssignReferees treats
-- as eligible for every family -- today's behaviour -- so no existing
-- judge is narrowed until an admin deliberately sets this.
alter table referees add column if not exists kata_families text[] not null default '{}';

-- The specific categories (a full kata+belt+age+gender combination, from
-- the real categories table -- not just a kata name or a whole family) a
-- judge must never be auto- or manually assigned to. Capped at 3 per judge
-- in the server action, not here, matching how other "up to N" limits in
-- this app are enforced at the application layer rather than a DB check.
create table if not exists referee_category_exclusions (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references referees(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (referee_id, category_id)
);
create index if not exists referee_category_exclusions_referee_id_idx
  on referee_category_exclusions(referee_id);

alter table referee_category_exclusions enable row level security;

-- Mirrors referee_assignments' own policy shape (migration 0045/0050):
-- is_admin() (admin/organizer/staff, not plain referee -- this is an
-- organizer-configured conflict-of-interest control, not something a judge
-- sets on themselves) gets full CRUD; a judge may read their own rows.
create policy "referee_category_exclusions_admin_all" on referee_category_exclusions
  for all using (is_admin()) with check (is_admin());

create policy "referee_category_exclusions_self_select" on referee_category_exclusions
  for select using (
    exists (
      select 1 from referees r
      where r.id = referee_category_exclusions.referee_id and r.user_id = auth.uid()
    )
  );
