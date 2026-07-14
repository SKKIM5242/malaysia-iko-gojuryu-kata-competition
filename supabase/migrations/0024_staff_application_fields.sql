-- Admin/Organizer/Customer Support applications gain the same fields as the
-- Referee/Judge application, except latest rank and certificate stay
-- optional here (no deposit/reward context for this role, unlike referees).

alter table staff_applications add column if not exists ic_passport text;
alter table staff_applications add column if not exists date_of_birth date;
alter table staff_applications add column if not exists gender text;
alter table staff_applications add column if not exists karate_rank text;
alter table staff_applications add column if not exists school text;
alter table staff_applications add column if not exists home_address text;
alter table staff_applications add column if not exists city_town text;
alter table staff_applications add column if not exists home_country text;
alter table staff_applications add column if not exists bank_name text;
alter table staff_applications add column if not exists bank_account_no text;
alter table staff_applications add column if not exists bank_account_name text;
alter table staff_applications add column if not exists certificate_path text;
alter table staff_applications add column if not exists international_certificate_paths text[] not null default '{}';
alter table staff_applications add column if not exists invitation_code text;
