-- USD 10 Tier's sign-in window opened 2 days after its own event date
-- (default_sign_in_valid_from = event_date + 2), silently blocking every
-- paid participant -- including from their own recording page -- from
-- signing in at all until then. That was a plain data mismatch (the two
-- dates are independent columns with no relationship), not something
-- computed wrong.
--
-- Adds an explicit "keep this synced to Event date" flag so the organizer
-- can opt a tier into never drifting apart again -- when set, saving the
-- competition always forces default_sign_in_valid_from = event_date,
-- regardless of what's typed into that field (see saveCompetition in
-- app/actions/admin.ts). Defaults to false for every EXISTING competition,
-- since some tiers (USD 100/200 here) have deliberately much later
-- sign-in dates that must not be silently overwritten by this migration --
-- only USD 10 Tier, the one actually reported, is opted in and corrected
-- below.
alter table competitions add column if not exists sign_in_from_follows_event_date boolean not null default false;

update competitions
set sign_in_from_follows_event_date = true,
    default_sign_in_valid_from = event_date
where id = 'c1000000-0000-0000-0000-000000000001'
  and event_date is not null;

select public.recompute_sign_in_quota_for_competition('c1000000-0000-0000-0000-000000000001'::uuid);
