import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { computeCommissions, type CommissionRow } from "@/lib/commissions";
import { computeWinnerRewards, type WinnerRewardRow } from "@/lib/rewards";
import { getOtherPayouts, type OtherPayoutRow } from "@/lib/other-payouts";
import { computeProfitLossByTier } from "@/lib/profit-loss";
import {
  setCommissionPayoutStatus, setWinnerPayoutStatus, uploadCommissionReceipt, uploadWinnerReceipt,
  saveOtherPayout, deleteOtherPayout, setOtherPayoutStatus, uploadOtherPayoutReceipt,
} from "@/app/actions/admin";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CertificateUploadField from "@/components/CertificateUploadField";
import ProfitLossSection from "@/components/ProfitLossSection";
import { getAllCompetitions } from "@/lib/admin-data";
import { shortTierName } from "@/lib/invitation-codes";

const MEDALS = ["🥇", "🥈", "🥉"];
const RETURN_TO = "/admin/commissions";
const cellInput = "w-full rounded-md border border-neutral-300 px-2 py-1 text-xs";

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

function OtherPayoutStatusButtons({
  id, current,
}: { id: string; current: "unpaid" | "paid" }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(["unpaid", "paid"] as const).map((o) => (
        <form key={o} action={setOtherPayoutStatus}>
          <input type="hidden" name="id" value={id} />
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

function OtherPayoutReceiptCell({
  id, receiptUrl, idPrefix,
}: { id: string; receiptUrl: string | null; idPrefix: string }) {
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
      <form action={uploadOtherPayoutReceipt} className="space-y-1">
        <input type="hidden" name="id" value={id} />
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
  const otherPayouts = await getOtherPayouts();
  const allCompetitions = await getAllCompetitions();
  const tierNameById = new Map(allCompetitions.map((c) => [c.id, c.name]));
  const profitLossRows = await computeProfitLossByTier(rows, rewardRows, otherPayouts);

  // Signed links (1h) for receipt photos in the private payout-receipts
  // bucket — one batched call per table, same pattern as certificate/kata
  // video signed URLs elsewhere in the admin panel.
  const supabase = await createClient();
  const receiptPaths = [
    ...rows.map((r) => r.receiptPath),
    ...rewardRows.map((r) => r.receiptPath),
    ...otherPayouts.map((r) => r.receiptPath),
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
        judged student&apos;s fee with no minimum and no tier test — every tier they judged in
        shows ✓ in the same column, purely for the per-tier breakdown below.
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
            tier_split: r.tiers.length === 0
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
        announcement. Reward amount is parsed from that tier&apos;s own published announcement
        (its &quot;Gold/Silver/Bronze — 1st/2nd/3rd Prize&quot; lines) — shows &quot;not
        announced&quot; if the tier&apos;s announcement doesn&apos;t state one.
        &quot;Paid&quot; below is your own record of who you&apos;ve actually paid out
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
            { key: "reward_amount", label: "Reward" },
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
            { key: "reward_amount_csv", label: "Reward USD" },
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
            reward_amount: r.rewardAmountUsd != null ? `$${r.rewardAmountUsd.toFixed(2)}` : "— not announced",
            reward_amount_csv: r.rewardAmountUsd != null ? r.rewardAmountUsd.toFixed(2) : "",
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

      <h2 id="other-payouts" className="mt-10 mb-2 scroll-mt-4 text-lg font-bold text-neutral-900">Other Payouts</h2>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Anything that isn&apos;t a computed School/Sensei/Referee commission or a Top-3 winner
        reward — vendor payments, refunds, staff bonuses, sponsor prizes, etc. Unlike the tables
        above, nothing here is computed automatically: enter the tier, a description, and the
        amount yourself, then track it the same way with Paid/Unpaid and a receipt upload.
      </p>

      <form id="other-new" action={saveOtherPayout}>
        <input type="hidden" name="return_to" value={RETURN_TO} />
      </form>
      {(otherPayouts ?? []).map((r) => (
        <form key={r.id} id={`other-${r.id}`} action={saveOtherPayout}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="return_to" value={RETURN_TO} />
        </form>
      ))}
      <button
        form="other-new"
        type="submit"
        className="mb-3 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700"
      >
        + Add payout (fill below, then Save on the new row)
      </button>

      <FilterableTable
        rowKey="key"
        downloadName="other-payouts"
        columns={[
          { key: "tier", label: "Tier", width: 200 },
          { key: "description", label: "Description", width: 220, wrap: true },
          { key: "amount", label: "Amount (USD)", width: 130 },
          { key: "status", label: "Status" },
          { key: "receipt", label: "Receipt", width: 220 },
          { key: "actions", label: "Actions", width: 130 },
        ]}
        csvColumns={[
          { key: "tier_csv", label: "Tier" },
          { key: "description_csv", label: "Description" },
          { key: "amount_csv", label: "Amount USD" },
          { key: "status_csv", label: "Status" },
          { key: "receipt_status_csv", label: "Receipt Uploaded" },
        ]}
        rows={[
          {
            key: "other-new-row",
            tier: (
              <select form="other-new" name="competition_id" required className={cellInput} defaultValue="">
                <option value="" disabled>Select tier…</option>
                {allCompetitions.map((c) => (
                  <option key={c.id} value={c.id}>{shortTierName(c.name)}</option>
                ))}
              </select>
            ),
            description: <input form="other-new" name="description" required placeholder="Description *" className={cellInput} />,
            amount: <input form="other-new" name="amount_usd" type="number" step="0.01" min="0" required placeholder="0.00" className={cellInput} />,
            status: <span className="text-xs text-neutral-400">—</span>,
            receipt: <span className="text-xs text-neutral-400">—</span>,
            actions: <span className="text-xs text-neutral-400">New row — Save above</span>,
            tier_csv: "", description_csv: "", amount_csv: "", status_csv: "", receipt_status_csv: "",
          },
          ...(otherPayouts ?? []).map((r: OtherPayoutRow) => ({
            key: r.id,
            tier: (
              <select form={`other-${r.id}`} name="competition_id" required defaultValue={r.competitionId} className={cellInput}>
                {allCompetitions.map((c) => (
                  <option key={c.id} value={c.id}>{shortTierName(c.name)}</option>
                ))}
              </select>
            ),
            description: (
              <input form={`other-${r.id}`} name="description" required defaultValue={r.description} className={cellInput} />
            ),
            amount: (
              <input
                form={`other-${r.id}`}
                name="amount_usd"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={r.amountUsd}
                className={cellInput}
              />
            ),
            status: <OtherPayoutStatusButtons id={r.id} current={r.status} />,
            receipt: (
              <OtherPayoutReceiptCell
                id={r.id}
                receiptUrl={r.receiptPath ? receiptUrlByPath.get(r.receiptPath) ?? null : null}
                idPrefix={`receipt-other-${r.id}`}
              />
            ),
            actions: (
              <span className="flex gap-1.5">
                <button
                  form={`other-${r.id}`}
                  type="submit"
                  className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  Save
                </button>
                <button
                  form={`other-${r.id}`}
                  formAction={deleteOtherPayout}
                  className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </span>
            ),
            tier_csv: r.competitionName,
            description_csv: r.description,
            amount_csv: r.amountUsd.toFixed(2),
            status_csv: r.status,
            receipt_status_csv: r.receiptPath ? "Yes" : "No",
          })),
        ]}
      />
      {(otherPayouts ?? []).length === 0 && <EmptyState>No other payouts recorded yet.</EmptyState>}

      <h2 id="profit-loss" className="mt-10 mb-2 scroll-mt-4 text-lg font-bold text-neutral-900">Profit / Loss by Tier</h2>
      <p className="mb-4 max-w-3xl text-sm text-neutral-500">
        Revenue is every paid participant registration fee for that tier. Payouts Done is every
        Commission, Winner Reward, and Other Payout above that&apos;s currently marked{" "}
        <strong>Paid</strong>, scoped to the same tier. Profit/Loss = Revenue − Payouts Done, as of
        the moment you click Generate — nothing here is stored, so re-generating always reflects
        the latest data.
      </p>
      <ProfitLossSection rows={profitLossRows} />
    </AdminShell>
  );
}
