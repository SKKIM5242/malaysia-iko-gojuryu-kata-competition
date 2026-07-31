-- The "every paid tier this account legitimately holds" union added in
-- migration 0094 only matched registrations through profiles.participant_id
-- -- a column almost nothing actually sets (5 profiles site-wide). Every
-- other part of the app (see getPendingRegistrations in app/account/page.tsx)
-- already treats "same email = same person, possibly several registrations"
-- as the real identity model: one sensei/parent signs up several students
-- under their own email, then switches which registration is active via
-- claimAndStartRecording. The quota window should widen the same way, or an
-- account whose currently-claimed registration happens to be their cheapest
-- tier gets short-changed on validity dates for tiers they've genuinely paid
-- into under the same email.
--
-- Net effect for an account holding paid registrations across all 3 tiers:
-- sign_in_valid_until now correctly extends to the latest tier's date
-- (e.g. USD 200's 2027-01-17) instead of being pinned to whichever single
-- registration happened to be linked last.

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
  v_total_limit int;
  v_unlimited boolean := false;
  v_roles text[];
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
  if not v_profile.sign_in_quota_auto then return; end if;

  select coalesce(array_agg(distinct lower(r)), '{}')
    into v_roles
  from unnest(
    coalesce(v_profile.roles, '{}'::text[])
    || case when v_profile.role is null then '{}'::text[] else array[v_profile.role] end
  ) r
  where r is not null and btrim(r) <> '';

  foreach v_role in array v_roles
  loop
    if v_role = 'audience' then continue; end if;
    v_role_limit := public.default_sign_in_limit_for_role(v_role);
    if v_role_limit is null then
      v_unlimited := true;
    else
      v_total_limit := coalesce(v_total_limit, 0) + v_role_limit;
    end if;
    if v_override_from is null and v_override_until is null then
      select valid_from, valid_until into v_override_from, v_override_until
        from sign_in_role_defaults
        where lower(role_key) = v_role or lower(role) = v_role
        order by (lower(role_key) = v_role) desc nulls last
        limit 1;
    end if;
  end loop;

  if v_override_from is not null or v_override_until is not null then
    update profiles
    set sign_in_limit = case when v_unlimited then null else v_total_limit end,
        sign_in_valid_from = v_override_from,
        sign_in_valid_until = v_override_until
    where user_id = p_user_id;
    return;
  end if;

  if v_profile.registration_id is not null then
    select competition_id into v_tmp from registrations where id = v_profile.registration_id;
    if v_tmp is not null then v_candidates := array_append(v_candidates, v_tmp); end if;
  end if;
  -- ...plus every other PAID registration on this account: reached through
  -- user_id, through the linked participant record (participant_id), OR
  -- (new) through a participant row sharing this profile's email — the same
  -- match getPendingRegistrations uses to list "Pending Recordings".
  select coalesce(array_agg(distinct cand.competition_id), '{}')
    into v_candidates
  from (
    select unnest(v_candidates) as competition_id
    union
    select reg.competition_id
    from registrations reg
    left join participants pt on pt.id = reg.participant_id
    where reg.competition_id is not null
      and reg.payment_status = 'paid'
      and (
        reg.user_id = p_user_id
        or (v_profile.participant_id is not null and reg.participant_id = v_profile.participant_id)
        or (v_profile.email is not null and pt.email is not null and lower(pt.email) = lower(v_profile.email))
      )
  ) cand;

  if v_profile.school_id is not null then
    select registration_competition_id into v_tmp from schools where id = v_profile.school_id;
    if v_tmp is not null then v_candidates := array_append(v_candidates, v_tmp); end if;
  end if;
  if v_profile.sensei_id is not null then
    select registration_competition_id into v_tmp from senseis where id = v_profile.sensei_id;
    if v_tmp is not null then v_candidates := array_append(v_candidates, v_tmp); end if;
  end if;
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
  set sign_in_limit = case when v_unlimited then null else v_total_limit end,
      sign_in_valid_from = v_from,
      sign_in_valid_until = v_until,
      sign_in_competition_id = coalesce(v_chosen, sign_in_competition_id)
  where user_id = p_user_id;
end;
$function$;

do $$
declare u uuid;
begin
  for u in select user_id from profiles where sign_in_quota_auto loop
    perform public.recompute_sign_in_quota(u);
  end loop;
end $$;
