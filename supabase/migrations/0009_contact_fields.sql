-- Mobile phone + email for participants, schools, and senseis.
-- (Referees and staff applications already have both.)

alter table participants add column if not exists email text;
alter table participants add column if not exists phone text;

alter table schools add column if not exists email text;
alter table schools add column if not exists phone text;

alter table senseis add column if not exists email text;
alter table senseis add column if not exists phone text;
