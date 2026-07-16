-- referees (the bank-details directory row) has never had a real link to
-- its login account (profiles/auth.users) -- the commission report has
-- been matching by email as a fragile heuristic. Add a proper column,
-- backfill it for anyone who already signed up, and keep it linked
-- automatically going forward.

alter table referees add column if not exists user_id uuid references auth.users(id);

-- Backfill: link any already-signed-up referee login to its directory row
-- when the emails match -- closes the gap for existing data.
update referees r
set user_id = p.user_id
from profiles p
where r.user_id is null
  and p.role = 'referee'
  and lower(p.email) = lower(r.email);

-- handle_new_user: auto-link a new referee signup to its still-unlinked
-- directory row by email, same as the backfill above. Best-effort -- a
-- referee who signs up with a different email than their directory
-- record needs the admin "Link account" action on that record instead
-- (see linkRefereeAccount in app/actions/admin.ts).
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
  if v_role = 'referee' then
    update referees set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;
