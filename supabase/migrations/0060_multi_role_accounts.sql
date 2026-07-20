-- Multi-role accounts: one login can now hold more than one role, so a
-- person doesn't need a separate account per role (they can't anyway --
-- auth.users.email is unique). profiles.roles holds every role the account
-- has; profiles.role stays the original *primary* (first-picked) role, so
-- every existing access-control check across the app (is_admin(),
-- is_referee(), and every `profile.role === '...'` check in the app code)
-- keeps working unchanged -- this is purely additive.
alter table profiles add column if not exists roles text[] not null default '{}';
update profiles set roles = array[role] where roles = '{}';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
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
  -- The signup form sends a `roles` JSON array (multi-select checkboxes);
  -- older/other creation paths (admin-created staff/referee accounts) still
  -- send a single `role` string -- keep honouring both.
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

  if 'referee' = any(v_roles) then
    update referees set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  if 'audience' = any(v_roles) then
    update audiences set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

-- Auto-adds a role to an *existing* account with a matching email right
-- after a successful public registration (School/Sensei/Participant/
-- Referee/Audience/Staff) -- so someone who already has a login and then
-- registers for something else picks up that role automatically, with no
-- admin step needed. Additive only: never touches the original `role`
-- column, so it can't change what any existing access-control check sees.
create or replace function public.grant_profile_role(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_email is null or p_role is null then
    return;
  end if;
  if p_role not in ('participant','referee','staff','organizer','customer_support','audience','school','sensei','admin') then
    return;
  end if;
  update profiles
  set roles = array(select distinct unnest(roles || array[p_role]))
  where lower(email) = lower(p_email) and not (p_role = any(roles));
end;
$$;
grant execute on function public.grant_profile_role(text, text) to anon, authenticated;
