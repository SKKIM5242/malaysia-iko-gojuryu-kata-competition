-- Two organizer-editable text overrides, both nullable ("blank = default"),
-- matching the convention already used for watermark_text etc.:
--   1) site_appearance.homepage_note -- the single global note shown once
--      beneath the tier cards on the homepage (currently hardcoded text).
--   2) competitions.kata_events_note -- per-tier, shown under that tier's
--      "Kata events" heading (currently a hardcoded, tier-blind paragraph).
alter table site_appearance add column if not exists homepage_note text;
alter table competitions add column if not exists kata_events_note text;
