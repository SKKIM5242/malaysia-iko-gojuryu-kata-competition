-- Backup + undo for the category "merge" actions (Merge -> Mix, Merge age,
-- Merge family, Merge belt group, and the new Merge with kata above/below).
-- Every one of those deletes source categories after moving their
-- registrations onto a target category -- this table records enough to
-- reverse exactly that, so an "Undo" button can bring it all back.

create table if not exists category_merge_log (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  merge_type text not null,
  -- The surviving category after the merge.
  target_category_id uuid not null,
  -- True when this merge action itself created target_category_id (an
  -- insert, not a reuse of an already-existing category) -- undo only ever
  -- deletes the target if this merge is the one that brought it into
  -- existence, never a category that already existed for other reasons.
  target_was_new boolean not null,
  -- Full row snapshot of every category this merge deleted -- everything
  -- needed to recreate each one exactly (same id, so nothing referencing it
  -- has to change), independent of the categories table's current shape.
  source_categories jsonb not null,
  -- [{registration_id, original_category_id}, ...] for every registration
  -- this merge moved -- undo sets each one's category_id back, rather than
  -- moving every registration currently in the target (which may include
  -- ones a *later* merge also fed in, that this undo must leave alone).
  moved_registrations jsonb not null,
  -- Human-readable summary shown on the Undo button's tooltip.
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  -- Null while still reversible. Set the moment Undo is used on it --
  -- makes "the latest merge for this competition" a simple query, and
  -- gives repeated Undo clicks a natural stack-like feel (each click steps
  -- back one further action).
  undone_at timestamptz
);

create index if not exists category_merge_log_competition_active_idx
  on category_merge_log (competition_id, created_at desc)
  where undone_at is null;

alter table category_merge_log enable row level security;

-- Mirrors categories' own RLS exactly (categories_v1_read / categories_write_staff)
-- via the same is_staff_any() helper, since every merge action reads and
-- writes both tables together in one flow.
create policy "category_merge_log_v1_read" on category_merge_log for select using (true);
create policy "category_merge_log_write_staff" on category_merge_log for all
  using (is_staff_any()) with check (is_staff_any());
