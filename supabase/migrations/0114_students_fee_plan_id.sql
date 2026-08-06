-- "Fee category" on a student now points at one specific fee plan instead
-- of just a broad student/adult classification -- the plan catalog has
-- grown to include things (Black Belt Holder, Online Training, a
-- competition-tier service charge) that never fit a two-value audience
-- split. The old `category` text column stays in place, untouched, so no
-- existing historical data is lost -- the app just stops reading/writing
-- it, in favour of this new column, going forward.
alter table students add column if not exists fee_plan_id uuid references fee_plans(id) on delete set null;
