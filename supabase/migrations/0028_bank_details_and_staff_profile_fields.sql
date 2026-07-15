-- Bank details for Schools and Senseis (matching Participants' own
-- bank/payout fields), and full participant-style identity/contact/bank
-- fields on profiles so Admin/Organizer/Customer Support accounts can
-- capture the same information Add Participant already does.

alter table schools add column if not exists bank_name text;
alter table schools add column if not exists bank_account_no text;
alter table schools add column if not exists bank_account_name text;

alter table senseis add column if not exists ic_passport text;
alter table senseis add column if not exists date_of_birth date;
alter table senseis add column if not exists bank_name text;
alter table senseis add column if not exists bank_account_no text;
alter table senseis add column if not exists bank_account_name text;

alter table profiles add column if not exists ic_passport text;
alter table profiles add column if not exists date_of_birth date;
alter table profiles add column if not exists gender text;
alter table profiles add column if not exists belt_rank text;
alter table profiles add column if not exists home_address text;
alter table profiles add column if not exists city_town text;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists certificate_path text;
alter table profiles add column if not exists bank_name text;
alter table profiles add column if not exists bank_account_no text;
alter table profiles add column if not exists bank_account_name text;
