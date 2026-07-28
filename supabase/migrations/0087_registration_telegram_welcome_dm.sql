-- Tracks whether the "1 hour after registration" Telegram welcome DM has
-- been sent for this registration (see app/api/cron/judging-timeline's new
-- pass) — backfilled to now() for every existing row so the feature only
-- ever fires for registrations from this point forward, never retroactively
-- surprising someone who registered long ago.
alter table registrations add column if not exists telegram_welcome_sent_at timestamptz;
update registrations set telegram_welcome_sent_at = now() where telegram_welcome_sent_at is null;
