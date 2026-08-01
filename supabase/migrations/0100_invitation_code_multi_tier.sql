-- Multi-tier invitation codes: one code can now grant access across a
-- contiguous range of competition tiers (e.g. "USD 10 Tier + USD 100 Tier")
-- instead of exactly one. competition_id is kept as the cheapest/primary
-- tier for backward compatibility with existing single-tier consumers
-- (display, sign_in_competition_id); competition_ids carries the full set.
alter table invitation_codes add column if not exists competition_ids uuid[];
update invitation_codes set competition_ids = array[competition_id] where competition_ids is null and competition_id is not null;

-- Mirrors support_tier_1/2/3_id's existing role in recompute_sign_in_quota:
-- another source of candidate competitions folded into the widest-window
-- calculation, but as a single array so it works for every role, not just
-- customer_support's fixed 3 slots.
alter table profiles add column if not exists invite_competition_ids uuid[];

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_allowed text[] := array['participant','referee','staff','organizer','customer_support','audience','school','sensei','admin'];
  v_roles text[];
  v_role text;
  v_code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  v_approved boolean := false;
  v_terms_accepted boolean := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);
  v_code_row invitation_codes%rowtype;
  v_school_id uuid;
  v_sensei_id uuid;
  v_invite_competition_ids uuid[];
begin
  if jsonb_typeof(new.raw_user_meta_data->'roles') = 'array' then
    select array_agg(value) into v_roles
      from jsonb_array_elements_text(new.raw_user_meta_data->'roles');
  end if;
  if v_roles is null or array_length(v_roles, 1) is null then
    v_roles := array[coalesce(new.raw_user_meta_data->>'role', 'participant')];
  end if;
  v_roles := array(select unnest(v_roles) intersect select unnest(v_allowed));
  if v_roles is null or array_length(v_roles, 1) is null then
    v_roles := array['participant'];
  end if;
  v_role := v_roles[1];

  if v_code is not null and v_role in ('referee','staff','audience','school','sensei','organizer','customer_support','admin') then
    select * into v_code_row from invitation_codes
      where code = v_code and active
        and (max_uses is null or use_count < max_uses)
        and (role = v_role or role = 'any')
        and (email is null or lower(email) = lower(new.email))
        and (valid_from is null or valid_from <= current_date)
        and (valid_until is null or valid_until >= current_date)
      limit 1;
    if v_code_row.id is not null then
      v_approved := true;
      update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
      if v_role = 'school' then v_school_id := v_code_row.for_record_id; end if;
      if v_role = 'sensei' then v_sensei_id := v_code_row.for_record_id; end if;
      v_invite_competition_ids := coalesce(v_code_row.competition_ids, case when v_code_row.competition_id is not null then array[v_code_row.competition_id] else null end);
    end if;
  end if;

  insert into profiles (
    user_id, role, roles, full_name, country, email, approved, terms_accepted_at, school_id, sensei_id,
    sign_in_limit, sign_in_valid_from, sign_in_valid_until, sign_in_competition_id, invite_competition_ids
  )
  values (
    new.id, v_role, v_roles,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved,
    case when v_terms_accepted then now() else null end,
    v_school_id, v_sensei_id,
    v_code_row.sign_in_limit, v_code_row.valid_from, v_code_row.valid_until, v_code_row.competition_id,
    v_invite_competition_ids
  )
  on conflict (user_id) do nothing;

  if v_code_row.id is not null and (v_code_row.sign_in_limit is not null or v_code_row.valid_from is not null or v_code_row.valid_until is not null) then
    update profiles set sign_in_quota_auto = false where user_id = new.id;
  end if;

  perform public.auto_link_other_roles_by_email(new.id, new.email);
  perform public.recompute_sign_in_quota(new.id);
  return new;
end;
$function$;

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
  if v_profile.invite_competition_ids is not null then
    v_candidates := v_candidates || v_profile.invite_competition_ids;
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

create or replace function public.recompute_sign_in_quota_for_competition(p_competition_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select distinct p.user_id
    from profiles p
    left join registrations r on r.id = p.registration_id
    left join schools s on s.id = p.school_id
    left join senseis se on se.id = p.sensei_id
    where p.sign_in_competition_id = p_competition_id
       or r.competition_id = p_competition_id
       or s.registration_competition_id = p_competition_id
       or se.registration_competition_id = p_competition_id
       or p.support_tier_1_id = p_competition_id
       or p.support_tier_2_id = p_competition_id
       or p.support_tier_3_id = p_competition_id
       or p_competition_id = any(p.invite_competition_ids)
       or exists (
         select 1 from registrations reg
         left join participants pt2 on pt2.id = reg.participant_id
         where reg.competition_id = p_competition_id
           and reg.payment_status = 'paid'
           and (
             reg.user_id = p.user_id
             or (p.participant_id is not null and reg.participant_id = p.participant_id)
             or (p.email is not null and pt2.email is not null and lower(pt2.email) = lower(p.email))
           )
       )
  loop
    perform public.recompute_sign_in_quota(v_user_id);
  end loop;
end;
$function$;
