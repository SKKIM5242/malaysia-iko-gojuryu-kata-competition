-- Auto-assign referees criteria: an editable, admin-documented list of the
-- rules the auto-assign algorithm follows (workload balancing, tie-break,
-- eligible pool, etc). Same "editable, falls back to code defaults while
-- empty" pattern as access_matrix_rows/access_comparison_rows. Editing
-- this table documents/communicates the rules to the team -- it doesn't
-- itself change the auto-assign algorithm's behavior.
create table if not exists auto_assign_criteria (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);
alter table auto_assign_criteria enable row level security;
drop policy if exists "auto_assign_criteria_read" on auto_assign_criteria;
create policy "auto_assign_criteria_read" on auto_assign_criteria
  for select to authenticated using (true);
drop policy if exists "auto_assign_criteria_write" on auto_assign_criteria;
create policy "auto_assign_criteria_write" on auto_assign_criteria
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A Referee/Judge may only assign or unassign THEMSELVES (e.g. to redo a
-- score: unassign yourself, which deletes your score, then assign
-- yourself back to submit a fresh one) -- never another referee, so they
-- can never delete or take over someone else's score. Admin/Organizer
-- keep full access to assign/unassign anyone.
create or replace function public.assign_referee(p_video uuid, p_referee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  my_role text;
begin
  if not public.is_judging_manager() then raise exception 'not authorised'; end if;
  select role into my_role from profiles where user_id = auth.uid();
  if my_role = 'referee' and p_referee <> auth.uid() then
    raise exception 'Referee/Judge accounts may only assign themselves';
  end if;
  insert into referee_assignments (video_id, referee_user_id)
  values (p_video, p_referee)
  on conflict (video_id, referee_user_id) do nothing;
  return true;
end;
$$;

create or replace function public.unassign_referee(p_video uuid, p_referee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  my_role text;
begin
  if not public.is_judging_manager() then raise exception 'not authorised'; end if;
  select role into my_role from profiles where user_id = auth.uid();
  if my_role = 'referee' and p_referee <> auth.uid() then
    raise exception 'Referee/Judge accounts may only unassign themselves';
  end if;
  delete from referee_assignments where video_id = p_video and referee_user_id = p_referee;
  delete from video_scores where video_id = p_video and referee_user_id = p_referee;
  return true;
end;
$$;
