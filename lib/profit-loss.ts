import { createClient } from "@/lib/supabase/server";
import { COMMISSION_RATE, type CommissionRow } from "@/lib/commissions";
import type { WinnerRewardRow } from "@/lib/rewards";
import type { OtherPayoutRow } from "@/lib/other-payouts";

export interface TierProfitLoss {
  competitionId: string;
  competitionName: string;
  revenueUsd: number;
  commissionPaidUsd: number;
  winnerPaidUsd: number;
  otherPaidUsd: number;
  totalPayoutsUsd: number;
  profitLossUsd: number;
}

/**
 * Per-tier Profit/Loss: participant fee revenue for that tier minus every
 * payout actually marked "paid" so far (commission + winner reward + other
 * payout), all scoped to the same tier. Computed fresh on every page load --
 * same "never stored" philosophy as commissions/rewards -- so the page's
 * "Generate" button just stamps the moment it was rendered rather than
 * triggering a separate computation or snapshot.
 */
export async function computeProfitLossByTier(
  commissionRows: CommissionRow[],
  rewardRows: WinnerRewardRow[],
  otherPayouts: OtherPayoutRow[],
): Promise<TierProfitLoss[]> {
  const supabase = await createClient();
  const [{ data: competitions }, { data: registrations }] = await Promise.all([
    supabase.from("competitions").select("id, name, registration_fee_usd"),
    supabase.from("registrations").select("competition_id, payment_status"),
  ]);

  const feeByCompetition = new Map<string, number>(
    (competitions ?? []).map((c) => [c.id as string, Number(c.registration_fee_usd ?? 0)]),
  );
  const nameByCompetition = new Map<string, string>(
    (competitions ?? []).map((c) => [c.id as string, c.name as string]),
  );

  // Revenue -- paid participant registration fees only (not referee/school
  // commission, not audience/support), grouped by the tier they registered for.
  const revenueByTier = new Map<string, number>();
  for (const r of registrations ?? []) {
    if (r.payment_status !== "paid") continue;
    const cid = r.competition_id as string;
    revenueByTier.set(cid, (revenueByTier.get(cid) ?? 0) + (feeByCompetition.get(cid) ?? 0));
  }

  // Commission "done" -- a recipient's payoutStatus covers their whole
  // commission at once (commission_payouts has no per-tier granularity), so
  // a "paid" recipient has every one of their qualifying tiers' shares
  // attributed as paid.
  const commissionPaidByTier = new Map<string, number>();
  for (const row of commissionRows) {
    if (row.payoutStatus !== "paid") continue;
    for (const t of row.tiers) {
      if (!t.qualifies) continue;
      const amount = t.feesUsd * COMMISSION_RATE;
      commissionPaidByTier.set(t.competitionId, (commissionPaidByTier.get(t.competitionId) ?? 0) + amount);
    }
  }

  const winnerPaidByTier = new Map<string, number>();
  for (const row of rewardRows) {
    if (row.payoutStatus !== "paid") continue;
    winnerPaidByTier.set(row.competitionId, (winnerPaidByTier.get(row.competitionId) ?? 0) + row.rewardAmountUsd);
  }

  const otherPaidByTier = new Map<string, number>();
  for (const row of otherPayouts) {
    if (row.status !== "paid") continue;
    otherPaidByTier.set(row.competitionId, (otherPaidByTier.get(row.competitionId) ?? 0) + row.amountUsd);
  }

  const tierIds = new Set<string>([
    ...(competitions ?? []).map((c) => c.id as string),
    ...revenueByTier.keys(), ...commissionPaidByTier.keys(), ...winnerPaidByTier.keys(), ...otherPaidByTier.keys(),
  ]);

  const rows: TierProfitLoss[] = [...tierIds].map((cid) => {
    const revenueUsd = revenueByTier.get(cid) ?? 0;
    const commissionPaidUsd = commissionPaidByTier.get(cid) ?? 0;
    const winnerPaidUsd = winnerPaidByTier.get(cid) ?? 0;
    const otherPaidUsd = otherPaidByTier.get(cid) ?? 0;
    const totalPayoutsUsd = commissionPaidUsd + winnerPaidUsd + otherPaidUsd;
    return {
      competitionId: cid,
      competitionName: nameByCompetition.get(cid) ?? "—",
      revenueUsd, commissionPaidUsd, winnerPaidUsd, otherPaidUsd, totalPayoutsUsd,
      profitLossUsd: revenueUsd - totalPayoutsUsd,
    };
  });

  return rows.sort((a, b) => (feeByCompetition.get(a.competitionId) ?? 0) - (feeByCompetition.get(b.competitionId) ?? 0));
}
