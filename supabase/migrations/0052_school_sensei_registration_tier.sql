-- School / Sensei directory registration is now paid per competition tier
-- (USD 10 / 100 / 200 — the tier's own registration fee), chosen at
-- registration time. The chosen tier is recorded here; payment_status
-- (added in 0037) flips to 'paid' via Stripe checkout webhook or the
-- admin's manual Paid button.
alter table schools add column if not exists registration_competition_id uuid references competitions(id);
alter table senseis add column if not exists registration_competition_id uuid references competitions(id);
