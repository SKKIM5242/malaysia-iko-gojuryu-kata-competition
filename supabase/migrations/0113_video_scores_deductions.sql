-- Per-criterion "Reduce Score System" deductions: a 2D grid (one boolean[]
-- per criterion row, 5 columns -- Minor/-0.05, Minor/-0.1, 3rd/-0.2,
-- 2nd/-0.3, 1st/-0.5) recording which deduction checkboxes a judge ticked
-- for each row of Score Sheet 1/2, stored alongside the row scores already
-- in `criteria` so Full View / the score detail popup have something to
-- show once judging closes (both are otherwise read-only).
alter table video_scores add column if not exists deductions jsonb;
