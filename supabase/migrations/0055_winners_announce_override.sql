-- Per-competition overrides for the default "deadline + 30 days, next
-- Malaysia working day" winners rule: a manually set announcement date
-- (the organizer wants some tiers to be special), plus a recommended
-- public/audience sign-in date shown alongside it.
alter table competitions add column if not exists winners_announce_date date;
alter table competitions add column if not exists audience_signin_date date;
