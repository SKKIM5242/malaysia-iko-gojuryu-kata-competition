import type { createClient } from "@/lib/supabase/server";
import { finalScore } from "@/lib/scoring";

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
