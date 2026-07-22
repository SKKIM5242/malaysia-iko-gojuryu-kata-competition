-- Let any signed-in account (admin, organizer, referee, customer_support,
-- audience, school, sensei — not just plain "participant" logins) link a
-- paid participant registration to their own profile, so the personal
-- "Start Recording" prompt can show for them too if they're also
-- competing themselves. Previously this was hard-restricted to
-- role = 'participant', which silently rejected every other role even
-- though the UI could reach the claim form for some of them.

create or replace function public.claim_registration(p_ref text, p_ic text)
returns text
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select r.* into v_reg
  from registrations r
  join participants p on p.id = r.participant_id
  where lower(r.id::text) like lower(p_ref) || '%'
    and p.ic_passport = p_ic
  limit 1;
  if v_reg.id is null then
    return 'No registration matches that reference ID + IC.';
  end if;
  if v_reg.payment_status <> 'paid' then
    return 'That registration is not paid yet — only paid participants can record.';
  end if;
  if exists (select 1 from profiles where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;
  select * into v_participant from participants where id = v_reg.participant_id;
  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = auth.uid();
  if not found then return 'Could not link — please try again.'; end if;
  return 'OK';
end;
$function$;

create or replace function public.claim_registration_by_id(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
  v_my_email text;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select email into v_my_email from profiles where user_id = auth.uid();
  if v_my_email is null or v_my_email = '' then return 'Your account has no email on file.'; end if;

  select r.* into v_reg from registrations r where r.id = p_registration_id;
  if v_reg.id is null then return 'Registration not found.'; end if;
  if v_reg.payment_status <> 'paid' then return 'That registration is not paid yet.'; end if;

  select * into v_participant from participants where id = v_reg.participant_id;
  if v_participant.id is null or lower(v_participant.email) <> lower(v_my_email) then
    return 'That registration does not match your account email.';
  end if;

  if exists (select 1 from profiles where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;

  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = auth.uid();
  if not found then return 'Could not link — please try again.'; end if;
  return 'OK';
end;
$function$;
