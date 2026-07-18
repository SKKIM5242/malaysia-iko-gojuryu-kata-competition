-- The Total Score is now out of 10 (was 11), per the organizer's
-- instruction: the rubric's five 0-1 criteria are unchanged and the two
-- big criteria become 0-2.5 each. One-time rescale of the existing (test)
-- scores from the 11-point to the 10-point scale, then the tighter check.
alter table video_scores drop constraint if exists video_scores_score_check;

-- Rows with a per-criterion breakdown: scale the two big criteria by
-- 2.5/3 and recompute the total from the scaled rows.
update video_scores
set criteria = array[
      criteria[1], criteria[2], criteria[3], criteria[4], criteria[5],
      round(criteria[6] * 2.5 / 3.0, 1),
      round(criteria[7] * 2.5 / 3.0, 1)
    ],
    score = round(
      criteria[1] + criteria[2] + criteria[3] + criteria[4] + criteria[5]
      + round(criteria[6] * 2.5 / 3.0, 1) + round(criteria[7] * 2.5 / 3.0, 1), 1)
where criteria is not null and array_length(criteria, 1) = 7;

-- Rows with only a total (old quick/override scores): proportional rescale.
update video_scores
set score = round(score * 10.0 / 11.0, 1)
where criteria is null or array_length(criteria, 1) is distinct from 7;

alter table video_scores add constraint video_scores_score_check
  check (score >= 0 and score <= 10);
