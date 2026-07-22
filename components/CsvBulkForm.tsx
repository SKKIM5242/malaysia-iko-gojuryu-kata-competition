"use client";

import { useActionState } from "react";
import { bulkRegisterCsv, type CsvBulkState } from "@/app/actions/bulk";
import { formatUSD } from "@/components/ui";
import type { Competition, School, Sensei } from "@/lib/types";

const initial: CsvBulkState = { done: false };

export default function CsvBulkForm({
  competitions,
  schools,
  senseis,
}: {
  competitions: Competition[];
  schools: School[];
  senseis: Sensei[];
}) {
  const [state, formAction, pending] = useActionState(bulkRegisterCsv, initial);

  if (state.done) {
    return (
      <div className="space-y-4">
        <div className={`rounded-lg border p-6 ${state.registered ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
          <h3 className="text-lg font-bold">
            {state.registered ?? 0} participants registered, {state.failed ?? 0} failed
          </h3>
          <p className="mt-1 text-sm text-neutral-600">
            Registered participants are pending payment confirmation by the organizer.
          </p>
        </div>
        {state.failures && state.failures.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">CSV row</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Problem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {state.failures.map((f) => (
                  <tr key={f.row}>
                    <td className="px-3 py-2 text-neutral-400">{f.row}</td>
                    <td className="px-3 py-2 font-medium">{f.name}</td>
                    <td className="px-3 py-2 text-red-600">{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(state.failed ?? 0) > state.failures.length && (
              <p className="px-3 py-2 text-xs text-neutral-400">
                Showing first {state.failures.length} of {state.failed} failures.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="csv_competition_id" className="mb-1 block text-sm font-medium text-neutral-700">
            Competition tier *
          </label>
          <select
            id="csv_competition_id"
            name="competition_id"
            required
            defaultValue={competitions.length === 1 ? competitions[0].id : ""}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="" disabled>Select the tier you paid for</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {formatUSD(c.registration_fee_usd)} per event</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="csv_school_id" className="mb-1 block text-sm font-medium text-neutral-700">School / Dojo *</label>
          <select id="csv_school_id" name="school_id" required defaultValue="" className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="" disabled>Select school</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="csv_sensei_id" className="mb-1 block text-sm font-medium text-neutral-700">Sensei / Coach *</label>
          <select id="csv_sensei_id" name="sensei_id" required defaultValue="" className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="" disabled>Select sensei</option>
            {senseis.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.rank ? ` (${s.rank})` : ""}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="csv_file" className="mb-1 block text-sm font-medium text-neutral-700">
            Filled-in CSV file *
          </label>
          <input
            id="csv_file"
            name="csv_file"
            type="file"
            accept=".csv,text/csv"
            required
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
      >
        {pending ? "Uploading and registering… (large files can take up to a minute)" : "Upload CSV and register participants"}
      </button>
    </form>
  );
}
