-- Backup + undo for the plain category "Delete" button (as opposed to the
-- merge buttons, already covered by category_merge_log). A category can
-- only ever be deleted while it has zero registrations (categories.id is
-- referenced by registrations.category_id with no ON DELETE clause, so
-- Postgres rejects the delete outright otherwise) -- so undoing a delete
-- only ever needs to recreate the one category row, never move any
-- registrations back.

create table if not exists category_delete_log (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  -- Full row snapshot of the deleted category -- everything needed to
  -- recreate it exactly (same id).
  category jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  -- Null while still reversible. Set the moment Undo is used on it.
  undone_at timestamptz
);

create index if not exists category_delete_log_competition_active_idx
  on category_delete_log (competition_id, created_at desc)
  where undone_at is null;

alter table category_delete_log enable row level security;

-- Mirrors categories' and category_merge_log's own RLS.
create policy "category_delete_log_v1_read" on category_delete_log for select using (true);
create policy "category_delete_log_write_staff" on category_delete_log for all
  using (is_staff_any()) with check (is_staff_any());
