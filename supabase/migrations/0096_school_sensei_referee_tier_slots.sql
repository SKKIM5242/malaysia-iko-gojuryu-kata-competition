-- Replaces the checkbox-based participating_tier_ids (migration 0092) with
-- the same 3-slot convention already used for Participant Support
-- (support_tier_1_id/2_id/3_id — see StaffAccountEditForm.tsx and
-- CommunityForms.tsx) so School, Sensei, and Referee use one consistent
-- "Tier 1 / Tier 2 / Tier 3" UI pattern across the whole app instead of two
-- different ones. Tier 1 is required at the form level (not enforced by a
-- DB constraint, since existing rows have none set yet); Tier 2 and 3 stay
-- optional.
--
-- This is still DECLARED INTENT, not a fact -- see the same note on
-- migration 0092. Commission stays computed from real paid registrations
-- (lib/commissions.ts) and is untouched by this migration.

alter table schools drop column if exists participating_tier_ids;
alter table senseis drop column if exists participating_tier_ids;

alter table schools  add column if not exists participating_tier_1_id uuid references competitions(id) on delete set null;
alter table schools  add column if not exists participating_tier_2_id uuid references competitions(id) on delete set null;
alter table schools  add column if not exists participating_tier_3_id uuid references competitions(id) on delete set null;

alter table senseis  add column if not exists participating_tier_1_id uuid references competitions(id) on delete set null;
alter table senseis  add column if not exists participating_tier_2_id uuid references competitions(id) on delete set null;
alter table senseis  add column if not exists participating_tier_3_id uuid references competitions(id) on delete set null;

alter table referees add column if not exists participating_tier_1_id uuid references competitions(id) on delete set null;
alter table referees add column if not exists participating_tier_2_id uuid references competitions(id) on delete set null;
alter table referees add column if not exists participating_tier_3_id uuid references competitions(id) on delete set null;

comment on column schools.participating_tier_1_id is 'Tiers this school declares it will have participants in (1 required, 2-3 optional) -- declared intent, not a commission input.';
comment on column senseis.participating_tier_1_id is 'Tiers this sensei declares they will have participants in (1 required, 2-3 optional) -- declared intent, not a commission input.';
comment on column referees.participating_tier_1_id is 'Tiers this referee declares they will judge (1 required, 2-3 optional). The USD 100 deposit already covers all 3 tiers regardless of what is selected here -- this is for scheduling/expectation only.';
