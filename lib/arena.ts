import type { createClient } from "@/lib/supabase/server";
import { finalScore } from "@/lib/scoring";
import { kataBaseOf } from "@/lib/division";

export interface JudgeScoreEntry {
  judgeName: string;
  score: number | null;
}

export interface ArenaEntry {
  videoId: string;
  participantId: string | null;
  participantName: string;
  categoryName: string | null;
  playbackUrl: string | null;
  /** Trimmed-mean aggregate — Kata Arena never shows this to anyone except
   * a participant's own entry after winners are announced; the Winners
   * page is the only place it's shown at large. */
  finalScore: number | null;
  /** One entry per assigned referee, individual (not aggregated) — this is
   * what Referee/Admin/Organizer/Customer Support/Audience see on Kata
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
      "id, storage_path, participant:participants(id, full_name), registration:registrations(category:categories(name))",
    )
    .in("registration_id", regIds);
  const videoList =
    (videos as unknown as Array<{
      id: string;
      storage_path: string;
      participant: { id: string; full_name: string } | null;
      registration: { category: { name: string } | null } | null;
    }>) ?? [];
  if (videoList.length === 0) return [];

  const videoIds = videoList.map((v) => v.id);
  const [{ data: scores }, { data: assignments }] = await Promise.all([
    supabase.from("video_scores").select("video_id, referee_user_id, score").in("video_id", videoIds),
    supabase.from("referee_assignments").select("video_id, referee_user_id").in("video_id", videoIds),
  ]);

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

  const scoresByVideo = new Map<string, number[]>();
  const scoreByKey = new Map<string, number>();
  for (const s of scores ?? []) {
    const list = scoresByVideo.get(s.video_id as string) ?? [];
    list.push(Number(s.score));
    scoresByVideo.set(s.video_id as string, list);
    scoreByKey.set(`${s.video_id}:${s.referee_user_id}`, Number(s.score));
  }
  const assignedByVideo = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = assignedByVideo.get(a.video_id as string) ?? [];
    list.push(a.referee_user_id as string);
    assignedByVideo.set(a.video_id as string, list);
  }

  return Promise.all(
    videoList.map(async (v) => {
      const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrl(v.storage_path, 3600);
      const assigned = assignedByVideo.get(v.id) ?? [];
      return {
        videoId: v.id,
        participantId: v.participant?.id ?? null,
        participantName: v.participant?.full_name ?? "Unknown participant",
        categoryName: v.registration?.category?.name ?? null,
        playbackUrl: signed?.signedUrl ?? null,
        finalScore: finalScore(scoresByVideo.get(v.id) ?? []),
        judgeScores: assigned.map((uid) => ({
          judgeName: refereeName.get(uid) ?? uid.slice(0, 8),
          score: scoreByKey.get(`${v.id}:${uid}`) ?? null,
        })),
      };
    }),
  );
}

/** Groups arena entries by kata event (the part of their category name
 * before " — belt — age"), preserving first-seen order — so Kata Arena can
 * show recordings organised the same way as the Kata Listing elsewhere on
 * the site, letting a participant see exactly where their own submission
 * sits among its kata + category. */
export function groupArenaByKata(entries: ArenaEntry[]): Array<[string, ArenaEntry[]]> {
  const groups = new Map<string, ArenaEntry[]>();
  for (const e of entries) {
    const base = e.categoryName ? kataBaseOf(e.categoryName) : "Uncategorised";
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(e);
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
