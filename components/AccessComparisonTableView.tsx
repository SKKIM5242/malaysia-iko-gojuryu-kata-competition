"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls, isClosed, CLOSED_SIZE } from "@/lib/useGridControls";
import { useTableInteractions } from "@/lib/useTableInteractions";
import TableInteractionOverlays from "@/components/TableInteractionOverlays";
import type { ComparisonRow } from "@/components/AccessComparisonTable";

const COLUMNS: Array<{ key: string; label: string; width: number }> = [
  { key: "what", label: "Access", width: 160 },
  { key: "participant", label: "Participant", width: 260 },
  { key: "school", label: "School / Dojo", width: 260 },
  { key: "sensei", label: "Sensei / Coach", width: 260 },
  { key: "referee", label: "Judge", width: 260 },
  { key: "audience", label: "Audience", width: 260 },
  { key: "organizer", label: "Organizer", width: 260 },
  { key: "support", label: "Participant Support", width: 260 },
];

/** The interactive shell around the Access Comparison table's data —
 * split out from the server component that fetches `rows` because column
 * resize needs client-side state. Every cell wraps its full prose text
 * (never truncates); the header row and the "Access" label column stay
 * pinned while the rest scrolls. Click a column's label (or a row's
 * "Access" cell) to select/highlight just that column/row. Drag a
 * column's right edge (or a row's bottom edge) to resize it, all the way
 * down to a closed solid-red bar — drag that bar back out to reopen, or
 * use the "closed" note above the table to reopen everything at once. */
export default function AccessComparisonTableView({ rows }: { rows: ComparisonRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();
  const t = useTableInteractions();

  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);

  const toggleColSelect = useCallback((key: string) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Pointer Events (not mouse-only) so dragging a column's resize handle
  // works with a mouse, a finger, or a stylus alike — plain mouse events
  // silently don't fire during a touch drag on mobile/tablet.
  const handleMove = useCallback((e: PointerEvent) => {
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
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  }, [handleMove]);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, key: string, fallback: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key, startX: e.clientX, startWidth: widthOf(key, fallback) };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
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
    () => COLUMNS.filter((c) => isClosed(widthOf(c.key, c.width), widthOf(c.key, c.width))).length,
    [widthOf],
  );

  const rowKeyOf = (r: ComparisonRow) => r.id ?? r.what;
  const colIndexByKey = useMemo(() => new Map(COLUMNS.map((c, i) => [c.key, i])), []);
  const cellText = useCallback(
    (r: ComparisonRow, key: string) => {
      const i = colIndexByKey.get(key) ?? 0;
      return i === 0 ? r.what : r.cells[i - 1];
    },
    [colIndexByKey],
  );

  const orderedColumns = t
    .orderColumnKeys(COLUMNS.map((c) => c.key))
    .map((k) => COLUMNS.find((c) => c.key === k))
    .filter((c): c is (typeof COLUMNS)[number] => !!c);

  const orderedRows = (() => {
    const keys = t.orderRowKeys(rows.map(rowKeyOf));
    const byKey = new Map(rows.map((r) => [rowKeyOf(r), r]));
    return keys.map((k) => byKey.get(k)).filter((r): r is ComparisonRow => !!r);
  })();

  const csvRows = useMemo(
    () =>
      rows.map((r) => {
        const out: Record<string, string> = { [COLUMNS[0].label]: r.what };
        COLUMNS.slice(1).forEach((c, i) => {
          out[c.label] = r.cells[i];
        });
        return out;
      }),
    [rows],
  );

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Click a column&apos;s label (or a row&apos;s leading cell) to select/highlight it — drag
          either one past a neighbor to reorder it. Drag a column&apos;s right edge (or a row&apos;s
          bottom edge) to resize it, all the way to close it down to a red bar. Click a cell to select
          it, then drag its blue corner handle across other cells to copy its value into them;
          right-click any cell to copy its value to the clipboard.
        </p>
        <DownloadCsvButton rows={csvRows} filename="access-comparison" />
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
          className="text-left text-xs"
          style={{ tableLayout: "fixed", width: orderedColumns.reduce((sum, c) => sum + widthOf(c.key, c.width), 0) }}
        >
          <colgroup>
            {orderedColumns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 uppercase tracking-wide text-neutral-500">
            <tr>
              {orderedColumns.map((c, i) => {
                const width = widthOf(c.key, c.width);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    data-col-order-key={c.key}
                    className={`relative select-none whitespace-nowrap ${
                      i === 0 ? "sticky left-0 z-10 border-r border-neutral-200" : ""
                    } ${closed ? "bg-red-600 p-0" : `px-3 py-2 ${selected ? "bg-sky-100" : i === 0 ? "bg-neutral-50" : ""}`}`}
                  >
                    {!closed && (
                      <span
                        onPointerDown={t.getColHeaderDownHandler(c.key, () => toggleColSelect(c.key))}
                        title="Click to select/highlight this column — drag to reorder"
                        className="block cursor-pointer overflow-hidden text-ellipsis pr-2"
                      >
                        {c.label}
                      </span>
                    )}
                    <span
                      onPointerDown={(e) => handleResizeStart(e, c.key, c.width)}
                      title={closed ? "Drag to reopen this column" : "Drag to resize (or close) this column"}
                      className={`absolute right-0 top-0 z-10 h-full cursor-col-resize touch-none select-none ${
                        closed ? "w-full bg-red-600 hover:bg-red-700" : "w-2 hover:bg-red-300 active:bg-red-500"
                      }`}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {orderedRows.map((r) => {
              const key = rowKeyOf(r);
              const rowHeight = grid.rowHeights[key];
              const rowClosed = rowHeight != null && rowHeight <= CLOSED_SIZE + 1;
              const rowSelected = grid.selectedRows.has(key);
              return (
                <tr
                  key={key}
                  data-row-order-key={key}
                  className={`group align-top hover:bg-neutral-50 ${!rowClosed && rowSelected ? "bg-sky-50" : ""} ${grid.rowSizeClass(key)}`}
                  style={grid.rowSizeStyle(key)}
                >
                  {orderedColumns.map((c, i) => {
                    const width = widthOf(c.key, c.width);
                    const colClosed = isClosed(width, width);
                    const colSelected = selectedCols.has(c.key);
                    const closed = colClosed || rowClosed;
                    const text = cellText(r, c.key);
                    if (i === 0) {
                      const cellBg = colClosed
                        ? "bg-red-600"
                        : colSelected || rowSelected
                          ? "bg-sky-50"
                          : "bg-white group-hover:bg-neutral-50";
                      return (
                        <td
                          key={c.key}
                          className={`relative sticky left-0 z-10 border-r border-neutral-200 font-semibold text-neutral-800 ${
                            closed ? "p-0" : "cursor-pointer select-none whitespace-normal break-words px-3 py-2"
                          } ${cellBg}`}
                          title={!closed ? "Click to select/highlight this row — drag to reorder" : undefined}
                          onPointerDown={!closed ? t.getRowHandleDownHandler(key, () => grid.toggleRowSelect(key)) : undefined}
                        >
                          {!closed && text}
                          <span
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              grid.handleRowResizeStart(e, key, rowHeight ?? 36);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            title={rowClosed ? "Drag to reopen this row" : "Drag to resize (or close) this row"}
                            className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                          />
                        </td>
                      );
                    }
                    const cellBg = colClosed ? "bg-red-600" : colSelected ? "bg-sky-50" : "";
                    const isCellSelected = t.isCellSelected(key, c.key);
                    const isFillPreview = t.isFillPreview(key, c.key);
                    const displayText = t.cellValue(key, c.key, text);
                    return (
                      <td
                        key={c.key}
                        data-cell-row={key}
                        data-cell-col={c.key}
                        className={`relative text-neutral-600 ${closed ? "p-0" : "whitespace-normal break-words px-3 py-2"} ${cellBg} ${
                          !closed && isCellSelected ? "ring-2 ring-inset ring-blue-500" : ""
                        } ${!closed && isFillPreview ? "outline outline-2 -outline-offset-2 outline-blue-300" : ""}`}
                        onClick={!closed ? () => t.selectCell(key, c.key) : undefined}
                        onContextMenu={!closed ? t.getContextMenuHandler(displayText) : undefined}
                      >
                        {!closed && displayText}
                        {!closed && isCellSelected && (
                          <span
                            onPointerDown={t.getFillHandleDownHandler(key, c.key, displayText)}
                            title="Drag to copy this value into other cells"
                            className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-crosshair rounded-sm border border-white bg-blue-600"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </DualScrollBox>
      <TableInteractionOverlays t={t} />
    </>
  );
}
