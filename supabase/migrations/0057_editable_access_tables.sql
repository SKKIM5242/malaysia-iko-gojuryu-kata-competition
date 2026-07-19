-- The Access Matrix (admin panel) and the public "What Your Payment
-- Unlocks — Access Comparison" table are now DB-backed so Admin/Organizer
-- can add, edit, and delete rows from the Content page. Both fall back to
-- the code's built-in defaults while empty; an "Import current defaults"
-- button seeds them.
create table if not exists access_matrix_rows (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  resource text not null,
  note text,
  admin text not null default '',
  organizer text not null default '',
  customer_support text not null default '',
  referee text not null default '',
  created_at timestamptz not null default now()
);
alter table access_matrix_rows enable row level security;
drop policy if exists "access_matrix_read" on access_matrix_rows;
create policy "access_matrix_read" on access_matrix_rows
  for select to authenticated using (true);
drop policy if exists "access_matrix_write" on access_matrix_rows;
create policy "access_matrix_write" on access_matrix_rows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists access_comparison_rows (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  what text not null,
  participant text not null default '',
  school text not null default '',
  sensei text not null default '',
  referee text not null default '',
  audience text not null default '',
  organizer text not null default '',
  support text not null default '',
  created_at timestamptz not null default now()
);
alter table access_comparison_rows enable row level security;
-- The comparison table renders on the PUBLIC registration page.
drop policy if exists "access_comparison_read" on access_comparison_rows;
create policy "access_comparison_read" on access_comparison_rows
  for select to anon, authenticated using (true);
drop policy if exists "access_comparison_write" on access_comparison_rows;
create policy "access_comparison_write" on access_comparison_rows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
