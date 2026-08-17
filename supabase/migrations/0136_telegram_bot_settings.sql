-- Moves the bot username out of Vercel-env-var-only storage into a DB
-- singleton, matching the telegram_groups pattern above it on the same
-- admin page: editable without a Vercel redeploy. TELEGRAM_BOT_TOKEN and
-- TELEGRAM_WEBHOOK_SECRET stay Vercel-only -- they're real secrets that
-- must never reach a page, unlike the username (which is just as visible
-- to anyone who finds the bot on Telegram itself).

create table if not exists telegram_bot_settings (
  id boolean primary key default true check (id),
  bot_username text,
  updated_at timestamptz not null default now()
);
insert into telegram_bot_settings (id) values (true) on conflict do nothing;
alter table telegram_bot_settings enable row level security;

drop policy if exists "telegram_bot_settings_select" on telegram_bot_settings;
create policy "telegram_bot_settings_select" on telegram_bot_settings
  for select to authenticated, anon using (true);

-- Reuses is_competition_manager() (defined in 0075_certificates.sql) --
-- the same admin/organizer/staff set already gated to edit Telegram groups.
drop policy if exists "telegram_bot_settings_write" on telegram_bot_settings;
create policy "telegram_bot_settings_write" on telegram_bot_settings
  for all to authenticated
  using (public.is_competition_manager())
  with check (public.is_competition_manager());
