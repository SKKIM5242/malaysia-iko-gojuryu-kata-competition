-- Two new fields on the Organizer/Participant Support application form:
-- "Which region would you prefer to support?" (required, one of the 7
-- Energy-Institute-style regions) and "Which country are you currently
-- based at?" (required, world country list). Deliberately separate from
-- the existing home_country/country free-text fields on these same forms
-- -- someone can be currently based somewhere other than their permanent
-- home address, and "based_country" answers that specifically.
--
-- staff_applications holds the public application (see applyStaff in
-- app/actions/community.ts); profiles holds the account once approved, or
-- created directly by an admin (see createStaffAccount in
-- app/actions/admin.ts) -- both need the columns since either path can be
-- how a Participant Support account comes to exist.

alter table staff_applications add column if not exists preferred_region text;
alter table staff_applications add column if not exists based_country text;

alter table profiles add column if not exists preferred_region text;
alter table profiles add column if not exists based_country text;

comment on column profiles.preferred_region is 'Which world region this Participant Support / Organizer account prefers to support (see SUPPORT_REGIONS in lib/reference-data.ts).';
comment on column profiles.based_country is 'Which country this account is currently based in -- may differ from their home address country.';
