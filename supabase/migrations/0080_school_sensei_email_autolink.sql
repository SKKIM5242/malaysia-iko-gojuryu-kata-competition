-- Schools and Senseis previously only got linked to a login (profiles.school_id /
-- profiles.sensei_id) when the account was created via their invitation code.
-- Referees and Audiences already auto-link by email match regardless of whether
-- an invitation code was used -- extend that same behaviour to Schools and
-- Senseis by backfilling schools.user_id / senseis.user_id on signup. This is
-- additive: the existing invitation-code path (profiles.school_id/sensei_id,
-- used by the sign-in-quota lookups) is untouched.

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
  if 'school' = any(v_roles) then
    update schools set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  if 'sensei' = any(v_roles) then
    update senseis set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

-- One-time backfill for accounts that already signed up before this migration
-- (email match only, same rule the trigger now applies going forward).
update schools s set user_id = p.user_id
  from profiles p
  where s.user_id is null
    and p.user_id is not null
    and lower(p.email) = lower(s.email)
    and ('school' = any(p.roles) or p.role = 'school');

update senseis se set user_id = p.user_id
  from profiles p
  where se.user_id is null
    and p.user_id is not null
    and lower(p.email) = lower(se.email)
    and ('sensei' = any(p.roles) or p.role = 'sensei');
