-- Fix "Could not update sign-in control": the authenticated role was never
-- GRANTed UPDATE on profiles (Postgres logs showed "permission denied for
-- table profiles"), so every client-side profile update — including the
-- admin Sign-in Control box — failed at the privilege check before RLS was
-- even consulted. Also adds the missing admin UPDATE policy (the only
-- existing one was user_id = auth.uid(), which would have made an admin's
-- update to someone ELSE's row silently match zero rows), and drops anon's
-- pointless write grants on profiles while here.
grant update on table profiles to authenticated;
revoke update, delete, truncate on table profiles from anon;

drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
