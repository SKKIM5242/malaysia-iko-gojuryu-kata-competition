-- Replace the unused "IKO affiliation code" on schools with the actual
-- person in-charge / chief instructor's identity — this is what the
-- organiser actually needs to contact/verify a dojo, the affiliation code
-- was never used anywhere in the app.
alter table schools drop column if exists affiliation_code;

alter table schools add column if not exists contact_title text;
alter table schools add column if not exists contact_name text;
alter table schools add column if not exists contact_karate_title text;
alter table schools add column if not exists contact_rank text;
alter table schools add column if not exists gender text;

-- Senseis already had home_address/city_town/home_country/certificate_path
-- columns from an earlier migration but no gender column and the
-- self-registration form never collected them — this closes that gap so
-- Sensei registration matches the required-field set used by Participants,
-- Referees, and Organizer/Support applications.
alter table senseis add column if not exists gender text;
