"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls, isClosed, CLOSED_SIZE } from "@/lib/useGridControls";
import type { ComparisonRow } from "@/components/AccessComparisonTable";

const COLUMNS: Array<{ key: string; label: string; width: number }> = [
  { key: "what", label: "Access", width: 220 },
  { key: "participant", label: "Participant", width: 220 },
  { key: "school", label: "School / Dojo", width: 220 },
  { key: "sensei", label: "Sensei / Coach", width: 220 },
  { key: "referee", label: "Referee / Judge", width: 220 },
  { key: "audience", label: "Audience", width: 220 },
  { key: "organizer", label: "Organizer", width: 220 },
  { key: "support", label: "Participant Support", width: 220 },
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

  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);

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
    (e: React.MouseEvent, key: string, fallback: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key, startX: e.clientX, startWidth: widthOf(key, fallback) };
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
    () => COLUMNS.filter((c) => isClosed(widthOf(c.key, c.width), widthOf(c.key, c.width))).length,
    [widthOf],
  );

  const rowKeyOf = (r: ComparisonRow) => r.id ?? r.what;

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
          Click a column&apos;s label (or a row&apos;s leading cell) to select/highlight it. Drag a
          column&apos;s right edge (or a row&apos;s bottom edge) to resize it, all the way to close it
          down to a red bar.
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
          style={{ tableLayout: "fixed", width: COLUMNS.reduce((sum, c) => sum + widthOf(c.key, c.width), 0) }}
        >
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 uppercase tracking-wide text-neutral-500">
            <tr>
              {COLUMNS.map((c, i) => {
                const width = widthOf(c.key, c.width);
                const closed = isClosed(width, width);
                const selected = selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`relative select-none whitespace-nowrap ${
                      i === 0 ? "sticky left-0 z-10 border-r border-neutral-200" : ""
                    } ${closed ? "bg-red-600 p-0" : `px-3 py-2 ${selected ? "bg-amber-100" : i === 0 ? "bg-neutral-50" : ""}`}`}
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
                      onMouseDown={(e) => handleResizeStart(e, c.key, c.width)}
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
            {rows.map((r) => {
              const key = rowKeyOf(r);
              const rowHeight = grid.rowHeights[key];
              const rowClosed = rowHeight != null && rowHeight <= CLOSED_SIZE + 1;
              const rowSelected = grid.selectedRows.has(key);
              return (
                <tr
                  key={key}
                  className={`group align-top hover:bg-neutral-50 ${!rowClosed && rowSelected ? "bg-sky-50" : ""} ${grid.rowSizeClass(key)}`}
                  style={grid.rowSizeStyle(key)}
                >
                  {COLUMNS.map((c, i) => {
                    const width = widthOf(c.key, c.width);
                    const colClosed = isClosed(width, width);
                    const colSelected = selectedCols.has(c.key);
                    const closed = colClosed || rowClosed;
                    if (i === 0) {
                      const cellBg = colClosed
                        ? "bg-red-600"
                        : colSelected
                          ? "bg-amber-100"
                          : rowSelected
                            ? "bg-sky-50"
                            : "bg-white group-hover:bg-neutral-50";
                      return (
                        <td
                          key={c.key}
                          className={`relative sticky left-0 z-10 border-r border-neutral-200 font-semibold text-neutral-800 ${
                            closed ? "p-0" : "cursor-pointer select-none whitespace-normal break-words px-3 py-2"
                          } ${cellBg}`}
                          title={!closed ? "Click to select/highlight this row" : undefined}
                          onClick={!closed ? () => grid.toggleRowSelect(key) : undefined}
                        >
                          {!closed && r.what}
                          <span
                            onMouseDown={(e) => grid.handleRowResizeStart(e, key, rowHeight ?? 36)}
                            onClick={(e) => e.stopPropagation()}
                            title={rowClosed ? "Drag to reopen this row" : "Drag to resize (or close) this row"}
                            className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                          />
                        </td>
                      );
                    }
                    const cellBg = colClosed ? "bg-red-600" : colSelected ? "bg-amber-100" : "";
                    return (
                      <td
                        key={c.key}
                        className={`text-neutral-600 ${closed ? "p-0" : "whitespace-normal break-words px-3 py-2"} ${cellBg}`}
                      >
                        {!closed && r.cells[i - 1]}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </DualScrollBox>
    </>
  );
}
