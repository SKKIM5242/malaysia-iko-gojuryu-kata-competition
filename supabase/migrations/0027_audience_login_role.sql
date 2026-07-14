-- Audience/Spectator becomes a real login role so paid (or invitation-code)
-- audience members can sign in and browse Kata Arena — previously "audience"
-- only existed as a public registration row (audiences table) with no way
-- to actually log in and view anything.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('participant','referee','staff','admin','organizer','customer_support','audience'));

-- handle_new_user: recognise 'audience' as a valid signup role and let an
-- invitation code auto-approve it, same as referee/staff already do.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'participant');
  v_code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  v_approved boolean := false;
  v_terms_accepted boolean := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);
  v_code_row invitation_codes%rowtype;
begin
  if v_role not in ('participant','referee','staff','organizer','customer_support','audience') then
    v_role := 'participant';
  end if;
  if v_code is not null and v_role in ('referee','staff','audience') then
    select * into v_code_row from invitation_codes
      where code = v_code and active
        and (max_uses is null or use_count < max_uses)
        and (role = v_role or role = 'any')
      limit 1;
    if v_code_row.id is not null then
      v_approved := true;
      update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
    end if;
  end if;
  insert into profiles (user_id, role, full_name, country, email, approved, terms_accepted_at)
  values (
    new.id, v_role,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'country',
    new.email,
    v_approved,
    case when v_terms_accepted then now() else null end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
