"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createBulkUploadCheckout,
  requestBulkUploadBatch,
  type BulkBatchState,
  type BulkCheckoutState,
} from "@/app/actions/bulk";
import { formatUSD } from "@/components/ui";
import type { Competition, School, Sensei } from "@/lib/types";

const initial: BulkBatchState = { done: false };
const checkoutInitial: BulkCheckoutState = { ok: false };

/** Pay-now button for a pending batch — creates a Stripe Checkout session
 * for the combined total and redirects there. Once payment succeeds,
 * finalizeBulkUploadBatchSession marks every tier in the batch paid and
 * emails the sensei the quotation + batch reference. */
function PayBatchButton({ batchId }: { batchId: string }) {
  const [state, formAction, pending] = useActionState(createBulkUploadCheckout, checkoutInitial);

  useEffect(() => {
    if (state.ok && state.checkoutUrl) window.location.href = state.checkoutUrl;
  }, [state]);

  return (
    <div className="mt-2">
      {state.error && <p className="mb-1 text-sm font-semibold text-red-600">{state.error}</p>}
      <form action={formAction}>
        <input type="hidden" name="batch_id" value={batchId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Redirecting to payment…" : "Pay with Stripe"}
        </button>
      </form>
      <p className="mt-1 text-xs text-amber-700">
        Takes you to a secure Stripe checkout — the upload unlocks the moment payment succeeds, and
        you&apos;ll be emailed the quotation and this batch reference for your records.
      </p>
    </div>
  );
}

/** Sensei pays for the whole batch upfront (unlike single-participant
 * registration, which registers first and pays after) — a single popup
 * covers all 3 competition tiers at once. For each tier they intend to
 * use, they give a participant headcount AND a total event count (fee
 * scales by events, same up-to-3-per-participant rule as individual
 * registration); one combined bill covers every tier entered, paid online
 * via Stripe. The moment payment succeeds the upload unlocks — use the
 * SAME School/Sensei in Option A or B below (picking the matching tier) —
 * up to exactly the numbers declared here, no more. */
export default function BulkUploadGate({
  competitions,
  schools,
  senseis,
}: {
  competitions: Competition[];
  schools: School[];
  senseis: Sensei[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(requestBulkUploadBatch, initial);

  useEffect(() => {
    if (state.done) setOpen(false);
  }, [state]);

  return (
    <section className="mb-10 rounded-xl border-2 border-red-700 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Step 1 — Enquire &amp; Pay For Your Bulk Registration</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Bulk registration is paid upfront, before you upload. Tell us — for each tier you&apos;re
        using — how many participants and how many total kata events they&apos;re taking, then pay
        the combined total online. The upload unlocks the moment payment succeeds — come back and
        upload your CSV or table below using this same School and Sensei.
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
      >
        Enquire &amp; pay for bulk registration
      </button>

      {state.done && state.tiers && (
        <div className="mt-4 space-y-3">
          {state.tiers.every((t) => t.status === "paid") ? (
            <div className="rounded-lg border border-green-300 bg-green-50 p-4">
              <p className="font-bold text-green-900">✅ Paid — you can upload now</p>
              <ul className="mt-1 space-y-0.5 text-sm text-green-800">
                {state.tiers.map((t) => (
                  <li key={t.competitionId}>
                    {t.competitionName}: {t.participants} participant{t.participants === 1 ? "" : "s"},{" "}
                    {t.events} event{t.events === 1 ? "" : "s"} remaining
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm text-green-800">
                Scroll down and upload using the same School and Sensei you selected — pick the
                matching tier for each upload.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="font-bold text-amber-900">Payment pending</p>
              <ul className="mt-1 space-y-0.5 text-sm text-amber-800">
                {state.tiers.map((t) => (
                  <li key={t.competitionId}>
                    {t.competitionName}: {t.participants} participant{t.participants === 1 ? "" : "s"},{" "}
                    {t.events} event{t.events === 1 ? "" : "s"} — {formatUSD(t.amountUsd)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-amber-800">
                Combined total due: <strong>{formatUSD(state.totalAmountUsd ?? 0)}</strong>. Batch
                reference{" "}
                <span className="rounded bg-white px-1.5 py-0.5 font-mono text-xs font-bold">
                  {state.batchId?.slice(0, 8).toUpperCase()}
                </span>
                {" "}— pay online below and the upload unlocks immediately.
              </p>
              {state.batchId && <PayBatchButton batchId={state.batchId} />}
            </div>
          )}
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-lg font-bold text-neutral-900">Bulk registration enquiry</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-400 hover:text-neutral-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-neutral-500">
              Fill in only the tier(s) you&apos;re registering for — leave a tier&apos;s fields at 0
              to skip it. <strong>The numbers you enter here are the only ones you&apos;ll be
              allowed to upload</strong> — uploading more participants or events than declared will
              be rejected by the system.
            </p>
            <form action={formAction} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="gate_school_id" className="mb-1 block text-sm font-medium text-neutral-700">
                    School / Dojo *
                  </label>
                  <select
                    id="gate_school_id"
                    name="school_id"
                    required
                    defaultValue=""
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="" disabled>Select school</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="gate_sensei_id" className="mb-1 block text-sm font-medium text-neutral-700">
                    Sensei / Coach *
                  </label>
                  <select
                    id="gate_sensei_id"
                    name="sensei_id"
                    required
                    defaultValue=""
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="" disabled>Select sensei</option>
                    {senseis.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.rank ? ` (${s.rank})` : ""}</option>
                    ))}
                  </select>
                </div>
              </div>

              {competitions.map((c, i) => (
                <div key={c.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <input type="hidden" name={`competition_${i + 1}_id`} value={c.id} />
                  <p className="mb-2 text-sm font-bold text-neutral-800">
                    {c.name}
                    <span className="ml-2 font-normal text-neutral-400">
                      {formatUSD(c.registration_fee_usd)} per event
                    </span>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`participants_${i + 1}`} className="mb-1 block text-xs font-medium text-neutral-700">
                        No. of participants
                      </label>
                      <input
                        id={`participants_${i + 1}`}
                        name={`participants_${i + 1}`}
                        type="number"
                        min={0}
                        defaultValue={0}
                        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor={`events_${i + 1}`} className="mb-1 block text-xs font-medium text-neutral-700">
                        Total no. of kata events
                      </label>
                      <input
                        id={`events_${i + 1}`}
                        name={`events_${i + 1}`}
                        type="number"
                        min={0}
                        defaultValue={0}
                        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}

              {state.error && (
                <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {state.error}
                </div>
              )}

              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60 sm:w-auto"
              >
                {pending ? "Checking…" : "Submit enquiry"}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
