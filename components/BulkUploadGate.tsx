"use client";

import { useActionState } from "react";
import { requestOrCheckBulkUploadPayment, type BulkPaymentState } from "@/app/actions/bulk";
import { OrganiserContact, formatUSD } from "@/components/ui";
import type { School, Sensei } from "@/lib/types";

const initial: BulkPaymentState = { done: false };

/** Sensei pays for the whole batch upfront (unlike single-participant
 * registration, which registers first and pays after) — request/check a
 * payment for N participants here, then use the SAME School/Sensei in
 * Option A or B below once it shows as paid. */
export default function BulkUploadGate({
  competitionId,
  registrationFeeUsd,
  schools,
  senseis,
}: {
  competitionId: string;
  registrationFeeUsd: number | null;
  schools: School[];
  senseis: Sensei[];
}) {
  const [state, formAction, pending] = useActionState(requestOrCheckBulkUploadPayment, initial);

  return (
    <section className="mb-10 rounded-xl border-2 border-red-700 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Step 1 — Pay For Your Bulk Registration</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Bulk registration is paid upfront, before you upload: tell us how many participants you're
        registering, pay the total, and once the organiser confirms it you can upload your CSV or
        table below — <strong>using this same School and Sensei</strong>.
      </p>

      <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-3">
        <input type="hidden" name="competition_id" value={competitionId} />
        <div>
          <label htmlFor="gate_school_id" className="mb-1 block text-sm font-medium text-neutral-700">School / Dojo *</label>
          <select id="gate_school_id" name="school_id" required defaultValue="" className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="" disabled>Select school</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gate_sensei_id" className="mb-1 block text-sm font-medium text-neutral-700">Sensei / Coach *</label>
          <select id="gate_sensei_id" name="sensei_id" required defaultValue="" className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="" disabled>Select sensei</option>
            {senseis.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.rank ? ` (${s.rank})` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gate_count" className="mb-1 block text-sm font-medium text-neutral-700">No. of participants *</label>
          <input
            id="gate_count"
            name="participant_count"
            type="number"
            min={1}
            required
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {pending ? "Checking…" : "Request / check payment"}
          </button>
        </div>
      </form>

      {state.error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</div>
      )}

      {state.done && state.status === "paid" && (
        <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="font-bold text-green-900">✅ Paid — you can upload now</p>
          <p className="mt-1 text-sm text-green-800">
            Balance remaining on this payment: <strong>{state.remainingParticipants}</strong> participant
            {state.remainingParticipants === 1 ? "" : "s"}. Scroll down and upload using the same School
            and Sensei you selected above.
          </p>
        </div>
      )}

      {state.done && state.status === "pending" && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-bold text-amber-900">Payment pending</p>
          <p className="mt-1 text-sm text-amber-800">
            Amount due: <strong>{formatUSD(state.amountUsd ?? 0)}</strong>. Transfer this amount and
            send your receipt to the organiser (see below), quoting payment reference{" "}
            <span className="rounded bg-white px-1.5 py-0.5 font-mono text-xs font-bold">{state.paymentId?.slice(0, 8).toUpperCase()}</span>.
            Once confirmed, come back and click &quot;Request / check payment&quot; again with the
            same School, Sensei, and participant count to unlock the upload.
          </p>
          <div className="mt-2 text-amber-900"><OrganiserContact /></div>
        </div>
      )}

      {registrationFeeUsd != null && (
        <p className="mt-3 text-xs text-neutral-400">
          Fee is {formatUSD(registrationFeeUsd)} per participant.
        </p>
      )}
    </section>
  );
}
