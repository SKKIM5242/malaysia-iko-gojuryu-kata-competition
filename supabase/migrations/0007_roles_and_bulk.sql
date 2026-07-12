-- Registration classifications (referees, audiences, staff applications),
-- sensei registered-by, and batch duplicate-check for 10k CSV bulk uploads.

alter table senseis add column if not exists registered_by text; -- self | student | other

create table if not exists referees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  ic_passport text not null,
  date_of_birth date,
  gender text,
  karate_rank text,
  school text,
  email text,
  phone text,
  home_address text,
  city_town text,
  home_country text,
  bank_name text,
  bank_account_no text,
  bank_account_name text,
  certificate_path text,
  invitation_code text,
  -- USD 100 deposit: pending / paid / waived (invitation) / refunded / forfeited
  payment_status text not null default 'pending',
  status text not null default 'pending', -- pending / approved / rejected
  created_at timestamptz not null default now()
);
alter table referees enable row level security;
drop policy if exists "referees_insert_public" on referees;
create policy "referees_insert_public" on referees
  for insert to anon, authenticated with check (true);
drop policy if exists "referees_all_auth" on referees;
create policy "referees_all_auth" on referees
  for all to authenticated using (true) with check (true);

create table if not exists audiences (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  home_country text,
  invitation_code text,
  -- USD 10 sign-in fee: pending / paid / waived (invitation)
  payment_status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table audiences enable row level security;
drop policy if exists "audiences_insert_public" on audiences;
create policy "audiences_insert_public" on audiences
  for insert to anon, authenticated with check (true);
drop policy if exists "audiences_all_auth" on audiences;
create policy "audiences_all_auth" on audiences
  for all to authenticated using (true) with check (true);

create table if not exists staff_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  role_requested text not null, -- admin / organizer / customer_support
  message text,
  status text not null default 'pending', -- pending / approved / rejected
  created_at timestamptz not null default now()
);
alter table staff_applications enable row level security;
drop policy if exists "staff_insert_public" on staff_applications;
create policy "staff_insert_public" on staff_applications
  for insert to anon, authenticated with check (true);
drop policy if exists "staff_all_auth" on staff_applications;
create policy "staff_all_auth" on staff_applications
  for all to authenticated using (true) with check (true);

-- Batch duplicate check for CSV bulk uploads (one call instead of 10,000)
create or replace function public.ics_already_registered(p_ics text[], p_competition uuid)
returns setof text
language sql
security definer
set search_path = public
as $$
  select distinct p.ic_passport
  from participants p
  join registrations r on r.participant_id = p.id
  where r.competition_id = p_competition
    and p.ic_passport = any(p_ics);
$$;
grant execute on function public.ics_already_registered(text[], uuid) to anon, authenticated;
