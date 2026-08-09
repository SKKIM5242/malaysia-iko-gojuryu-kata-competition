-- School contact person's IC/Passport, mirroring senseis.ic_passport
-- (already collected on the admin Sensei form, migration 0028, but never on
-- either public self-registration form). Lets School and Sensei accounts
-- self-link the same way participants already do via claim_registration:
-- reference (the record's own id, first 8 hex chars — already shown as
-- reference_id in both admin directory tables) + IC/Passport. 'waived'
-- counts as paid here (not just 'paid') to match how /account's own
-- approval check already treats the two tiers identically.
alter table schools add column if not exists contact_ic_passport text;

create or replace function public.claim_school(p_ref text, p_ic text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row schools%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;

  select * into v_row from schools
    where lower(id::text) like lower(p_ref) || '%'
      and contact_ic_passport is not null
      and contact_ic_passport = p_ic
    limit 1;
  if v_row.id is null then return 'No school matches that reference ID + IC/Passport.'; end if;
  if v_row.payment_status not in ('paid', 'waived') then return 'This school is not marked paid yet.'; end if;
  if v_row.user_id is not null then return 'That school is already linked to an account.'; end if;
  if exists (select 1 from profiles where user_id = auth.uid() and school_id is not null) then
    return 'Your account is already linked to a different school.';
  end if;

  update schools set user_id = auth.uid() where id = v_row.id;
  update profiles set school_id = v_row.id where user_id = auth.uid();
  perform public.auto_link_other_roles_by_email(auth.uid(), v_row.email);
  perform public.recompute_sign_in_quota(auth.uid());
  return 'OK';
end;
$function$;

create or replace function public.claim_sensei(p_ref text, p_ic text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row senseis%rowtype;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;

  select * into v_row from senseis
    where lower(id::text) like lower(p_ref) || '%'
      and ic_passport is not null
      and ic_passport = p_ic
    limit 1;
  if v_row.id is null then return 'No sensei matches that reference ID + IC/Passport.'; end if;
  if v_row.payment_status not in ('paid', 'waived') then return 'This sensei is not marked paid yet.'; end if;
  if v_row.user_id is not null then return 'That sensei is already linked to an account.'; end if;
  if exists (select 1 from profiles where user_id = auth.uid() and sensei_id is not null) then
    return 'Your account is already linked to a different sensei.';
  end if;

  update senseis set user_id = auth.uid() where id = v_row.id;
  update profiles set sensei_id = v_row.id where user_id = auth.uid();
  perform public.auto_link_other_roles_by_email(auth.uid(), v_row.email);
  perform public.recompute_sign_in_quota(auth.uid());
  return 'OK';
end;
$function$;
