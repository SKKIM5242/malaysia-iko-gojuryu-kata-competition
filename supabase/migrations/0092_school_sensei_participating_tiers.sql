-- Which competition tiers a School / Sensei says they will have participants
-- in, captured at registration time on both the public and admin forms.
--
-- This is DECLARED INTENT, not a fact: it is filled in before the school's
-- students have actually registered for anything. Commission is therefore
-- still computed from real paid registrations (see lib/commissions.ts) --
-- this column exists so the organizer can see, up front, which tiers a
-- school expects to bring students to, and chase the ones that never
-- materialise.
--
-- Stored as an array of competition ids rather than three boolean columns so
-- it keeps working if a fourth tier is ever added, and so each entry is a
-- real foreign-key-shaped reference to competitions.id rather than a
-- hardcoded "usd10"-style string.

alter table schools  add column if not exists participating_tier_ids uuid[] not null default '{}';
alter table senseis  add column if not exists participating_tier_ids uuid[] not null default '{}';

comment on column schools.participating_tier_ids is
  'Competition tiers this school declares it will have participants in. Declared intent, captured on the registration form -- actual commission is computed from paid registrations, not from this.';
comment on column senseis.participating_tier_ids is
  'Competition tiers this sensei declares they will have participants in. Declared intent, captured on the registration form -- actual commission is computed from paid registrations, not from this.';
