-- Two live sign-in bugs, both confirmed against production before this ran.
--
-- BUG 1 — every role resolved to 250 sign-ins, including Admin/Organizer.
--
-- sign_in_role_defaults.role was doing double duty: the join key onto
-- profiles.role AND the free-text label the organizer edits on
-- /admin/content. Relabelling the rows there ('participant' -> 'Participant',
-- 'customer_support' -> 'Participant_Support', plus a new display-only
-- 'Winner' row) silently broke every lookup, so
-- default_sign_in_limit_for_role fell through to its hardcoded 250 for all
-- nine roles. Verified live before this migration:
--   select public.default_sign_in_limit_for_role('admin');  -- 250, must be NULL
--   select public.default_sign_in_limit_for_role('referee'); -- 250, must be 1000
-- The correct 1000s and NULLs still sitting in profiles are stale values
-- written before the relabel — the next recompute would have clobbered them,
-- capping admins at 250 sign-ins.
--
-- Fix: role_key is the stable join key, role stays the editable label.
--
-- BUG 2 — a multi-tier participant got one tier's window wholesale.
--
-- recompute_sign_in_quota picked a single "chosen" competition and copied its
-- default_sign_in_valid_from/until. Someone entered in the USD 200 Tier was
-- therefore locked out until 2026-10-25 even though their USD 10 Tier entry
-- opens 2026-08-10. Per the organizer's confirmed rule, a multi-tier
-- registrant gets the MOST GENEROUS window across everything they hold:
-- earliest valid_from, latest valid_until. It also only looked at the one
-- profiles.registration_id and only support_tier_1_id, ignoring the account's
-- other paid registrations and supported tiers 2 and 3.

-- ---------------------------------------------------------------- role_key

alter table sign_in_role_defaults add column if not exists role_key text;

comment on column sign_in_role_defaults.role_key is
  'Stable join key onto profiles.role / profiles.roles. Distinct from `role`, '
  'which is the display label the organizer may rename freely on '
  '/admin/content. NULL marks a display-only row that matches no account.';
comment on column sign_in_role_defaults.role is
  'Display label only — safe to rename. Lookups use role_key.';

-- Backfill from whatever the labels have been edited to. Anything that is
-- not a real profile role (e.g. the 'Winner' display row) stays NULL and so
-- matches no account.
update sign_in_role_defaults
set role_key = case
  when lower(role) in ('participant','school','sensei','referee',
                       'customer_support','organizer','admin','staff','audience')
    then lower(role)
  when lower(role) in ('participant_support','support','participant support')
    then 'customer_support'
  else null
end
where role_key is null;

create unique index if not exists sign_in_role_defaults_role_key_uniq
  on sign_in_role_defaults (lower(role_key)) where role_key is not null;

-- --------------------------------------------------- limit lookup by key

create or replace function public.default_sign_in_limit_for_role(p_role text)
returns int
language sql
stable
set search_path to 'public'
as $function$
  -- Matches on role_key first (case-insensitive), then falls back to the
  -- display label so a hand-inserted row without a key still resolves. The
  -- trailing 250 applies only when the role is absent from the table
  -- entirely; a row that is present with a NULL limit means UNLIMITED and
  -- must return NULL, which is why the two are distinguished here.
  select case
    when exists (
      select 1 from sign_in_role_defaults
      where lower(role_key) = lower(p_role) or lower(role) = lower(p_role)
    )
    then (
      select default_sign_in_limit from sign_in_role_defaults
      where lower(role_key) = lower(p_role) or lower(role) = lower(p_role)
      order by (lower(role_key) = lower(p_role)) desc nulls last
      limit 1
    )
    else 250
  end;
$function$;

-- ------------------------------------------- generous multi-tier window

create or replace function public.recompute_sign_in_quota(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile profiles%rowtype;
  v_role text;
  v_role_limit int;
  v_best_limit int;
  v_unlimited boolean := false;
  v_candidates uuid[] := '{}';
  v_tmp uuid;
  v_today date := current_date;
  v_chosen uuid;
  v_from date;
  v_until date;
  v_any_open_from boolean := false;
  v_any_open_until boolean := false;
  v_best_open uuid;
  v_best_open_deadline date;
  v_best_upcoming uuid;
  v_best_upcoming_event date;
  v_best_past uuid;
  v_best_past_deadline date;
  v_override_from date;
  v_override_until date;
  c record;
begin
  select * into v_profile from profiles where user_id = p_user_id;
  if v_profile.user_id is null then return; end if;
  -- A manually set quota (sign_in_quota_auto = false) is the organizer's
  -- deliberate override and is never recomputed.
  if not v_profile.sign_in_quota_auto then return; end if;

  foreach v_role in array coalesce(v_profile.roles, array[v_profile.role])
  loop
    if lower(v_role) = 'audience' then continue; end if;
    v_role_limit := public.default_sign_in_limit_for_role(v_role);
    if v_role_limit is null then
      v_unlimited := true;
    elsif v_best_limit is null or v_role_limit > v_best_limit then
      v_best_limit := v_role_limit;
    end if;
    -- An explicit validity override on the role default (rather than the
    -- tier-derived window) wins outright — first matching role's override
    -- is used if more than one of this account's roles has one set.
    if v_override_from is null and v_override_until is null then
      select valid_from, valid_until into v_override_from, v_override_until
        from sign_in_role_defaults
        where lower(role_key) = lower(v_role) or lower(role) = lower(v_role)
        order by (lower(role_key) = lower(v_role)) desc nulls last
        limit 1;
    end if;
  end loop;

  if v_override_from is not null or v_override_until is not null then
    update profiles
    set sign_in_limit = case when v_unlimited then null else v_best_limit end,
        sign_in_valid_from = v_override_from,
        sign_in_valid_until = v_override_until
    where user_id = p_user_id;
    return;
  end if;

  -- Every tier this account legitimately holds, not just one of them.
  if v_profile.registration_id is not null then
    select competition_id into v_tmp from registrations where id = v_profile.registration_id;
    if v_tmp is not null then v_candidates := array_append(v_candidates, v_tmp); end if;
  end if;
  -- ...plus every other PAID registration on this account, whether it was
  -- reached through the user_id or through the linked participant record.
  select coalesce(array_agg(distinct cand.competition_id), '{}')
    into v_candidates
  from (
    select unnest(v_candidates) as competition_id
    union
    select reg.competition_id
    from registrations reg
    where reg.competition_id is not null
      and reg.payment_status = 'paid'
      and (reg.user_id = p_user_id
           or (v_profile.participant_id is not null
               and reg.participant_id = v_profile.participant_id))
  ) cand;

  if v_profile.school_id is not null then
    select registration_competition_id into v_tmp from schools where id = v_profile.school_id;
    if v_tmp is not null then v_candidates := array_append(v_candidates, v_tmp); end if;
  end if;
  if v_profile.sensei_id is not null then
    select registration_competition_id into v_tmp from senseis where id = v_profile.sensei_id;
    if v_tmp is not null then v_candidates := array_append(v_candidates, v_tmp); end if;
  end if;
  -- All three supported tiers, not only the first — a support account covering
  -- three tiers needs a window spanning all three.
  if v_profile.support_tier_1_id is not null then
    v_candidates := array_append(v_candidates, v_profile.support_tier_1_id);
  end if;
  if v_profile.support_tier_2_id is not null then
    v_candidates := array_append(v_candidates, v_profile.support_tier_2_id);
  end if;
  if v_profile.support_tier_3_id is not null then
    v_candidates := array_append(v_candidates, v_profile.support_tier_3_id);
  end if;
  if v_profile.sign_in_competition_id is not null then
    v_candidates := array_append(v_candidates, v_profile.sign_in_competition_id);
  end if;

  for c in
    select id, event_date, registration_deadline,
           default_sign_in_valid_from, default_sign_in_valid_until
    from competitions
    where id = any(v_candidates)
  loop
    -- MOST GENEROUS window across every candidate: earliest start, latest
    -- end. A NULL on either side means "unbounded" to isWithinSignInQuota
    -- (lib/sign-in-quota.ts), so a single unconfigured tier makes that side
    -- unbounded rather than being skipped by min()/max().
    if c.default_sign_in_valid_from is null then
      v_any_open_from := true;
    elsif v_from is null or c.default_sign_in_valid_from < v_from then
      v_from := c.default_sign_in_valid_from;
    end if;
    if c.default_sign_in_valid_until is null then
      v_any_open_until := true;
    elsif v_until is null or c.default_sign_in_valid_until > v_until then
      v_until := c.default_sign_in_valid_until;
    end if;

    -- sign_in_competition_id still names ONE tier, for display and tier
    -- attribution elsewhere: prefer an open one, else the nearest upcoming,
    -- else the most recent past.
    if c.event_date is not null and c.event_date <= v_today
       and (c.registration_deadline is null or v_today <= c.registration_deadline) then
      if v_best_open is null or c.registration_deadline < v_best_open_deadline then
        v_best_open := c.id; v_best_open_deadline := c.registration_deadline;
      end if;
    elsif c.event_date is not null and c.event_date > v_today then
      if v_best_upcoming is null or c.event_date < v_best_upcoming_event then
        v_best_upcoming := c.id; v_best_upcoming_event := c.event_date;
      end if;
    else
      if v_best_past is null or c.registration_deadline > v_best_past_deadline then
        v_best_past := c.id; v_best_past_deadline := c.registration_deadline;
      end if;
    end if;
  end loop;

  if v_any_open_from then v_from := null; end if;
  if v_any_open_until then v_until := null; end if;
  v_chosen := coalesce(v_best_open, v_best_upcoming, v_best_past);

  update profiles
  set sign_in_limit = case when v_unlimited then null else v_best_limit end,
      sign_in_valid_from = v_from,
      sign_in_valid_until = v_until,
      sign_in_competition_id = coalesce(v_chosen, sign_in_competition_id)
  where user_id = p_user_id;
end;
$function$;

-- Repair every auto-managed account that is currently carrying a value
-- written by the broken lookup. Accounts with sign_in_quota_auto = false are
-- skipped by the function itself, so manual overrides survive.
do $$
declare u uuid;
begin
  for u in select user_id from profiles where sign_in_quota_auto loop
    perform public.recompute_sign_in_quota(u);
  end loop;
end $$;
