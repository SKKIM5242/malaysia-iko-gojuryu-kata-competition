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

/** A Total Score of exactly 0 from any one judge disqualifies the entry —
 * announced nowhere publicly (Winners page, category listings), regardless
 * of what the other judges gave. */
export function isDisqualified(scores: number[]): boolean {
  return scores.some((s) => s === 0);
}

/** Profile roles whose score on a recording is an Admin/Organizer "take over
 * or override" rather than a judge's own mark (see submitScore). */
export const OVERRIDE_ROLES = ["admin", "organizer", "staff"] as const;

export type ScoreStatus = "pending" | "partial" | "complete" | "disqualified" | "override";

export interface ScoreOutcome {
  status: ScoreStatus;
  /** What to display, and what ranking sorts on. Null when there is nothing
   * meaningful to show yet (nobody has scored) or the entry is out
   * (disqualified). */
  score: number | null;
  /** Assigned judges who have submitted, and how many are expected. */
  scored: number;
  required: number;
}

/**
 * The single place that decides what a recording's score IS.
 *
 * Every caller used to average EVERY row in video_scores for the video, with
 * no regard for whether that judge is still on the panel. A judge who scored
 * and was later unassigned kept pulling the average around for good, and the
 * "how many have scored" count included them too -- so an entry could show a
 * green, finished-looking total while two of its three assigned judges were
 * still pending. Confirmed on real data before this was written.
 *
 * The rules, as set by the organizer:
 *  - An Admin/Organizer override REPLACES the panel's average outright.
 *  - Otherwise only the CURRENTLY ASSIGNED judges count; a score from anyone
 *    since unassigned is ignored entirely.
 *  - A 0 from any assigned judge disqualifies, whatever the others gave.
 *  - All assigned judges in -> complete. Some still out -> partial, showing
 *    the running average of those who have scored.
 */
export function resolveScoreOutcome(
  assignedScores: number[],
  overrideScores: number[],
  judgesRequired: number,
): ScoreOutcome {
  const required = Math.max(0, judgesRequired);
  const scored = assignedScores.length;
  if (overrideScores.length > 0) {
    // Averaged only so several overrides can't produce an arbitrary answer;
    // in practice there is one.
    return { status: "override", score: finalScore(overrideScores), scored, required };
  }
  if (isDisqualified(assignedScores)) {
    return { status: "disqualified", score: null, scored, required };
  }
  if (scored === 0) return { status: "pending", score: null, scored, required };
  if (scored < required) return { status: "partial", score: finalScore(assignedScores), scored, required };
  return { status: "complete", score: finalScore(assignedScores), scored, required };
}

/** Splits a recording's raw score rows into the two groups that count, and
 * silently drops the third (a score from a referee no longer assigned).
 * Shared so the Kata Arena and the winners ranking can never drift apart. */
export function splitScoreRows(
  rows: Array<{ refereeUserId: string; score: number }>,
  assignedUserIds: Iterable<string>,
  overrideUserIds: ReadonlySet<string>,
): { assignedScores: number[]; overrideScores: number[] } {
  const assigned = new Set(assignedUserIds);
  const assignedScores: number[] = [];
  const overrideScores: number[] = [];
  for (const row of rows) {
    if (assigned.has(row.refereeUserId)) assignedScores.push(row.score);
    else if (overrideUserIds.has(row.refereeUserId)) overrideScores.push(row.score);
  }
  return { assignedScores, overrideScores };
}
