import { createClient } from "@/lib/supabase/server";

export interface OtherPayoutRow {
  id: string;
  competitionId: string;
  competitionName: string;
  description: string;
  amountUsd: number;
  status: "unpaid" | "paid";
  receiptPath: string | null;
}

/**
 * Free-form payouts the organizer enters manually — vendor payments,
 * refunds, staff bonuses, sponsor prizes, anything that isn't a computed
 * school/sensei/referee commission or a Top-3 winner reward. Unlike those
 * two (computed live, never stored), every row here is real stored data,
 * so it needs its own create/edit/delete on top of the shared Paid/Unpaid
 * + receipt-upload pattern.
 */
export async function getOtherPayouts(): Promise<OtherPayoutRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("other_payouts")
    .select("id, competition_id, description, amount_usd, status, receipt_path, competition:competitions(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as Array<{
    id: string;
    competition_id: string;
    description: string;
    amount_usd: number;
    status: "unpaid" | "paid";
    receipt_path: string | null;
    competition: { name: string } | null;
  }>).map((r) => ({
    id: r.id,
    competitionId: r.competition_id,
    competitionName: r.competition?.name ?? "—",
    description: r.description,
    amountUsd: Number(r.amount_usd),
    status: r.status,
    receiptPath: r.receipt_path,
  }));
}
