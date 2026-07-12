-- Stripe Checkout link per class invoice (owner sends it to the payer).
alter table class_invoices add column if not exists checkout_url text;
