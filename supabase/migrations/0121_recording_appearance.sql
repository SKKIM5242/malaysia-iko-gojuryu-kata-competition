-- Branding for the RECORDING screens (testimonial video today, kata
-- recording next), kept separate from site_appearance on purpose.
--
-- The public site's header carries a logo, a title, a subtitle and a whole
-- navigation menu; a recording screen carries a narrow banner and a footer
-- watermark over a live camera feed and nothing else. Sharing one row would
-- mean every change to the website's chrome silently changed what appears
-- across a competitor's recording, and the site's own menu/button fields
-- would sit unused and confusing in a recording context.
--
-- Same singleton pattern, storage bucket, and RLS tier as site_appearance
-- (migration 0112) so the two admin sections behave identically.
create table if not exists recording_appearance (
  id boolean primary key default true check (id),
  logo_path text,

  -- Banner line 1 -- the big title across the top of the recording screen.
  line1_text text,
  line1_align text not null default 'center' check (line1_align in ('left','center','right')),
  line1_line_height numeric not null default 1.2,
  line1_color text not null default '#ffffff',
  line1_font_size int not null default 18,
  line1_font_family text not null default 'serif',
  line1_bold boolean not null default true,

  -- Banner line 2 -- the smaller "Organized by ..." line underneath.
  line2_text text,
  line2_align text not null default 'center' check (line2_align in ('left','center','right')),
  line2_line_height numeric not null default 1.2,
  line2_color text not null default '#ffffff',
  line2_font_size int not null default 11,
  line2_font_family text not null default 'sans',
  line2_bold boolean not null default false,

  -- Footer watermark across the bottom of the recording screen.
  footer_text text,
  footer_align text not null default 'center' check (footer_align in ('left','center','right')),
  footer_line_height numeric not null default 1.2,
  footer_color text not null default '#ffffff',
  footer_font_size int not null default 12,
  footer_font_family text not null default 'sans',
  footer_bold boolean not null default true,

  updated_at timestamptz not null default now()
);

-- Seeded with the organizer's own wording rather than left null, so the
-- recording screens show the right banner from the moment this ships
-- instead of only after somebody visits the admin form.
insert into recording_appearance (id, line1_text, line2_text, footer_text)
values (
  true,
  'MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION',
  'Organized by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD',
  'Malaysia Open Virtual Karate-do Kata Competition 2026'
)
on conflict do nothing;

alter table recording_appearance enable row level security;

-- Readable by anyone: the recording screen is reached by participants and
-- winners, and these are public branding strings, not sensitive data.
drop policy if exists "recording_appearance_select" on recording_appearance;
create policy "recording_appearance_select" on recording_appearance
  for select to authenticated, anon using (true);

-- Same editor tier as site_appearance: is_competition_manager() covers
-- admin / organizer / staff (defined in migration 0075).
drop policy if exists "recording_appearance_write" on recording_appearance;
create policy "recording_appearance_write" on recording_appearance
  for all to authenticated
  using (public.is_competition_manager())
  with check (public.is_competition_manager());
