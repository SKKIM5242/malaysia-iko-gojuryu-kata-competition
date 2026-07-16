-- Tracks whether a computed commission (School/Sensei revenue-share,
-- Referee judging commission) has actually been paid out -- the commission
-- amount itself is always computed fresh from live registration data (see
-- lib/commissions.ts), never stored, so it can't drift out of sync with
-- reality. This table is purely the organiser's own bookkeeping of what
-- they've paid so far.
create table if not exists commission_payouts (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('school','sensei','referee')),
  recipient_id uuid not null,
  status text not null default 'unpaid' check (status in ('unpaid','paid')),
  paid_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  unique (recipient_type, recipient_id)
);
alter table commission_payouts enable row level security;
drop policy if exists "commission_payouts_admin_all" on commission_payouts;
create policy "commission_payouts_admin_all" on commission_payouts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
