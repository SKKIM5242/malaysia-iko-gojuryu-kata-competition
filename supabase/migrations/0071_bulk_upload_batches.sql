-- Lets a Sensei declare (and pay for) their bulk registration across all 3
-- competition tiers in one enquiry, instead of one tier at a time.
-- batch_id groups up to 3 sibling bulk_upload_payments rows (one per tier)
-- created from a single popup submission, so the organizer can confirm the
-- whole combined bill with one click.
--
-- declared_participants is the true participant headcount cap for that
-- tier -- separate from participant_count, which (per its existing
-- consume_bulk_upload_payment behaviour) is really an EVENT-slot budget:
-- it's decremented by however many rows (= registrations = events) get
-- uploaded, so a participant taking 3 events already spends 3 of it. Kept
-- the column name as-is to avoid touching the proven consume function;
-- only the enquiry form and upload validation now track both dimensions
-- so uploads can be rejected once EITHER cap is exceeded, not just events.
alter table bulk_upload_payments add column if not exists batch_id uuid;
alter table bulk_upload_payments add column if not exists declared_participants int;
update bulk_upload_payments set declared_participants = participant_count where declared_participants is null;
alter table bulk_upload_payments alter column declared_participants set not null;
