-- Full typography/layout controls for certificate_templates (migration 0128),
-- on top of the plain text + logo/medal picker that shipped there -- per-image
-- size, a shared logo-row alignment + "no gap" toggle, footer Date/Signer
-- typography, and a per-field JSONB style blob for each of the 5 text
-- regions (Header1/2, Body1/2/3): font size, color, alignment, weight,
-- italic, underline (+ thickness), line spacing, "no spacing between line",
-- and an approximate max-lines clamp. See lib/certificate-render.tsx for how
-- each is applied and its exact fallback when unset.
--
-- Every new column defaults to whatever reproduces today's hardcoded look
-- exactly (same "changes nothing until an organizer edits a row" principle
-- as 0128) -- the 5 *_style columns default to '{}', meaning "use the
-- field's own built-in default", which the render code already matches
-- 1:1 against the pre-migration JSX (e.g. body1 keeps its accent-colored
-- underline by defaulting show *within the render code*, not the DB, since
-- that default depends on which field it is, not a single global rule).
alter table certificate_templates
  add column logo1_size int not null default 420,
  add column logo2_size int not null default 420,
  add column medal_size int not null default 368,
  -- Today's row is always centered (justify-content: center) -- "left"/
  -- "right" push the whole Logo1(+Medal)+Logo2 row to that edge instead.
  add column logos_alignment text not null default 'center' check (logos_alignment in ('left', 'center', 'right')),
  -- Removes the 20px flex gap (and the medal's extra 46px logo-2 nudge)
  -- between the logo/medal images -- no separate numeric gap field, just
  -- this one on/off per the organizer's own request.
  add column logos_no_spacing boolean not null default false,
  add column date_color text not null default '#44403c',
  add column date_size int not null default 55,
  -- The organizer only asked for Left/Right here (unlike every other
  -- alignment control below, which also offers Center) -- "center" is kept
  -- as the seeded default anyway so applying this migration doesn't shift
  -- today's centered date, and as an option in the UI so a Left/Right pick
  -- can be undone back to today's look.
  add column date_alignment text not null default 'center' check (date_alignment in ('left', 'center', 'right')),
  add column signer_name_size int not null default 28,
  add column signer_title_size int not null default 22,
  add column signer_name_bold boolean not null default true,
  add column signer_title_bold boolean not null default false,
  -- Shared by both the primary and second signer block (there's no UI ask
  -- to style them independently) -- moves the whole signature+hr+name+title
  -- column to that edge of its footer slot, same idea as logos_alignment.
  add column signer_position text not null default 'center' check (signer_position in ('left', 'center', 'right')),
  add column header1_style jsonb not null default '{}'::jsonb,
  add column header2_style jsonb not null default '{}'::jsonb,
  add column body1_style jsonb not null default '{}'::jsonb,
  add column body2_style jsonb not null default '{}'::jsonb,
  add column body3_style jsonb not null default '{}'::jsonb;

-- {kata_category} is being split into two independent merge tokens --
-- {kata_name} (just the kata) and {category} (belt rank / gender / age
-- group) -- per the organizer's request for two separate "insert" buttons
-- instead of one combined one. Only winner/participant's seeded Body 2
-- actually used the old token; substituteMergeTokens() in
-- lib/certificate-render.tsx still recognizes {kata_category} too (as a
-- deprecated alias, same value as {category}) so this rewrite is a
-- courtesy, not a hard requirement -- it just keeps newly-inserted-button
-- tokens and already-saved text consistent.
update certificate_templates
  set body2 = replace(body2, '{kata_category}', '{category}')
  where body2 like '%{kata_category}%';
