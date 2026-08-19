import type { createClient } from "@/lib/supabase/server";
import { OVERRIDE_ROLES, resolveScoreOutcome, splitScoreRows, type ScoreStatus } from "@/lib/scoring";
import { kataBaseOf } from "@/lib/division";

export interface JudgeScoreEntry {
  judgeName: string;
  judgeUserId: string;
  score: number | null;
}

export interface ArenaEntry {
  videoId: string;
  participantId: string | null;
  participantName: string;
  categoryName: string | null;
  /** Ranking groups on this, not on the name: two different categories can
   * carry identical names (the same event exists in more than one tier), and
   * grouping by the label would rank entries from separate categories
   * against each other. */
  categoryId: string | null;
  /** Only used to scope a School/Sensei login's view to their own
   * students — never shown to anyone. */
  schoolId: string | null;
  senseiId: string | null;
  playbackUrl: string | null;
  createdAt: string;
  /** Trimmed-mean aggregate. Shown in Kata Arena as the round-status total
   * once `scoresSubmitted` reaches the competition's judges_required — the
   * Winners page separately reveals rankings/standings 30 days after the
   * deadline regardless of this. */
  finalScore: number | null;
  /** true if any one ASSIGNED judge gave a Total Score of exactly 0 — the
   * entry is disqualified regardless of what the other judges gave. */
  disqualified: boolean;
  /** What state this recording's scoring is actually in — see
   * resolveScoreOutcome. Drives the Kata Arena status pill's colour:
   * green complete, amber partial, red for an override or a
   * disqualification, grey while nobody has scored. */
  status: ScoreStatus;
  /** Position within this recording's own CATEGORY, by score, best first —
   * the same grouping the winners are decided on. Null for anything with no
   * usable score (nobody has judged it yet, or it is disqualified). */
  rank: number | null;
  /** Another settled entry in the same category finished on exactly this
   * score. A tie can't stand -- an Admin/Organizer or Chief Judge has to
   * override one of them (they are alerted the moment it happens, see
   * maybeNotifyScoreTie) -- so it is shown as unresolved rather than as two
   * equal placings. */
  tied: boolean;
  /** How many of the assigned judges have actually submitted a score —
   * compared against the competition's judges_required to know whether
   * judging is complete for this recording. */
  scoresSubmitted: number;
  /** One entry per assigned referee, individual (not aggregated) — this is
   * what Referee/Admin/Organizer/Participant Support/Audience see on Kata
   * Arena instead of the final score. */
  judgeScores: JudgeScoreEntry[];
}

/** All submitted recordings, individual judge scores, and the final
 * trimmed-mean score for a competition — used by both /account and the
 * Kata Arena page. Callers decide what to actually display: Kata Arena
 * shows judgeScores to privileged viewers and never shows finalScore
 * except to a participant viewing their own entry post-announcement
 * (see lib/winners.ts's winnersRevealed). */
export async function loadKataArena(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string,
): Promise<ArenaEntry[]> {
  const { data: regs } = await supabase.from("registrations").select("id").eq("competition_id", competitionId);
  const regIds = (regs ?? []).map((r) => r.id as string);
  if (regIds.length === 0) return [];

  const { data: videos } = await supabase
    .from("kata_videos")
    .select(
      "id, storage_path, created_at, participant:participants(id, full_name, school_id, sensei_id), registration:registrations(category:categories(id, name))",
    )
    .in("registration_id", regIds);
  const videoList =
    (videos as unknown as Array<{
      id: string;
      storage_path: string;
      created_at: string;
      participant: { id: string; full_name: string; school_id: string | null; sensei_id: string | null } | null;
      registration: { category: { id: string; name: string } | null } | null;
    }>) ?? [];
  if (videoList.length === 0) return [];

  const videoIds = videoList.map((v) => v.id);
  const [{ data: scores }, { data: assignments }, { data: overrideProfiles }] = await Promise.all([
    supabase.from("video_scores").select("video_id, referee_user_id, score").in("video_id", videoIds),
    supabase.from("referee_assignments").select("video_id, referee_user_id").in("video_id", videoIds),
    // Needed to tell an Admin/Organizer override apart from a score left
    // behind by a referee who has since been unassigned: both are score rows
    // with no assignment, but the first replaces the panel's average and the
    // second must be ignored completely.
    supabase.from("profiles").select("user_id").in("role", OVERRIDE_ROLES as unknown as string[]),
  ]);
  const overrideUserIds = new Set((overrideProfiles ?? []).map((p) => p.user_id as string));
  // Read here rather than taken from the caller, so the status and ranking
  // below can't be computed against a different panel size than the one the
  // page renders against.
  const { data: comp } = await supabase
    .from("competitions")
    .select("judges_required")
    .eq("id", competitionId)
    .maybeSingle();
  const judgesRequired = Number(comp?.judges_required ?? 3);

  const refereeIds = [...new Set((assignments ?? []).map((a) => a.referee_user_id as string))];
  const refereeName = new Map<string, string>();
  if (refereeIds.length > 0) {
    const { data: refProfiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", refereeIds);
    for (const p of refProfiles ?? []) {
      refereeName.set(p.user_id as string, (p.full_name as string) ?? (p.user_id as string).slice(0, 8));
    }
  }

  const rowsByVideo = new Map<string, Array<{ refereeUserId: string; score: number }>>();
  const scoreByKey = new Map<string, number>();
  for (const s of scores ?? []) {
    const list = rowsByVideo.get(s.video_id as string) ?? [];
    list.push({ refereeUserId: s.referee_user_id as string, score: Number(s.score) });
    rowsByVideo.set(s.video_id as string, list);
    scoreByKey.set(`${s.video_id}:${s.referee_user_id}`, Number(s.score));
  }
  const assignedByVideo = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = assignedByVideo.get(a.video_id as string) ?? [];
    list.push(a.referee_user_id as string);
    assignedByVideo.set(a.video_id as string, list);
  }

  const entries: ArenaEntry[] = await Promise.all(
    videoList.map(async (v) => {
      const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrl(v.storage_path, 3600);
      const assigned = assignedByVideo.get(v.id) ?? [];
      const { assignedScores, overrideScores } = splitScoreRows(
        rowsByVideo.get(v.id) ?? [],
        assigned,
        overrideUserIds,
      );
      const outcome = resolveScoreOutcome(assignedScores, overrideScores, judgesRequired);
      return {
        videoId: v.id,
        participantId: v.participant?.id ?? null,
        participantName: v.participant?.full_name ?? "Unknown participant",
        categoryName: v.registration?.category?.name ?? null,
        categoryId: v.registration?.category?.id ?? null,
        schoolId: v.participant?.school_id ?? null,
        senseiId: v.participant?.sensei_id ?? null,
        playbackUrl: signed?.signedUrl ?? null,
        createdAt: v.created_at,
        finalScore: outcome.score,
        disqualified: outcome.status === "disqualified",
        status: outcome.status,
        // Both filled in below, once every entry's score is known.
        rank: null,
        tied: false,
        scoresSubmitted: outcome.scored,
        judgeScores: assigned.map((uid) => ({
          judgeName: refereeName.get(uid) ?? uid.slice(0, 8),
          judgeUserId: uid,
          score: scoreByKey.get(`${v.id}:${uid}`) ?? null,
        })),
      };
    }),
  );

  // Rank within each CATEGORY -- the same grouping winners are decided on,
  // not the looser kata-event grouping the Arena lists under. Anything with
  // no usable score sits outside the ranking rather than being given a
  // last place it hasn't earned. Ties share a position (two firsts, then a
  // third), which is how a placing is normally read.
  const byCategory = new Map<string, ArenaEntry[]>();
  for (const e of entries) {
    if (e.finalScore == null || e.status === "disqualified") continue;
    const key = e.categoryId ?? e.categoryName ?? "";
    const list = byCategory.get(key) ?? [];
    list.push(e);
    byCategory.set(key, list);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
    // Compared at the 2 decimals everyone actually sees: two results that
    // differ only in the 3rd decimal read as identical on screen and would
    // be disputed as a tie regardless.
    const shown = (e: ArenaEntry) => (e.finalScore ?? 0).toFixed(2);
    const countByScore = new Map<string, number>();
    for (const e of list) countByScore.set(shown(e), (countByScore.get(shown(e)) ?? 0) + 1);
    let lastScore: string | null = null;
    let lastRank = 0;
    list.forEach((e, i) => {
      e.tied = (countByScore.get(shown(e)) ?? 0) > 1;
      if (lastScore != null && shown(e) === lastScore) {
        e.rank = lastRank;
        return;
      }
      e.rank = i + 1;
      lastRank = i + 1;
      lastScore = shown(e);
    });
  }
  return entries;
}

/** Groups arena entries by kata event (the part of their category name
 * before " — belt — age"), each group sorted by submission date/time —
 * so Kata Arena can show recordings organised the same way as the Kata
 * Listing elsewhere on the site, numbered in the order participants
 * actually submitted, letting a participant see exactly where their own
 * submission sits among its kata + category. */
export function groupArenaByKata(entries: ArenaEntry[]): Array<[string, ArenaEntry[]]> {
  const groups = new Map<string, ArenaEntry[]>();
  for (const e of entries) {
    const base = e.categoryName ? kataBaseOf(e.categoryName) : "Uncategorised";
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(e);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return [...groups.entries()];
}

export interface CategoryRecording {
  participantName: string;
  playbackUrl: string | null;
}

/** Every paid registration's submitted recording for a competition, keyed
 * by category_id — used by the Kata Categories page to slot each
 * participant's video under its kata sub-category (Male/Female/Mix ×
 * Belt group × Age bracket). Registrants without a submitted video yet
 * are omitted — this page is a recordings browser, not a roster. */
export async function loadRecordingsByCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string,
): Promise<Map<string, CategoryRecording[]>> {
  const result = new Map<string, CategoryRecording[]>();

  const { data: regs } = await supabase
    .from("registrations")
    .select("id, category_id, participant:participants(full_name)")
    .eq("competition_id", competitionId)
    .eq("payment_status", "paid")
    .not("category_id", "is", null);
  const regList =
    (regs as unknown as Array<{
      id: string;
      category_id: string;
      participant: { full_name: string } | null;
    }>) ?? [];
  if (regList.length === 0) return result;
  const regIds = regList.map((r) => r.id);

  const { data: videos } = await supabase
    .from("kata_videos")
    .select("registration_id, storage_path")
    .in("registration_id", regIds);
  const pathByReg = new Map((videos ?? []).map((v) => [v.registration_id as string, v.storage_path as string]));
  const paths = [...pathByReg.values()];
  if (paths.length === 0) return result;

  const playbackUrls = new Map<string, string>();
  const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrls(paths, 3600);
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) playbackUrls.set(s.path, s.signedUrl);
  }

  for (const r of regList) {
    const path = pathByReg.get(r.id);
    if (!path) continue;
    const list = result.get(r.category_id) ?? [];
    list.push({
      participantName: r.participant?.full_name ?? "Unknown participant",
      playbackUrl: playbackUrls.get(path) ?? null,
    });
    result.set(r.category_id, list);
  }
  return result;
}
