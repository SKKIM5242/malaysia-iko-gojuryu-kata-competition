-- Customer Support application/account: which competition tier(s) they'll
-- support (up to 3, picked from the Kata Competition list), highest
-- education, and language ability. Added to both staff_applications (the
-- public application) and profiles (the actual admin-created account) --
-- same dual-table pattern already used for ic_passport/home_address/etc.
alter table staff_applications add column if not exists support_tier_1_id uuid references competitions(id);
alter table staff_applications add column if not exists support_tier_2_id uuid references competitions(id);
alter table staff_applications add column if not exists support_tier_3_id uuid references competitions(id);
alter table staff_applications add column if not exists highest_education text;
alter table staff_applications add column if not exists languages_count int;
alter table staff_applications add column if not exists languages text[] not null default '{}';

alter table profiles add column if not exists support_tier_1_id uuid references competitions(id);
alter table profiles add column if not exists support_tier_2_id uuid references competitions(id);
alter table profiles add column if not exists support_tier_3_id uuid references competitions(id);
alter table profiles add column if not exists highest_education text;
alter table profiles add column if not exists languages_count int;
alter table profiles add column if not exists languages text[] not null default '{}';

-- Class Billing: fee_plans/class_invoices were always MYR-only (amount_myr).
-- Add a currency field (amount_myr is kept as the generic amount column --
-- renaming it app-wide was judged too invasive for what's still just a
-- numeric amount; currency now says what unit it's actually in) and an
-- "applies to" tag for the competition-side roles a plan can be billed
-- against, alongside the existing class-only "audience" (student/adult/all).
alter table fee_plans add column if not exists currency text not null default 'MYR';
alter table fee_plans add column if not exists applies_to text[] not null default '{}';
alter table class_invoices add column if not exists currency text not null default 'MYR';
