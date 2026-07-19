/** The organizer's official scoring rubric — decoded cell-by-cell from
 * "SCORE TABLE 2 WITH FORMULA.xlsx" (single sheet, judges J1/J2/J3 side by
 * side): 7 criteria with ranges 0–1 (×5) and 0–3 (×2), a Total Score row
 * whose stated range is 0–10, a "Sensei Just Input a No. to Self-Populate"
 * row (type one total → each criterion row self-populates total÷7, the
 * spreadsheet's $E$12/$C$12 formula), Average = 3 judges' totals ÷ 3, and
 * "0 = Disqualified". Score Sheet 1 = the self-populate entry mode; Score
 * Sheet 2 = per-row entry. Totals are capped at 10 everywhere (validation,
 * server action, and DB check constraint). */
export const SCORING_CRITERIA: Array<{ label: string; max: number }> = [
  { label: "Neat appearance of uniform and person", max: 1 },
  { label: "Approach, formal bowing, and exit", max: 1 },
  { label: "Proper performance of techniques", max: 1 },
  { label: "Balance and flow", max: 1 },
  { label: "Completion of kata", max: 1 },
  { label: "Spirit or feeling in kata", max: 3 },
  { label: "Execution of techniques (sharpness)", max: 3 },
];

export const TOTAL_MAX = 10;

/** The Excel's self-populate rule: one typed total spreads evenly across
 * all 7 rows (total ÷ 7 each — the sheet's $E$12/$C$12 with C12 = 7). */
export function splitEvenly(total: number | null): number[] {
  if (total == null) return SCORING_CRITERIA.map(() => 0);
  return SCORING_CRITERIA.map(() => Math.round((total / SCORING_CRITERIA.length) * 100) / 100);
}
