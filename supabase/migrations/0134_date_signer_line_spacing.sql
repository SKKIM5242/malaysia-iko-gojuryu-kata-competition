-- Extends the Word-style Single/1.5/Double/At least/Exactly/Multiple line
-- spacing control (migration 0133's TextStyle upgrade, Header 1/2 + Body
-- 1/2/3) to the Date description and Signer name/title -- these live as
-- individual columns rather than inside a *_style jsonb blob (they're not
-- part of TextStyle), so each needs its own mode+at pair.

alter table certificate_templates
  add column date_description_line_spacing_mode text not null default 'single'
    check (date_description_line_spacing_mode in ('single', '1.5', 'double', 'atLeast', 'exactly', 'multiple')),
  add column date_description_line_spacing_at numeric,
  add column signer_name_line_spacing_mode text not null default 'single'
    check (signer_name_line_spacing_mode in ('single', '1.5', 'double', 'atLeast', 'exactly', 'multiple')),
  add column signer_name_line_spacing_at numeric,
  add column signer_title_line_spacing_mode text not null default 'single'
    check (signer_title_line_spacing_mode in ('single', '1.5', 'double', 'atLeast', 'exactly', 'multiple')),
  add column signer_title_line_spacing_at numeric;
