-- Postcode field alongside every registration form's required home address
-- (Participant, School, Sensei, Referee, Staff/Organizer application).

alter table participants add column if not exists postcode text;
alter table schools add column if not exists postcode text;
alter table senseis add column if not exists postcode text;
alter table referees add column if not exists postcode text;
alter table staff_applications add column if not exists postcode text;
