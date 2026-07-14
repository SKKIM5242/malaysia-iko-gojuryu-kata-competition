-- Real login tiers for Admin/Organizer and Customer Support (previously both
-- lumped into the generic 'staff' role). 'staff' is kept valid for existing
-- rows and is treated as organizer-equivalent for access purposes going
-- forward — no new signups choose it.
--
-- Access model:
--   admin (Super Admin)   -> full access everywhere; only role that can
--                            create/approve new Organizer accounts.
--   organizer / staff     -> full admin panel access EXCEPT /admin/accounts
--                            and /admin/judging (enforced in middleware),
--                            and cannot create Organizer accounts.
--   customer_support      -> real login, but narrow access: view/edit
--                            registrations & participants (no delete),
--                            generate invitation codes, and merge
--                            categories/divisions on /admin/competitions.
--                            Enforced in middleware (route allow-list) +
--                            server-action role checks (delete guards) +
--                            a new RLS insert policy for invitation_codes.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('participant','referee','staff','admin','organizer','customer_support'));

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role = 'admin' and approved
  );
$$;

create or replace function public.is_customer_support() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role = 'customer_support' and approved
  );
$$;

-- Organizer gets the same broad admin gate 'staff' already had.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role in ('admin','staff','organizer') and approved
  );
$$;

-- Customer Support may create invitation codes (narrow grant — they still
-- can't read/update/delete existing codes, only public.is_admin() can).
drop policy if exists "invitation_codes_customer_support_insert" on invitation_codes;
create policy "invitation_codes_customer_support_insert" on invitation_codes
  for insert to authenticated with check (public.is_customer_support());

-- Extend the audience/referee/school-generatable invitation code roles.
alter table invitation_codes drop constraint if exists invitation_codes_role_check;
alter table invitation_codes add constraint invitation_codes_role_check
  check (role in ('referee','staff','audience','school','any'));

-- handle_new_user: 'organizer' and 'customer_support' are recognised so a
-- profile row is created with the right role, but approval for those two is
-- NEVER driven by client-supplied metadata (raw_user_meta_data is fully
-- client-controllable via the public auth.signUp() call — trusting a
-- "pre_approved" flag from it would let anyone self-grant admin access).
-- Real approval for those two roles only ever happens via
-- app/actions/admin.ts createStaffAccount, which uses the service-role
-- client to flip `approved` after independently verifying the caller's own
-- role server-side.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'participant');
  v_code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  v_approved boolean := false;
  v_terms_accepted boolean := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false);
  v_code_row invitation_codes%rowtype;
begin
  if v_role not in ('participant','referee','staff','organizer','customer_support') then
    v_role := 'participant';
  end if;
  if v_code is not null and v_role in ('referee','staff') then
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
