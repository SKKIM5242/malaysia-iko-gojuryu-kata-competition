-- Persist each judge's per-criterion breakdown (the 7 rows from SCORE TABLE
-- 2 WITH FORMULA.xlsx), not just the summed Total Score, so Admin/Organizer
-- can review exactly how a score was made up. Nullable -- scores submitted
-- before this column existed keep showing just their total.
alter table video_scores add column if not exists criteria numeric[];
