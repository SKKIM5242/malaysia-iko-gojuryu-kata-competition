-- Lets one login (typically a Sensei who put their own email on several
-- students' registrations so they can help with recording) hold MORE THAN
-- ONE linked participant at a time. profiles.participant_id/registration_id
-- keep working exactly as before as the account's PRIMARY link -- every
-- existing single-registration code path (certificates ownership,
-- winners/testimonial "is this mine" checks, the admin Registrations page's
-- profile<->registration map) keeps resolving against that one field,
-- unchanged. This is additive: profile_participants holds every linked
-- registration (primary included), and only Kata Arena listing, the
-- recorder, and sign-in quota are updated to use it.

create table if not exists profile_participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (registration_id)
);
create index if not exists profile_participants_user_id_idx on profile_participants(user_id);

alter table profile_participants enable row level security;
drop policy if exists "profile_participants_select_own" on profile_participants;
create policy "profile_participants_select_own" on profile_participants
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Backfill: every profile that already has a primary link gets one row here,
-- so nothing changes for accounts that predate this feature.
insert into profile_participants (user_id, participant_id, registration_id)
select user_id, participant_id, registration_id
from profiles
where registration_id is not null and participant_id is not null
on conflict (registration_id) do nothing;

-- ── Bulk-link every paid registration matching an email, not just the
--    first one -- mirrors auto_link_other_roles_by_email's pattern but for
--    participants, which are otherwise limited to a single link. ──────────
create or replace function public.auto_link_participants_by_email(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first_participant_id uuid;
  v_first_registration_id uuid;
begin
  if p_email is null or p_email = '' then return; end if;

  insert into profile_participants (user_id, participant_id, registration_id)
  select p_user_id, reg.participant_id, reg.id
  from registrations reg
  join participants pt on pt.id = reg.participant_id
  where reg.payment_status = 'paid'
    and lower(pt.email) = lower(p_email)
    and not exists (select 1 from profile_participants pp where pp.registration_id = reg.id)
  order by reg.created_at asc
  on conflict (registration_id) do nothing;

  if (select registration_id from profiles where user_id = p_user_id) is null then
    select participant_id, registration_id into v_first_participant_id, v_first_registration_id
    from profile_participants
    where user_id = p_user_id
    order by created_at asc
    limit 1;
    if v_first_registration_id is not null then
      update profiles
      set participant_id = v_first_participant_id, registration_id = v_first_registration_id
      where user_id = p_user_id;
    end if;
  end if;
end;
$function$;
-- Called directly from the client (claimAndStartRecording re-syncing on
-- every "Start Recording" click), unlike auto_link_other_roles_by_email
-- which is only ever reached indirectly via perform from another
-- SECURITY DEFINER function — needs its own explicit grant.
grant execute on function public.auto_link_participants_by_email(uuid, text) to authenticated;

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
  perform public.auto_link_participants_by_email(new.id, new.email);
  perform public.recompute_sign_in_quota(new.id);
  return new;
end;
$function$;

-- ── claim_registration / claim_registration_by_id / admin_link_registration:
--    now ADD to profile_participants instead of only overwriting the single
--    primary pointer -- and only set the primary pointer when it's still
--    null, so claiming a second registration never steals the slot from the
--    first. The "already claimed" guard now checks profile_participants
--    (the actual claimed set), not just the primary field. ────────────────
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
  if exists (select 1 from profile_participants where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;
  select * into v_participant from participants where id = v_reg.participant_id;

  insert into profile_participants (user_id, participant_id, registration_id)
  values (auth.uid(), v_reg.participant_id, v_reg.id)
  on conflict (registration_id) do nothing;

  update profiles
  set participant_id = coalesce(participant_id, v_reg.participant_id),
      registration_id = coalesce(registration_id, v_reg.id),
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

  if exists (select 1 from profile_participants where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;

  insert into profile_participants (user_id, participant_id, registration_id)
  values (auth.uid(), v_reg.participant_id, v_reg.id)
  on conflict (registration_id) do nothing;

  update profiles
  set participant_id = coalesce(participant_id, v_reg.participant_id),
      registration_id = coalesce(registration_id, v_reg.id),
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

  if exists (select 1 from profile_participants where registration_id = v_reg.id) then
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

  insert into profile_participants (user_id, participant_id, registration_id)
  values (v_target_user_id, v_reg.participant_id, v_reg.id)
  on conflict (registration_id) do nothing;

  update profiles
  set participant_id = coalesce(participant_id, v_reg.participant_id),
      registration_id = coalesce(registration_id, v_reg.id),
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = v_target_user_id;

  perform public.auto_link_other_roles_by_email(v_target_user_id, v_participant.email);
  perform public.recompute_sign_in_quota(v_target_user_id);

  return 'OK';
end;
$function$;

-- ── recompute_sign_in_quota: the 'participant' role's own contribution to
--    the summed limit now scales with however many participants are
--    actually linked (greatest(1, ...) so a solo account with no
--    profile_participants rows yet still gets its one 250, unchanged from
--    today) instead of a flat 250 regardless of how many are linked. Every
--    other role's math, and the whole window-union logic below it, is
--    untouched -- that part already unions across every paid registration
--    reachable by participant_id/email. ─────────────────────────────────
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
  v_linked_participants int;
  c record;
begin
  select * into v_profile from profiles where user_id = p_user_id;
  if v_profile.user_id is null then return; end if;
  if not v_profile.sign_in_quota_auto then return; end if;

  select count(*) into v_linked_participants from profile_participants where user_id = p_user_id;

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
    elsif v_role = 'participant' then
      v_total_limit := coalesce(v_total_limit, 0) + v_role_limit * greatest(1, v_linked_participants);
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

-- ── videos_delete_own: extend ownership to any registration reachable via
--    profile_participants, not just the primary singular field, so a Sensei
--    can delete/re-record any of their linked students' recordings. ──────
drop policy if exists "videos_delete_own" on kata_videos;
create policy "videos_delete_own" on kata_videos
  for delete to authenticated using (
    (
      exists (
        select 1 from profiles p
        where p.user_id = auth.uid() and p.registration_id = kata_videos.registration_id
      )
      or exists (
        select 1 from profile_participants pp
        where pp.user_id = auth.uid() and pp.registration_id = kata_videos.registration_id
      )
    )
    and not exists (select 1 from video_scores vs where vs.video_id = kata_videos.id)
  );
