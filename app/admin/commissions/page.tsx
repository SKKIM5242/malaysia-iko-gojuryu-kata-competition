import { schemaReady } from "@/lib/data";
import { computeCommissions, type CommissionRow } from "@/lib/commissions";
import { computeWinnerRewards, type WinnerRewardRow } from "@/lib/rewards";
import { setCommissionPayoutStatus, setWinnerPayoutStatus } from "@/app/actions/admin";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";

const MEDALS = ["🥇", "🥈", "🥉"];

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { school: "School / Dojo", sensei: "Sensei", referee: "Referee / Judge" };

function PayoutButtons({
  recipientType, recipientId, current,
}: { recipientType: string; recipientId: string; current: "unpaid" | "paid" }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(["unpaid", "paid"] as const).map((o) => (
        <form key={o} action={setCommissionPayoutStatus}>
          <input type="hidden" name="recipient_type" value={recipientType} />
          <input type="hidden" name="recipient_id" value={recipientId} />
          <input type="hidden" name="status" value={o} />
          <button
            disabled={o === current}
            className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
              o === current
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {o}
          </button>
        </form>
      ))}
    </div>
  );
}

function RewardPayoutButtons({
  registrationId, current,
}: { registrationId: string; current: "unpaid" | "paid" }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(["unpaid", "paid"] as const).map((o) => (
        <form key={o} action={setWinnerPayoutStatus}>
          <input type="hidden" name="registration_id" value={registrationId} />
          <input type="hidden" name="status" value={o} />
          <button
            disabled={o === current}
            className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
              o === current
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {o}
          </button>
        </form>
      ))}
    </div>
  );
}

export default async function AdminCommissions({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Commissions" active="/admin/commissions">
        <SetupNotice />
      </AdminShell>
    );
  }

  const rows = await computeCommissions();
  const payable = rows.filter((r) => r.commissionUsd > 0);
  const rewardRows = await computeWinnerRewards();

  return (
    <AdminShell title="Commissions" active="/admin/commissions" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Computed live from paid registrations — never stored, so it can&apos;t go stale. School/Dojo
        and Sensei need <strong>more than 10 participants</strong> to qualify for any share at all
        (10% flat once qualified); 10 or fewer earns nothing. Referee/Judge earns 10% of every
        judged student&apos;s fee with no minimum. &quot;Paid&quot; below is just your own record of
        who you&apos;ve actually paid out via bank transfer — use the bank details shown to do that
        transfer yourself.
      </p>

      {rows.length === 0 ? (
        <EmptyState>No schools, senseis, or referees yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="key"
          downloadName="commissions"
          columns={[
            { key: "type", label: "Type" },
            { key: "name", label: "Name" },
            { key: "participant_count", label: "Participants" },
            { key: "total_fees", label: "Total Fees (Paid)" },
            { key: "commission", label: "Commission (10%)" },
            { key: "bank", label: "Bank" },
            { key: "payout", label: "Payout" },
          ]}
          csvColumns={[
            { key: "type", label: "Type" },
            { key: "name", label: "Name" },
            { key: "participant_count", label: "Participants" },
            { key: "total_fees", label: "Total Fees USD (Paid)" },
            { key: "commission", label: "Commission USD (10%)" },
            { key: "bank_name", label: "Bank Name" },
            { key: "bank_account_no", label: "Bank Account No" },
            { key: "bank_account_name", label: "Bank Account Holder Name" },
            { key: "payout_status", label: "Payout Status" },
          ]}
          rows={rows.map((r: CommissionRow) => ({
            key: `${r.recipientType}:${r.recipientId}`,
            type: TYPE_LABEL[r.recipientType],
            name: r.name,
            participant_count: String(r.participantCount),
            total_fees: `$${r.totalFeesUsd.toFixed(2)}`,
            commission: `$${r.commissionUsd.toFixed(2)}`,
            bank: [r.bankName, r.bankAccountNo, r.bankAccountName].filter(Boolean).join(" · ") || "—",
            bank_name: r.bankName ?? "",
            bank_account_no: r.bankAccountNo ?? "",
            bank_account_name: r.bankAccountName ?? "",
            payout_status: r.payoutStatus,
            payout: (
              <PayoutButtons recipientType={r.recipientType} recipientId={r.recipientId} current={r.payoutStatus} />
            ),
          }))}
        />
      )}

      <p className="mt-4 text-xs text-neutral-400">
        {payable.length} of {rows.length} currently qualify for a non-zero commission.
      </p>

      <h2 className="mt-10 mb-2 text-lg font-bold text-neutral-900">Rewards — Top 3 Winners Payout</h2>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Top 3 per category, for every competition whose Winners have already been announced —
        computed live from the same scores shown on the public{" "}
        <a href="/winners" className="font-semibold underline underline-offset-2">Winners</a> page.
        Winnings are transferred to each participant&apos;s account after 1 month of the winner
        announcement. &quot;Paid&quot; below is your own record of who you&apos;ve actually paid out
        via bank transfer — use the bank details shown to do that transfer yourself.
      </p>

      {rewardRows.length === 0 ? (
        <EmptyState>No winners announced yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="key"
          downloadName="winner-rewards"
          columns={[
            { key: "competition", label: "Competition" },
            { key: "category", label: "Category" },
            { key: "rank", label: "Rank" },
            { key: "name", label: "Participant" },
            { key: "score", label: "Score" },
            { key: "bank", label: "Bank" },
            { key: "payout", label: "Payout" },
          ]}
          csvColumns={[
            { key: "competition", label: "Competition" },
            { key: "category", label: "Category" },
            { key: "rank", label: "Rank" },
            { key: "name", label: "Participant" },
            { key: "score", label: "Score" },
            { key: "bank_name", label: "Bank Name" },
            { key: "bank_account_no", label: "Bank Account No" },
            { key: "bank_account_name", label: "Bank Account Holder Name" },
            { key: "payout_status", label: "Payout Status" },
          ]}
          rows={rewardRows.map((r: WinnerRewardRow) => ({
            key: r.registrationId,
            competition: r.competitionName,
            category: r.categoryName,
            rank: `${MEDALS[r.rank - 1] ?? ""} ${r.rank}`,
            name: r.participantName,
            score: r.finalScore.toFixed(1),
            bank: [r.bankName, r.bankAccountNo, r.bankAccountName].filter(Boolean).join(" · ") || "—",
            bank_name: r.bankName ?? "",
            bank_account_no: r.bankAccountNo ?? "",
            bank_account_name: r.bankAccountName ?? "",
            payout_status: r.payoutStatus,
            payout: <RewardPayoutButtons registrationId={r.registrationId} current={r.payoutStatus} />,
          }))}
        />
      )}
    </AdminShell>
  );
}
