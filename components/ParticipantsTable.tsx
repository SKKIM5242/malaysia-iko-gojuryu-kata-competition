"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CategoryName } from "@/components/ui";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";

export interface ParticipantRow {
  id: string;
  no: number;
  name: string;
  categoryName: string | null;
  division: string | null;
  belt: string | null;
  school: string | null;
  sensei: string | null;
}

const COLUMNS = [
  { key: "no", label: "#" },
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "division", label: "Division" },
  { key: "belt", label: "Belt" },
  { key: "school", label: "School" },
  { key: "sensei", label: "Sensei" },
] as const;

type FilterableKey = Exclude<(typeof COLUMNS)[number]["key"], "no">;

function rawValue(r: ParticipantRow, key: FilterableKey): string {
  switch (key) {
    case "name": return r.name;
    case "category": return r.categoryName ?? "";
    case "division": return r.division ?? "";
    case "belt": return r.belt ?? "";
    case "school": return r.school ?? "";
    case "sensei": return r.sensei ?? "";
  }
}

const MIN_COL_WIDTH = 50;
const DEFAULT_WIDTHS: Record<string, number> = {
  no: 56,
  name: 180,
  category: 220,
  division: 100,
  belt: 120,
  school: 200,
  sensei: 160,
};

/** Same drag-to-resize mechanic as the admin FilterableTable, plus a
 * top+bottom synced scrollbar (DualScrollBox) and per-column header
 * filters (ColumnFilterDropdown) — scaled down for this public,
 * read-only, server-paginated list (no CSV export here, and no "#" column
 * filter since it's just a running row count). Widths and filters reset
 * on reload, not persisted. */
export default function ParticipantsTable({ rows }: { rows: ParticipantRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const widthOf = useCallback(
    (key: string) => colWidths[key] ?? DEFAULT_WIDTHS[key] ?? 150,
    [colWidths],
  );

  const handleMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(MIN_COL_WIDTH, r.startWidth + (e.clientX - r.startX));
    setColWidths((prev) => ({ ...prev, [r.key]: next }));
  }, []);

  const handleUp = useCallback(() => {
    resizingRef.current = null;
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleUp);
  }, [handleMove]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, key: string) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key, startX: e.clientX, startWidth: widthOf(key) };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [widthOf, handleMove, handleUp],
  );

  const uniqueValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of COLUMNS) {
      if (c.key === "no") continue;
      const seen = new Set<string>();
      const values: string[] = [];
      for (const r of rows) {
        const v = rawValue(r, c.key as FilterableKey);
        if (!seen.has(v)) {
          seen.add(v);
          values.push(v);
        }
      }
      map[c.key] = values;
    }
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v && v.size > 0);
    if (active.length === 0) return rows;
    return rows.filter((r) => active.every(([key, values]) => values.has(rawValue(r, key as FilterableKey))));
  }, [rows, filters]);

  const totalWidth = COLUMNS.reduce((sum, c) => sum + widthOf(c.key), 0);

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-400">
        Showing {filtered.length} of {rows.length}. Drag a column's right edge to resize it.
      </p>
      <DualScrollBox>
        <table className="text-left text-sm" style={{ tableLayout: "fixed", width: totalWidth }}>
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="relative select-none px-4 py-3">
                  <span className="block overflow-hidden text-ellipsis pr-2">{c.label}</span>
                  <span
                    onMouseDown={(e) => handleResizeStart(e, c.key)}
                    title="Drag to resize this column"
                    className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                  />
                </th>
              ))}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-1.5">
                  {c.key !== "no" && (
                    <ColumnFilterDropdown
                      values={uniqueValues[c.key] ?? []}
                      selected={filters[c.key] ?? new Set()}
                      onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50">
                  <td className="truncate px-4 py-3 text-neutral-400">{r.no}</td>
                  <td className="truncate px-4 py-3 font-medium text-neutral-900">{r.name}</td>
                  <td className="truncate px-4 py-3" title={r.categoryName ?? undefined}>
                    <CategoryName name={r.categoryName ?? undefined} />
                  </td>
                  <td className="truncate px-4 py-3 text-xs">{r.division ?? "—"}</td>
                  <td className="truncate px-4 py-3" title={r.belt ?? undefined}>{r.belt ?? "—"}</td>
                  <td className="truncate px-4 py-3" title={r.school ?? undefined}>{r.school ?? "—"}</td>
                  <td className="truncate px-4 py-3">{r.sensei ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DualScrollBox>
    </div>
  );
}
