-- School and Sensei become real login roles (like Referee/Audience already
-- are), scoped to viewing only their own students' kata recordings, and
-- gated behind a USD 10 fee for unlimited sign-in -- same shape as
-- audiences.payment_status, just on the schools/senseis directory rows
-- since those can exist with no login at all.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('participant','referee','staff','admin','organizer','customer_support','audience','school','sensei'));

-- Which specific school/sensei this login represents -- set only via a
-- personal invitation code (see for_record_id below), never client-supplied.
alter table profiles add column if not exists school_id uuid references schools(id);
alter table profiles add column if not exists sensei_id uuid references senseis(id);

-- Records which School/Sensei record a personal code (generateRecordInvitationCode)
-- was minted for, so handle_new_user can link the new login to the right
-- school_id/sensei_id without re-deriving it from the code string itself.
alter table invitation_codes add column if not exists for_record_id uuid;

alter table schools add column if not exists payment_status text not null default 'pending'
  check (payment_status in ('pending','paid','waived'));
alter table senseis add column if not exists payment_status text not null default 'pending'
  check (payment_status in ('pending','paid','waived'));

-- handle_new_user: recognise 'school' and 'sensei' as signup roles. Unlike
-- referee/audience (where a code just waives a fee), the code here is the
-- only way the system knows which school_id/sensei_id this login belongs
-- to -- so a valid code both approves the account AND links it.
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
  if v_role not in ('participant','referee','staff','organizer','customer_support','audience','school','sensei') then
    v_role := 'participant';
  end if;
  if v_code is not null and v_role in ('referee','staff','audience','school','sensei') then
    select * into v_code_row from invitation_codes
      where code = v_code and active
        and (max_uses is null or use_count < max_uses)
        and (role = v_role or role = 'any')
        and (email is null or lower(email) = lower(new.email))
      limit 1;
    if v_code_row.id is not null then
      v_approved := true;
      update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
      if v_role = 'school' then v_school_id := v_code_row.for_record_id; end if;
      if v_role = 'sensei' then v_sensei_id := v_code_row.for_record_id; end if;
    end if;
  end if;
  insert into profiles (user_id, role, full_name, country, email, approved, terms_accepted_at, school_id, sensei_id)
  values (
    new.id, v_role,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved,
    case when v_terms_accepted then now() else null end,
    v_school_id, v_sensei_id
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
