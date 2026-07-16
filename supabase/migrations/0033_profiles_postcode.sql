-- Postcode for Admin/Organizer and Customer Support accounts (profiles),
-- alongside their now-required home address.

alter table profiles add column if not exists postcode text;
