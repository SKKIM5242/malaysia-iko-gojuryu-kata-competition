-- Tracks whether a Top-3 winner's prize/reward payout has actually been
-- sent -- who the winners are and their bank details are always computed
-- fresh from live scoring data (see lib/rewards.ts), never stored, so this
-- table is purely the organiser's own bookkeeping of what's been paid.
create table if not exists winner_payouts (
  registration_id uuid primary key references registrations(id) on delete cascade,
  status text not null default 'unpaid' check (status in ('unpaid','paid')),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table winner_payouts enable row level security;
drop policy if exists "winner_payouts_admin_all" on winner_payouts;
create policy "winner_payouts_admin_all" on winner_payouts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
