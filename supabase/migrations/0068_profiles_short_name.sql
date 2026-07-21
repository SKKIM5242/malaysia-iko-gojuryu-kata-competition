-- Same short name/initial as staff_applications.short_name (migration
-- 0067), but on the actual login/profile row -- set when Admin/Organizer
-- creates a Participant Support account directly from the Support page.
alter table profiles add column if not exists short_name text;
