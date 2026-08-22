-- 1. Per-competition kata family override -----------------------------------
--
-- Until now a kata's family (Elementary / Intermediate / Advance / Mastery /
-- Kobudo) came ONLY from the hardcoded CANONICAL_KATA_ORDER map in
-- lib/kata-families.ts. That map is right for the 24 standard kata, but it
-- left the organizer no way to move one -- dragging a kata into another
-- family box had nothing to write, so it silently did nothing.
--
-- NULL keeps the canonical answer, so every existing row behaves exactly as
-- before and this is a pure addition. A value here wins for that competition
-- only: the same kata can sit in different families in different tiers, which
-- is the point.
alter table categories add column if not exists kata_family text;

comment on column categories.kata_family is
  'Overrides the canonical family from lib/kata-families.ts for this competition only. NULL = use the canonical map. Every category sharing a kata base name in one competition is kept in step by setKataFamily().';

create index if not exists categories_kata_family_idx on categories (competition_id, kata_family);

-- 2. Recording specifications ------------------------------------------------
--
-- The resolution/fps/bitrate each kind of recording is made at. Previously
-- these lived only in code (idealVideoDimensions + recordingBitrates), which
-- made "what would 1080p at 2 Mbit/s cost us?" a question only a developer
-- could answer. One row per recording kind; `applied` marks a row the live
-- recorders should actually use rather than just a figure being modelled.
create table if not exists recording_specs (
  -- 'kata' | 'testimonial_video' | 'testimonial_voice'
  id text primary key,
  resolution text not null,
  fps int not null default 30,
  video_kbps int not null,
  audio_kbps int not null default 96,
  -- false = this row is a what-if being modelled on the Storage page and has
  -- no effect on recording; true = the recorders should adopt it.
  applied boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table recording_specs enable row level security;

-- Readable by any signed-in account (the recorders need it), writable only by
-- the competition managers, matching how every other settings table here
-- behaves.
drop policy if exists recording_specs_select on recording_specs;
create policy recording_specs_select on recording_specs
  for select to authenticated using (true);

drop policy if exists recording_specs_write on recording_specs;
create policy recording_specs_write on recording_specs
  for all to authenticated using (is_admin()) with check (is_admin());

-- Seeded from what the code does TODAY, so the page opens showing the truth
-- rather than a blank form. Kept in sync by hand with lib/media-recording.ts
-- if those defaults ever change; the page's "Use default" button reads the
-- code, not this row.
insert into recording_specs (id, resolution, fps, video_kbps, audio_kbps, applied)
values
  ('kata', '720p', 30, 1134, 96, false),
  ('testimonial_video', '480p', 24, 520, 96, false),
  ('testimonial_voice', 'audio', 0, 0, 96, false)
on conflict (id) do nothing;
