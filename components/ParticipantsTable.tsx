"use client";

import { useCallback, useRef, useState } from "react";
import { CategoryName } from "@/components/ui";

export interface ParticipantRow {
  id: string;
  no: number;
  name: string;
  categoryName: string | null;
  division: string | null;
  belt: string | null;
  school: string | null;
  sensei: string | null;
}

const COLUMNS = [
  { key: "no", label: "#" },
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "division", label: "Division" },
  { key: "belt", label: "Belt" },
  { key: "school", label: "School" },
  { key: "sensei", label: "Sensei" },
] as const;

const MIN_COL_WIDTH = 50;
const DEFAULT_WIDTHS: Record<string, number> = {
  no: 56,
  name: 180,
  category: 220,
  division: 100,
  belt: 120,
  school: 200,
  sensei: 160,
};

/** Same drag-to-resize mechanic as the admin FilterableTable, scaled down
 * for this public, read-only, server-paginated list (no per-column
 * filters or CSV export here — the page above already has its own
 * tier/kata/school filter form). Widths reset on reload, not persisted. */
export default function ParticipantsTable({ rows }: { rows: ParticipantRow[] }) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

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

  const totalWidth = COLUMNS.reduce((sum, c) => sum + widthOf(c.key), 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
      <table className="text-left text-sm" style={{ tableLayout: "fixed", width: totalWidth }}>
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: widthOf(c.key) }} />
          ))}
        </colgroup>
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className="relative select-none px-4 py-3">
                <span className="block overflow-hidden text-ellipsis pr-2">{c.label}</span>
                <span
                  onMouseDown={(e) => handleResizeStart(e, c.key)}
                  title="Drag to resize this column"
                  className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <td className="truncate px-4 py-3 text-neutral-400">{r.no}</td>
              <td className="truncate px-4 py-3 font-medium text-neutral-900">{r.name}</td>
              <td className="truncate px-4 py-3" title={r.categoryName ?? undefined}>
                <CategoryName name={r.categoryName ?? undefined} />
              </td>
              <td className="truncate px-4 py-3 text-xs">{r.division ?? "—"}</td>
              <td className="truncate px-4 py-3">{r.belt ?? "—"}</td>
              <td className="truncate px-4 py-3" title={r.school ?? undefined}>{r.school ?? "—"}</td>
              <td className="truncate px-4 py-3">{r.sensei ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
