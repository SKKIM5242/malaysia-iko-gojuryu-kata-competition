"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls, isClosed, CLOSED_SIZE } from "@/lib/useGridControls";

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

const DEFAULT_COL_WIDTH = 150;

/** Generic per-column-filterable data table — same filter-box-per-column
 * pattern as the Participant Records table, reused for every other
 * registrant type (Referees, Audience, Schools, Senseis, Staff Accounts)
 * so each gets its own filterable list without duplicating the table UI.
 * Click a column's label, or a row's leading cell, to select/highlight
 * just that column/row (amber for a column, sky for a row) — click again
 * to deselect. Drag a column's right edge (or a row's bottom edge) to
 * resize it, all the way down to a closed solid-red bar; drag that bar
 * back out to reopen, or use the "closed" note above the table to reopen
 * every closed column/row at once. */
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
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

  const widthOf = useCallback(
    (col: FilterableColumn, index: number): number => {
      if (colWidths[col.key] != null) return colWidths[col.key];
      if (col.width != null) return col.width;
      return stickyColumns === 2 && index === 0 ? firstColumnWidth : DEFAULT_COL_WIDTH;
    },
    [colWidths, stickyColumns, firstColumnWidth],
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
    () => columns.filter((c, i) => isClosed(widthOf(c, i), widthOf(c, i))).length,
    [columns, widthOf],
  );

  const stickyPosClass = (i: number) => (i < stickyColumns ? `sticky z-10 border-r border-neutral-200 ${i === 0 ? "left-0" : ""}` : "");
  const stickyLeftStyle = (i: number): CSSProperties | undefined => {
    if (stickyColumns < 2 || i !== 1) return undefined;
    return { left: widthOf(columns[0], 0) };
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
          Showing {filtered.length} of {rows.length}. Filters combine (AND). Click a column's label
          (or a row's leading cell) to select/highlight it. Drag a column's right edge (or a row's
          bottom edge) to resize it, all the way to close it down to a red bar.
        </p>
        <DownloadCsvButton rows={csvRows} filename={downloadName} />
      </div>
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
        <table
          className="text-left text-sm"
          style={{ tableLayout: "fixed", width: columns.reduce((sum, c, i) => sum + widthOf(c, i), 0) }}
        >
          <colgroup>
            {columns.map((c, i) => (
              <col key={c.key} style={{ width: widthOf(c, i) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {columns.map((c, i) => {
                const width = widthOf(c, i);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`relative select-none whitespace-nowrap ${stickyPosClass(i)} ${
                      closed
                        ? "bg-red-600 p-0"
                        : `px-3 py-2.5 ${selected ? "bg-amber-100" : i < stickyColumns ? "bg-neutral-50" : ""}`
                    }`}
                    style={stickyLeftStyle(i)}
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
                      onMouseDown={(e) => handleResizeStart(e, c, i)}
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
              {columns.map((c, i) => {
                const width = widthOf(c, i);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`${closed ? "bg-red-600 p-0" : `px-2 py-1.5 ${selected ? "bg-amber-50" : ""}`} ${stickyPosClass(i)}`}
                    style={stickyLeftStyle(i)}
                  >
                    {!closed && (
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
                <td colSpan={columns.length} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const key = String(row[rowKey]);
                const rowHeight = grid.rowHeights[key];
                const rowClosed = rowHeight != null && rowHeight <= CLOSED_SIZE + 1;
                const rowSelected = grid.selectedRows.has(key);
                return (
                  <tr
                    key={key}
                    className={`group hover:bg-neutral-50 ${!rowClosed && rowSelected ? "bg-sky-50" : ""} ${grid.rowSizeClass(key)}`}
                    style={grid.rowSizeStyle(key)}
                  >
                    {columns.map((c, i) => {
                      const width = widthOf(c, i);
                      const colClosed = isClosed(width, width);
                      const colSelected = selectedCols.has(c.key);
                      const cell = row[c.key];
                      const isText = typeof cell === "string";
                      const textCls = c.wrap ? "whitespace-normal break-words" : "truncate";
                      const isHandle = i === 0;
                      const closed = colClosed || rowClosed;
                      const cellBg = colClosed
                        ? "bg-red-600"
                        : colSelected
                          ? "bg-amber-100"
                          : rowSelected
                            ? i < stickyColumns
                              ? "bg-sky-50"
                              : ""
                            : i < stickyColumns
                              ? "bg-white group-hover:bg-neutral-50"
                              : "";
                      return (
                        <td
                          key={c.key}
                          className={`${closed ? "p-0" : `px-3 py-2 ${isText ? textCls : ""}`} ${stickyPosClass(i)} ${cellBg} ${
                            isHandle && !closed ? "relative cursor-pointer select-none" : isHandle ? "relative" : ""
                          }`}
                          style={stickyLeftStyle(i)}
                          title={
                            isHandle && !closed
                              ? "Click to select/highlight this row"
                              : !closed && isText && !c.wrap
                                ? cell
                                : undefined
                          }
                          onClick={isHandle && !closed ? () => grid.toggleRowSelect(key) : undefined}
                        >
                          {!closed && (isText ? cell || "—" : cell)}
                          {isHandle && (
                            <span
                              onMouseDown={(e) => grid.handleRowResizeStart(e, key, rowHeight ?? 36)}
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
