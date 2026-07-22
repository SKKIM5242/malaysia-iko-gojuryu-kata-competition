-- General "where did you hear about this competition?" attribution field --
-- distinct from audiences.support_referral (which specifically credits a
-- Participant Support member for the 10% sign-in bounty). Optional on
-- every registration type; left blank unless the registrant names a
-- referrer (a friend, not their own Dojo's PIC/Sensei).
alter table schools add column if not exists referral_source text;
alter table senseis add column if not exists referral_source text;
alter table participants add column if not exists referral_source text;
alter table referees add column if not exists referral_source text;
alter table audiences add column if not exists referral_source text;
alter table staff_applications add column if not exists referral_source text;
alter table profiles add column if not exists referral_source text;
