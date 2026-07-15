"use client";

import { useActionState } from "react";
import type { CsvUploadResult } from "@/lib/csv-bulk";

const initial: CsvUploadResult = { done: false };

export default function CsvUploadForm({
  action,
  templateHref,
  entityLabel,
  note,
}: {
  action: (state: CsvUploadResult, formData: FormData) => Promise<CsvUploadResult>;
  templateHref: string;
  entityLabel: string;
  note?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-sm font-bold text-neutral-800">Bulk upload via CSV</p>
      <p className="mt-1 text-xs text-neutral-500">
        <a href={templateHref} download className="font-semibold text-red-700 underline underline-offset-2">
          Download the CSV template
        </a>{" "}
        (opens in Excel), fill one row per {entityLabel}, keep the header row, then upload it below.
        {note ? ` ${note}` : ""}
      </p>

      {state.done && (
        <div
          className={`mt-3 rounded-md border p-3 text-sm ${
            (state.succeeded ?? 0) > 0 ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"
          }`}
        >
          <p className="font-bold">
            {state.succeeded ?? 0} {entityLabel}(s) added, {state.failed ?? 0} failed
          </p>
          {state.failures && state.failures.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded border border-neutral-200 bg-white">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-2 py-1.5">Row</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Problem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {state.failures.map((f) => (
                    <tr key={f.row}>
                      <td className="px-2 py-1.5 text-neutral-400">{f.row}</td>
                      <td className="px-2 py-1.5 font-medium">{f.name}</td>
                      <td className="px-2 py-1.5 text-red-600">{f.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(state.failed ?? 0) > state.failures.length && (
                <p className="px-2 py-1.5 text-xs text-neutral-400">
                  Showing first {state.failures.length} of {state.failed} failures.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {state.error && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          name="csv_file"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-xs file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-60"
        >
          {pending ? "Uploading…" : "Upload CSV"}
        </button>
      </form>
    </div>
  );
}
