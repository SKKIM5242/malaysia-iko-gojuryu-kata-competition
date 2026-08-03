-- Organizational job title for Organizer/Support accounts (e.g. "Chief
-- Organizer", "Support Assistant") -- purely descriptive, distinct from
-- profiles.role/roles which drive actual permissions. Free text, not a DB
-- enum, so the picklist can grow without a migration; the admin UI offers
-- a fixed dropdown of the organizer's own titles.
alter table profiles add column if not exists staff_title text;
