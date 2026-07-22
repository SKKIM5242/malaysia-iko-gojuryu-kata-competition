"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls } from "@/lib/useGridControls";

export interface FilterableColumn {
  key: string;
  label: string;
  /** Default pixel width until the user drags to resize — overrides the
   * table's standard default for just this column (e.g. a wider start for
   * a free-text description column). */
  width?: number;
  /** Wrap long text onto multiple lines instead of truncating with an
   * ellipsis — for columns where the full text matters more than a
   * single-line row height. */
  wrap?: boolean;
}

/** A cell is either plain filterable text, or a pre-rendered React node
 * (e.g. a certificate link) built server-side — never a function. Server
 * Components can pass rendered nodes to Client Components like this one,
 * but never a callback/closure (RSC serialization forbids it). */
type CellValue = string | ReactNode;

const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTH = 150;

/** Generic per-column-filterable data table — same filter-box-per-column
 * pattern as the Participant Records table, reused for every other
 * registrant type (Referees, Audience, Schools, Senseis, Staff Accounts)
 * so each gets its own filterable list without duplicating the table UI.
 * Every column — including the sticky/pinned ones — can be dragged wider
 * or narrower from its right edge; widths reset on page reload (not
 * persisted). Click a column's label, or a row's leading cell, to
 * select/highlight it; a highlighted column/row can be hidden with the ×
 * that appears, and rows can be dragged taller/shorter from their bottom
 * edge the same way columns resize from their right edge. */
export default function FilterableTable({
  columns,
  rows,
  rowKey,
  downloadName,
  csvColumns,
  stickyColumns = 1,
  firstColumnWidth = 64,
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
  /** How many leading columns stay pinned during horizontal scroll (1 or 2).
   * With 2, the first column defaults to a narrow width so the second
   * column's sticky offset is known — meant for a narrow "No." column. Both
   * stay resizable like every other column. */
  stickyColumns?: 1 | 2;
  /** Default pixel width of column 0 when stickyColumns is 2 (until dragged). */
  firstColumnWidth?: number;
}) {
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

  const visibleColumns = useMemo(() => columns.filter((c) => !grid.hiddenCols.has(c.key)), [columns, grid.hiddenCols]);

  const widthOf = useCallback(
    (col: FilterableColumn, index: number): number => {
      if (colWidths[col.key] != null) return colWidths[col.key];
      if (col.width != null) return col.width;
      return stickyColumns === 2 && index === 0 ? firstColumnWidth : DEFAULT_COL_WIDTH;
    },
    [colWidths, stickyColumns, firstColumnWidth],
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
    (e: React.MouseEvent, col: FilterableColumn, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key: col.key, startX: e.clientX, startWidth: widthOf(col, index) };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [widthOf, handleMove, handleUp],
  );

  const stickyPosClass = (i: number) => (i < stickyColumns ? `sticky z-10 border-r border-neutral-200 ${i === 0 ? "left-0" : ""}` : "");
  const stickyLeftStyle = (i: number): CSSProperties | undefined => {
    if (stickyColumns < 2 || i !== 1) return undefined;
    return { left: widthOf(visibleColumns[0], 0) };
  };

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

  const displayedRows = useMemo(
    () => filtered.filter((row) => !grid.hiddenRows.has(String(row[rowKey]))),
    [filtered, grid.hiddenRows, rowKey],
  );

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
          Showing {filtered.length} of {rows.length}. Filters combine (AND). Drag a column's right
          edge to resize it, or click a header/row to select and hide it.
        </p>
        <DownloadCsvButton rows={csvRows} filename={downloadName} />
      </div>
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
        <table
          className="text-left text-sm"
          style={{ tableLayout: "fixed", width: visibleColumns.reduce((sum, c, i) => sum + widthOf(c, i), 0) }}
        >
          <colgroup>
            {visibleColumns.map((c, i) => (
              <col key={c.key} style={{ width: widthOf(c, i) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {visibleColumns.map((c, i) => {
                const selected = grid.selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`relative select-none px-3 py-2.5 whitespace-nowrap ${stickyPosClass(i)} ${
                      selected ? "bg-amber-100" : i < stickyColumns ? "bg-neutral-50" : ""
                    }`}
                    style={stickyLeftStyle(i)}
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
                      onMouseDown={(e) => handleResizeStart(e, c, i)}
                      title="Drag to resize this column"
                      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                    />
                  </th>
                );
              })}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {visibleColumns.map((c, i) => (
                <th
                  key={c.key}
                  className={`px-2 py-1.5 bg-white ${stickyPosClass(i)}`}
                  style={stickyLeftStyle(i)}
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
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              displayedRows.map((row) => {
                const key = String(row[rowKey]);
                const rowSelected = grid.selectedRows.has(key);
                const rowHeight = grid.rowHeights[key];
                return (
                  <tr
                    key={key}
                    className={`group hover:bg-neutral-50 ${rowSelected ? "bg-amber-50" : ""} ${grid.rowSizeClass(key)}`}
                    style={grid.rowSizeStyle(key)}
                  >
                    {visibleColumns.map((c, i) => {
                      const cell = row[c.key];
                      const isText = typeof cell === "string";
                      const textCls = c.wrap ? "whitespace-normal break-words" : "truncate";
                      const isHandle = i === 0;
                      const cellBg =
                        i < stickyColumns
                          ? rowSelected
                            ? "bg-amber-50"
                            : "bg-white group-hover:bg-neutral-50"
                          : "";
                      return (
                        <td
                          key={c.key}
                          className={`px-3 py-2 ${isText ? textCls : ""} ${stickyPosClass(i)} ${cellBg} ${
                            isHandle ? "relative cursor-pointer select-none" : ""
                          }`}
                          style={stickyLeftStyle(i)}
                          title={isHandle ? "Click to select/highlight this row" : isText && !c.wrap ? (cell as string) : undefined}
                          onClick={isHandle ? () => grid.toggleRowSelect(key) : undefined}
                        >
                          {isText ? cell || "—" : cell}
                          {isHandle && rowSelected && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                grid.hideRow(key);
                              }}
                              title="Hide this row"
                              className="absolute right-1 top-1/2 z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white hover:bg-red-700"
                            >
                              ×
                            </button>
                          )}
                          {isHandle && (
                            <span
                              onMouseDown={(e) => grid.handleRowResizeStart(e, key, rowHeight ?? 36)}
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
