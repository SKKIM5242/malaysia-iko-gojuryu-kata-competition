-- Customer Support's own sign-in/out log for USD 8/hour pay -- deliberately
-- a manual clock in/out, not derived from actual page-session timestamps,
-- since Customer Support also does real work replying via the Telegram
-- assistant/community groups where there's no page session to track at all.
create table if not exists support_shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  task_summary text,
  created_at timestamptz not null default now()
);
alter table support_shifts enable row level security;

drop policy if exists "support_shifts_select" on support_shifts;
create policy "support_shifts_select" on support_shifts
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "support_shifts_insert" on support_shifts;
create policy "support_shifts_insert" on support_shifts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "support_shifts_update" on support_shifts;
create policy "support_shifts_update" on support_shifts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
