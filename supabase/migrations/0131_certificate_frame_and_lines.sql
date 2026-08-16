-- Footer Date/Signer divider-line style+length, an organizer-editable Date
-- description (replacing the hardcoded "Winner Announcement Date" /
-- "Announcement Date" ternary), and outer/inner frame border controls --
-- all seeded to reproduce today's exact hardcoded look, same "changes
-- nothing until an organizer edits a row" principle as every certificate
-- template migration before this one.
alter table certificate_templates
  add column date_description text not null default 'Announcement Date',
  -- "dotted" is deliberately not an allowed value -- Satori (next/og's
  -- renderer) only implements borderTopStyle solid/dashed and throws a hard
  -- 500 on anything else, confirmed by actually triggering it.
  add column date_line_style text not null default 'solid' check (date_line_style in ('solid', 'dashed')),
  -- Matches DateBlock's hardcoded width={380} in lib/certificate-render.tsx
  -- -- the hr spans 100% of this, so "line length" and "column width" are
  -- the same number.
  add column date_line_width int not null default 380,
  add column signer_line_style text not null default 'solid' check (signer_line_style in ('solid', 'dashed')),
  -- Shared by both signers (same "one shared style" precedent as every
  -- other signer_* column) -- was previously two different hardcoded
  -- values, 500 for the primary signer and 460 for the second; 500 is the
  -- closer match for the common case (most certificates only ever show one
  -- signer) and only a ~9% difference for the rarer two-signer case.
  add column signer_line_width int not null default 500,
  -- Outer ring is 14px, inner ring 3px, both currently always the kind/
  -- rank accent color -- frame_color null preserves that automatic
  -- coloring; set, it overrides both rings uniformly (all 3 Winner ranks
  -- included, since template design here is per-kind, not per-rank).
  add column frame_outer_width int not null default 14,
  add column frame_inner_width int not null default 3,
  add column frame_color text;

update certificate_templates set date_description = 'Winner Announcement Date' where kind = 'winner';
