"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CategoryName } from "@/components/ui";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls } from "@/lib/useGridControls";

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

const MIN_COL_WIDTH = 50;
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
 * filter since it's just a running row count). Widths and filters reset
 * on reload, not persisted. Click a column header or a row's "#" cell to
 * select/highlight it; a highlighted column/row can be hidden with the ×
 * that appears, and rows resize taller/shorter from their bottom edge the
 * same way columns resize from their right edge. */
export default function ParticipantsTable({ rows }: { rows: ParticipantRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

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

  const visibleColumns = useMemo(() => COLUMNS.filter((c) => !grid.hiddenCols.has(c.key)), [grid.hiddenCols]);

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

  const displayedRows = useMemo(
    () => filtered.filter((r) => !grid.hiddenRows.has(r.id)),
    [filtered, grid.hiddenRows],
  );

  const totalWidth = visibleColumns.reduce((sum, c) => sum + widthOf(c.key), 0);

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-400">
        Showing {filtered.length} of {rows.length}. Drag a column's right edge to resize it, or
        click a header/row to select and hide it.
      </p>
      {(grid.hiddenCols.size > 0 || grid.hiddenRows.size > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          {grid.hiddenCols.size > 0 && (
            <span>
              {grid.hiddenCols.size} column{grid.hiddenCols.size === 1 ? "" : "s"} hidden —{" "}
              <button type="button" onClick={grid.showAllCols} className="font-semibold underline underline-offset-2">
                show all
              </button>
            </span>
          )}
          {grid.hiddenRows.size > 0 && (
            <span>
              {grid.hiddenRows.size} row{grid.hiddenRows.size === 1 ? "" : "s"} hidden —{" "}
              <button type="button" onClick={grid.showAllRows} className="font-semibold underline underline-offset-2">
                show all
              </button>
            </span>
          )}
        </div>
      )}
      <DualScrollBox>
        <table className="text-left text-sm" style={{ tableLayout: "fixed", width: totalWidth }}>
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {visibleColumns.map((c) => {
                const selected = grid.selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`relative select-none px-4 py-3 ${selected ? "bg-amber-100" : ""}`}
                  >
                    <span
                      onClick={() => grid.toggleColSelect(c.key)}
                      title="Click to select/highlight this column"
                      className="block cursor-pointer overflow-hidden text-ellipsis pr-4"
                    >
                      {c.label}
                    </span>
                    {selected && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          grid.hideCol(c.key);
                        }}
                        title="Hide this column"
                        className="absolute right-2.5 top-1/2 z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white hover:bg-red-700"
                      >
                        ×
                      </button>
                    )}
                    <span
                      onMouseDown={(e) => handleResizeStart(e, c.key)}
                      title="Drag to resize this column"
                      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                    />
                  </th>
                );
              })}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {visibleColumns.map((c) => (
                <th key={c.key} className="px-2 py-1.5">
                  {c.key !== "no" && c.key !== "reference_id" && (
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
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              displayedRows.map((r) => {
                const rowSelected = grid.selectedRows.has(r.id);
                const rowHeight = grid.rowHeights[r.id];
                return (
                  <tr
                    key={r.id}
                    className={`group hover:bg-neutral-50 ${rowSelected ? "bg-amber-50" : ""} ${grid.rowSizeClass(r.id)}`}
                    style={grid.rowSizeStyle(r.id)}
                  >
                    {visibleColumns.map((c, i) => {
                      const isHandle = i === 0;
                      let cellClass = "truncate px-4 py-3";
                      let cellTitle: string | undefined;
                      let content: React.ReactNode;
                      switch (c.key) {
                        case "no":
                          cellClass += " text-neutral-400";
                          content = r.no;
                          break;
                        case "reference_id":
                          cellClass += " font-mono text-xs";
                          content = r.id.slice(0, 8).toUpperCase();
                          break;
                        case "name":
                          cellClass += " font-medium text-neutral-900";
                          content = r.name;
                          break;
                        case "tier":
                          cellTitle = r.tier ?? undefined;
                          content = r.tier ?? "—";
                          break;
                        case "category":
                          cellTitle = r.categoryName ?? undefined;
                          content = <CategoryName name={r.categoryName ?? undefined} />;
                          break;
                        case "division":
                          cellClass += " text-xs";
                          content = r.division ?? "—";
                          break;
                        case "belt":
                          cellTitle = r.belt ?? undefined;
                          content = r.belt ?? "—";
                          break;
                        case "school":
                          cellTitle = r.school ?? undefined;
                          content = r.school ?? "—";
                          break;
                        case "sensei":
                          content = r.sensei ?? "—";
                          break;
                      }
                      return (
                        <td
                          key={c.key}
                          className={`${cellClass} ${isHandle ? "relative cursor-pointer select-none" : ""}`}
                          title={isHandle ? "Click to select/highlight this row" : cellTitle}
                          onClick={isHandle ? () => grid.toggleRowSelect(r.id) : undefined}
                        >
                          {content}
                          {isHandle && rowSelected && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                grid.hideRow(r.id);
                              }}
                              title="Hide this row"
                              className="absolute right-1 top-1/2 z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white hover:bg-red-700"
                            >
                              ×
                            </button>
                          )}
                          {isHandle && (
                            <span
                              onMouseDown={(e) => grid.handleRowResizeStart(e, r.id, rowHeight ?? 40)}
                              title="Drag to resize this row"
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
