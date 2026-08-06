"use client";

import { useActionState } from "react";
import type { CsvUploadResult } from "@/lib/csv-bulk";
import { useTableInteractions } from "@/lib/useTableInteractions";
import TableInteractionOverlays from "@/components/TableInteractionOverlays";

const initial: CsvUploadResult = { done: false };

const FAILURE_COLS = [
  { key: "row", label: "Row" },
  { key: "name", label: "Name" },
  { key: "error", label: "Problem" },
] as const;

export default function CsvUploadForm({
  action,
  templateHref,
  entityLabel,
  note,
  resultVerb = "added",
}: {
  action: (state: CsvUploadResult, formData: FormData) => Promise<CsvUploadResult>;
  templateHref: string;
  entityLabel: string;
  note?: string;
  /** Past-tense verb for the success count, e.g. "added" (default), "updated",
   * "saved" — lets callers whose upload overrides existing records (instead
   * of only ever inserting new ones) describe what actually happened. */
  resultVerb?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const t = useTableInteractions();
  const orderedCols = t
    .orderColumnKeys(FAILURE_COLS.map((c) => c.key))
    .map((k) => FAILURE_COLS.find((c) => c.key === k))
    .filter((c): c is (typeof FAILURE_COLS)[number] => !!c);
  const orderedFailures = state.failures
    ? (() => {
        const keys = t.orderRowKeys(state.failures.map((f) => String(f.row)));
        const byKey = new Map(state.failures.map((f) => [String(f.row), f]));
        return keys.map((k) => byKey.get(k)).filter((f): f is NonNullable<typeof f> => !!f);
      })()
    : [];

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
            {state.succeeded ?? 0} {entityLabel}(s) {resultVerb}, {state.failed ?? 0} failed
          </p>
          {state.failures && state.failures.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded border border-neutral-200 bg-white">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-50 uppercase tracking-wide text-neutral-500">
                  <tr>
                    {orderedCols.map((c) => (
                      <th key={c.key} data-col-order-key={c.key} className="px-2 py-1.5">
                        <span onPointerDown={t.getColHeaderDownHandler(c.key, () => {})} title="Drag to reorder" className="block cursor-pointer select-none">
                          {c.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {orderedFailures.map((f) => (
                    <tr key={f.row} data-row-order-key={String(f.row)}>
                      {orderedCols.map((c, i) => {
                        const text = String(f[c.key]);
                        const isCellSelected = t.isCellSelected(String(f.row), c.key);
                        const isFillPreview = t.isFillPreview(String(f.row), c.key);
                        const displayText = t.cellValue(String(f.row), c.key, text);
                        return (
                          <td
                            key={c.key}
                            data-cell-row={String(f.row)}
                            data-cell-col={c.key}
                            onPointerDown={i === 0 ? t.getRowHandleDownHandler(String(f.row), () => {}) : undefined}
                            onClick={i !== 0 ? () => t.selectCell(String(f.row), c.key) : undefined}
                            onContextMenu={t.getContextMenuHandler(displayText)}
                            className={`relative px-2 py-1.5 ${i === 0 ? "cursor-pointer select-none text-neutral-400" : i === 1 ? "font-medium" : "text-red-600"} ${
                              isCellSelected ? "ring-2 ring-inset ring-blue-500" : ""
                            } ${isFillPreview ? "outline outline-2 -outline-offset-2 outline-blue-300" : ""}`}
                          >
                            {displayText}
                            {isCellSelected && (
                              <span
                                onPointerDown={t.getFillHandleDownHandler(String(f.row), c.key, displayText)}
                                title="Drag to copy this value into other cells"
                                className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-crosshair rounded-sm border border-white bg-blue-600"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {(state.failed ?? 0) > state.failures.length && (
                <p className="px-2 py-1.5 text-xs text-neutral-400">
                  Showing first {state.failures.length} of {state.failed} failures.
                </p>
              )}
              <TableInteractionOverlays t={t} />
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
