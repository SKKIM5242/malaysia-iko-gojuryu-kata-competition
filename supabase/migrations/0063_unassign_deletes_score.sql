-- Unassigning a referee/judge from a video must also delete their
-- submitted score for that video -- otherwise it lingers as a stale entry
-- that no longer has a matching assignment, which could still count
-- towards judging-status displays and winners ranking, and would leave an
-- old score sitting there if the same referee is re-assigned later
-- instead of requiring a fresh submission. Organizer's explicit
-- instruction: unassigning always deletes the score.
create or replace function public.unassign_referee(p_video uuid, p_referee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_judging_manager() then raise exception 'not authorised'; end if;
  delete from referee_assignments where video_id = p_video and referee_user_id = p_referee;
  delete from video_scores where video_id = p_video and referee_user_id = p_referee;
  return true;
end;
$$;
