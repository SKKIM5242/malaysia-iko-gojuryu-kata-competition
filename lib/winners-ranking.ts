import { createClient } from "@/lib/supabase/server";
import { finalScore, isDisqualified } from "@/lib/scoring";

export interface RankedWinner {
  rank: number;
  registrationId: string;
  participantId: string;
  participantName: string;
  finalScore: number;
  videoId: string;
  storagePath: string;
}

/**
 * Top 3 per category for one competition, ranked by finalScore desc, with
 * disqualified entries (any judge gave a 0 total) excluded. Computed live
 * from paid registrations + submitted scores every call -- nothing here is
 * stored. Shared by the public /winners page (gated behind the reveal
 * date), the admin Winners preview (no gate), and the reward-payout list
 * in lib/rewards.ts, so all three always agree on who's actually winning.
 */
export async function computeCategoryRankings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string,
): Promise<Map<string, RankedWinner[]>> {
  const { data: regs } = await supabase
    .from("registrations")
    .select("id, category_id, participant_id, participant:participants(full_name)")
    .eq("competition_id", competitionId)
    .eq("payment_status", "paid")
    .not("category_id", "is", null);
  const regList =
    (regs as unknown as Array<{
      id: string;
      category_id: string;
      participant_id: string;
      participant: { full_name: string } | null;
    }>) ?? [];
  if (regList.length === 0) return new Map();
  const regIds = regList.map((r) => r.id);

  const { data: videos } = await supabase
    .from("kata_videos")
    .select("id, registration_id, storage_path")
    .in("registration_id", regIds);
  const videoByReg = new Map(
    (videos ?? []).map((v) => [v.registration_id as string, { id: v.id as string, storagePath: v.storage_path as string }]),
  );
  const videoIds = (videos ?? []).map((v) => v.id as string);
  if (videoIds.length === 0) return new Map();

  const { data: scores } = await supabase.from("video_scores").select("video_id, score").in("video_id", videoIds);
  const scoresByVideo = new Map<string, number[]>();
  for (const s of scores ?? []) {
    const list = scoresByVideo.get(s.video_id as string) ?? [];
    list.push(Number(s.score));
    scoresByVideo.set(s.video_id as string, list);
  }

  const byCategory = new Map<
    string,
    Array<{ regId: string; participantId: string; name: string; score: number; videoId: string; storagePath: string }>
  >();
  for (const r of regList) {
    const video = videoByReg.get(r.id);
    if (!video) continue;
    const videoScores = scoresByVideo.get(video.id) ?? [];
    if (isDisqualified(videoScores)) continue;
    const fs = finalScore(videoScores);
    if (fs == null) continue;
    const list = byCategory.get(r.category_id) ?? [];
    list.push({
      regId: r.id,
      participantId: r.participant_id,
      name: r.participant?.full_name ?? "Unknown participant",
      score: fs,
      videoId: video.id,
      storagePath: video.storagePath,
    });
    byCategory.set(r.category_id, list);
  }

  const result = new Map<string, RankedWinner[]>();
  for (const [catId, entries] of byCategory) {
    const top3 = entries.sort((a, b) => b.score - a.score).slice(0, 3);
    result.set(
      catId,
      top3.map((e, i) => ({
        rank: i + 1,
        registrationId: e.regId,
        participantId: e.participantId,
        participantName: e.name,
        finalScore: e.score,
        videoId: e.videoId,
        storagePath: e.storagePath,
      })),
    );
  }
  return result;
}
