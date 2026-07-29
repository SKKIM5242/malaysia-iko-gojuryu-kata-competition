-- Two admin-reference tables for the /admin/content page: a catalogue of
-- every button in the app and what notifications it does/doesn't trigger
-- (email, Telegram DM, "join group" link), and a role-by-role summary of
-- who can ever end up Telegram-linked. Both are documentation the
-- organizer maintains by hand (like access_matrix_rows), not derived from
-- live data — same editable-table + CSV import/export pattern.
create table if not exists notification_reference_rows (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  page text not null,
  button_label text not null,
  sends_email text not null default '',
  sends_telegram_dm text not null default '',
  telegram_group_link text not null default '',
  notes text,
  created_at timestamptz not null default now()
);
alter table notification_reference_rows enable row level security;
drop policy if exists "notification_reference_read" on notification_reference_rows;
create policy "notification_reference_read" on notification_reference_rows
  for select to authenticated using (true);
drop policy if exists "notification_reference_write" on notification_reference_rows;
create policy "notification_reference_write" on notification_reference_rows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists telegram_link_reference_rows (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  role text not null,
  can_be_linked text not null default '',
  how_to_link text not null default '',
  notes text,
  created_at timestamptz not null default now()
);
alter table telegram_link_reference_rows enable row level security;
drop policy if exists "telegram_link_reference_read" on telegram_link_reference_rows;
create policy "telegram_link_reference_read" on telegram_link_reference_rows
  for select to authenticated using (true);
drop policy if exists "telegram_link_reference_write" on telegram_link_reference_rows;
create policy "telegram_link_reference_write" on telegram_link_reference_rows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
