"use client";

import { useMemo, useState, type ReactNode } from "react";

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
}: {
  columns: FilterableColumn[];
  rows: Array<Record<string, CellValue>>;
  rowKey: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v && v.trim() !== "");
    if (active.length === 0) return rows;
    return rows.filter((row) =>
      active.every(([key, value]) => {
        const cell = row[key];
        const text = typeof cell === "string" ? cell : "";
        return text.toLowerCase().includes(value.toLowerCase());
      }),
    );
  }, [rows, filters]);

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-400">
        Showing {filtered.length} of {rows.length}. Filters combine (AND).
      </p>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm" style={{ minWidth: `${columns.length * 150}px` }}>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-1.5">
                  <input
                    value={filters[c.key] ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                    placeholder="Filter…"
                    className="w-full min-w-[90px] rounded border border-neutral-300 px-1.5 py-1 text-xs font-normal focus:border-red-600 focus:outline-none"
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
                <tr key={String(row[rowKey])} className="hover:bg-neutral-50">
                  {columns.map((c) => {
                    const cell = row[c.key];
                    const isText = typeof cell === "string";
                    return (
                      <td
                        key={c.key}
                        className="max-w-[220px] truncate px-3 py-2"
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
      </div>
    </div>
  );
}
