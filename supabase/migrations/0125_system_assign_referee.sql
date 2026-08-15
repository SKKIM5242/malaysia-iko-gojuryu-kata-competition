-- Standing-rule auto-assign (submitKataVideo firing this the instant a
-- recording is submitted, not just on the admin "Auto-assign judges"
-- button) has no human actor to check -- it runs from server code using the
-- service-role client, where auth.uid() is null. assign_referee (migration
-- 0122) can't be reused as-is: its own is_judging_manager() check would
-- reject that null-uid caller outright ("not authorised"), and its
-- referee-self-assign-only rule doesn't even apply to a system caller.
--
-- This is the same function minus that human-authorisation check -- same
-- advisory lock (closes the identical over-assignment race 0122 fixed),
-- same judges_required cap check, same insert. Locked down at the GRANT
-- level (not just "the app happens to only call it from trusted code") so
-- even a client holding the anon/authenticated key can never invoke it
-- directly -- only code using the service-role key can.
create or replace function public.system_assign_referee(p_video uuid, p_referee uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_required int;
  v_current_count int;
  v_already_assigned boolean;
begin
  perform pg_advisory_xact_lock(hashtext(p_video::text)::bigint);

  select exists(
    select 1 from referee_assignments where video_id = p_video and referee_user_id = p_referee
  ) into v_already_assigned;

  if not v_already_assigned then
    select c.judges_required into v_required
    from kata_videos v
    join registrations r on r.id = v.registration_id
    join competitions c on c.id = r.competition_id
    where v.id = p_video;

    select count(*) into v_current_count from referee_assignments where video_id = p_video;

    if v_required is not null and v_current_count >= v_required then
      raise exception 'This recording already has its full panel of % judges — unassign one first.', v_required;
    end if;
  end if;

  insert into referee_assignments (video_id, referee_user_id)
  values (p_video, p_referee)
  on conflict (video_id, referee_user_id) do nothing;
  return true;
end;
$function$;

revoke execute on function public.system_assign_referee(uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_assign_referee(uuid, uuid) to service_role;
