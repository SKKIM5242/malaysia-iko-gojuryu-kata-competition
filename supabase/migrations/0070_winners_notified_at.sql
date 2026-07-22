-- Tracks whether the daily judging-timeline cron has already posted the
-- "winners announced" Telegram notification for a competition, so it fires
-- exactly once on (or the first cron run after) winners_announce_date.
alter table competitions add column if not exists winners_notified_at timestamptz;
