-- Tracks whether the "your certificate is now available" Telegram + email
-- notice has already gone out for a competition, so it fires exactly once
-- regardless of which path revealed winners first -- the manual "Publish
-- All Certificates" button (publishWinnersNow) or the automatic
-- deadline+30-days cron. Deliberately a separate column from
-- winners_notified_at (0070) -- that one guards the existing generic
-- "winners announced" Telegram group broadcast, a different message.
alter table competitions add column if not exists certificates_notified_at timestamptz;
