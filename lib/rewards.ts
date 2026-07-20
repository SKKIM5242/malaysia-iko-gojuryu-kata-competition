import { createClient } from "@/lib/supabase/server";
import { finalScore, isDisqualified } from "@/lib/scoring";
import { winnersRevealDate, winnersRevealDateFor } from "@/lib/winners";

export interface WinnerRewardRow {
  registrationId: string;
  competitionName: string;
  categoryName: string;
  rank: number;
  participantName: string;
  finalScore: number;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  payoutStatus: "unpaid" | "paid";
}

interface Entry {
  regId: string;
  participantId: string;
  name: string;
  score: number;
}

/**
 * Top 3 per category, for every competition whose Winners have already
 * been announced — same ranking rules as the public /winners page (see
 * app/winners/page.tsx), plus each winner's bank details for the
 * organizer to pay out manually. Nothing here is stored except the
 * unpaid/paid bookkeeping in winner_payouts.
 */
export async function computeWinnerRewards(): Promise<WinnerRewardRow[]> {
  const supabase = await createClient();

  const { data: competitions } = await supabase
    .from("competitions")
    .select("id, name, registration_deadline, winners_announce_date");
  const revealed = (competitions ?? []).filter((c) => {
    if (!c.registration_deadline) return false;
    const revealDate =
      winnersRevealDateFor(c.registration_deadline as string, c.winners_announce_date as string | null) ??
      winnersRevealDate(c.registration_deadline as string);
    return new Date() >= revealDate;
  });
  if (revealed.length === 0) return [];

  const [{ data: categories }, { data: payouts }] = await Promise.all([
    supabase.from("categories").select("id, name"),
    supabase.from("winner_payouts").select("registration_id, status"),
  ]);
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));
  const payoutStatus = new Map(
    (payouts ?? []).map((p) => [p.registration_id as string, p.status as "unpaid" | "paid"]),
  );

  const entriesWithMeta: Array<{ entry: Entry; competitionName: string; categoryName: string; rank: number }> = [];

  for (const comp of revealed) {
    const { data: regs } = await supabase
      .from("registrations")
      .select("id, category_id, participant_id, participant:participants(full_name)")
      .eq("competition_id", comp.id)
      .eq("payment_status", "paid")
      .not("category_id", "is", null);
    const regList =
      (regs as unknown as Array<{
        id: string;
        category_id: string;
        participant_id: string;
        participant: { full_name: string } | null;
      }>) ?? [];
    if (regList.length === 0) continue;
    const regIds = regList.map((r) => r.id);

    const { data: videos } = await supabase
      .from("kata_videos")
      .select("id, registration_id")
      .in("registration_id", regIds);
    const videoByReg = new Map((videos ?? []).map((v) => [v.registration_id as string, v.id as string]));
    const videoIds = (videos ?? []).map((v) => v.id as string);
    if (videoIds.length === 0) continue;

    const { data: scores } = await supabase.from("video_scores").select("video_id, score").in("video_id", videoIds);
    const scoresByVideo = new Map<string, number[]>();
    for (const s of scores ?? []) {
      const list = scoresByVideo.get(s.video_id as string) ?? [];
      list.push(Number(s.score));
      scoresByVideo.set(s.video_id as string, list);
    }

    const byCategory = new Map<string, Entry[]>();
    for (const r of regList) {
      const videoId = videoByReg.get(r.id);
      if (!videoId) continue;
      const videoScores = scoresByVideo.get(videoId) ?? [];
      if (isDisqualified(videoScores)) continue;
      const fs = finalScore(videoScores);
      if (fs == null) continue;
      const list = byCategory.get(r.category_id) ?? [];
      list.push({
        regId: r.id,
        participantId: r.participant_id,
        name: r.participant?.full_name ?? "Unknown participant",
        score: fs,
      });
      byCategory.set(r.category_id, list);
    }

    for (const [catId, entries] of byCategory) {
      const top3 = entries.sort((a, b) => b.score - a.score).slice(0, 3);
      top3.forEach((entry, i) => {
        entriesWithMeta.push({
          entry,
          competitionName: comp.name as string,
          categoryName: categoryNameById.get(catId) ?? "Unknown category",
          rank: i + 1,
        });
      });
    }
  }

  if (entriesWithMeta.length === 0) return [];

  const participantIds = Array.from(new Set(entriesWithMeta.map((e) => e.entry.participantId)));
  const { data: bankRows } = await supabase
    .from("participant_bank_details")
    .select("participant_id, bank_name, bank_account_no, bank_account_name")
    .in("participant_id", participantIds);
  const bankByParticipant = new Map((bankRows ?? []).map((b) => [b.participant_id as string, b]));

  const rows: WinnerRewardRow[] = entriesWithMeta.map(({ entry, competitionName, categoryName, rank }) => {
    const bank = bankByParticipant.get(entry.participantId);
    return {
      registrationId: entry.regId,
      competitionName,
      categoryName,
      rank,
      participantName: entry.name,
      finalScore: entry.score,
      bankName: (bank?.bank_name as string | undefined) ?? null,
      bankAccountNo: (bank?.bank_account_no as string | undefined) ?? null,
      bankAccountName: (bank?.bank_account_name as string | undefined) ?? null,
      payoutStatus: payoutStatus.get(entry.regId) ?? "unpaid",
    };
  });

  return rows.sort(
    (a, b) =>
      a.competitionName.localeCompare(b.competitionName) ||
      a.categoryName.localeCompare(b.categoryName) ||
      a.rank - b.rank,
  );
}
