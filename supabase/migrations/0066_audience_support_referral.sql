-- Optional: which Participant Support member recommended this Audience
-- sign-in (their short name/initial, e.g. "Amy" or "KSK") -- the basis for
-- the 10% Audience sign-in cut the organizer pays that Participant
-- Support member. Left blank unless a Participant Support member really
-- did recommend the sign-in.
alter table audiences add column if not exists support_referral text;
