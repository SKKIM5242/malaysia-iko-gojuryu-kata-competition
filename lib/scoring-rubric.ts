/** The organizer's official scoring rubrics — decoded cell-by-cell from
 * "SCORE TABLE 2 WITH FORMULA - Referee or Judges to choose one to use
 * only.xlsx" (two sheets, judges J1/J2/J3 side by side; the referee/judge
 * chooses ONE sheet to use):
 *
 * Score Sheet 1 — 10 criteria, each 0–1, entered row by row; Total Score
 * = the sum (0–10); Average = 3 judges' totals ÷ 3; "Disqualify = 0".
 *
 * Score Sheet 2 — 7 criteria (0–1 ×5, 0–3 ×2) with the sheet's
 * "Referee/Judge Just Input a No. to Self-Populated on Average then
 * readjust accordingly" row: one typed Total (0–10) fills every row, and
 * per the organizer's rule items 1–5 are capped at 1 each with the
 * remainder split equally between items 6 and 7; the judge may then
 * readjust any row. Totals are capped at 10 everywhere (validation,
 * server action, and DB check constraint). */

export interface RubricCriterion {
  label: string;
  max: number;
}

export const SHEET1_CRITERIA: RubricCriterion[] = [
  { label: "Stances", max: 1 },
  { label: "Techniques", max: 1 },
  { label: "Transitional movements", max: 1 },
  { label: "Timing and synchronization", max: 1 },
  { label: "Correct breathing", max: 1 },
  { label: "Focus (KIME)", max: 1 },
  { label: "Conformance: Consistence in the performance of the KIHON", max: 1 },
  { label: "Strength", max: 1 },
  { label: "Speed", max: 1 },
  { label: "Balance", max: 1 },
];

export const SHEET2_CRITERIA: RubricCriterion[] = [
  { label: "Neat appearance of uniform and person", max: 1 },
  { label: "Approach, formal bowing, and exit", max: 1 },
  { label: "Proper performance of techniques", max: 1 },
  { label: "Balance and flow", max: 1 },
  { label: "Completion of kata", max: 1 },
  { label: "Spirit or feeling in kata", max: 3 },
  { label: "Execution of techniques (sharpness)", max: 3 },
];

/** Historical scores were saved against the 7-row rubric; keep it as the
 * default for reading old criteria arrays and even-split estimates. */
export const SCORING_CRITERIA = SHEET2_CRITERIA;

export const TOTAL_MAX = 10;

/** The organizer's official disqualification reasons, verbatim from the
 * "Kata Requirements & Rules & Regulation Briefing" announcement's "Kata
 * or Team Kata - Disqualification" list — offered as a dropdown whenever a
 * judge gives a Total Score of 0, plus a free-text "Other" option for
 * anything not on this list. Kept here (not parsed from the announcement
 * at runtime) since the announcement is free-form markdown prose, not a
 * structured list — update this array by hand if the organizer revises
 * the announcement's wording. */
export const DISQUALIFICATION_REASONS: string[] = [
  "Not announcing the kata, announcing the wrong kata – or performing another kata than pre-announced to the official table.",
  "Failing to bow at the beginning and completion of the Kata performance.",
  "Not starting the Kata facing the Judges.",
  "A distinct pause or stop in the performance.",
  "Omitting or adding movements - or otherwise substantially change the performance from its original form.",
  "Having to take a corrective step to recover from a total loss of balance or have a fall.",
  "Belt falling off during the performance.",
  "Exceeding the total time limit of 5 minutes duration for Kata and Bunkai.",
  "Performing a scissor takedown technique to the neck area in Bunkai (Jodan Kani Basami)",
  "Failure to follow the instructions of the Chief Judge or other misconduct (SHIKKAKU).",
];

export const OTHER_DISQUALIFICATION_REASON = "Other (type your own reason)";

/** Picks which rubric a stored criteria array belongs to by its length —
 * 10 rows = Score Sheet 1, anything else = the 7-row Score Sheet 2. */
export function rubricFor(criteria: number[] | null | undefined): RubricCriterion[] {
  return criteria?.length === SHEET1_CRITERIA.length ? SHEET1_CRITERIA : SHEET2_CRITERIA;
}

/** Legacy even split across the 7 rows — only used to display old scores
 * that were saved without per-row detail. */
export function splitEvenly(total: number | null): number[] {
  if (total == null) return SHEET2_CRITERIA.map(() => 0);
  return SHEET2_CRITERIA.map(() => Math.round((total / SHEET2_CRITERIA.length) * 100) / 100);
}

/** Score Sheet 1's self-populate rule: the typed total (0–10) spreads
 * evenly across all 10 rows — total ÷ 10 each, capped at the row's 0–1
 * maximum, kept to 2 decimal places. The judge can then readjust any row
 * by hand (the Total itself displays to 1 decimal place). */
export function splitSheet1(total: number | null): number[] {
  if (total == null) return SHEET1_CRITERIA.map(() => 0);
  const t = Math.max(0, Math.min(TOTAL_MAX, total));
  const perRow = Math.round(Math.min(t / SHEET1_CRITERIA.length, 1) * 100) / 100;
  return SHEET1_CRITERIA.map(() => perRow);
}

/** Score Sheet 2's self-populate rule: the typed total spreads on average
 * (total ÷ 7) but items 1–5 never exceed their 0–1 range — whatever the
 * cap holds back is split equally between items 6 and 7 (0–3 each; at the
 * 10 maximum they get 2.5 each, still in range). The judge can then
 * readjust any row by hand. */
export function splitCapped(total: number | null): number[] {
  if (total == null) return SHEET2_CRITERIA.map(() => 0);
  const t = Math.max(0, Math.min(TOTAL_MAX, total));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const perRow15 = round2(Math.min(t / SHEET2_CRITERIA.length, 1));
  const perRow67 = round2((t - perRow15 * 5) / 2);
  return [perRow15, perRow15, perRow15, perRow15, perRow15, perRow67, perRow67];
}
