-- Tracks whether the "your recording has been fully judged" notification has
-- already been sent to the participant, so it fires exactly once per video
-- (the moment the assigned-judges count reaches the competition's
-- judges_required) — same idempotency pattern as competitions.winners_notified_at.
alter table kata_videos add column if not exists participant_notified_at timestamptz;
