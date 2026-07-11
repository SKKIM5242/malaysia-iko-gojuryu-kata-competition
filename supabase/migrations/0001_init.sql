create table if not exists competitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  venue text,
  event_date date,
  registration_deadline date,
  registration_fee_myr numeric,
  status text not null default 'open',
  description text,
  created_at timestamptz not null default now()
);
alter table competitions enable row level security;
drop policy if exists "competitions_v1_read" on competitions;
create policy "competitions_v1_read" on competitions for select using (true);
drop policy if exists "competitions_v1_write" on competitions;
create policy "competitions_v1_write" on competitions for all using (true) with check (true);

create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  state text,
  affiliation_code text,
  created_at timestamptz not null default now()
);
alter table schools enable row level security;
drop policy if exists "schools_v1_read" on schools;
create policy "schools_v1_read" on schools for select using (true);
drop policy if exists "schools_v1_write" on schools;
create policy "schools_v1_write" on schools for all using (true) with check (true);

create table if not exists senseis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  rank text,
  school_id uuid references schools(id),
  created_at timestamptz not null default now()
);
alter table senseis enable row level security;
drop policy if exists "senseis_v1_read" on senseis;
create policy "senseis_v1_read" on senseis for select using (true);
drop policy if exists "senseis_v1_write" on senseis;
create policy "senseis_v1_write" on senseis for all using (true) with check (true);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  competition_id uuid references competitions(id),
  name text not null,
  age_min int,
  age_max int,
  belt_group text,
  gender text,
  created_at timestamptz not null default now()
);
alter table categories enable row level security;
drop policy if exists "categories_v1_read" on categories;
create policy "categories_v1_read" on categories for select using (true);
drop policy if exists "categories_v1_write" on categories;
create policy "categories_v1_write" on categories for all using (true) with check (true);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  full_name text not null,
  ic_passport text not null,
  date_of_birth date,
  gender text,
  belt_rank text,
  school_id uuid references schools(id),
  sensei_id uuid references senseis(id),
  created_at timestamptz not null default now()
);
alter table participants enable row level security;
drop policy if exists "participants_v1_read" on participants;
create policy "participants_v1_read" on participants for select using (true);
drop policy if exists "participants_v1_write" on participants;
create policy "participants_v1_write" on participants for all using (true) with check (true);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  competition_id uuid references competitions(id),
  participant_id uuid references participants(id),
  category_id uuid references categories(id),
  payment_status text not null default 'pending',
  payment_reference text,
  notes text,
  created_at timestamptz not null default now()
);
alter table registrations enable row level security;
drop policy if exists "registrations_v1_read" on registrations;
create policy "registrations_v1_read" on registrations for select using (true);
drop policy if exists "registrations_v1_write" on registrations;
create policy "registrations_v1_write" on registrations for all using (true) with check (true);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  competition_id uuid references competitions(id),
  title text not null,
  body text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);
alter table announcements enable row level security;
drop policy if exists "announcements_v1_read" on announcements;
create policy "announcements_v1_read" on announcements for select using (true);
drop policy if exists "announcements_v1_write" on announcements;
create policy "announcements_v1_write" on announcements for all using (true) with check (true);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  table_name text,
  record_id uuid,
  action text,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid,
  ip_address text,
  created_at timestamptz not null default now()
);
alter table audit_logs enable row level security;
drop policy if exists "audit_logs_v1_read" on audit_logs;
create policy "audit_logs_v1_read" on audit_logs for select using (true);
drop policy if exists "audit_logs_v1_write" on audit_logs;
create policy "audit_logs_v1_write" on audit_logs for all using (true) with check (true);

insert into schools (id, name, state, affiliation_code) values
  ('a1000000-0000-0000-0000-000000000001', 'Dojo Goju-ryu Kuala Lumpur', 'Kuala Lumpur', 'IKO-MY-KL-001'),
  ('a1000000-0000-0000-0000-000000000002', 'Persatuan Karate Selangor Goju-ryu', 'Selangor', 'IKO-MY-SEL-002'),
  ('a1000000-0000-0000-0000-000000000003', 'Kelab Karate Penang IKO', 'Pulau Pinang', 'IKO-MY-PNG-003');

insert into senseis (id, name, rank, school_id) values
  ('b1000000-0000-0000-0000-000000000001', 'Sensei Ahmad Razali', 'Godan', 'a1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002', 'Sensei Lim Boon Huat', 'Yondan', 'a1000000-0000-0000-0000-000000000002'),
  ('b1000000-0000-0000-0000-000000000003', 'Sensei Muthu Krishnan', 'Sandan', 'a1000000-0000-0000-0000-000000000003');

insert into competitions (id, name, venue, event_date, registration_deadline, registration_fee_myr, status, description) values
  ('c1000000-0000-0000-0000-000000000001', 'Malaysia IKO Goju-ryu Kata Championship 2026', 'Dewan Belia Chow Kit, Kuala Lumpur', '2026-09-20', '2026-08-31', 80.00, 'open', 'The official Malaysia IKO Goju-ryu Karate-do Kata competition open to all registered IKO members. Perform Kaishu or Heishu kata in your division.');

insert into categories (id, competition_id, name, age_min, age_max, belt_group, gender) values
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Junior Male Kyu', 12, 17, 'kyu', 'male'),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Junior Female Kyu', 12, 17, 'kyu', 'female'),
  ('d1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Senior Male Dan', 18, 99, 'dan', 'male'),
  ('d1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 'Senior Female Open', 18, 99, 'kyu', 'female');

insert into participants (id, full_name, ic_passport, date_of_birth, gender, belt_rank, school_id, sensei_id) values
  ('e1000000-0000-0000-0000-000000000001', 'Muhammad Haziq bin Azlan', '081234-14-5671', '2008-03-12', 'male', '3rd Kyu', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000002', 'Nurul Ain binti Roslan', '090987-10-4432', '2009-07-22', 'female', '4th Kyu', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000003', 'Tan Wei Jie', '001122-14-3345', '2000-11-22', 'male', '1st Dan', 'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000004', 'Kavitha a/p Subramaniam', '031020-07-8821', '2003-10-20', 'female', '2nd Kyu', 'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003'),
  ('e1000000-0000-0000-0000-000000000005', 'Ariff Danial bin Suhaimi', '070503-14-6612', '2007-05-03', 'male', '2nd Kyu', 'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000006', 'Siti Hajar binti Yusof', '021118-10-7743', '2002-11-18', 'female', '1st Kyu', 'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003');

insert into registrations (id, competition_id, participant_id, category_id, payment_status, payment_reference) values
  ('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'paid', 'MAYB-20250710-001'),
  ('f1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'paid', 'MAYB-20250711-002'),
  ('f1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003', 'paid', 'CIMB-20250712-088'),
  ('f1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000004', 'pending', null),
  ('f1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001', 'pending', null),
  ('f1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000004', 'rejected', 'INVALID-REF');

insert into announcements (id, competition_id, title, body, published) values
  ('91000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Registration Now Open — Malaysia IKO Goju-ryu Kata Championship 2026', 'Registration is officially open for all IKO Malaysia Goju-ryu members. Deadline is **31 August 2026**. Fee: RM 80 per participant. Transfer to Maybank 5121-2345-6789 (Malaysia IKO Goju-ryu Association) and WhatsApp your receipt to the organiser.', true),
  ('91000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Kata Requirements & Rules Briefing', 'All competitors must perform a **Goju-ryu Kata** from the approved IKO list. Heishu kata (Sanchin, Tensho) are permitted for Dan divisions. Kyu divisions must perform Kaishu kata. Full rules document will be emailed upon confirmed payment.', true);