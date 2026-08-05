-- Tracks how many times an Organizer/Admin/Staff has unassigned a referee
-- from a video, split by whether the removal counts as a forfeited
-- assignment or not -- a referee/judge reliability metric, separate from
-- a referee simply unassigning themselves to redo their own score (which
-- never touches these counts; see unassign_referee below).
alter table referees
  add column if not exists unassigned_forfeit_count integer not null default 0,
  add column if not exists unassigned_not_forfeit_count integer not null default 0;

create or replace function public.increment_referee_unassigned_count(p_user_id uuid, p_forfeit boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_judging_manager() then raise exception 'not authorised'; end if;
  update referees
  set unassigned_forfeit_count = unassigned_forfeit_count + (case when p_forfeit then 1 else 0 end),
      unassigned_not_forfeit_count = unassigned_not_forfeit_count + (case when p_forfeit then 0 else 1 end)
  where user_id = p_user_id;
end;
$$;
