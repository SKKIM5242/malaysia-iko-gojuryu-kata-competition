/** The organizer's official scoring rubric — the 7 criteria from
 * "SCORE TABLE 2 WITH FORMULA.xlsx", rescaled per the organizer's
 * instruction so the Total Score is out of 10 (was 11): the five 0–1 rows
 * are unchanged and the two big rows are 0–2.5 each (1×5 + 2.5×2 = 10).
 * Shared by the referee's score sheets and the Admin/Organizer read-only
 * detail view, so every surface renders the identical rubric. */
export const SCORING_CRITERIA: Array<{ label: string; max: number }> = [
  { label: "Neat appearance of uniform and person", max: 1 },
  { label: "Approach, formal bowing, and exit", max: 1 },
  { label: "Proper performance of techniques", max: 1 },
  { label: "Balance and flow", max: 1 },
  { label: "Completion of kata", max: 1 },
  { label: "Spirit or feeling in kata", max: 2.5 },
  { label: "Execution of techniques (sharpness)", max: 2.5 },
];

export function splitEvenly(total: number | null): number[] {
  if (total == null) return SCORING_CRITERIA.map(() => 0);
  const maxSum = SCORING_CRITERIA.reduce((a, c) => a + c.max, 0);
  return SCORING_CRITERIA.map((c) => Math.round(total * (c.max / maxSum) * 10) / 10);
}
