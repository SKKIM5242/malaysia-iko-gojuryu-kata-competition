"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { bulkRegister, type BulkRow, type BulkState } from "@/app/actions/bulk";
import type { Competition, School, Sensei } from "@/lib/types";

const initial: BulkState = { done: false };

const emptyRow = (): BulkRow => ({
  full_name: "",
  ic_passport: "",
  date_of_birth: "",
  gender: "",
  belt_rank: "",
  rank_confirmation: "",
  home_address: "",
  city_town: "",
  home_country: "Malaysia",
  kata_base: "",
  bank_name: "",
  bank_account_no: "",
  bank_account_name: "",
});

const cell = "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs focus:border-red-600 focus:outline-none";

export default function BulkRegisterForm({
  competition,
  kataBases,
  schools,
  senseis,
}: {
  competition: Competition;
  kataBases: string[];
  schools: School[];
  senseis: Sensei[];
}) {
  const [rows, setRows] = useState<BulkRow[]>(() => Array.from({ length: 5 }, emptyRow));
  const [state, formAction, pending] = useActionState(bulkRegister, initial);

  const update = (i: number, key: keyof BulkRow, value: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  if (state.done && state.results) {
    const okCount = state.results.filter((r) => r.ok).length;
    return (
      <div className="space-y-4">
        <div className={`rounded-lg border p-6 ${okCount > 0 ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
          <h2 className="text-lg font-bold">
            {okCount} of {state.results.length} participants registered
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Registered participants are <strong>pending payment</strong> — the organiser confirms
            each one once the fee is received. Failed rows are listed below; fix and resubmit them
            via <Link href="/register/bulk" className="underline">a new bulk form</Link>.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">No.</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {state.results.map((r) => (
                <tr key={r.row}>
                  <td className="px-3 py-2 text-neutral-400">{r.row}</td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">
                    {r.ok ? (
                      <span className="text-green-700">✔ Ref <span className="font-mono font-bold">{r.referenceId}</span></span>
                    ) : (
                      <span className="text-red-600">✘ {r.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="competition_id" value={competition.id} />
      <input type="hidden" name="rows_json" value={JSON.stringify(rows)} />

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="school_id" className="mb-1 block text-sm font-medium text-neutral-700">School / Dojo *</label>
          <select id="school_id" name="school_id" required defaultValue="" className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="" disabled>Select school</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sensei_id" className="mb-1 block text-sm font-medium text-neutral-700">Sensei / Coach *</label>
          <select id="sensei_id" name="sensei_id" required defaultValue="" className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="" disabled>Select sensei</option>
            {senseis.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.rank ? ` (${s.rank})` : ""}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[1700px] text-left">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-2 py-2 w-10">No.</th>
              <th className="px-2 py-2">Full name *</th>
              <th className="px-2 py-2">IC / Passport *</th>
              <th className="px-2 py-2">Date of birth *</th>
              <th className="px-2 py-2">Gender *</th>
              <th className="px-2 py-2">Belt rank *</th>
              <th className="px-2 py-2">Rank confirmation *</th>
              <th className="px-2 py-2">Home address *</th>
              <th className="px-2 py-2">City/Town *</th>
              <th className="px-2 py-2">Country *</th>
              <th className="px-2 py-2">Kata event *</th>
              <th className="px-2 py-2">Bank name *</th>
              <th className="px-2 py-2">Bank account no. *</th>
              <th className="px-2 py-2">Account holder *</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                <td className="px-2 py-1.5 text-center text-sm font-semibold text-neutral-400">{i + 1}</td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} full name`} className={cell} value={row.full_name} onChange={(e) => update(i, "full_name", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} IC`} className={cell} value={row.ic_passport} onChange={(e) => update(i, "ic_passport", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} date of birth`} type="date" className={cell} value={row.date_of_birth} onChange={(e) => update(i, "date_of_birth", e.target.value)} /></td>
                <td className="px-2 py-1.5">
                  <select aria-label={`Row ${i + 1} gender`} className={cell} value={row.gender} onChange={(e) => update(i, "gender", e.target.value)}>
                    <option value=""></option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} belt rank`} className={cell} placeholder="e.g. 3rd Kyu" value={row.belt_rank} onChange={(e) => update(i, "belt_rank", e.target.value)} /></td>
                <td className="px-2 py-1.5">
                  <select aria-label={`Row ${i + 1} rank confirmation`} className={cell} value={row.rank_confirmation} onChange={(e) => update(i, "rank_confirmation", e.target.value)}>
                    <option value=""></option>
                    <option value="sensei_confirmed">Sensei Confirmed</option>
                    <option value="pending_confirmation">Pending Confirmation</option>
                  </select>
                </td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} home address`} className={cell} value={row.home_address} onChange={(e) => update(i, "home_address", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} city or town`} className={cell} value={row.city_town} onChange={(e) => update(i, "city_town", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} home country`} className={cell} value={row.home_country} onChange={(e) => update(i, "home_country", e.target.value)} /></td>
                <td className="px-2 py-1.5">
                  <select aria-label={`Row ${i + 1} kata event`} className={cell} value={row.kata_base} onChange={(e) => update(i, "kata_base", e.target.value)}>
                    <option value=""></option>
                    {kataBases.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} bank name`} className={cell} value={row.bank_name} onChange={(e) => update(i, "bank_name", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} bank account no`} className={cell} value={row.bank_account_no} onChange={(e) => update(i, "bank_account_no", e.target.value)} /></td>
                <td className="px-2 py-1.5"><input aria-label={`Row ${i + 1} account holder`} className={cell} value={row.bank_account_name} onChange={(e) => update(i, "bank_account_name", e.target.value)} /></td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    aria-label={`Remove row ${i + 1}`}
                    onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          + Add row
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Submitting…" : `Submit ${rows.length} participants`}
        </button>
        <span className="text-xs text-neutral-400">
          Empty rows are skipped. Each participant gets their own reference ID. Rank confirmation:
          choose <strong>Sensei Confirmed</strong> if you vouch for the stated rank, or{" "}
          <strong>Pending Confirmation</strong> — the participant uploads or photographs their
          certificate later.
        </span>
      </div>
    </form>
  );
}
