-- redeem_invitation_code (used by the public Referee/Audience registration
-- forms and admin's createAudienceMember) never checked valid_from/
-- valid_until, even though handle_new_user (the account-signup trigger)
-- always has -- so a code the organizer scoped to a specific date window
-- could still waive a Referee/Audience fee outside that window. Brings this
-- function in line with handle_new_user's existing check (0060_multi_role_accounts.sql).
-- competition_id is deliberately NOT added here: neither this function's
-- callers nor handle_new_user ever have an independent competition
-- selection to validate it against -- it's stamped onto the resulting
-- profile's sign_in_competition_id as designation, not enforced as a filter.
create or replace function public.redeem_invitation_code(p_code text, p_role text, p_email text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      and (valid_from is null or valid_from <= current_date)
      and (valid_until is null or valid_until >= current_date)
    limit 1;
  if v_code_row.id is null then
    return false;
  end if;
  update invitation_codes set use_count = use_count + 1 where id = v_code_row.id;
  return true;
end;
$function$;
