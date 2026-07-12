-- Dojo class billing: students, fee plans, enrollments, invoices.
-- Billing data is private — authenticated (organiser) access only, no anon
-- policies at all. Class fees are in MYR (RM), unlike competition fees (USD).

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  ic_passport text,
  date_of_birth date,
  gender text,
  category text not null default 'student',      -- 'student' | 'adult'
  email text,
  phone text,
  home_address text,
  city_town text,
  home_country text,
  join_date date default current_date,
  status text not null default 'active',         -- 'active' | 'inactive'
  notes text,
  created_at timestamptz not null default now()
);
alter table students enable row level security;
drop policy if exists "students_auth_all" on students;
create policy "students_auth_all" on students
  for all to authenticated using (true) with check (true);

create table if not exists fee_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,                             -- 'membership_yearly' | 'training_monthly' | 'grading'
  amount_myr numeric,                             -- null = set per invoice (e.g. grading)
  billing_interval text not null,                 -- 'yearly' | 'monthly' | 'bimonthly' | 'quarterly'
  audience text not null default 'all',           -- 'student' | 'adult' | 'all'
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table fee_plans enable row level security;
drop policy if exists "fee_plans_auth_all" on fee_plans;
create policy "fee_plans_auth_all" on fee_plans
  for all to authenticated using (true) with check (true);

create table if not exists class_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  fee_plan_id uuid not null references fee_plans(id),
  start_date date not null default current_date,
  next_billing_date date not null default current_date,
  status text not null default 'active',          -- 'active' | 'paused' | 'cancelled'
  created_at timestamptz not null default now(),
  unique (student_id, fee_plan_id)
);
alter table class_enrollments enable row level security;
drop policy if exists "class_enrollments_auth_all" on class_enrollments;
create policy "class_enrollments_auth_all" on class_enrollments
  for all to authenticated using (true) with check (true);

create table if not exists class_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  fee_plan_id uuid references fee_plans(id),
  description text not null,
  amount_myr numeric not null,
  period_start date,
  period_end date,
  due_date date,
  status text not null default 'unpaid',          -- 'unpaid' | 'paid' | 'void'
  payment_reference text,
  stripe_invoice_id text,
  created_at timestamptz not null default now()
);
alter table class_invoices enable row level security;
drop policy if exists "class_invoices_auth_all" on class_invoices;
create policy "class_invoices_auth_all" on class_invoices
  for all to authenticated using (true) with check (true);

-- Seed the organiser's fee plans (amounts editable in the admin panel).
insert into fee_plans (id, name, kind, amount_myr, billing_interval, audience) values
  ('fee00000-0000-0000-0000-000000000001', 'Current Year Membership', 'membership_yearly', 800.00, 'yearly', 'all'),
  ('fee00000-0000-0000-0000-000000000002', 'Monthly Training Fee — Student', 'training_monthly', 800.00, 'monthly', 'student'),
  ('fee00000-0000-0000-0000-000000000003', 'Monthly Training Fee — Adult', 'training_monthly', 900.00, 'monthly', 'adult'),
  ('fee00000-0000-0000-0000-000000000004', 'Grading Fee (amount set per grading)', 'grading', null, 'quarterly', 'all')
on conflict (id) do nothing;
