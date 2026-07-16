-- Add invitation_code for record-keeping to schools/senseis/participants
-- (referees/audiences already have it since 0007) and to profiles (for
-- Organizer/Customer Support accounts, tagged at creation time by the admin
-- who made them) -- none of these gate account creation, they're purely a
-- record of which code (if any) the registrant was given.
alter table schools add column if not exists invitation_code text;
alter table senseis add column if not exists invitation_code text;
alter table participants add column if not exists invitation_code text;
alter table profiles add column if not exists invitation_code text;

-- Widen invitation_codes' role check so every role type can be generated
-- from Admin -> Accounts -> Invitation codes. Only referee/audience/school
-- (and 'any') are actually consumed by public self-signup or the
-- School/Sensei "waive fee" boxes; sensei/participant/organizer/
-- customer_support/admin codes are generation-only / record-keeping labels
-- for now -- handle_new_user() is deliberately left untouched so this does
-- NOT open a public self-signup path to organizer/customer_support/admin
-- (that boundary was closed on purpose in 0023_organizer_customer_support_roles.sql).
alter table invitation_codes drop constraint if exists invitation_codes_role_check;
alter table invitation_codes add constraint invitation_codes_role_check
  check (role in ('referee','staff','audience','school','sensei','participant','organizer','customer_support','admin','any'));

-- Per-record invitation codes: generated from an already-saved School/Sensei
-- record (via the new "Generate invitation code" button on its Edit form),
-- bound to that one record's email and single-use (max_uses defaults to 1
-- for these). Existing generic/shared codes (role-only, no email) keep
-- working exactly as before -- this is additive, not a replacement.
alter table invitation_codes add column if not exists email text;

-- Postgres identifies functions by name + argument types, so adding a 3rd
-- parameter creates a second overload rather than replacing the old one --
-- drop the 2-arg version explicitly so only the email-aware one remains.
drop function if exists public.redeem_invitation_code(text, text);

create or replace function public.redeem_invitation_code(p_code text, p_role text, p_email text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_code_row invitation_codes%rowtype;
begin
  if p_code is null or trim(p_code) = '' then
    return false;
  end if;
  select * into v_code_row from invitation_codes
    where code = trim(p_code) and active
      and (max_uses is null or use_count < max_uses)
      and (role = p_role or role = 'any')
      and (email is null or lower(email) = lower(coalesce(p_email, '')))
    limit 1;
  if v_code_row.id is null then
    return false;
  end if;
  update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
  return true;
end;
$$;
grant execute on function public.redeem_invitation_code(text, text, text) to anon, authenticated;

-- handle_new_user does its own inline code lookup (not a call to
-- redeem_invitation_code) -- add the same email match here so a personal,
-- per-record code can only be redeemed by the email it was generated for.
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
        and (email is null or lower(email) = lower(new.email))
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
