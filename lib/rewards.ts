import { createClient } from "@/lib/supabase/server";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import { winnersRevealDate, winnersRevealDateFor } from "@/lib/winners";

export interface WinnerRewardRow {
  registrationId: string;
  competitionId: string;
  competitionName: string;
  categoryName: string;
  rank: number;
  participantName: string;
  finalScore: number;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  /** Prize amount for this rank, from that tier's own row in `tier_prizes`
   * (see lib/tier-prizes.ts) -- a real organizer-controlled setting, not
   * parsed from announcement text. Defaults to 0 until the organizer sets
   * it for that tier. */
  rewardAmountUsd: number;
  payoutStatus: "unpaid" | "paid";
  receiptPath: string | null;
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

  const [{ data: categories }, { data: payouts }, { data: prizes }] = await Promise.all([
    supabase.from("categories").select("id, name"),
    supabase.from("winner_payouts").select("registration_id, status, receipt_path"),
    supabase.from("tier_prizes").select("competition_id, first_place_usd, second_place_usd, third_place_usd"),
  ]);
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));
  const payoutStatus = new Map(
    (payouts ?? []).map((p) => [p.registration_id as string, p.status as "unpaid" | "paid"]),
  );
  const receiptPathByReg = new Map(
    (payouts ?? []).map((p) => [p.registration_id as string, p.receipt_path as string | null]),
  );
  const prizesByCompetition = new Map(
    (prizes ?? []).map((p) => [
      p.competition_id as string,
      { 1: Number(p.first_place_usd ?? 0), 2: Number(p.second_place_usd ?? 0), 3: Number(p.third_place_usd ?? 0) },
    ]),
  );

  const entriesWithMeta: Array<{
    entry: Entry; competitionId: string; competitionName: string; categoryName: string; rank: number;
  }> = [];

  for (const comp of revealed) {
    const rankings = await computeCategoryRankings(supabase, comp.id as string);
    for (const [catId, entries] of rankings) {
      for (const e of entries) {
        entriesWithMeta.push({
          entry: { regId: e.registrationId, participantId: e.participantId, name: e.participantName, score: e.finalScore },
          competitionId: comp.id as string,
          competitionName: comp.name as string,
          categoryName: categoryNameById.get(catId) ?? "Unknown category",
          rank: e.rank,
        });
      }
    }
  }

  if (entriesWithMeta.length === 0) return [];

  const participantIds = Array.from(new Set(entriesWithMeta.map((e) => e.entry.participantId)));
  const { data: bankRows } = await supabase
    .from("participant_bank_details")
    .select("participant_id, bank_name, bank_account_no, bank_account_name")
    .in("participant_id", participantIds);
  const bankByParticipant = new Map((bankRows ?? []).map((b) => [b.participant_id as string, b]));

  const rows: WinnerRewardRow[] = entriesWithMeta.map(({ entry, competitionId, competitionName, categoryName, rank }) => {
    const bank = bankByParticipant.get(entry.participantId);
    const prizes = prizesByCompetition.get(competitionId);
    return {
      registrationId: entry.regId,
      competitionId,
      competitionName,
      categoryName,
      rank,
      participantName: entry.name,
      finalScore: entry.score,
      rewardAmountUsd: rank === 1 || rank === 2 || rank === 3 ? prizes?.[rank] ?? 0 : 0,
      bankName: (bank?.bank_name as string | undefined) ?? null,
      bankAccountNo: (bank?.bank_account_no as string | undefined) ?? null,
      bankAccountName: (bank?.bank_account_name as string | undefined) ?? null,
      payoutStatus: payoutStatus.get(entry.regId) ?? "unpaid",
      receiptPath: receiptPathByReg.get(entry.regId) ?? null,
    };
  });

  return rows.sort(
    (a, b) =>
      a.competitionName.localeCompare(b.competitionName) ||
      a.categoryName.localeCompare(b.categoryName) ||
      a.rank - b.rank,
  );
}
