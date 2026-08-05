"use client";

import { useState, type ReactNode } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { bulkRegister, type BulkRow, type BulkState } from "@/app/actions/bulk";
import { formatUSD } from "@/components/ui";
import { ageAt } from "@/lib/division";
import { shortTierName } from "@/lib/invitation-codes";
import DateOfBirthField from "@/components/DateOfBirthField";
import { useTableInteractions } from "@/lib/useTableInteractions";
import TableInteractionOverlays from "@/components/TableInteractionOverlays";
import type { Competition, School, Sensei } from "@/lib/types";

const initial: BulkState = { done: false };

const emptyRow = (): BulkRow => ({
  full_name: "",
  ic_passport: "",
  date_of_birth: "",
  gender: "",
  belt_rank: "",
  rank_confirmation: "",
  email: "",
  phone: "",
  home_address: "",
  city_town: "",
  home_country: "Malaysia",
  kata_base: "",
  bank_name: "",
  bank_account_no: "",
  bank_account_name: "",
});

const cell = "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs focus:border-red-600 focus:outline-none";

/** One reorderable, editable grid entry. `id` is a stable client-only key
 * (independent of array position) so drag-reordering the ROWS on screen
 * doesn't get confused with — or corrupt — which underlying `rows[]`
 * index an edit/remove actually targets. */
interface RowEntry {
  id: string;
  index: number;
  row: BulkRow;
}

interface ColDef {
  key: string;
  label: string;
  /** Plain-text value for fill-copy/right-click-copy — undefined for
   * non-editable/decorative columns (No., Age, remove), which stay
   * reorderable but aren't cell-select eligible. */
  value?: (row: BulkRow) => string;
  render: (
    entry: RowEntry,
    update: (i: number, key: keyof BulkRow, value: string) => void,
    kataBases: string[],
    remove: (i: number) => void,
  ) => ReactNode;
}

const COLUMNS: ColDef[] = [
  {
    key: "no",
    label: "No.",
    render: (entry) => <span className="text-center text-sm font-semibold text-neutral-400">{entry.index + 1}</span>,
  },
  {
    key: "full_name",
    label: "Full name *",
    value: (row) => row.full_name,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} full name`} className={cell} value={entry.row.full_name} onChange={(e) => update(entry.index, "full_name", e.target.value)} />
    ),
  },
  {
    key: "ic_passport",
    label: "IC / Passport *",
    value: (row) => row.ic_passport,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} IC`} className={cell} value={entry.row.ic_passport} onChange={(e) => update(entry.index, "ic_passport", e.target.value)} />
    ),
  },
  {
    key: "date_of_birth",
    label: "Date of Birth: DD/MM/YYYY *",
    value: (row) => row.date_of_birth,
    render: (entry, update) => (
      <DateOfBirthField
        key={`dob-${entry.id}`}
        ariaLabel={`Row ${entry.index + 1} date of birth`}
        defaultValueISO={entry.row.date_of_birth}
        onISOChange={(iso) => update(entry.index, "date_of_birth", iso)}
        className={cell}
      />
    ),
  },
  {
    key: "age",
    label: "Age",
    render: (entry) => (
      <span className="block text-center text-neutral-500">
        {entry.row.date_of_birth && !Number.isNaN(Date.parse(entry.row.date_of_birth)) ? ageAt(entry.row.date_of_birth, null) : "—"}
      </span>
    ),
  },
  {
    key: "gender",
    label: "Gender *",
    value: (row) => row.gender,
    render: (entry, update) => (
      <select aria-label={`Row ${entry.index + 1} gender`} className={cell} value={entry.row.gender} onChange={(e) => update(entry.index, "gender", e.target.value)}>
        <option value=""></option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
    ),
  },
  {
    key: "belt_rank",
    label: "Latest Belt rank *",
    value: (row) => row.belt_rank,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} belt rank`} className={cell} placeholder="e.g. 3rd Kyu" value={entry.row.belt_rank} onChange={(e) => update(entry.index, "belt_rank", e.target.value)} />
    ),
  },
  {
    key: "rank_confirmation",
    label: "Rank confirmation *",
    value: (row) => row.rank_confirmation,
    render: (entry, update) => (
      <select aria-label={`Row ${entry.index + 1} rank confirmation`} className={cell} value={entry.row.rank_confirmation} onChange={(e) => update(entry.index, "rank_confirmation", e.target.value)}>
        <option value=""></option>
        <option value="sensei_confirmed">Sensei Confirmed</option>
        <option value="pending_confirmation">Pending Confirmation</option>
      </select>
    ),
  },
  {
    key: "email",
    label: "Email *",
    value: (row) => row.email,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} email`} type="email" className={cell} value={entry.row.email} onChange={(e) => update(entry.index, "email", e.target.value)} />
    ),
  },
  {
    key: "phone",
    label: "Mobile phone *",
    value: (row) => row.phone,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} mobile phone`} type="tel" className={cell} value={entry.row.phone} onChange={(e) => update(entry.index, "phone", e.target.value)} />
    ),
  },
  {
    key: "home_address",
    label: 'Home address *(no comma "," allowed)',
    value: (row) => row.home_address,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} home address`} className={cell} value={entry.row.home_address} onChange={(e) => update(entry.index, "home_address", e.target.value.replace(/,/g, ""))} />
    ),
  },
  {
    key: "city_town",
    label: "City/Town *",
    value: (row) => row.city_town,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} city or town`} className={cell} value={entry.row.city_town} onChange={(e) => update(entry.index, "city_town", e.target.value)} />
    ),
  },
  {
    key: "home_country",
    label: "Country *",
    value: (row) => row.home_country,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} home country`} className={cell} value={entry.row.home_country} onChange={(e) => update(entry.index, "home_country", e.target.value)} />
    ),
  },
  {
    key: "kata_base",
    label: "Kata event *",
    value: (row) => row.kata_base,
    render: (entry, update, kataBases) => (
      <select aria-label={`Row ${entry.index + 1} kata event`} className={cell} value={entry.row.kata_base} onChange={(e) => update(entry.index, "kata_base", e.target.value)}>
        <option value=""></option>
        {kataBases.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
    ),
  },
  {
    key: "bank_name",
    label: "Bank name *",
    value: (row) => row.bank_name,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} bank name`} className={cell} value={entry.row.bank_name} onChange={(e) => update(entry.index, "bank_name", e.target.value)} />
    ),
  },
  {
    key: "bank_account_no",
    label: "International Bank Account No. (IBAN) *",
    value: (row) => row.bank_account_no,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} IBAN`} className={cell} value={entry.row.bank_account_no} onChange={(e) => update(entry.index, "bank_account_no", e.target.value)} />
    ),
  },
  {
    key: "bank_account_name",
    label: "Account holder *",
    value: (row) => row.bank_account_name,
    render: (entry, update) => (
      <input aria-label={`Row ${entry.index + 1} account holder`} className={cell} value={entry.row.bank_account_name} onChange={(e) => update(entry.index, "bank_account_name", e.target.value)} />
    ),
  },
  {
    key: "remove",
    label: "",
    render: (entry, _update, _kataBases, remove) => (
      <button
        type="button"
        aria-label={`Remove row ${entry.index + 1}`}
        onClick={() => remove(entry.index)}
        className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
      >
        ✕
      </button>
    ),
  },
];

export default function BulkRegisterForm({
  competitions,
  kataBases,
  schools,
  senseis,
}: {
  competitions: Competition[];
  kataBases: string[];
  schools: School[];
  senseis: Sensei[];
}) {
  const [rows, setRows] = useState<BulkRow[]>(() => Array.from({ length: 5 }, emptyRow));
  // Deterministic (not crypto.randomUUID()) for this initial batch -- it
  // has to match between the server-rendered HTML and the client's first
  // render, or React flags a hydration mismatch. Rows added later via "+
  // Add row" happen purely client-side after mount, so those are free to
  // use a real random id.
  const [rowIds, setRowIds] = useState<string[]>(() => rows.map((_, i) => `row-${i}`));
  const [state, formAction, pending] = useActionState(bulkRegister, initial);

  const update = (i: number, key: keyof BulkRow, value: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setRowIds((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
    setRowIds((prev) => [...prev, crypto.randomUUID()]);
  };

  // Fill-copy writes straight into row state (real inputs, not display
  // text) — decode "rowId:colKey" back to an actual rows[] index via
  // rowIds, then call the same update() every onChange uses.
  const t = useTableInteractions({
    onFill: (value, targets) => {
      for (const target of targets) {
        const idx = rowIds.indexOf(target.row);
        if (idx === -1) continue;
        const col = COLUMNS.find((c) => c.key === target.col);
        if (!col?.value) continue;
        update(idx, target.col as keyof BulkRow, value);
      }
    },
  });

  if (state.done && state.results) {
    const okCount = state.results.filter((r) => r.ok).length;
    return (
      <div className="space-y-4">
        <div className={`rounded-lg border p-6 ${okCount > 0 ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
          <h2 className="text-lg font-bold">
            {okCount} of {state.results.length} participants registered
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Registered participants are <strong>pending payment</strong> — the organizer confirms
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

  const orderedColKeys = t.orderColumnKeys(COLUMNS.map((c) => c.key));
  const colByKey = new Map(COLUMNS.map((c) => [c.key, c]));
  const orderedColumns = orderedColKeys.map((k) => colByKey.get(k)).filter((c): c is ColDef => !!c);

  const entries: RowEntry[] = rows.map((row, index) => ({ id: rowIds[index], index, row }));
  const orderedEntryIds = t.orderRowKeys(entries.map((e) => e.id));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const orderedEntries = orderedEntryIds.map((id) => entryById.get(id)).filter((e): e is RowEntry => !!e);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="rows_json" value={JSON.stringify(rows)} />

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="table_competition_id" className="mb-1 block text-sm font-medium text-neutral-700">
            Competition tier *
          </label>
          <select
            id="table_competition_id"
            name="competition_id"
            required
            defaultValue={competitions.length === 1 ? competitions[0].id : ""}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="" disabled>Select the tier you paid for</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>{shortTierName(c.name)} — {formatUSD(c.registration_fee_usd)} per event</option>
            ))}
          </select>
        </div>
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

      <p className="mb-2 text-xs text-neutral-500">
        Note: for participants outside Malaysia, provide their IBAN, SWIFT code, BIC, BBAN, or ACH
        number in the International Bank Account No. (IBAN) column. If unsure, ask them to call their
        bank to check — this ensures smooth processing with no delay in receiving any reward.
        Click a column&apos;s label (or a row&apos;s No. cell) to select it and drag past a neighbor
        to reorder it. Click any field to select it, then drag its blue corner handle down or across
        to copy that value into the same field on other rows; right-click a field to copy its value
        to the clipboard.
      </p>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[2000px] text-left">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {orderedColumns.map((c) => (
                <th key={c.key} data-col-order-key={c.key} className={c.key === "no" ? "w-10 px-2 py-2" : c.key === "remove" ? "w-8 px-2 py-2" : "px-2 py-2"}>
                  <span
                    onPointerDown={t.getColHeaderDownHandler(c.key, () => {})}
                    title={c.label ? "Click to select — drag to reorder" : "Drag to reorder"}
                    className="block cursor-pointer select-none"
                  >
                    {c.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {orderedEntries.map((entry) => (
              <tr key={entry.id} data-row-order-key={entry.id} className="align-top">
                {orderedColumns.map((c) => {
                  const isSelectable = !!c.value;
                  const text = isSelectable ? c.value!(entry.row) : "";
                  const isCellSelected = isSelectable && t.isCellSelected(entry.id, c.key);
                  const isFillPreview = isSelectable && t.isFillPreview(entry.id, c.key);
                  return (
                    <td
                      key={c.key}
                      data-cell-row={entry.id}
                      data-cell-col={c.key}
                      onPointerDown={c.key === "no" ? t.getRowHandleDownHandler(entry.id, () => {}) : undefined}
                      onContextMenu={isSelectable ? t.getContextMenuHandler(text) : undefined}
                      className={`relative px-2 py-1.5 ${c.key === "no" ? "cursor-pointer select-none text-center" : ""} ${
                        isCellSelected ? "ring-2 ring-inset ring-blue-500" : ""
                      } ${isFillPreview ? "outline outline-2 -outline-offset-2 outline-blue-300" : ""}`}
                    >
                      <div onFocus={isSelectable ? () => t.selectCell(entry.id, c.key) : undefined}>
                        {c.render(entry, update, kataBases, removeRow)}
                      </div>
                      {isCellSelected && (
                        <span
                          onPointerDown={t.getFillHandleDownHandler(entry.id, c.key, text)}
                          title="Drag to copy this value into other rows"
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
      </div>
      <TableInteractionOverlays t={t} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addRow}
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
          certificate later. To register the same student for more than one tier, submit this
          table again with that other tier selected above and the student&apos;s row repeated —
          same IC/passport and details each time.
        </span>
      </div>
    </form>
  );
}
