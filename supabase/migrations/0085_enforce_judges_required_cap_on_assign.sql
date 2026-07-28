-- assign_referee previously had no cap check at all, so manual "Add
-- referee" assignment (and any other caller) could push a recording past
-- its competition's judges_required target with no warning. Auto-assign
-- already respected the cap; this makes assign_referee do the same, for
-- every caller.
create or replace function public.assign_referee(p_video uuid, p_referee uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  my_role text;
  v_required int;
  v_current_count int;
  v_already_assigned boolean;
begin
  if not public.is_judging_manager() then raise exception 'not authorised'; end if;
  select role into my_role from profiles where user_id = auth.uid();
  if my_role = 'referee' and p_referee <> auth.uid() then
    raise exception 'Referee/Judge accounts may only assign themselves';
  end if;

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

-- One-time cleanup: a prior Admin/Organizer/Staff "take over or override
-- score" attempt self-assigned this organizer-role test account as a judge
-- (see submitScore in app/actions/account.ts, fixed alongside this
-- migration to no longer do that), but the score upsert that should have
-- followed never completed, leaving a dangling assignment with no score —
-- the phantom 4th "judge" on Kim Siew Kiew's recording. Safe to remove:
-- it has no video_scores row at all, nothing else references it.
delete from referee_assignments
where video_id = '14ad0d68-e3b6-4c74-9b38-6f4709380e0c'
  and referee_user_id = '9507dd33-7366-4852-9b23-943bacdfe370'
  and not exists (
    select 1 from video_scores
    where video_id = referee_assignments.video_id
      and referee_user_id = referee_assignments.referee_user_id
  );
