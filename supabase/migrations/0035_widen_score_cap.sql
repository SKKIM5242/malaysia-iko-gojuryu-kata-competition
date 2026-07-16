-- The official scoring rubric (SCORE TABLE 2 WITH FORMULA.xlsx) sums 7
-- criteria maxing at 1+1+1+1+1+3+3 = 11, not 10 — widen the check
-- constraint so a judge giving full marks across the board isn't silently
-- rejected.

alter table video_scores drop constraint if exists video_scores_score_check;
alter table video_scores add constraint video_scores_score_check check (score >= 0 and score <= 11);
