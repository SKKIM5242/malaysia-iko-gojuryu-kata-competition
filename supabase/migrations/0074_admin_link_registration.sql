-- Lets Admin/Organizer/Participant Support/Referee link a paid registration
-- to its owner's account on the participant's behalf, from the admin
-- Participant Records page — for when a participant can't self-link (wrong
-- reference ID, signed up with a different email, etc.) without needing a
-- developer to run a manual database fix each time. Matches the account by
-- the participant's own email on file, same rule claim_registration_by_id
-- already uses for self-service linking.
create or replace function public.admin_link_registration(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_actor_role text;
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
  v_target_user_id uuid;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select role into v_actor_role from profiles where user_id = auth.uid();
  if v_actor_role is null or v_actor_role not in ('admin', 'organizer', 'staff', 'customer_support', 'referee') then
    return 'Only Admin, Organizer, Participant Support, or Referee/Judge accounts can link a registration.';
  end if;

  select r.* into v_reg from registrations r where r.id = p_registration_id;
  if v_reg.id is null then return 'Registration not found.'; end if;
  if v_reg.payment_status <> 'paid' then
    return 'This registration is not marked paid yet — check its Slot Status first.';
  end if;

  select * into v_participant from participants where id = v_reg.participant_id;
  if v_participant.id is null or v_participant.email is null or v_participant.email = '' then
    return 'This participant has no email on file to match against.';
  end if;

  if exists (select 1 from profiles where registration_id = v_reg.id) then
    return 'That registration is already linked to an account.';
  end if;

  select user_id into v_target_user_id
  from profiles
  where lower(email) = lower(v_participant.email)
  order by (registration_id is null) desc
  limit 1;

  if v_target_user_id is null then
    return 'No account is signed up with ' || v_participant.email ||
      ' yet — the participant needs to create an account with that exact email first, then try linking again.';
  end if;

  if exists (select 1 from profiles where user_id = v_target_user_id and registration_id is not null) then
    return 'The account signed up with ' || v_participant.email ||
      ' already has a different registration linked — unlink or choose a different account first.';
  end if;

  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = v_target_user_id;

  return 'OK';
end;
$function$;
