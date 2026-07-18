/** The organiser's official scoring rubric — copied exactly from
 * "SCORE TABLE 2 WITH FORMULA.xlsx": 7 criteria summing to 11 max
 * (1+1+1+1+1+3+3). Shared by the referee's own scoring popup and the
 * Admin/Organizer read-only detail view, so both render the identical
 * layout as the source spreadsheet. */
export const SCORING_CRITERIA: Array<{ label: string; max: number }> = [
  { label: "Neat appearance of uniform and person", max: 1 },
  { label: "Approach, formal bowing, and exit", max: 1 },
  { label: "Proper performance of techniques", max: 1 },
  { label: "Balance and flow", max: 1 },
  { label: "Completion of kata", max: 1 },
  { label: "Spirit or feeling in kata", max: 3 },
  { label: "Execution of techniques (sharpness)", max: 3 },
];

export function splitEvenly(total: number | null): number[] {
  if (total == null) return SCORING_CRITERIA.map(() => 0);
  const maxSum = SCORING_CRITERIA.reduce((a, c) => a + c.max, 0);
  return SCORING_CRITERIA.map((c) => Math.round(total * (c.max / maxSum) * 10) / 10);
}
