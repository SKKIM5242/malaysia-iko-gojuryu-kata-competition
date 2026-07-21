-- Participant Support's own short name/initial, entered at registration.
-- Audience sign-ins credit a referral by entering this same short
-- name/initial in audiences.support_referral (migration 0066); the
-- organizer matches the two manually to pay the 10% cut.
alter table staff_applications add column if not exists short_name text;
