-- Gates bulk participant registration (CSV or on-screen table) behind
-- upfront payment: the sensei requests a payment for N participants, the
-- organiser confirms it manually (same bank-transfer + confirm pattern as
-- every other payment here), and only then can that sensei actually submit
-- a batch of up to N participants for that competition. This is the
-- opposite order from single-participant registration (which registers
-- first, pays after) -- deliberately, per the organiser's request.
create table if not exists bulk_upload_payments (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id),
  school_id uuid not null references schools(id),
  sensei_id uuid not null references senseis(id),
  participant_count int not null check (participant_count > 0),
  amount_usd numeric(10,2) not null,
  payment_reference text,
  status text not null default 'pending' check (status in ('pending','paid','consumed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table bulk_upload_payments enable row level security;

-- Public (unauthenticated) flow, same as the schools/senseis/participants
-- tables this joins against -- a sensei never logs in to bulk-register.
drop policy if exists "bulk_upload_payments_public_insert" on bulk_upload_payments;
create policy "bulk_upload_payments_public_insert" on bulk_upload_payments
  for insert to anon, authenticated with check (true);
drop policy if exists "bulk_upload_payments_public_select" on bulk_upload_payments;
create policy "bulk_upload_payments_public_select" on bulk_upload_payments
  for select to anon, authenticated using (true);

-- Only the organiser can mark a request paid.
drop policy if exists "bulk_upload_payments_admin_update" on bulk_upload_payments;
create policy "bulk_upload_payments_admin_update" on bulk_upload_payments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Atomically debits however many rows an upload actually succeeded in
-- registering from a paid payment's remaining balance (participant_count
-- doubles as "how many are left to use" once paid) -- a sensei who paid
-- for 250 and uploads in three smaller batches spends down the same
-- payment across all three, rather than the whole prepaid amount being
-- burned by the first (possibly partial) batch. Marks 'consumed' only once
-- the balance is fully used. Callable anonymously (security definer),
-- since the bulk upload actions run without a session.
create or replace function public.consume_bulk_upload_payment(p_id uuid, p_rows_uploaded int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_row bulk_upload_payments%rowtype;
begin
  select * into v_row from bulk_upload_payments where id = p_id and status = 'paid';
  if v_row.id is null or v_row.participant_count < p_rows_uploaded then
    return false;
  end if;
  update bulk_upload_payments
    set participant_count = participant_count - p_rows_uploaded,
        status = case when participant_count - p_rows_uploaded <= 0 then 'consumed' else status end
    where id = p_id;
  return true;
end;
$$;
grant execute on function public.consume_bulk_upload_payment(uuid, int) to anon, authenticated;
