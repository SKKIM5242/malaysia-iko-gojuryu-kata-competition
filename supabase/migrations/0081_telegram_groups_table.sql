-- Telegram group invite links were hardcoded as TELEGRAM_GROUP_* Vercel env
-- vars, which meant every edit required a CLI/dashboard change and a
-- redeploy. Move them into a DB-backed, admin-editable table so Admin/
-- Organizer/Staff can add, edit, and delete groups directly from
-- /admin/telegram -- same pattern as access_matrix_rows / access_comparison_rows
-- (0057_editable_access_tables.sql). Seeded with the current live links so
-- this is a drop-in replacement with no functional change.
create table if not exists telegram_groups (
  id uuid primary key default gen_random_uuid(),
  category text not null unique,
  label text not null,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table telegram_groups enable row level security;

-- Group links appear on public registration pages (School/Sensei/Referee/
-- Audience/Staff forms, the post-payment thank-you page, etc.), so anon
-- needs read access too -- same as access_comparison_rows.
drop policy if exists "telegram_groups_read" on telegram_groups;
create policy "telegram_groups_read" on telegram_groups
  for select to anon, authenticated using (true);

drop policy if exists "telegram_groups_write" on telegram_groups;
create policy "telegram_groups_write" on telegram_groups
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into telegram_groups (category, label, url, sort_order) values
  ('participant', 'Participants', 'https://t.me/+mfpuPeHf6gs5Y2Rl', 1),
  ('school', 'School / Dojo & Sensei / Coach', 'https://t.me/+JjPOjCHLOzNlMzRl', 2),
  ('referee', 'Referees / Judges', 'https://t.me/+WfAyMh5t9t02N2Rl', 3),
  ('audience', 'Audience / Spectators', 'https://t.me/+15XLZ1AK8nAwNWFl', 4),
  ('staff', 'Admin / Organizer / Participant Support', 'https://t.me/+pCKynJO6wLJmZjhl', 5),
  ('class', 'Dojo Class Students', 'https://t.me/+AuQzOz-cEiBlZjll', 6)
on conflict (category) do nothing;
