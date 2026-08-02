-- "Other Payout" — a free-form payout ledger for anything that isn't a
-- computed school/sensei/referee commission or a Top-3 winner reward
-- (vendor payments, refunds, staff bonuses, sponsor prizes, etc.), entered
-- manually by the organizer per competition tier. Same Paid/Unpaid +
-- receipt-upload shape as commission_payouts/winner_payouts, but since
-- nothing here is computed from live data, every row also needs its own
-- create/edit/delete — unlike the other two payout tables, which only ever
-- track status against rows that already exist elsewhere.
create table if not exists other_payouts (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  description text not null,
  amount_usd numeric not null check (amount_usd >= 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  receipt_path text,
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table other_payouts enable row level security;

drop policy if exists "other_payouts_admin_all" on other_payouts;
create policy "other_payouts_admin_all" on other_payouts
  for all to authenticated
  using (is_admin())
  with check (is_admin());
