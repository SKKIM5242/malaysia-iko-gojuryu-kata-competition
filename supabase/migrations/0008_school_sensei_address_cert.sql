-- Home address / country / city for schools and senseis, plus a rank
-- certificate upload for senseis (schools have no rank, so none needed).

alter table schools add column if not exists home_address text;
alter table schools add column if not exists home_country text;
alter table schools add column if not exists city_town text;

alter table senseis add column if not exists home_address text;
alter table senseis add column if not exists home_country text;
alter table senseis add column if not exists city_town text;
alter table senseis add column if not exists certificate_path text;
