-- Tier-based default sign-in validity window, populated per fee tier.
alter table competitions add column if not exists default_sign_in_valid_from date;
alter table competitions add column if not exists default_sign_in_valid_until date;
update competitions set default_sign_in_valid_from = '2026-08-10', default_sign_in_valid_until = '2026-10-16' where registration_fee_usd = 10;
update competitions set default_sign_in_valid_from = '2026-09-30', default_sign_in_valid_until = '2026-12-17' where registration_fee_usd = 100;
update competitions set default_sign_in_valid_from = '2026-10-25', default_sign_in_valid_until = '2027-01-17' where registration_fee_usd = 200;

-- Renewal pricing/terms, tracked on the request itself for display and for
-- the Stripe checkout line item (amount_usd is fixed at request time; the
-- sign-in window fields are filled in at payment time, "from date of
-- purchase").
alter table subscription_renewals add column if not exists competition_id uuid references competitions(id);
alter table subscription_renewals add column if not exists amount_usd numeric;
alter table subscription_renewals add column if not exists sign_in_limit int;
alter table subscription_renewals add column if not exists valid_from date;
alter table subscription_renewals add column if not exists valid_until date;

-- Role's default sign-in cap, applied only when nothing has already set
-- one (an invitation code's own sign_in_limit, or a prior admin override,
-- always wins). Audience is deliberately excluded by every caller below —
-- their per-sign-in payment model has no comparable "cap" concept.
create or replace function public.default_sign_in_limit_for_role(p_role text)
returns int
language sql
immutable
as $function$
  select case
    when p_role in ('referee', 'customer_support') then 1000
    when p_role in ('organizer', 'admin', 'staff') then null
    else 250
  end;
$function$;

-- Fills in sign_in_limit / sign_in_valid_from / sign_in_valid_until for one
-- profile — but ONLY the fields that are still null, so it never clobbers
-- an invitation code's own values or a manual Sign-in Control override.
-- Called right after profile creation (handle_new_user) and again whenever
-- a registration/directory record gets linked to an account later
-- (claim_registration, claim_registration_by_id, admin_link_registration,
-- and the school/sensei auto-link block below), since a plain
-- self-registration has no known competition tier until that link happens.
create or replace function public.apply_default_sign_in_quota(p_user_id uuid, p_role text, p_competition_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_default_from date;
  v_default_until date;
begin
  if p_role = 'audience' then return; end if;

  update profiles
  set sign_in_limit = coalesce(sign_in_limit, public.default_sign_in_limit_for_role(p_role))
  where user_id = p_user_id;

  if p_competition_id is not null then
    select default_sign_in_valid_from, default_sign_in_valid_until
      into v_default_from, v_default_until
      from competitions where id = p_competition_id;
    update profiles
    set sign_in_valid_from = coalesce(sign_in_valid_from, v_default_from),
        sign_in_valid_until = coalesce(sign_in_valid_until, v_default_until),
        sign_in_competition_id = coalesce(sign_in_competition_id, p_competition_id)
    where user_id = p_user_id;
  end if;
end;
$function$;

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
  v_matched_school_comp uuid;
  v_matched_sensei_comp uuid;
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

  perform public.apply_default_sign_in_quota(new.id, v_role, v_code_row.competition_id);

  if 'referee' = any(v_roles) then
    update referees set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  if 'audience' = any(v_roles) then
    update audiences set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  if 'school' = any(v_roles) then
    update schools set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
    select registration_competition_id into v_matched_school_comp
      from schools where user_id = new.id and lower(email) = lower(new.email) limit 1;
    if v_matched_school_comp is not null then
      perform public.apply_default_sign_in_quota(new.id, 'school', v_matched_school_comp);
    end if;
  end if;
  if 'sensei' = any(v_roles) then
    update senseis set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
    select registration_competition_id into v_matched_sensei_comp
      from senseis where user_id = new.id and lower(email) = lower(new.email) limit 1;
    if v_matched_sensei_comp is not null then
      perform public.apply_default_sign_in_quota(new.id, 'sensei', v_matched_sensei_comp);
    end if;
  end if;
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
  perform public.apply_default_sign_in_quota(auth.uid(), 'participant', v_reg.competition_id);
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
  perform public.apply_default_sign_in_quota(auth.uid(), 'participant', v_reg.competition_id);
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

  perform public.apply_default_sign_in_quota(v_target_user_id, 'participant', v_reg.competition_id);

  return 'OK';
end;
$function$;
