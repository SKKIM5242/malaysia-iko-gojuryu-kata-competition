/** Shared cap for a judge's self-written Confirmed Judges introduction --
 * used by both the client-side live counter (WordCountedTextarea) and the
 * server-side authoritative check (saveJudgeSelfIntro), so the two can
 * never drift apart. */
export const JUDGE_SELF_INTRO_MAX_WORDS = 200;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
