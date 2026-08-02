"use client";

import { useState } from "react";
import FilterableTable from "@/components/FilterableTable";
import { adminBtn } from "@/components/admin-styles";

export interface ProfitLossTierData {
  competitionId: string;
  competitionName: string;
  revenueUsd: number;
  commissionPaidUsd: number;
  winnerPaidUsd: number;
  otherPaidUsd: number;
  totalPayoutsUsd: number;
  profitLossUsd: number;
}

/** The report itself is already computed server-side on every page load
 * (same "never stored" live-data philosophy as Commissions/Rewards above) --
 * this button just reveals it and stamps the moment the organizer chose to
 * look, so "as of [date & time]" reflects when they generated it rather than
 * an arbitrary page-load timestamp. */
export default function ProfitLossSection({ rows }: { rows: ProfitLossTierData[] }) {
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div>
      <button type="button" onClick={() => setGeneratedAt(new Date())} className={adminBtn}>
        {generatedAt ? "Regenerate" : "Generate"} report as of now
      </button>

      {generatedAt && (
        <div className="mt-3">
          <p className="mb-3 text-xs font-semibold text-neutral-500">
            Generated as of {generatedAt.toLocaleString()}
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-500">No competition tiers yet.</p>
          ) : (
            <FilterableTable
              rowKey="competitionId"
              downloadName="profit-loss-by-tier"
              columns={[
                { key: "tier", label: "Tier" },
                { key: "revenue", label: "Revenue (Paid Fees)" },
                { key: "commission_paid", label: "Commission Paid" },
                { key: "winner_paid", label: "Winner Rewards Paid" },
                { key: "other_paid", label: "Other Payouts Paid" },
                { key: "total_payouts", label: "Total Payouts Done" },
                { key: "profit_loss", label: "Profit / (Loss)" },
              ]}
              csvColumns={[
                { key: "tier", label: "Tier" },
                { key: "revenue_csv", label: "Revenue USD (Paid Fees)" },
                { key: "commission_paid_csv", label: "Commission Paid USD" },
                { key: "winner_paid_csv", label: "Winner Rewards Paid USD" },
                { key: "other_paid_csv", label: "Other Payouts Paid USD" },
                { key: "total_payouts_csv", label: "Total Payouts Done USD" },
                { key: "profit_loss_csv", label: "Profit / (Loss) USD" },
              ]}
              rows={rows.map((r) => ({
                competitionId: r.competitionId,
                tier: r.competitionName,
                revenue: fmt(r.revenueUsd),
                commission_paid: fmt(r.commissionPaidUsd),
                winner_paid: fmt(r.winnerPaidUsd),
                other_paid: fmt(r.otherPaidUsd),
                total_payouts: fmt(r.totalPayoutsUsd),
                profit_loss: (
                  <span className={r.profitLossUsd < 0 ? "font-semibold text-red-600" : "font-semibold text-green-700"}>
                    {r.profitLossUsd < 0 ? `(${fmt(Math.abs(r.profitLossUsd))})` : fmt(r.profitLossUsd)}
                  </span>
                ),
                revenue_csv: r.revenueUsd.toFixed(2),
                commission_paid_csv: r.commissionPaidUsd.toFixed(2),
                winner_paid_csv: r.winnerPaidUsd.toFixed(2),
                other_paid_csv: r.otherPaidUsd.toFixed(2),
                total_payouts_csv: r.totalPayoutsUsd.toFixed(2),
                profit_loss_csv: r.profitLossUsd.toFixed(2),
              }))}
            />
          )}
        </div>
      )}
    </div>
  );
}
