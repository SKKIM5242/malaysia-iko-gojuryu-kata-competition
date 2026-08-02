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
  /** Prize amount for this rank, parsed from the tier's own published
   * announcement text (e.g. "Gold - 1st Prize - USD 2,000 & Certificate").
   * Null when no announcement for the tier states a matching prize line --
   * shown as "not announced" rather than silently treated as $0. */
  rewardAmountUsd: number | null;
  payoutStatus: "unpaid" | "paid";
  receiptPath: string | null;
}

const PRIZE_LINE_PATTERN: Record<1 | 2 | 3, RegExp> = {
  1: /1st\s*Prize\s*-?\s*USD\s*([\d,]+(?:\.\d+)?)/i,
  2: /2nd\s*Prize\s*-?\s*USD\s*([\d,]+(?:\.\d+)?)/i,
  3: /3rd\s*Prize\s*-?\s*USD\s*([\d,]+(?:\.\d+)?)/i,
};

function parsePrizeAmount(body: string, rank: 1 | 2 | 3): number | null {
  const match = body.match(PRIZE_LINE_PATTERN[rank]);
  return match ? Number(match[1].replace(/,/g, "")) : null;
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
    .select("id, name, registration_deadline, winners_announce_date, registration_fee_usd");
  const revealed = (competitions ?? []).filter((c) => {
    if (!c.registration_deadline) return false;
    const revealDate =
      winnersRevealDateFor(c.registration_deadline as string, c.winners_announce_date as string | null) ??
      winnersRevealDate(c.registration_deadline as string);
    return new Date() >= revealDate;
  });
  if (revealed.length === 0) return [];

  const [{ data: categories }, { data: payouts }, { data: announcements }] = await Promise.all([
    supabase.from("categories").select("id, name"),
    supabase.from("winner_payouts").select("registration_id, status, receipt_path"),
    supabase
      .from("announcements")
      .select("competition_id, title, body, published, created_at")
      .eq("published", true)
      .order("created_at", { ascending: true }),
  ]);
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));
  const payoutStatus = new Map(
    (payouts ?? []).map((p) => [p.registration_id as string, p.status as "unpaid" | "paid"]),
  );
  const receiptPathByReg = new Map(
    (payouts ?? []).map((p) => [p.registration_id as string, p.receipt_path as string | null]),
  );

  // Prize amounts are announced per tier as free text (e.g. "Gold - 1st
  // Prize - USD 2,000 & Certificate") rather than stored as a number
  // anywhere -- pick each tier's most recently published announcement
  // (`.order("created_at", { ascending: true })` above means the last write
  // wins the map) and parse its prize lines. A handful of legacy
  // announcement rows predate the competition_id FK, so those fall back to
  // matching "USD<fee>" in the title against the tier's own fee.
  const bodyByCompetitionId = new Map<string, string>();
  const bodyByFeeFallback = new Map<number, string>();
  for (const a of announcements ?? []) {
    const body = a.body as string;
    if (a.competition_id) {
      bodyByCompetitionId.set(a.competition_id as string, body);
    } else {
      const feeMatch = (a.title as string).match(/USD\s*(\d+)/i);
      if (feeMatch) bodyByFeeFallback.set(Number(feeMatch[1]), body);
    }
  }
  const prizeAmountsByCompetition = new Map<string, { 1: number | null; 2: number | null; 3: number | null }>();
  for (const comp of revealed) {
    const body = bodyByCompetitionId.get(comp.id as string) ?? bodyByFeeFallback.get(Number(comp.registration_fee_usd ?? -1));
    prizeAmountsByCompetition.set(comp.id as string, {
      1: body ? parsePrizeAmount(body, 1) : null,
      2: body ? parsePrizeAmount(body, 2) : null,
      3: body ? parsePrizeAmount(body, 3) : null,
    });
  }

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
    const prizes = prizeAmountsByCompetition.get(competitionId);
    return {
      registrationId: entry.regId,
      competitionId,
      competitionName,
      categoryName,
      rank,
      participantName: entry.name,
      finalScore: entry.score,
      rewardAmountUsd: rank === 1 || rank === 2 || rank === 3 ? prizes?.[rank] ?? null : null,
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
