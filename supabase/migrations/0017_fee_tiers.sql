-- Three separate paid tiers of the same championship, each closing at
-- whichever comes first: its own participant cap, or 31 Dec 2026.

alter table competitions add column if not exists max_participants int;

create or replace function public.competition_paid_count(p_competition uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from registrations
  where competition_id = p_competition and payment_status = 'paid';
$$;
grant execute on function public.competition_paid_count(uuid) to anon, authenticated;

do $$
declare
  v_tier1 uuid := 'c1000000-0000-0000-0000-000000000001';
  v_tier2 uuid := gen_random_uuid();
  v_tier3 uuid := gen_random_uuid();
  v_venue text;
  v_event_date date;
  v_description text;
  v_status text;
begin
  select venue, event_date, description, status
    into v_venue, v_event_date, v_description, v_status
  from competitions where id = v_tier1;

  update competitions
  set name = 'Malaysia Open IKO Goju-ryu Kata Championship 2026 — USD 10 Tier',
      max_participants = 100,
      registration_deadline = '2026-12-31',
      registration_fee_usd = 10
  where id = v_tier1;

  insert into competitions
    (id, name, venue, event_date, registration_deadline, registration_fee_usd, status, description, max_participants)
  values
    (v_tier2, 'Malaysia Open IKO Goju-ryu Kata Championship 2026 — USD 100 Tier',
     v_venue, v_event_date, '2026-12-31', 100, v_status, v_description, 200);

  insert into competitions
    (id, name, venue, event_date, registration_deadline, registration_fee_usd, status, description, max_participants)
  values
    (v_tier3, 'Malaysia Open IKO Goju-ryu Kata Championship 2026 — USD 200 Tier',
     v_venue, v_event_date, '2026-12-31', 200, v_status, v_description, 200);

  -- Same 24-kata x belt x age structure for the two new tiers.
  insert into categories (competition_id, name, age_min, age_max, belt_group, gender, sort_order)
  select v_tier2, name, age_min, age_max, belt_group, gender, sort_order
  from categories where competition_id = v_tier1;

  insert into categories (competition_id, name, age_min, age_max, belt_group, gender, sort_order)
  select v_tier3, name, age_min, age_max, belt_group, gender, sort_order
  from categories where competition_id = v_tier1;
end $$;
