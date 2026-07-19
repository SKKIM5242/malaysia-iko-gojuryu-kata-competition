-- Forgot Password previously only matched Participants/Referees by
-- IC/Passport or phone, so School, Sensei, Audience, Organizer, Participant
-- Support, and Admin accounts (which may have no IC/passport or phone on
-- file) could never be found and silently got no reset email. profiles.email
-- covers every account type — check it first, case-insensitively, before
-- falling back to the existing IC/passport/phone lookups.
create or replace function public.find_email_for_identity(p_identifier text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_id text := nullif(trim(p_identifier), '');
begin
  if v_id is null then return null; end if;

  select email into v_email from profiles
    where lower(email) = lower(v_id)
    limit 1;
  if v_email is not null then return v_email; end if;

  select email into v_email from participants
    where ic_passport = v_id or phone = v_id
    limit 1;
  if v_email is not null then return v_email; end if;

  select email into v_email from referees
    where ic_passport = v_id or phone = v_id
    limit 1;
  if v_email is not null then return v_email; end if;

  select email into v_email from senseis
    where ic_passport = v_id or phone = v_id
    limit 1;
  if v_email is not null then return v_email; end if;

  select email into v_email from schools
    where phone = v_id
    limit 1;
  return v_email;
end;
$$;
