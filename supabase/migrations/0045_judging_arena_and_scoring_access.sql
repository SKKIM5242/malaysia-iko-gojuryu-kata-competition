-- Judging Arena (assign referees, set judges-required, auto-assign): was
-- Super Admin only (requireAdmin / is_admin() inside assign_referee /
-- unassign_referee). Organiser's explicit instruction: Organizer and
-- Referee/Judge now get Full access too (Staff already shares the
-- "Organizer" column throughout the Access Matrix; Customer Support stays
-- View only, unchanged).
create or replace function public.is_judging_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role in ('admin','organizer','staff','referee') and approved
  );
$$;

create or replace function public.assign_referee(p_video uuid, p_referee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_judging_manager() then raise exception 'not authorised'; end if;
  insert into referee_assignments (video_id, referee_user_id)
  values (p_video, p_referee)
  on conflict (video_id, referee_user_id) do nothing;
  return true;
end;
$$;

create or replace function public.unassign_referee(p_video uuid, p_referee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_judging_manager() then raise exception 'not authorised'; end if;
  delete from referee_assignments where video_id = p_video and referee_user_id = p_referee;
  return true;
end;
$$;

-- Kata video scoring: Admin and Organizer get Full access -- they may
-- score any recording, not just ones formally assigned to them (Customer
-- Support stays view-only/blocked from scoring; Referee/Judge is
-- unchanged -- still only their own assigned videos). Additive to the
-- existing referee+assignment INSERT policy.
create or replace function public.is_score_override() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role in ('admin','organizer','staff') and approved
  );
$$;

drop policy if exists "scores_manager_upsert" on video_scores;
create policy "scores_manager_upsert" on video_scores
  for insert to authenticated with check (
    referee_user_id = auth.uid() and public.is_score_override()
  );
