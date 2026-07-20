-- Lets a signed-in account switch which of its held roles (profiles.roles)
-- is currently active. Updates profiles.role directly -- every existing
-- access-control check in the app already keys off that single column, so
-- this makes a switch take effect everywhere instantly with no other code
-- changes needed.
create or replace function public.switch_active_role(p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update profiles
  set role = p_role
  where user_id = auth.uid() and p_role = any(roles);
end;
$$;
grant execute on function public.switch_active_role(text) to authenticated;
