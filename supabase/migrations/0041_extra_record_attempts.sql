-- Lets a participant buy 3 more delete-and-re-record chances for USD 10
-- once they've used their free 3 -- same manual admin-marks-paid pattern
-- as every other payment in this app (no real payment gateway exists).
alter table profiles add column if not exists bonus_record_attempts int not null default 0;

create table if not exists attempt_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table attempt_purchases enable row level security;

drop policy if exists "attempt_purchases_select" on attempt_purchases;
create policy "attempt_purchases_select" on attempt_purchases
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "attempt_purchases_insert" on attempt_purchases;
create policy "attempt_purchases_insert" on attempt_purchases
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "attempt_purchases_admin_update" on attempt_purchases;
create policy "attempt_purchases_admin_update" on attempt_purchases
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- The 3-attempt cap becomes "3 + however many bonus attempts they've paid
-- for" in both places it was hardcoded.
create or replace function public.consume_delete_attempt()
returns boolean language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update profiles set record_attempts = record_attempts + 1
  where user_id = auth.uid() and record_attempts < 3 + bonus_record_attempts
  returning record_attempts into v;
  return v is not null;
end;
$$;

create or replace function public.increment_record_attempts()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update profiles
  set record_attempts = least(record_attempts + 1, 3 + bonus_record_attempts)
  where user_id = auth.uid()
  returning record_attempts into v;
  return coalesce(v, 3);
end;
$$;
