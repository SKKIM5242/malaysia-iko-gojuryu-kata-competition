-- Lets the organizer set the date printed on every certificate for a tier,
-- independent of the competition's actual event_date (e.g. backdating to
-- match when winners were really informed, or a round "announcement" date
-- instead of the recording date). Falls back to event_date when unset --
-- see the certificate rendering select in app/api/certificates/[kind]/[id]/route.tsx.
alter table competitions add column if not exists certificate_date date;
