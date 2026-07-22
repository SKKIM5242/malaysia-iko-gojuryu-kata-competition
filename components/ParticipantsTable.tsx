"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CategoryName } from "@/components/ui";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls, isClosed, CLOSED_SIZE } from "@/lib/useGridControls";

export interface ParticipantRow {
  id: string;
  no: number;
  name: string;
  tier: string | null;
  categoryName: string | null;
  division: string | null;
  belt: string | null;
  school: string | null;
  sensei: string | null;
}

const COLUMNS = [
  { key: "no", label: "#" },
  { key: "reference_id", label: "Reference ID" },
  { key: "name", label: "Name" },
  { key: "tier", label: "Competition Tier" },
  { key: "category", label: "Category" },
  { key: "division", label: "Division" },
  { key: "belt", label: "Belt" },
  { key: "school", label: "School" },
  { key: "sensei", label: "Sensei" },
] as const;

type FilterableKey = Exclude<(typeof COLUMNS)[number]["key"], "no" | "reference_id">;

function rawValue(r: ParticipantRow, key: FilterableKey): string {
  switch (key) {
    case "name": return r.name;
    case "tier": return r.tier ?? "";
    case "category": return r.categoryName ?? "";
    case "division": return r.division ?? "";
    case "belt": return r.belt ?? "";
    case "school": return r.school ?? "";
    case "sensei": return r.sensei ?? "";
  }
}

const DEFAULT_WIDTHS: Record<string, number> = {
  no: 56,
  reference_id: 110,
  name: 180,
  tier: 170,
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
 * filter since it's just a running row count). Click a column's label (or
 * a row's "#" cell) to select/highlight it. Drag a column's right edge
 * (or a row's bottom edge) to resize it, all the way down to a closed
 * solid-red bar — drag that bar back out, or use the "closed" note above
 * the table to reopen everything at once. */
export default function ParticipantsTable({ rows }: { rows: ParticipantRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

  const widthOf = useCallback(
    (key: string) => colWidths[key] ?? DEFAULT_WIDTHS[key] ?? 150,
    [colWidths],
  );

  const toggleColSelect = useCallback((key: string) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(CLOSED_SIZE, r.startWidth + (e.clientX - r.startX));
    setColWidths((prev) => {
      const updated = { ...prev, [r.key]: next };
      if (next <= CLOSED_SIZE + 1 && selectedCols.has(r.key) && selectedCols.size > 1) {
        for (const key of selectedCols) {
          if (key !== r.key) updated[key] = CLOSED_SIZE;
        }
      }
      return updated;
    });
  }, [selectedCols]);

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

  const resetClosedCols = useCallback(() => {
    setColWidths((prev) => {
      const next: Record<string, number> = {};
      for (const [key, w] of Object.entries(prev)) {
        if (!isClosed(w, w)) next[key] = w;
      }
      return next;
    });
  }, []);

  const closedColCount = useMemo(
    () => COLUMNS.filter((c) => isClosed(widthOf(c.key), widthOf(c.key))).length,
    [widthOf],
  );

  const uniqueValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of COLUMNS) {
      if (c.key === "no" || c.key === "reference_id") continue;
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

  function cellFor(c: (typeof COLUMNS)[number], r: ParticipantRow): { className: string; title?: string; content: React.ReactNode } {
    switch (c.key) {
      case "no":
        return { className: "text-neutral-400", content: r.no };
      case "reference_id":
        return { className: "font-mono text-xs", content: r.id.slice(0, 8).toUpperCase() };
      case "name":
        return { className: "font-medium text-neutral-900", content: r.name };
      case "tier":
        return { className: "", title: r.tier ?? undefined, content: r.tier ?? "—" };
      case "category":
        return { className: "", title: r.categoryName ?? undefined, content: <CategoryName name={r.categoryName ?? undefined} /> };
      case "division":
        return { className: "text-xs", content: r.division ?? "—" };
      case "belt":
        return { className: "", title: r.belt ?? undefined, content: r.belt ?? "—" };
      case "school":
        return { className: "", title: r.school ?? undefined, content: r.school ?? "—" };
      case "sensei":
        return { className: "", content: r.sensei ?? "—" };
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-400">
        Showing {filtered.length} of {rows.length}. Click a column's label (or a row's "#" cell) to
        select/highlight it. Drag a column's right edge (or a row's bottom edge) to resize it, all
        the way to close it down to a red bar.
      </p>
      {(closedColCount > 0 || grid.closedRowCount > 0) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          <span>
            {closedColCount > 0 && `${closedColCount} column${closedColCount === 1 ? "" : "s"} closed`}
            {closedColCount > 0 && grid.closedRowCount > 0 && " · "}
            {grid.closedRowCount > 0 && `${grid.closedRowCount} row${grid.closedRowCount === 1 ? "" : "s"} closed`}
          </span>
          <button
            type="button"
            onClick={() => {
              resetClosedCols();
              grid.resetClosedRows();
            }}
            title="Reopen every closed column and row"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white hover:bg-red-700"
          >
            ×
          </button>
        </div>
      )}
      <DualScrollBox>
        <table className="text-left text-sm" style={{ tableLayout: "fixed", width: totalWidth }}>
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {COLUMNS.map((c) => {
                const width = widthOf(c.key);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`relative select-none whitespace-nowrap ${closed ? "bg-red-600 p-0" : `px-4 py-3 ${selected ? "bg-sky-100" : ""}`}`}
                  >
                    {!closed && (
                      <span
                        onClick={() => toggleColSelect(c.key)}
                        title="Click to select/highlight this column"
                        className="block cursor-pointer overflow-hidden text-ellipsis pr-2"
                      >
                        {c.label}
                      </span>
                    )}
                    <span
                      onMouseDown={(e) => handleResizeStart(e, c.key)}
                      title={closed ? "Drag to reopen this column" : "Drag to resize (or close) this column"}
                      className={`absolute right-0 top-0 z-10 h-full cursor-col-resize touch-none select-none ${
                        closed ? "w-full bg-red-600 hover:bg-red-700" : "w-2 hover:bg-red-300 active:bg-red-500"
                      }`}
                    />
                  </th>
                );
              })}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {COLUMNS.map((c) => {
                const width = widthOf(c.key);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th key={c.key} className={closed ? "bg-red-600 p-0" : `px-2 py-1.5 ${selected ? "bg-sky-50" : ""}`}>
                    {!closed && c.key !== "no" && c.key !== "reference_id" && (
                      <ColumnFilterDropdown
                        values={uniqueValues[c.key] ?? []}
                        selected={filters[c.key] ?? new Set()}
                        onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                      />
                    )}
                  </th>
                );
              })}
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
              filtered.map((r) => {
                const rowHeight = grid.rowHeights[r.id];
                const rowClosed = rowHeight != null && rowHeight <= CLOSED_SIZE + 1;
                const rowSelected = grid.selectedRows.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`group hover:bg-neutral-50 ${!rowClosed && rowSelected ? "bg-sky-50" : ""} ${grid.rowSizeClass(r.id)}`}
                    style={grid.rowSizeStyle(r.id)}
                  >
                    {COLUMNS.map((c, i) => {
                      const width = widthOf(c.key);
                      const colClosed = isClosed(width, width);
                      const colSelected = selectedCols.has(c.key);
                      const closed = colClosed || rowClosed;
                      const isHandle = i === 0;
                      const { className, title, content } = cellFor(c, r);
                      const cellBg = colClosed ? "bg-red-600" : colSelected ? "bg-sky-50" : "";
                      return (
                        <td
                          key={c.key}
                          className={`${closed ? "p-0" : `truncate px-4 py-3 ${className}`} ${cellBg} ${
                            isHandle && !closed ? "relative cursor-pointer select-none" : isHandle ? "relative" : ""
                          }`}
                          title={isHandle && !closed ? "Click to select/highlight this row" : !closed ? title : undefined}
                          onClick={isHandle && !closed ? () => grid.toggleRowSelect(r.id) : undefined}
                        >
                          {!closed && content}
                          {isHandle && (
                            <span
                              onMouseDown={(e) => grid.handleRowResizeStart(e, r.id, rowHeight ?? 40)}
                              onClick={(e) => e.stopPropagation()}
                              title={rowClosed ? "Drag to reopen this row" : "Drag to resize (or close) this row"}
                              className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </DualScrollBox>
    </div>
  );
}
