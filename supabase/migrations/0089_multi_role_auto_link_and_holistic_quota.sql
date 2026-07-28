-- Admin-editable table of each role's default sign-in cap — the Sign-in
-- Access Matrix shown on /account (view-only) and managed from the admin
-- panel (Admin/Organizer only). default_sign_in_limit_for_role and
-- recompute_sign_in_quota below read from this table so an edit here
-- actually changes future defaults, not just documentation.
create table sign_in_role_defaults (
  id uuid primary key default gen_random_uuid(),
  role text not null unique,
  default_sign_in_limit int,
  tier_tied boolean not null default false,
  notes text,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

insert into sign_in_role_defaults (role, default_sign_in_limit, tier_tied, notes, sort_order) values
  ('participant', 250, true, 'Tier follows their linked registration.', 1),
  ('school', 250, true, 'Tier follows their own tier registration.', 2),
  ('sensei', 250, true, 'Tier follows their own tier registration.', 3),
  ('referee', 1000, true, 'Tier window applies, but a referee with a still-unscored assignment is never signed out until it''s cleared — only the 30-minute inactivity timeout applies then.', 4),
  ('customer_support', 1000, true, 'Tier follows the first of their (up to 3) supported tiers.', 5),
  ('organizer', null, false, 'Unlimited — exempt from quota checks entirely.', 6),
  ('admin', null, false, 'Unlimited — exempt from quota checks entirely.', 7),
  ('staff', null, false, 'Unlimited — exempt from quota checks entirely (legacy admin/organizer/support role).', 8),
  ('audience', null, false, 'Not applicable — pays per individual sign-in, no fixed count or window.', 9);

alter table sign_in_role_defaults enable row level security;
create policy sign_in_role_defaults_read on sign_in_role_defaults for select using (auth.uid() is not null);
create policy sign_in_role_defaults_admin_write on sign_in_role_defaults for all using (is_admin()) with check (is_admin());

-- Tracks whether a profile's sign-in limit/valid window are still
-- system-computed defaults (true, safe to recompute as new role/tier
-- links appear) or were explicitly set by an invitation code's own values
-- or a manual Sign-in Control save (false, never touched again).
alter table profiles add column if not exists sign_in_quota_auto boolean not null default true;

create or replace function public.default_sign_in_limit_for_role(p_role text)
returns int
language sql
stable
as $function$
  select coalesce(
    (select default_sign_in_limit from sign_in_role_defaults where role = p_role),
    case when exists (select 1 from sign_in_role_defaults where role = p_role) then null else 250 end
  );
$function$;

-- Auto-links every OTHER role/directory record sharing this email to the
-- same account — one link action now connects all of them, instead of
-- needing a separate manual link per role. Referee/Audience/School/Sensei
-- were already auto-linked at signup only; this also covers a paid
-- participant registration (previously never auto-linked at all) and
-- re-runs the same email match whenever ANY link happens afterward
-- (claim_registration, claim_registration_by_id, admin_link_registration),
-- not just at signup.
create or replace function public.auto_link_other_roles_by_email(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_email is null or p_email = '' then return; end if;

  update referees set user_id = p_user_id where user_id is null and lower(email) = lower(p_email);
  update audiences set user_id = p_user_id where user_id is null and lower(email) = lower(p_email);
  update schools set user_id = p_user_id where user_id is null and lower(email) = lower(p_email);
  update senseis set user_id = p_user_id where user_id is null and lower(email) = lower(p_email);

  if (select registration_id from profiles where user_id = p_user_id) is null then
    update profiles
    set participant_id = r.participant_id, registration_id = r.id
    from (
      select reg.id, reg.participant_id
      from registrations reg
      join participants pt on pt.id = reg.participant_id
      where reg.payment_status = 'paid'
        and lower(pt.email) = lower(p_email)
        and not exists (select 1 from profiles pr2 where pr2.registration_id = reg.id)
      order by reg.created_at asc
      limit 1
    ) r
    where profiles.user_id = p_user_id;
  end if;
end;
$function$;

-- Recomputes one profile's sign_in_limit / valid window from scratch,
-- across EVERY role and every tier association it now holds (registration,
-- school/sensei's own tier, first supported tier for Participant Support,
-- or a code-granted competition) — the sign-in limit is the BEST across
-- all its roles (an unlimited role always wins; otherwise the highest
-- finite default), and the tier used for the date window is whichever
-- associated competition is open for recording right now, else the
-- soonest upcoming one, else the most recently closed one. No-ops
-- entirely once sign_in_quota_auto is false (an invitation code's own
-- values, or a manual Sign-in Control save, always win and are never
-- recomputed away).
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
  v_chosen_from date;
  v_chosen_until date;
  v_best_open uuid;
  v_best_open_deadline date;
  v_best_upcoming uuid;
  v_best_upcoming_event date;
  v_best_past uuid;
  v_best_past_deadline date;
  c record;
begin
  select * into v_profile from profiles where user_id = p_user_id;
  if v_profile.user_id is null then return; end if;
  if not v_profile.sign_in_quota_auto then return; end if;

  foreach v_role in array coalesce(v_profile.roles, array[v_profile.role])
  loop
    if v_role = 'audience' then continue; end if;
    v_role_limit := public.default_sign_in_limit_for_role(v_role);
    if v_role_limit is null then
      v_unlimited := true;
    elsif v_best_limit is null or v_role_limit > v_best_limit then
      v_best_limit := v_role_limit;
    end if;
  end loop;

  if v_profile.registration_id is not null then
    select competition_id into v_tmp from registrations where id = v_profile.registration_id;
    if v_tmp is not null then v_candidates := array_append(v_candidates, v_tmp); end if;
  end if;
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
  if v_profile.sign_in_competition_id is not null then
    v_candidates := array_append(v_candidates, v_profile.sign_in_competition_id);
  end if;

  for c in
    select id, event_date, registration_deadline
    from competitions
    where id = any(v_candidates)
  loop
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
  v_chosen := coalesce(v_best_open, v_best_upcoming, v_best_past);

  if v_chosen is not null then
    select default_sign_in_valid_from, default_sign_in_valid_until
      into v_chosen_from, v_chosen_until
      from competitions where id = v_chosen;
  end if;

  update profiles
  set sign_in_limit = case when v_unlimited then null else v_best_limit end,
      sign_in_valid_from = v_chosen_from,
      sign_in_valid_until = v_chosen_until,
      sign_in_competition_id = coalesce(v_chosen, sign_in_competition_id)
  where user_id = p_user_id;
end;
$function$;

drop function if exists public.apply_default_sign_in_quota(uuid, text, uuid);

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
    end if;
  end if;

  insert into profiles (
    user_id, role, roles, full_name, country, email, approved, terms_accepted_at, school_id, sensei_id,
    sign_in_limit, sign_in_valid_from, sign_in_valid_until, sign_in_competition_id
  )
  values (
    new.id, v_role, v_roles,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved,
    case when v_terms_accepted then now() else null end,
    v_school_id, v_sensei_id,
    v_code_row.sign_in_limit, v_code_row.valid_from, v_code_row.valid_until, v_code_row.competition_id
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

create or replace function public.claim_registration(p_ref text, p_ic text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
  v_my_email text;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select r.* into v_reg
  from registrations r
  join participants p on p.id = r.participant_id
  where lower(r.id::text) like lower(p_ref) || '%'
    and p.ic_passport = p_ic
  limit 1;
  if v_reg.id is null then
    return 'No registration matches that reference ID + IC.';
  end if;
  if v_reg.payment_status <> 'paid' then
    return 'That registration is not paid yet — only paid participants can record.';
  end if;
  if exists (select 1 from profiles where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;
  select * into v_participant from participants where id = v_reg.participant_id;
  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = auth.uid();
  if not found then return 'Could not link — please try again.'; end if;
  select email into v_my_email from profiles where user_id = auth.uid();
  perform public.auto_link_other_roles_by_email(auth.uid(), coalesce(v_my_email, v_participant.email));
  perform public.recompute_sign_in_quota(auth.uid());
  return 'OK';
end;
$function$;

create or replace function public.claim_registration_by_id(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
  v_my_email text;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select email into v_my_email from profiles where user_id = auth.uid();
  if v_my_email is null or v_my_email = '' then return 'Your account has no email on file.'; end if;

  select r.* into v_reg from registrations r where r.id = p_registration_id;
  if v_reg.id is null then return 'Registration not found.'; end if;
  if v_reg.payment_status <> 'paid' then return 'That registration is not paid yet.'; end if;

  select * into v_participant from participants where id = v_reg.participant_id;
  if v_participant.id is null or lower(v_participant.email) <> lower(v_my_email) then
    return 'That registration does not match your account email.';
  end if;

  if exists (select 1 from profiles where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;

  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = auth.uid();
  if not found then return 'Could not link — please try again.'; end if;
  perform public.auto_link_other_roles_by_email(auth.uid(), v_my_email);
  perform public.recompute_sign_in_quota(auth.uid());
  return 'OK';
end;
$function$;

create or replace function public.admin_link_registration(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_actor_role text;
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
  v_target_user_id uuid;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select role into v_actor_role from profiles where user_id = auth.uid();
  if v_actor_role is null or v_actor_role not in ('admin', 'organizer', 'staff', 'customer_support', 'referee') then
    return 'Only Admin, Organizer, Participant Support, or Referee/Judge accounts can link a registration.';
  end if;

  select r.* into v_reg from registrations r where r.id = p_registration_id;
  if v_reg.id is null then return 'Registration not found.'; end if;
  if v_reg.payment_status <> 'paid' then
    return 'This registration is not marked paid yet — check its Slot Status first.';
  end if;

  select * into v_participant from participants where id = v_reg.participant_id;
  if v_participant.id is null or v_participant.email is null or v_participant.email = '' then
    return 'This participant has no email on file to match against.';
  end if;

  if exists (select 1 from profiles where registration_id = v_reg.id) then
    return 'That registration is already linked to an account.';
  end if;

  select user_id into v_target_user_id
  from profiles
  where lower(email) = lower(v_participant.email)
  order by (registration_id is null) desc
  limit 1;

  if v_target_user_id is null then
    return 'No account is signed up with ' || v_participant.email ||
      ' yet — the participant needs to create an account with that exact email first, then try linking again.';
  end if;

  if exists (select 1 from profiles where user_id = v_target_user_id and registration_id is not null) then
    return 'The account signed up with ' || v_participant.email ||
      ' already has a different registration linked — unlink or choose a different account first.';
  end if;

  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = v_target_user_id;

  perform public.auto_link_other_roles_by_email(v_target_user_id, v_participant.email);
  perform public.recompute_sign_in_quota(v_target_user_id);

  return 'OK';
end;
$function$;
