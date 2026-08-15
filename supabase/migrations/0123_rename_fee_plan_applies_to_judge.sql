-- APPLIES_TO_OPTIONS in app/admin/classes/page.tsx renamed "Competition
-- Referee/Judge" -> "Competition Judge" (site-wide Referee->Judge wording
-- pass). fee_plans.applies_to is a text[] whose values must match the
-- current dropdown options exactly, or a stored old value silently stops
-- matching any checkbox on the edit form. One existing row used the old
-- value; replace it in place rather than leave it orphaned.
update fee_plans
set applies_to = array_replace(applies_to, 'Competition Referee/Judge', 'Competition Judge')
where applies_to @> array['Competition Referee/Judge'];
