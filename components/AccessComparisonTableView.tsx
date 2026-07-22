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
 * pinned while the rest scrolls. Drag a column's right edge (or a row's
 * "Access" label bottom edge) to resize it, all the way down to a closed
 * solid-red bar — drag that bar back out to reopen. */
export default function AccessComparisonTableView({ rows }: { rows: ComparisonRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);

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
          Drag a column&apos;s right edge (or a row&apos;s bottom edge) to resize it — drag all the way
          to close it down to a red bar, then drag that bar back out to reopen.
        </p>
        <DownloadCsvButton rows={csvRows} filename="access-comparison" />
      </div>
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
                return (
                  <th
                    key={c.key}
                    className={`relative select-none whitespace-nowrap ${
                      i === 0 ? "sticky left-0 z-10 border-r border-neutral-200" : ""
                    } ${closed ? "bg-red-600 p-0" : `px-3 py-2 ${i === 0 ? "bg-neutral-50" : ""}`}`}
                  >
                    {!closed && <span className="block overflow-hidden text-ellipsis pr-2">{c.label}</span>}
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
              return (
                <tr
                  key={key}
                  className={`group align-top hover:bg-neutral-50 ${grid.rowSizeClass(key)}`}
                  style={grid.rowSizeStyle(key)}
                >
                  {COLUMNS.map((c, i) => {
                    const width = widthOf(c.key, c.width);
                    const colClosed = isClosed(width, width);
                    const closed = colClosed || rowClosed;
                    if (i === 0) {
                      return (
                        <td
                          key={c.key}
                          className={`relative sticky left-0 z-10 border-r border-neutral-200 font-semibold text-neutral-800 ${
                            closed ? "p-0" : "whitespace-normal break-words px-3 py-2"
                          } ${colClosed ? "bg-red-600" : "bg-white group-hover:bg-neutral-50"}`}
                        >
                          {!closed && r.what}
                          <span
                            onMouseDown={(e) => grid.handleRowResizeStart(e, key, rowHeight ?? 36)}
                            title={rowClosed ? "Drag to reopen this row" : "Drag to resize (or close) this row"}
                            className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={c.key}
                        className={`text-neutral-600 ${closed ? "p-0" : "whitespace-normal break-words px-3 py-2"} ${
                          colClosed ? "bg-red-600" : ""
                        }`}
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
