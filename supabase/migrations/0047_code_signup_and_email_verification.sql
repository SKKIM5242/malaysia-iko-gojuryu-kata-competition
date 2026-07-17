-- Invitation codes: a code can now also carry a sign-in validity window
-- (valid_from/valid_until — when the ACCOUNT it creates may sign in, copied
-- onto the new profile) and a sign_in_limit (how many sign-ins that account
-- gets), alongside its existing role/max_uses/email/for_record_id. Organizer,
-- Customer Support, and Admin now also self-signup via a valid code, same as
-- Referee/Audience/School/Sensei already do -- per organiser's explicit
-- instruction that every role should support code-based self-signup.
alter table invitation_codes add column if not exists valid_from date;
alter table invitation_codes add column if not exists valid_until date;
alter table invitation_codes add column if not exists sign_in_limit int;

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
    sign_in_limit, sign_in_valid_from, sign_in_valid_until
  )
  values (
    new.id, v_role,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved,
    case when v_terms_accepted then now() else null end,
    v_school_id, v_sensei_id,
    v_code_row.sign_in_limit, v_code_row.valid_from, v_code_row.valid_until
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

-- Email verification: every new account gets a one-time token emailed to
-- them; the account is recorded here as pending until they click the link.
create table if not exists email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text,
  token text not null unique,
  sent_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table email_verifications enable row level security;

drop policy if exists "email_verifications_select_admin" on email_verifications;
create policy "email_verifications_select_admin" on email_verifications
  for select to authenticated using (public.is_admin());
