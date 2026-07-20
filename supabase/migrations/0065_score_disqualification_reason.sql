-- A Total Score of 0 disqualifies the entry -- the judge must now record
-- why, picked from the organizer's official disqualification list
-- (lib/scoring-rubric.ts's DISQUALIFICATION_REASONS, sourced from the
-- "Kata Requirements & Rules & Regulation Briefing" announcement) or
-- typed as free text. Enforced client-side (RefereeScoring.tsx) and
-- server-side (submitScore in app/actions/account.ts).
alter table video_scores add column if not exists disqualification_reason text;
