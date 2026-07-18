-- Editable "Auto-Assign Referee Terms & Conditions" list, managed by
-- Admin/Organizer on the Referees admin page as a numbered listing. Seeded
-- with the rules the auto-assign algorithm actually implements today
-- (app/actions/admin.ts autoAssignReferees) plus the standing no-appeal
-- clause, so the published terms start out matching real behaviour.
create table if not exists auto_assign_terms (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table auto_assign_terms enable row level security;

drop policy if exists "auto_assign_terms_read_auth" on auto_assign_terms;
create policy "auto_assign_terms_read_auth" on auto_assign_terms
  for select to authenticated using (true);

drop policy if exists "auto_assign_terms_write_admin" on auto_assign_terms;
create policy "auto_assign_terms_write_admin" on auto_assign_terms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into auto_assign_terms (position, content)
select * from (values
  (1, 'Only Referee/Judge accounts that are Approved and linked to a login are eligible for auto-assignment.'),
  (2, 'Every recording is assigned the number of judges configured as "Judges per recording" for its competition (default 3).'),
  (3, 'Auto-assign only fills gaps — recordings that already have enough judges are left untouched, and existing manual assignments are never removed or replaced.'),
  (4, 'For each open slot, the eligible referee with the lowest current workload (fewest total assignments) is chosen, with random tie-breaks, so workload stays evenly balanced across the panel.'),
  (5, 'A referee is never assigned to the same recording twice.'),
  (6, 'Recordings are processed in random order on each auto-assign run, so a shortage of referees does not systematically leave the same recordings unjudged.'),
  (7, 'A Referee/Judge''s score is final once submitted — no appeal is available.')
) as seed(position, content)
where not exists (select 1 from auto_assign_terms);
