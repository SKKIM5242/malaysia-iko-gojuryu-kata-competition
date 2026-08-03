-- Per-tier customization of the recording watermark footer (previously a
-- single hardcoded string + fixed styling in components/KataRecorder.tsx).
-- All columns nullable/defaulted so existing competitions keep exactly
-- today's look until an organizer explicitly customizes one.

alter table competitions
  add column if not exists watermark_text text,
  add column if not exists watermark_font_size_px integer,
  add column if not exists watermark_font_family text,
  add column if not exists watermark_bold boolean not null default false,
  add column if not exists watermark_color text,
  add column if not exists watermark_direction text not null default 'ltr';

alter table competitions
  drop constraint if exists competitions_watermark_direction_check;
alter table competitions
  add constraint competitions_watermark_direction_check
  check (watermark_direction in (
    'ltr',               -- a) Normal - Left to Right
    'vertical_ltr_left', -- b) Top to Bottom - at left border
    'vertical_rtl_left', -- c) Bottom to Top - at left border
    'diagonal_up',       -- d) Left Bottom to Right Top - Diagonally
    'diagonal_down',     -- e) Left Top to Right Bottom - Diagonally
    'vertical_ltr_right',-- f) Top to Bottom - at right border
    'vertical_rtl_right',-- g) Bottom to Top - at right border
    'rtl_cjk'            -- h) Chinese/Japanese Kanji font - Right to Left
  ));
