-- Sprint 4 lock-down: replace v1 open write policies with authenticated-only
-- writes. Public reads are retained where the site needs them; participant
-- rows are only publicly readable once a paid registration confirms them.
-- The public registration form (anonymous) keeps INSERT on participants,
-- registrations, and audit_logs.

-- ── competitions ─────────────────────────────────────────────────────────────
drop policy if exists "competitions_v1_write" on competitions;
create policy "competitions_write_auth" on competitions
  for all to authenticated using (true) with check (true);

-- ── schools ──────────────────────────────────────────────────────────────────
drop policy if exists "schools_v1_write" on schools;
create policy "schools_write_auth" on schools
  for all to authenticated using (true) with check (true);

-- ── senseis ──────────────────────────────────────────────────────────────────
drop policy if exists "senseis_v1_write" on senseis;
create policy "senseis_write_auth" on senseis
  for all to authenticated using (true) with check (true);

-- ── categories ───────────────────────────────────────────────────────────────
drop policy if exists "categories_v1_write" on categories;
create policy "categories_write_auth" on categories
  for all to authenticated using (true) with check (true);

-- ── participants ─────────────────────────────────────────────────────────────
-- Public read only for confirmed (paid) participants; owner reads all.
drop policy if exists "participants_v1_read" on participants;
drop policy if exists "participants_v1_write" on participants;
create policy "participants_read_auth" on participants
  for select to authenticated using (true);
create policy "participants_read_public_confirmed" on participants
  for select to anon using (
    exists (
      select 1 from registrations r
      where r.participant_id = participants.id and r.payment_status = 'paid'
    )
  );
-- Anonymous visitors submit the registration form.
create policy "participants_insert_public" on participants
  for insert to anon, authenticated with check (true);
create policy "participants_update_auth" on participants
  for update to authenticated using (true) with check (true);
create policy "participants_delete_auth" on participants
  for delete to authenticated using (true);

-- ── registrations ────────────────────────────────────────────────────────────
drop policy if exists "registrations_v1_read" on registrations;
drop policy if exists "registrations_v1_write" on registrations;
create policy "registrations_read_auth" on registrations
  for select to authenticated using (true);
create policy "registrations_read_public_paid" on registrations
  for select to anon using (payment_status = 'paid');
create policy "registrations_insert_public" on registrations
  for insert to anon, authenticated with check (payment_status = 'pending' or auth.uid() is not null);
create policy "registrations_update_auth" on registrations
  for update to authenticated using (true) with check (true);
create policy "registrations_delete_auth" on registrations
  for delete to authenticated using (true);

-- ── announcements ────────────────────────────────────────────────────────────
-- Drafts are hidden from the public; owner sees everything.
drop policy if exists "announcements_v1_read" on announcements;
drop policy if exists "announcements_v1_write" on announcements;
create policy "announcements_read_auth" on announcements
  for select to authenticated using (true);
create policy "announcements_read_public_published" on announcements
  for select to anon using (published = true);
create policy "announcements_write_auth" on announcements
  for all to authenticated using (true) with check (true);

-- ── audit_logs (append-only) ─────────────────────────────────────────────────
drop policy if exists "audit_logs_v1_read" on audit_logs;
drop policy if exists "audit_logs_v1_write" on audit_logs;
create policy "audit_logs_insert_any" on audit_logs
  for insert to anon, authenticated with check (true);
create policy "audit_logs_read_auth" on audit_logs
  for select to authenticated using (true);
-- no update/delete policies: audit_logs is append-only

-- ── duplicate-IC check for the anonymous registration form ──────────────────
-- Runs as definer so the form can detect duplicates without exposing
-- unconfirmed participants to the public.
create or replace function public.ic_already_registered(p_ic text, p_competition uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from participants p
    join registrations r on r.participant_id = p.id
    where p.ic_passport = p_ic
      and r.competition_id = p_competition
  );
$$;

grant execute on function public.ic_already_registered(text, uuid) to anon, authenticated;
