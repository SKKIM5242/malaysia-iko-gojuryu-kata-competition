"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
   * single-line row height. Applies to both the header label and body
   * cells. */
  wrap?: boolean;
}

/** A cell is either plain filterable text, or a pre-rendered React node
 * (e.g. a certificate link) built server-side — never a function. Server
 * Components can pass rendered nodes to Client Components like this one,
 * but never a callback/closure (RSC serialization forbids it). */
type CellValue = string | ReactNode;

const DEFAULT_COL_WIDTH = 150;
/** Below this many pixels of pointer movement, a header/handle press is
 * still treated as a plain click (select/highlight) rather than a drag
 * (reorder) — keeps an ordinary tap from being misread as a drag. */
const DRAG_THRESHOLD = 6;

/** Generic per-column-filterable data table — same filter-box-per-column
 * pattern as the Participant Records table, reused for every other
 * registrant type (Referees, Audience, Schools, Senseis, Staff Accounts)
 * so each gets its own filterable list without duplicating the table UI.
 * Click a column's label, or a row's leading cell, to select/highlight
 * just that column/row (same blue in either direction) — click again to
 * deselect; select several columns (or rows) and dragging any one of them
 * closed takes the whole selected group down together. Drag a column's
 * right edge (or a row's bottom edge) to resize it, all the way down to a
 * closed solid-red bar; drag that bar back out to reopen, or use the
 * "closed" note above the table to reopen every closed column/row at
 * once.
 *
 * Beyond resizing, a column header (or a row's leading cell) can also be
 * dragged sideways/up-down past a neighbor to reorder it — order is
 * session-only state, same as widths/heights, and resets on reload.
 *
 * Any text cell can be clicked to select it (a small blue handle appears
 * at its corner); dragging that handle across other cells in the same row
 * or column copies its value into them, mouse-release applying instantly
 * and a touch-release instead asking via a small popup first, since touch
 * lacks the precision/hover feedback a mouse has. Right-clicking any text
 * cell copies its value straight to the clipboard. None of this writes
 * back to the database — it's a local, on-screen convenience only. */
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
  const [colOrder, setColOrder] = useState<string[] | null>(null);
  const [rowOrder, setRowOrder] = useState<string[] | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: string; col: string } | null>(null);
  const [fillOverrides, setFillOverrides] = useState<Record<string, string>>({});
  const [fillPreview, setFillPreview] = useState<Set<string> | null>(null);
  const [fillPopup, setFillPopup] = useState<{ x: number; y: number; value: string; targets: string[] } | null>(null);
  const [copyToast, setCopyToast] = useState<{ x: number; y: number } | null>(null);
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const colDragRef = useRef<{ key: string; startX: number; startY: number; moved: boolean } | null>(null);
  const rowDragRef = useRef<{ key: string; startX: number; startY: number; moved: boolean } | null>(null);
  const fillDragRef = useRef<{ row: string; col: string; value: string; axis: "row" | "col" | null } | null>(null);
  const grid = useGridControls();

  useEffect(() => {
    if (!copyToast) return;
    const t = setTimeout(() => setCopyToast(null), 1200);
    return () => clearTimeout(t);
  }, [copyToast]);

  const orderedColumns = useMemo(() => {
    if (!colOrder) return columns;
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const ordered: FilterableColumn[] = [];
    const seen = new Set<string>();
    for (const k of colOrder) {
      const c = byKey.get(k);
      if (c) {
        ordered.push(c);
        seen.add(k);
      }
    }
    for (const c of columns) if (!seen.has(c.key)) ordered.push(c);
    return ordered;
  }, [columns, colOrder]);

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

  // Pointer Events (not mouse-only) so dragging a column's resize handle
  // works with a mouse, a finger, or a stylus alike — see the matching
  // comment in lib/useGridControls.ts for why plain mouse events silently
  // don't work on touch devices.
  const handleMove = useCallback((e: PointerEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(CLOSED_SIZE, r.startWidth + (e.clientX - r.startX));
    setColWidths((prev) => {
      const updated = { ...prev, [r.key]: next };
      // Dragging one column of a multi-column selection closed takes every
      // other selected column down with it, same as the row equivalent.
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
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  }, [handleMove]);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, col: FilterableColumn, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key: col.key, startX: e.clientX, startWidth: widthOf(col, index) };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [widthOf, handleMove, handleUp],
  );

  // Column header drag-to-reorder — a short press-and-move past a
  // neighboring header swaps the two live; releasing without moving past
  // the threshold falls back to the original click-to-select behavior.
  const handleColHeaderMove = useCallback((e: PointerEvent) => {
    const d = colDragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
    d.moved = true;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const th = el?.closest<HTMLElement>("[data-col-order-key]");
    const overKey = th?.dataset.colOrderKey;
    if (!overKey || overKey === d.key) return;
    setColOrder((prev) => {
      const order = prev ?? columns.map((c) => c.key);
      const from = order.indexOf(d.key);
      if (from === -1) return prev;
      const next = order.slice();
      const [moved] = next.splice(from, 1);
      const insertAt = next.indexOf(overKey);
      if (insertAt === -1) return prev;
      next.splice(insertAt, 0, moved);
      return next;
    });
  }, [columns]);

  const handleColHeaderUp = useCallback(() => {
    window.removeEventListener("pointermove", handleColHeaderMove);
    window.removeEventListener("pointerup", handleColHeaderUp);
    const d = colDragRef.current;
    colDragRef.current = null;
    if (d && !d.moved) toggleColSelect(d.key);
  }, [handleColHeaderMove, toggleColSelect]);

  const handleColHeaderDown = useCallback(
    (e: React.PointerEvent, col: FilterableColumn) => {
      colDragRef.current = { key: col.key, startX: e.clientX, startY: e.clientY, moved: false };
      window.addEventListener("pointermove", handleColHeaderMove);
      window.addEventListener("pointerup", handleColHeaderUp);
    },
    [handleColHeaderMove, handleColHeaderUp],
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
    () => orderedColumns.filter((c, i) => isClosed(widthOf(c, i), widthOf(c, i))).length,
    [orderedColumns, widthOf],
  );

  const stickyPosClass = (i: number) => (i < stickyColumns ? `sticky z-10 border-r border-neutral-200 ${i === 0 ? "left-0" : ""}` : "");
  const stickyLeftStyle = (i: number): CSSProperties | undefined => {
    if (stickyColumns < 2 || i !== 1) return undefined;
    return { left: widthOf(orderedColumns[0], 0) };
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

  const orderedRows = useMemo(() => {
    if (!rowOrder) return filtered;
    const byKey = new Map(filtered.map((r) => [String(r[rowKey]), r]));
    const ordered: Array<Record<string, CellValue>> = [];
    const seen = new Set<string>();
    for (const k of rowOrder) {
      const r = byKey.get(k);
      if (r) {
        ordered.push(r);
        seen.add(k);
      }
    }
    for (const r of filtered) {
      const k = String(r[rowKey]);
      if (!seen.has(k)) ordered.push(r);
    }
    return ordered;
  }, [filtered, rowOrder, rowKey]);

  // Row leading-cell drag-to-reorder — same press-and-move-past-threshold
  // pattern as the column header, falling back to row select/highlight on
  // a plain click. The resize strip at the row's bottom edge stops this
  // from firing (it stops its own pointerdown from bubbling here).
  const handleRowHandleMove = useCallback((e: PointerEvent) => {
    const d = rowDragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
    d.moved = true;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const tr = el?.closest<HTMLElement>("[data-row-order-key]");
    const overKey = tr?.dataset.rowOrderKey;
    if (!overKey || overKey === d.key) return;
    setRowOrder((prev) => {
      const order = prev ?? orderedRows.map((r) => String(r[rowKey]));
      const from = order.indexOf(d.key);
      if (from === -1) return prev;
      const next = order.slice();
      const [moved] = next.splice(from, 1);
      const insertAt = next.indexOf(overKey);
      if (insertAt === -1) return prev;
      next.splice(insertAt, 0, moved);
      return next;
    });
  }, [orderedRows, rowKey]);

  const handleRowHandleUp = useCallback(() => {
    window.removeEventListener("pointermove", handleRowHandleMove);
    window.removeEventListener("pointerup", handleRowHandleUp);
    const d = rowDragRef.current;
    rowDragRef.current = null;
    if (d && !d.moved) grid.toggleRowSelect(d.key);
  }, [handleRowHandleMove, grid]);

  const handleRowHandleDown = useCallback(
    (e: React.PointerEvent, key: string) => {
      rowDragRef.current = { key, startX: e.clientX, startY: e.clientY, moved: false };
      window.addEventListener("pointermove", handleRowHandleMove);
      window.addEventListener("pointerup", handleRowHandleUp);
    },
    [handleRowHandleMove, handleRowHandleUp],
  );

  // Fill-handle drag (Excel-style): press the small handle on a selected
  // cell, drag across other cells in the same row or column — whichever
  // direction the drag first commits to — and release to copy the source
  // cell's value into every cell passed over. Purely a local display
  // override (`fillOverrides`), never written back to the database.
  const applyFill = useCallback((value: string, targets: string[]) => {
    setFillOverrides((prev) => {
      const next = { ...prev };
      for (const t of targets) next[t] = value;
      return next;
    });
  }, []);

  const handleFillMove = useCallback((e: PointerEvent) => {
    const f = fillDragRef.current;
    if (!f) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const td = el?.closest<HTMLElement>("[data-cell-row][data-cell-col]");
    if (!td) return;
    const targetRow = td.dataset.cellRow!;
    const targetCol = td.dataset.cellCol!;
    let axis = f.axis;
    if (!axis) {
      if (targetRow === f.row && targetCol !== f.col) axis = "row";
      else if (targetCol === f.col && targetRow !== f.row) axis = "col";
    }
    if (!axis) return;
    fillDragRef.current = { ...f, axis };
    const colKeys = orderedColumns.map((c) => c.key);
    const rowKeys = orderedRows.map((r) => String(r[rowKey]));
    const preview = new Set<string>();
    if (axis === "row") {
      const i0 = colKeys.indexOf(f.col);
      const i1 = colKeys.indexOf(targetCol);
      if (i0 !== -1 && i1 !== -1) {
        const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
        for (let i = lo; i <= hi; i++) preview.add(`${f.row}:${colKeys[i]}`);
      }
    } else {
      const i0 = rowKeys.indexOf(f.row);
      const i1 = rowKeys.indexOf(targetRow);
      if (i0 !== -1 && i1 !== -1) {
        const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
        for (let i = lo; i <= hi; i++) preview.add(`${rowKeys[i]}:${f.col}`);
      }
    }
    setFillPreview(preview);
  }, [orderedColumns, orderedRows, rowKey]);

  const handleFillUp = useCallback((e: PointerEvent) => {
    window.removeEventListener("pointermove", handleFillMove);
    window.removeEventListener("pointerup", handleFillUp);
    const f = fillDragRef.current;
    fillDragRef.current = null;
    setFillPreview((preview) => {
      if (f && preview && preview.size > 1) {
        const targets = [...preview].filter((k) => k !== `${f.row}:${f.col}`);
        if (targets.length > 0) {
          if (e.pointerType === "touch") {
            setFillPopup({ x: e.clientX, y: e.clientY, value: f.value, targets });
          } else {
            applyFill(f.value, targets);
          }
        }
      }
      return null;
    });
  }, [handleFillMove, applyFill]);

  const handleFillDown = useCallback(
    (e: React.PointerEvent, row: string, col: string, value: string) => {
      e.preventDefault();
      e.stopPropagation();
      fillDragRef.current = { row, col, value, axis: null };
      window.addEventListener("pointermove", handleFillMove);
      window.addEventListener("pointerup", handleFillUp);
    },
    [handleFillMove, handleFillUp],
  );

  const handleCellContextMenu = useCallback((e: React.MouseEvent, text: string) => {
    e.preventDefault();
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopyToast({ x: e.clientX, y: e.clientY });
  }, []);

  const csvRows = useMemo(
    () =>
      orderedRows.map((row) => {
        const out: Record<string, string> = {};
        for (const c of csvColumns ?? columns) {
          const cell = row[c.key];
          if (typeof cell === "string") out[c.label] = cell;
        }
        return out;
      }),
    [orderedRows, columns, csvColumns],
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Showing {filtered.length} of {rows.length}. Filters combine (AND). Click a column's label
          (or a row's leading cell) to select/highlight it — drag either one past a neighbor to
          reorder it. Drag a column's right edge (or a row's bottom edge) to resize it, all the way
          to close it down to a red bar. Click a cell to select it, then drag its blue corner handle
          across other cells to copy its value into them; right-click any cell to copy its value to
          the clipboard.
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
          style={{ tableLayout: "fixed", width: orderedColumns.reduce((sum, c, i) => sum + widthOf(c, i), 0) }}
        >
          <colgroup>
            {orderedColumns.map((c, i) => (
              <col key={c.key} style={{ width: widthOf(c, i) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {orderedColumns.map((c, i) => {
                const width = widthOf(c, i);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    data-col-order-key={c.key}
                    className={`relative select-none whitespace-nowrap ${stickyPosClass(i)} ${
                      closed
                        ? "bg-red-600 p-0"
                        : `px-3 py-2.5 ${selected ? "bg-sky-100" : i < stickyColumns ? "bg-neutral-50" : ""}`
                    }`}
                    style={stickyLeftStyle(i)}
                  >
                    {!closed && (
                      <span
                        onPointerDown={(e) => handleColHeaderDown(e, c)}
                        title="Click to select/highlight this column — drag to reorder"
                        className={`block cursor-pointer pr-2 ${
                          c.wrap ? "whitespace-normal break-words" : "overflow-hidden text-ellipsis"
                        }`}
                      >
                        {c.label}
                      </span>
                    )}
                    <span
                      onPointerDown={(e) => handleResizeStart(e, c, i)}
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
              {orderedColumns.map((c, i) => {
                const width = widthOf(c, i);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`${closed ? "bg-red-600 p-0" : `px-2 py-1.5 ${selected ? "bg-sky-50" : ""}`} ${stickyPosClass(i)}`}
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
            {orderedRows.length === 0 ? (
              <tr>
                <td colSpan={orderedColumns.length} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              orderedRows.map((row) => {
                const key = String(row[rowKey]);
                const rowHeight = grid.rowHeights[key];
                const rowClosed = rowHeight != null && rowHeight <= CLOSED_SIZE + 1;
                const rowSelected = grid.selectedRows.has(key);
                return (
                  <tr
                    key={key}
                    id={`row-${key}`}
                    data-row-order-key={key}
                    className={`group hover:bg-neutral-50 ${!rowClosed && rowSelected ? "bg-sky-50" : ""} ${grid.rowSizeClass(key)}`}
                    style={grid.rowSizeStyle(key)}
                  >
                    {orderedColumns.map((c, i) => {
                      const width = widthOf(c, i);
                      const colClosed = isClosed(width, width);
                      const colSelected = selectedCols.has(c.key);
                      const cell = row[c.key];
                      const isText = typeof cell === "string";
                      const cellKey = `${key}:${c.key}`;
                      const displayCell = isText ? (fillOverrides[cellKey] ?? cell) : cell;
                      const textCls = c.wrap ? "whitespace-normal break-words" : "truncate";
                      const isHandle = i === 0;
                      const closed = colClosed || rowClosed;
                      const highlighted = colSelected || rowSelected;
                      const isCellSelected = selectedCell?.row === key && selectedCell?.col === c.key;
                      const isFillPreview = fillPreview?.has(cellKey) ?? false;
                      const cellBg = colClosed
                        ? "bg-red-600"
                        : highlighted
                          ? "bg-sky-50"
                          : i < stickyColumns
                            ? "bg-white group-hover:bg-neutral-50"
                            : "";
                      return (
                        <td
                          key={c.key}
                          data-cell-row={key}
                          data-cell-col={c.key}
                          className={`${closed ? "p-0" : `px-3 py-2 ${isText ? textCls : ""}`} ${stickyPosClass(i)} ${cellBg} ${
                            isHandle && !closed ? "relative cursor-pointer select-none" : "relative"
                          } ${!closed && isCellSelected ? "ring-2 ring-inset ring-blue-500" : ""} ${
                            !closed && isFillPreview ? "outline outline-2 -outline-offset-2 outline-blue-300" : ""
                          }`}
                          style={stickyLeftStyle(i)}
                          title={
                            isHandle && !closed
                              ? "Click to select/highlight this row — drag to reorder"
                              : !closed && isText && !c.wrap
                                ? String(displayCell)
                                : undefined
                          }
                          onClick={
                            !isHandle && !closed && isText ? () => setSelectedCell({ row: key, col: c.key }) : undefined
                          }
                          onContextMenu={
                            !closed && isText ? (e) => handleCellContextMenu(e, String(displayCell)) : undefined
                          }
                          onPointerDown={isHandle && !closed ? (e) => handleRowHandleDown(e, key) : undefined}
                        >
                          {!closed && (isText ? displayCell || "—" : displayCell)}
                          {isHandle && (
                            <span
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                grid.handleRowResizeStart(e, key, rowHeight ?? 36);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              title={rowClosed ? "Drag to reopen this row" : "Drag to resize (or close) this row"}
                              className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                            />
                          )}
                          {!isHandle && !closed && isCellSelected && (
                            <span
                              onPointerDown={(e) => handleFillDown(e, key, c.key, String(displayCell))}
                              title="Drag to copy this value into other cells"
                              className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-crosshair rounded-sm border border-white bg-blue-600"
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
      {fillPopup && (
        <div className="fixed inset-0 z-50" onClick={() => setFillPopup(null)}>
          <div
            className="absolute w-56 rounded-md border border-neutral-300 bg-white p-3 shadow-xl"
            style={{
              left: Math.min(fillPopup.x, (typeof window !== "undefined" ? window.innerWidth : 400) - 230),
              top: Math.min(fillPopup.y, (typeof window !== "undefined" ? window.innerHeight : 400) - 110),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-neutral-600">
              Copy &quot;{fillPopup.value}&quot; to {fillPopup.targets.length} cell{fillPopup.targets.length === 1 ? "" : "s"}?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  applyFill(fillPopup.value, fillPopup.targets);
                  setFillPopup(null);
                }}
                className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setFillPopup(null)}
                className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {copyToast && (
        <div
          className="pointer-events-none fixed z-50 rounded bg-neutral-900 px-2 py-1 text-xs font-semibold text-white shadow-lg"
          style={{ left: copyToast.x + 8, top: copyToast.y + 8 }}
        >
          Copied
        </div>
      )}
    </div>
  );
}
