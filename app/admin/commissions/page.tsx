import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { computeCommissions, type CommissionRow } from "@/lib/commissions";
import { computeWinnerRewards, type WinnerRewardRow } from "@/lib/rewards";
import { setCommissionPayoutStatus, setWinnerPayoutStatus, uploadCommissionReceipt, uploadWinnerReceipt } from "@/app/actions/admin";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CertificateUploadField from "@/components/CertificateUploadField";
import { getAllCompetitions } from "@/lib/admin-data";
import { shortTierName } from "@/lib/invitation-codes";

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

/** Admin/Organizer attach a photo/scan of the actual bank transfer here —
 * proof behind the Paid button, not just the checkbox itself. Uploading
 * doesn't change payout status by itself, and re-uploading simply replaces
 * the link (the old file is left in storage, same as certificate re-uploads
 * elsewhere in the admin panel). */
function CommissionReceiptCell({
  recipientType, recipientId, receiptUrl, idPrefix,
}: { recipientType: string; recipientId: string; receiptUrl: string | null; idPrefix: string }) {
  return (
    <div className="space-y-1.5">
      {receiptUrl && (
        <a
          href={receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs font-semibold text-green-700 underline underline-offset-2"
        >
          View receipt
        </a>
      )}
      <form action={uploadCommissionReceipt} className="space-y-1">
        <input type="hidden" name="recipient_type" value={recipientType} />
        <input type="hidden" name="recipient_id" value={recipientId} />
        <CertificateUploadField id={idPrefix} name="receipt" />
        <button
          type="submit"
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          {receiptUrl ? "Replace receipt" : "Upload receipt"}
        </button>
      </form>
    </div>
  );
}

function WinnerReceiptCell({
  registrationId, receiptUrl, idPrefix,
}: { registrationId: string; receiptUrl: string | null; idPrefix: string }) {
  return (
    <div className="space-y-1.5">
      {receiptUrl && (
        <a
          href={receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs font-semibold text-green-700 underline underline-offset-2"
        >
          View receipt
        </a>
      )}
      <form action={uploadWinnerReceipt} className="space-y-1">
        <input type="hidden" name="registration_id" value={registrationId} />
        <CertificateUploadField id={idPrefix} name="receipt" />
        <button
          type="submit"
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          {receiptUrl ? "Replace receipt" : "Upload receipt"}
        </button>
      </form>
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
  const allCompetitions = await getAllCompetitions();
  const tierNameById = new Map(allCompetitions.map((c) => [c.id, c.name]));

  // Signed links (1h) for receipt photos in the private payout-receipts
  // bucket — one batched call per table, same pattern as certificate/kata
  // video signed URLs elsewhere in the admin panel.
  const supabase = await createClient();
  const receiptPaths = [
    ...rows.map((r) => r.receiptPath),
    ...rewardRows.map((r) => r.receiptPath),
  ].filter((p): p is string => !!p);
  const receiptUrlByPath = new Map<string, string>();
  if (receiptPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("payout-receipts")
      .createSignedUrls(receiptPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) receiptUrlByPath.set(s.path, s.signedUrl);
    }
  }

  return (
    <AdminShell title="Commissions" active="/admin/commissions" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Computed live from paid registrations — never stored, so it can&apos;t go stale. School/Dojo
        and Sensei qualify <strong>per competition tier</strong>: more than 10 paid kata
        <strong> events</strong> by their students within one tier earns 10% of{" "}
        <strong>that tier&apos;s</strong> fees. A tier with 10 or fewer events earns nothing even
        when another tier qualifies, so the 10% is taken only from the qualifying tiers — see the
        Events by Tier column, where ✓ marks a tier that pays. Referee/Judge earns 10% of every
        judged student&apos;s fee with no minimum and no tier test.
        &quot;Paid&quot; below is just your own record of who you&apos;ve actually paid out via
        bank transfer — use the bank details shown to do that transfer yourself. Attach a photo or
        scan of the transfer receipt in the Receipt column as proof once you&apos;ve paid.
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
            { key: "participant_count", label: "Students" },
            { key: "entry_count", label: "Paid Events" },
            { key: "tier_split", label: "Events by Tier (✓ = pays)", width: 260, wrap: true },
            { key: "total_fees", label: "Total Fees (Paid)" },
            { key: "qualifying_fees", label: "Qualifying Fees" },
            { key: "commission", label: "Commission (10%)" },
            { key: "bank", label: "Bank" },
            { key: "payout", label: "Payout" },
            { key: "receipt", label: "Receipt", width: 220 },
          ]}
          csvColumns={[
            { key: "type", label: "Type" },
            { key: "name", label: "Name" },
            { key: "participant_count", label: "Students" },
            { key: "entry_count", label: "Paid Events" },
            { key: "tier_split", label: "Events by Tier" },
            { key: "total_fees", label: "Total Fees USD (Paid)" },
            { key: "qualifying_fees", label: "Qualifying Fees USD" },
            { key: "commission", label: "Commission USD (10%)" },
            { key: "bank_name", label: "Bank Name" },
            { key: "bank_account_no", label: "International Bank Account No. (IBAN)" },
            { key: "bank_account_name", label: "Bank Account Holder Name" },
            { key: "payout_status", label: "Payout Status" },
            { key: "receipt_status", label: "Receipt Uploaded" },
          ]}
          rows={rows.map((r: CommissionRow) => ({
            key: `${r.recipientType}:${r.recipientId}`,
            type: TYPE_LABEL[r.recipientType],
            name: r.name,
            participant_count: String(r.participantCount),
            entry_count: String(r.entryCount),
            tier_split: r.recipientType === "referee"
              ? "— not tier-scoped"
              : r.tiers.length === 0
                ? "— none yet"
                : r.tiers
                    .map((t) =>
                      `${shortTierName(tierNameById.get(t.competitionId) ?? "—")}: ${t.entryCount}${t.qualifies ? " ✓" : ""}`,
                    )
                    .join(" · "),
            total_fees: `$${r.totalFeesUsd.toFixed(2)}`,
            qualifying_fees: `$${r.qualifyingFeesUsd.toFixed(2)}`,
            commission: `$${r.commissionUsd.toFixed(2)}`,
            bank: [r.bankName, r.bankAccountNo, r.bankAccountName].filter(Boolean).join(" · ") || "—",
            bank_name: r.bankName ?? "",
            bank_account_no: r.bankAccountNo ?? "",
            bank_account_name: r.bankAccountName ?? "",
            payout_status: r.payoutStatus,
            payout: (
              <PayoutButtons recipientType={r.recipientType} recipientId={r.recipientId} current={r.payoutStatus} />
            ),
            receipt_status: r.receiptPath ? "Yes" : "No",
            receipt: (
              <CommissionReceiptCell
                recipientType={r.recipientType}
                recipientId={r.recipientId}
                receiptUrl={r.receiptPath ? receiptUrlByPath.get(r.receiptPath) ?? null : null}
                idPrefix={`receipt-${r.recipientType}-${r.recipientId}`}
              />
            ),
          }))}
        />
      )}

      <p className="mt-4 text-xs text-neutral-400">
        {payable.length} of {rows.length} currently qualify for a non-zero commission.
      </p>

      <h2 id="rewards" className="mt-10 mb-2 scroll-mt-4 text-lg font-bold text-neutral-900">Rewards — Top 3 Winners Payout</h2>
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
            { key: "receipt", label: "Receipt", width: 220 },
          ]}
          csvColumns={[
            { key: "competition", label: "Competition" },
            { key: "category", label: "Category" },
            { key: "rank", label: "Rank" },
            { key: "name", label: "Participant" },
            { key: "score", label: "Score" },
            { key: "bank_name", label: "Bank Name" },
            { key: "bank_account_no", label: "International Bank Account No. (IBAN)" },
            { key: "bank_account_name", label: "Bank Account Holder Name" },
            { key: "payout_status", label: "Payout Status" },
            { key: "receipt_status", label: "Receipt Uploaded" },
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
            receipt_status: r.receiptPath ? "Yes" : "No",
            receipt: (
              <WinnerReceiptCell
                registrationId={r.registrationId}
                receiptUrl={r.receiptPath ? receiptUrlByPath.get(r.receiptPath) ?? null : null}
                idPrefix={`receipt-winner-${r.registrationId}`}
              />
            ),
          }))}
        />
      )}
    </AdminShell>
  );
}
