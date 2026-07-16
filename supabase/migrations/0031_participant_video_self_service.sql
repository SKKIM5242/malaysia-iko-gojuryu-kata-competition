-- Lets a signed-in participant (a) one-click-claim any OTHER paid
-- registration under their own account email straight from a "pending
-- recordings" list (no need to retype reference ID + IC each time), and
-- (b) delete their own submitted recording to re-record — capped at the
-- same 3 total chances already promised at registration ("You only get 3
-- chances to delete and re-record your kata"), which previously only
-- applied to redoing a take before the first submission.

-- ── Claim a specific registration by ID, verified by matching the
--    registration's participant email to the signer's own account email
--    (rather than requiring reference ID + IC/passport re-entry). ─────────
create or replace function public.claim_registration_by_id(p_registration_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_reg registrations%rowtype;
  v_participant participants%rowtype;
  v_my_email text;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select email into v_my_email from profiles where user_id = auth.uid();
  if v_my_email is null or v_my_email = '' then return 'Your account has no email on file.'; end if;

  select r.* into v_reg from registrations r where r.id = p_registration_id;
  if v_reg.id is null then return 'Registration not found.'; end if;
  if v_reg.payment_status <> 'paid' then return 'That registration is not paid yet.'; end if;

  select * into v_participant from participants where id = v_reg.participant_id;
  if v_participant.id is null or lower(v_participant.email) <> lower(v_my_email) then
    return 'That registration does not match your account email.';
  end if;

  if exists (select 1 from profiles where registration_id = v_reg.id and user_id <> auth.uid()) then
    return 'That registration is already linked to another account.';
  end if;

  update profiles
  set participant_id = v_reg.participant_id,
      registration_id = v_reg.id,
      approved = true,
      full_name = coalesce(full_name, v_participant.full_name)
  where user_id = auth.uid() and role = 'participant';
  if not found then return 'Only participant accounts can claim a registration.'; end if;
  return 'OK';
end;
$$;
grant execute on function public.claim_registration_by_id(uuid) to authenticated;

-- ── Atomically consume one of the 3 delete-and-re-record chances; refuses
--    (returns false) once already at the cap instead of silently no-op-ing,
--    so the caller can tell success from "none left". ────────────────────
create or replace function public.consume_delete_attempt()
returns boolean language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update profiles set record_attempts = record_attempts + 1
  where user_id = auth.uid() and record_attempts < 3
  returning record_attempts into v;
  return v is not null;
end;
$$;
grant execute on function public.consume_delete_attempt() to authenticated;

-- ── Owner may delete their own submitted recording — but never once a
--    referee has already scored it, so a participant can't erase evidence
--    of a low score. Ownership is via the CURRENT profile-registration
--    link (not kata_videos.user_id), since the recording may have been
--    admin-uploaded on the participant's behalf. ────────────────────────
drop policy if exists "videos_delete_own" on kata_videos;
create policy "videos_delete_own" on kata_videos
  for delete to authenticated using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid() and p.registration_id = kata_videos.registration_id
    )
    and not exists (select 1 from video_scores vs where vs.video_id = kata_videos.id)
  );
