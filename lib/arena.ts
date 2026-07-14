import type { createClient } from "@/lib/supabase/server";
import { finalScore } from "@/lib/scoring";

export interface ArenaEntry {
  videoId: string;
  participantName: string;
  categoryName: string | null;
  playbackUrl: string | null;
  finalScore: number | null;
}

/** All submitted recordings (+ final trimmed-mean scores) for a competition
 * — used by both /account and the Kata Arena page. Callers decide whether
 * to actually display finalScore (Kata Arena only reveals it once winners
 * are announced, via lib/winners.ts's winnersRevealed). */
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
      "id, storage_path, participant:participants(full_name), registration:registrations(category:categories(name))",
    )
    .in("registration_id", regIds);
  const videoList =
    (videos as unknown as Array<{
      id: string;
      storage_path: string;
      participant: { full_name: string } | null;
      registration: { category: { name: string } | null } | null;
    }>) ?? [];
  if (videoList.length === 0) return [];

  const videoIds = videoList.map((v) => v.id);
  const { data: scores } = await supabase.from("video_scores").select("video_id, score").in("video_id", videoIds);
  const scoresByVideo = new Map<string, number[]>();
  for (const s of scores ?? []) {
    const list = scoresByVideo.get(s.video_id as string) ?? [];
    list.push(Number(s.score));
    scoresByVideo.set(s.video_id as string, list);
  }

  return Promise.all(
    videoList.map(async (v) => {
      const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrl(v.storage_path, 3600);
      return {
        videoId: v.id,
        participantName: v.participant?.full_name ?? "Unknown participant",
        categoryName: v.registration?.category?.name ?? null,
        playbackUrl: signed?.signedUrl ?? null,
        finalScore: finalScore(scoresByVideo.get(v.id) ?? []),
      };
    }),
  );
}
