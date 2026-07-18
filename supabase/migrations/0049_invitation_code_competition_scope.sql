-- Invitation codes can now be scoped to one specific competition -- copied
-- onto the resulting account's sign_in_competition_id at redemption (the
-- same column SignInControlBox already reads/writes), same as
-- valid_from/valid_until/sign_in_limit already are.
alter table invitation_codes add column if not exists competition_id uuid references competitions(id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'participant');
  v_code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  v_approved boolean := false;
  v_terms_accepted boolean := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);
  v_code_row invitation_codes%rowtype;
  v_school_id uuid;
  v_sensei_id uuid;
begin
  if v_role not in ('participant','referee','staff','organizer','customer_support','audience','school','sensei','admin') then
    v_role := 'participant';
  end if;
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
    user_id, role, full_name, country, email, approved, terms_accepted_at, school_id, sensei_id,
    sign_in_limit, sign_in_valid_from, sign_in_valid_until, sign_in_competition_id
  )
  values (
    new.id, v_role,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved,
    case when v_terms_accepted then now() else null end,
    v_school_id, v_sensei_id,
    v_code_row.sign_in_limit, v_code_row.valid_from, v_code_row.valid_until, v_code_row.competition_id
  )
  on conflict (user_id) do nothing;
  if v_role = 'referee' then
    update referees set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  if v_role = 'audience' then
    update audiences set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;
