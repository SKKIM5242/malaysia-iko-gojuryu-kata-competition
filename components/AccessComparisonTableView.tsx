"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import DualScrollBox from "@/components/DualScrollBox";
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
 * listing tables. */
export default function AccessComparisonTableView({ rows }: { rows: ComparisonRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

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
        <p className="text-xs text-neutral-400">Drag a column&apos;s right edge to resize it.</p>
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
              {COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  className={`relative select-none px-3 py-2 ${
                    i === 0 ? "sticky left-0 z-10 border-r border-neutral-200 bg-neutral-50" : ""
                  }`}
                >
                  <span className="block overflow-hidden text-ellipsis pr-2">{c.label}</span>
                  <span
                    onMouseDown={(e) => handleResizeStart(e, c.key, c.width)}
                    title="Drag to resize this column"
                    className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id ?? r.what} className="group align-top hover:bg-neutral-50">
                <td className="sticky left-0 z-10 whitespace-normal break-words border-r border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-800 group-hover:bg-neutral-50">
                  {r.what}
                </td>
                {r.cells.map((cell, i) => (
                  <td key={i} className="whitespace-normal break-words px-3 py-2 text-neutral-600">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </DualScrollBox>
    </>
  );
}
