-- Per-kind, organizer-editable certificate template: the 5 text regions
-- (Header1/Header2/Body1/Body2/Body3) and the logo/medal layout, replacing
-- what was previously hardcoded in lib/certificate-render.tsx. Keyed by
-- kind rather than a singleton row -- winner/participant/referee/sensei/
-- school/support each get their own template; the 3 winner rank cards
-- (1st/2nd/3rd) on the admin preview grid all share the single "winner"
-- row, differing only by the built-in rank-colored medal art and accent
-- color (not by editable text), per the organizer's own call on this.
--
-- Body1/2/3 (and, optionally, Header1/2) hold plain text that may contain
-- merge tokens -- {name}, {kata_category}, {competition_tier}, {rank} --
-- substituted at render time from that specific certificate's live data
-- (see substituteMergeTokens in lib/certificate-render.tsx). Seeded below
-- with the exact wording/values the hardcoded version used, so applying
-- this migration changes nothing visually until an organizer edits a row.
create table certificate_templates (
  kind text primary key check (kind in ('winner', 'participant', 'referee', 'sensei', 'school', 'support')),
  header1 text not null default '',
  header2 text not null default '',
  body1 text not null default '',
  body2 text not null default '',
  body3 text not null default '',
  -- 1 = only Logo 1 renders (Logo 2 slot empty); 2 = both.
  logo_count smallint not null default 2 check (logo_count in (1, 2)),
  logo1_path text,
  logo2_path text,
  -- Winner's medal is always the built-in dynamic gold/silver/bronze art
  -- (rank isn't known ahead of render time, so it can't be a plain upload)
  -- and always sits centered between Logo 1 and Logo 2 when logo_count = 2,
  -- matching today's fixed layout -- show_medal/medal_position only have an
  -- effect for the other 5 kinds, which have no rank and so no medal at
  -- all today; opting one in uses a plain uploaded image instead.
  show_medal boolean not null default false,
  medal_position text not null default 'between' check (medal_position in ('between', 'left', 'right')),
  medal_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into certificate_templates (kind, header1, header2, body1, body2, body3, logo_count, show_medal, medal_position) values
  ('winner', 'Certificate of Achievement', 'This certificate is proudly presented to',
   '{name}', 'for placing {rank} PLACE in {kata_category} Event', 'at {competition_tier}',
   2, true, 'between'),
  ('participant', 'Certificate of Participation', 'This certificate is proudly presented to',
   '{name}', 'for taking part in {kata_category} Event', 'at {competition_tier}',
   2, false, 'between'),
  ('referee', 'Certificate of Appreciation', 'This certificate is proudly presented to',
   '{name}', 'for serving as a Judge', 'at {competition_tier}',
   2, false, 'between'),
  ('sensei', 'Certificate of Appreciation', 'This certificate is proudly presented to',
   '{name}', 'for guiding your students'' participation, as Sensei,', 'at {competition_tier}',
   2, false, 'between'),
  ('school', 'Certificate of Appreciation', 'This certificate is proudly presented to',
   '{name}', 'for your students'' participation, as a School / Dojo,', 'at {competition_tier}',
   2, false, 'between'),
  ('support', 'Certificate of Appreciation', 'This certificate is proudly presented to',
   '{name}', 'for supporting the organizing team', 'at {competition_tier}',
   2, false, 'between');

alter table certificate_templates enable row level security;

-- Readable by anyone -- certificate rendering (including the public,
-- signed-out Winner Certificate preview on /winners) needs this at render
-- time, and none of it is sensitive: it's the same "presented to" wording
-- and org logos already visible on every generated certificate PNG.
create policy "certificate_templates_select_all" on certificate_templates
  for select using (true);

-- Deliberately narrower than every other certificate-admin action on this
-- page (Settings/Publish use is_admin(), which despite its name also
-- includes 'staff' and 'organizer') -- the organizer specifically asked
-- for template *design* to be Admin + Organizer only, Staff excluded,
-- since it's the org's branding/wording rather than day-to-day operation.
create or replace function public.is_certificate_template_manager()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role in ('admin', 'organizer') and approved
  );
$$;

create policy "certificate_templates_manage" on certificate_templates
  for all using (is_certificate_template_manager()) with check (is_certificate_template_manager());
