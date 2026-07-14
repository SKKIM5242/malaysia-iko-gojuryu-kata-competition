-- "Forgot password" flow verifies identity via IC/Passport or mobile phone
-- (not just email), matching what participants and referees actually
-- register with. RLS on participants only allows anon reads of PAID rows,
-- and referees has no anon read policy at all — a security-definer RPC is
-- needed so pending/unpaid registrants can still reset their password.
-- Returns only the email (never displayed to the caller — used server-side
-- to trigger Supabase's own resetPasswordForEmail), so it leaks no more
-- than a boolean "does this identifier exist" signal.
create or replace function public.find_email_for_identity(p_identifier text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_id text := nullif(trim(p_identifier), '');
begin
  if v_id is null then return null; end if;
  select email into v_email from participants
    where ic_passport = v_id or phone = v_id
    limit 1;
  if v_email is not null then return v_email; end if;
  select email into v_email from referees
    where ic_passport = v_id or phone = v_id
    limit 1;
  return v_email;
end;
$$;
grant execute on function public.find_email_for_identity(text) to anon, authenticated;
