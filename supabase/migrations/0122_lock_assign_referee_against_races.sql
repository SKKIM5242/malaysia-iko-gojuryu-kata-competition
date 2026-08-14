-- assign_referee's judges_required cap check (migration 0085) reads
-- referee_assignments' count, then inserts, as two separate statements
-- with nothing serializing them. Two concurrent calls for the SAME video
-- -- a fast double-click on "Auto-assign referees", or auto-assign racing
-- a manual "Add referee" click, or two admins clicking at once -- can both
-- run the count-check before either has committed its insert, both see
-- the same pre-insert count, both pass, and both insert: a recording
-- lands with judges_required + 1 (or more) judges, no error ever shown.
--
-- pg_advisory_xact_lock serializes every call for the same video_id --
-- the second caller's count read now waits until the first has committed
-- (or rolled back), so it sees the true post-insert count. The lock is
-- transaction-scoped and released automatically, never held past this one
-- function call.
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
