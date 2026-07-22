"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls } from "@/lib/useGridControls";
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

const MIN_COL_WIDTH = 100;

/** The interactive shell around the Access Comparison table's data —
 * split out from the server component that fetches `rows` because column
 * resize needs client-side state. Every cell wraps its full prose text
 * (never truncates); the header row and the "Access" label column stay
 * pinned while the rest scrolls, same drag-to-resize pattern as the admin
 * listing tables. Click a column header or a row's "Access" label to
 * select/highlight it; a highlighted column/row can be hidden with the ×
 * that appears, and rows resize taller/shorter from their bottom edge the
 * same way columns resize from their right edge. */
export default function AccessComparisonTableView({ rows }: { rows: ComparisonRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);

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
    (e: React.MouseEvent, key: string, fallback: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key, startX: e.clientX, startWidth: widthOf(key, fallback) };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [widthOf, handleMove, handleUp],
  );

  const visibleColumns = useMemo(() => COLUMNS.filter((c) => !grid.hiddenCols.has(c.key)), [grid.hiddenCols]);
  const rowKeyOf = (r: ComparisonRow) => r.id ?? r.what;
  const displayedRows = useMemo(() => rows.filter((r) => !grid.hiddenRows.has(rowKeyOf(r))), [rows, grid.hiddenRows]);
  const cellValue = (r: ComparisonRow, key: string): string =>
    key === "what" ? r.what : r.cells[COLUMNS.findIndex((c) => c.key === key) - 1];

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
          Drag a column&apos;s right edge to resize it, or click a header/row to select and hide it.
        </p>
        <DownloadCsvButton rows={csvRows} filename="access-comparison" />
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
          className="text-left text-xs"
          style={{ tableLayout: "fixed", width: visibleColumns.reduce((sum, c) => sum + widthOf(c.key, c.width), 0) }}
        >
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 uppercase tracking-wide text-neutral-500">
            <tr>
              {visibleColumns.map((c, i) => {
                const selected = grid.selectedCols.has(c.key);
                return (
                  <th
                    key={c.key}
                    className={`relative select-none px-3 py-2 ${
                      i === 0 ? "sticky left-0 z-10 border-r border-neutral-200" : ""
                    } ${selected ? "bg-amber-100" : i === 0 ? "bg-neutral-50" : ""}`}
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
                      onMouseDown={(e) => handleResizeStart(e, c.key, c.width)}
                      title="Drag to resize this column"
                      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {displayedRows.map((r) => {
              const key = rowKeyOf(r);
              const rowSelected = grid.selectedRows.has(key);
              const rowHeight = grid.rowHeights[key];
              const handleBg = rowSelected ? "bg-amber-50" : "bg-white group-hover:bg-neutral-50";
              return (
                <tr
                  key={key}
                  className={`group align-top hover:bg-neutral-50 ${rowSelected ? "bg-amber-50" : ""} ${grid.rowSizeClass(key)}`}
                  style={grid.rowSizeStyle(key)}
                >
                  {visibleColumns.map((c, i) => {
                    if (i === 0) {
                      return (
                        <td
                          key={c.key}
                          className={`relative sticky left-0 z-10 cursor-pointer select-none whitespace-normal break-words border-r border-neutral-200 px-3 py-2 font-semibold text-neutral-800 ${handleBg}`}
                          title="Click to select/highlight this row"
                          onClick={() => grid.toggleRowSelect(key)}
                        >
                          {cellValue(r, c.key)}
                          {rowSelected && (
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
                          <span
                            onMouseDown={(e) => grid.handleRowResizeStart(e, key, rowHeight ?? 36)}
                            title="Drag to resize this row"
                            className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} className="whitespace-normal break-words px-3 py-2 text-neutral-600">
                        {cellValue(r, c.key)}
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
