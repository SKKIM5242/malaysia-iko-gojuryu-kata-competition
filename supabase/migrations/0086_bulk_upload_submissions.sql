-- One row per actual CSV/table upload event (as opposed to
-- bulk_upload_payments, which tracks the payment gate) — lets the admin
-- panel show what was actually uploaded per batch, download it, confirm
-- it, and mark the payment-vs-headcount tally done. Same public
-- insert/select + admin-only update shape as bulk_upload_payments, since
-- the insert happens from the same unauthenticated bulk-upload flow.
create table bulk_upload_submissions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  competition_id uuid not null references competitions(id),
  school_id uuid not null references schools(id),
  sensei_id uuid not null references senseis(id),
  registration_ids uuid[] not null default '{}',
  row_count int not null default 0,
  status text not null default 'received' check (status in ('received','confirmed')),
  confirmed_at timestamptz,
  confirmed_by uuid,
  tally_status text not null default 'pending' check (tally_status in ('pending','done')),
  tally_done_at timestamptz,
  tally_done_by uuid,
  created_at timestamptz not null default now()
);

create index bulk_upload_submissions_batch_idx on bulk_upload_submissions (batch_id);

alter table bulk_upload_submissions enable row level security;

create policy bulk_upload_submissions_public_insert on bulk_upload_submissions
  for insert with check (true);

create policy bulk_upload_submissions_public_select on bulk_upload_submissions
  for select using (true);

create policy bulk_upload_submissions_admin_update on bulk_upload_submissions
  for update using (is_admin()) with check (is_admin());
