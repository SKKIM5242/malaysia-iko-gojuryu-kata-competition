-- The Referee and Audience self-registration forms (components/CommunityForms.tsx)
-- have always promised "free with invitation code", but app/actions/community.ts
-- never actually validated the code — payment_status was hardcoded to 'pending'
-- regardless. This adds a security-definer redeem function (anon-callable, since
-- these are public unauthenticated forms) and wires it up.

alter table invitation_codes drop constraint if exists invitation_codes_role_check;
alter table invitation_codes add constraint invitation_codes_role_check
  check (role in ('referee','staff','audience','any'));

create or replace function public.redeem_invitation_code(p_code text, p_role text)
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
    limit 1;
  if v_code_row.id is null then
    return false;
  end if;
  update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
  return true;
end;
$$;
grant execute on function public.redeem_invitation_code(text, text) to anon, authenticated;

-- Single-use test code, not the public unlimited-use pattern of the other
-- seeded codes — deactivate it (or generate a proper one in Admin ->
-- Accounts -> Invitation codes) once done testing.
insert into invitation_codes (code, role, note, max_uses) values
  ('IKO-AUDIENCE-TEST-1', 'audience', 'One-time test code for the requester to verify the free-entry flow', 1)
on conflict (code) do nothing;
