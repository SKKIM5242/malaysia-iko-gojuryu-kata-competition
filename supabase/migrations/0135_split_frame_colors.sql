-- Splits the single frame_color override into independent outer/inner ring
-- colors -- previously one color (or "Automatic") applied to both border
-- rings; now each ring gets its own override, defaulting to the same
-- automatic kind/rank accent as before when unset. Backfills any existing
-- frame_color onto both new columns before dropping it, so an
-- already-customized frame keeps rendering exactly as it did (checked: it's
-- null everywhere on both dev/staging and production today, so this is a
-- no-op backfill in practice, but correct regardless).

alter table certificate_templates
  add column frame_outer_color text,
  add column frame_inner_color text;

update certificate_templates
set frame_outer_color = frame_color, frame_inner_color = frame_color
where frame_color is not null;

alter table certificate_templates drop column frame_color;
