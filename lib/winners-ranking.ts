import { createClient } from "@/lib/supabase/server";
import { OVERRIDE_ROLES, resolveScoreOutcome, splitScoreRows } from "@/lib/scoring";

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
  // The panel size this competition expects, so "judging finished" means the
  // same here as it does on the Kata Arena.
  const { data: comp } = await supabase
    .from("competitions")
    .select("judges_required")
    .eq("id", competitionId)
    .maybeSingle();
  const judgesRequired = Number(comp?.judges_required ?? 3);

  const { data: videos } = await supabase
    .from("kata_videos")
    .select("id, registration_id, storage_path")
    .in("registration_id", regIds);
  const videoByReg = new Map(
    (videos ?? []).map((v) => [v.registration_id as string, { id: v.id as string, storagePath: v.storage_path as string }]),
  );
  const videoIds = (videos ?? []).map((v) => v.id as string);
  if (videoIds.length === 0) return new Map();

  // Assignments and staff identities are needed here for the same reason as
  // the Kata Arena: a score row alone doesn't say whether it belongs to a
  // judge still on the panel, an Admin/Organizer override, or a referee who
  // was unassigned long ago. Ranking on the raw rows counted that last group
  // toward who wins.
  const [{ data: scores }, { data: assignments }, { data: overrideProfiles }] = await Promise.all([
    supabase.from("video_scores").select("video_id, referee_user_id, score").in("video_id", videoIds),
    supabase.from("referee_assignments").select("video_id, referee_user_id").in("video_id", videoIds),
    supabase.from("profiles").select("user_id").in("role", OVERRIDE_ROLES as unknown as string[]),
  ]);
  const overrideUserIds = new Set((overrideProfiles ?? []).map((p) => p.user_id as string));
  const assignedByVideo = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = assignedByVideo.get(a.video_id as string) ?? [];
    list.push(a.referee_user_id as string);
    assignedByVideo.set(a.video_id as string, list);
  }
  const rowsByVideo = new Map<string, Array<{ refereeUserId: string; score: number }>>();
  for (const s of scores ?? []) {
    const list = rowsByVideo.get(s.video_id as string) ?? [];
    list.push({ refereeUserId: s.referee_user_id as string, score: Number(s.score) });
    rowsByVideo.set(s.video_id as string, list);
  }

  const byCategory = new Map<
    string,
    Array<{ regId: string; participantId: string; name: string; score: number; videoId: string; storagePath: string }>
  >();
  for (const r of regList) {
    const video = videoByReg.get(r.id);
    if (!video) continue;
    const { assignedScores, overrideScores } = splitScoreRows(
      rowsByVideo.get(video.id) ?? [],
      assignedByVideo.get(video.id) ?? [],
      overrideUserIds,
    );
    const outcome = resolveScoreOutcome(assignedScores, overrideScores, judgesRequired);
    // Only a settled result can place: judging finished, or an
    // Admin/Organizer override standing in for it. A half-judged entry used
    // to be rankable, which let a single generous score outrank a complete
    // panel; disqualified entries stay out as before.
    if (outcome.status !== "complete" && outcome.status !== "override") continue;
    const fs = outcome.score;
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
