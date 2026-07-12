-- Online payment (pay-before-submit) + participant bank details for rewards.
--
-- Bank details are PII: they live in their own table with NO anonymous read
-- policy, so the public REST API can never expose them (participants itself
-- is publicly readable once confirmed).
--
-- registration_drafts holds the validated form payload while the visitor is
-- at the payment gateway; the webhook / success page finalises it into real
-- participant + registration rows using the service-role key, then deletes it.

create table if not exists participant_bank_details (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references participants(id) on delete cascade,
  bank_name text not null,
  bank_account_no text not null,
  bank_account_name text not null,
  created_at timestamptz not null default now()
);
alter table participant_bank_details enable row level security;
drop policy if exists "bank_details_insert_public" on participant_bank_details;
create policy "bank_details_insert_public" on participant_bank_details
  for insert to anon, authenticated with check (true);
drop policy if exists "bank_details_read_auth" on participant_bank_details;
create policy "bank_details_read_auth" on participant_bank_details
  for select to authenticated using (true);
drop policy if exists "bank_details_update_auth" on participant_bank_details;
create policy "bank_details_update_auth" on participant_bank_details
  for update to authenticated using (true) with check (true);
drop policy if exists "bank_details_delete_auth" on participant_bank_details;
create policy "bank_details_delete_auth" on participant_bank_details
  for delete to authenticated using (true);

create table if not exists registration_drafts (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  stripe_session_id text,
  created_at timestamptz not null default now()
);
alter table registration_drafts enable row level security;
-- Server action (anon) writes the draft; only the service role / owner reads it.
drop policy if exists "drafts_insert_public" on registration_drafts;
create policy "drafts_insert_public" on registration_drafts
  for insert to anon, authenticated with check (true);
drop policy if exists "drafts_read_auth" on registration_drafts;
create policy "drafts_read_auth" on registration_drafts
  for select to authenticated using (true);
drop policy if exists "drafts_delete_auth" on registration_drafts;
create policy "drafts_delete_auth" on registration_drafts
  for delete to authenticated using (true);

-- Finalised online payments are inserted as 'paid' by the service role
-- (bypasses RLS), so the anon insert policy stays pending-only.
