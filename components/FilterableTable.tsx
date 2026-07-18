"use client";

import { useMemo, useState, type ReactNode } from "react";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";

export interface FilterableColumn {
  key: string;
  label: string;
}

/** A cell is either plain filterable text, or a pre-rendered React node
 * (e.g. a certificate link) built server-side — never a function. Server
 * Components can pass rendered nodes to Client Components like this one,
 * but never a callback/closure (RSC serialization forbids it). */
type CellValue = string | ReactNode;

/** Generic per-column-filterable data table — same filter-box-per-column
 * pattern as the Participant Records table, reused for every other
 * registrant type (Referees, Audience, Schools, Senseis, Staff Accounts)
 * so each gets its own filterable list without duplicating the table UI. */
export default function FilterableTable({
  columns,
  rows,
  rowKey,
  downloadName,
  csvColumns,
}: {
  columns: FilterableColumn[];
  rows: Array<Record<string, CellValue>>;
  rowKey: string;
  /** Filename (without extension) for the CSV download button. */
  downloadName: string;
  /** Overrides `columns` for the CSV export only — lets the on-screen table
   * keep merged, human-readable columns (e.g. "Contact") while the
   * downloaded CSV gets each underlying field (Email, Phone) in its own
   * column, since spreadsheet users need to sort/filter/text-to-columns on
   * a single value per cell. Callers must include the raw field values as
   * extra keys on each row alongside the display keys `columns` reads. */
  csvColumns?: FilterableColumn[];
}) {
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});

  const uniqueValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of columns) {
      const seen = new Set<string>();
      const values: string[] = [];
      for (const row of rows) {
        const cell = row[c.key];
        if (typeof cell !== "string") continue;
        if (!seen.has(cell)) {
          seen.add(cell);
          values.push(cell);
        }
      }
      map[c.key] = values;
    }
    return map;
  }, [rows, columns]);

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v && v.size > 0);
    if (active.length === 0) return rows;
    return rows.filter((row) =>
      active.every(([key, values]) => {
        const cell = row[key];
        const text = typeof cell === "string" ? cell : "";
        return values.has(text);
      }),
    );
  }, [rows, filters]);

  const csvRows = useMemo(
    () =>
      filtered.map((row) => {
        const out: Record<string, string> = {};
        for (const c of csvColumns ?? columns) {
          const cell = row[c.key];
          if (typeof cell === "string") out[c.label] = cell;
        }
        return out;
      }),
    [filtered, columns, csvColumns],
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Showing {filtered.length} of {rows.length}. Filters combine (AND).
        </p>
        <DownloadCsvButton rows={csvRows} filename={downloadName} />
      </div>
      <DualScrollBox>
        <table className="w-full text-left text-sm" style={{ minWidth: `${columns.length * 150}px` }}>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  className={`px-3 py-2.5 whitespace-nowrap ${
                    i === 0 ? "sticky left-0 z-10 border-r border-neutral-200 bg-neutral-50" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  className={`px-2 py-1.5 ${i === 0 ? "sticky left-0 z-10 border-r border-neutral-200 bg-white" : ""}`}
                >
                  <ColumnFilterDropdown
                    values={uniqueValues[c.key] ?? []}
                    selected={filters[c.key] ?? new Set()}
                    onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={String(row[rowKey])} className="group hover:bg-neutral-50">
                  {columns.map((c, i) => {
                    const cell = row[c.key];
                    const isText = typeof cell === "string";
                    return (
                      <td
                        key={c.key}
                        className={`max-w-[220px] truncate px-3 py-2 ${
                          i === 0
                            ? "sticky left-0 z-10 border-r border-neutral-200 bg-white group-hover:bg-neutral-50"
                            : ""
                        }`}
                        title={isText ? cell : undefined}
                      >
                        {isText ? cell || "—" : cell}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DualScrollBox>
    </div>
  );
}
