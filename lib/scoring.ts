/**
 * Competition judging convention: with 5 or more judges, the single highest
 * and single lowest scores are dropped before averaging (limits the effect
 * of one outlier judge). With fewer than 5 judges (e.g. a 3-judge panel),
 * every score counts — there's nothing safe to trim.
 */
export function finalScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  let counted = scores;
  if (scores.length >= 5) {
    const sorted = [...scores].sort((a, b) => a - b);
    counted = sorted.slice(1, -1);
  }
  return counted.reduce((a, b) => a + b, 0) / counted.length;
}
