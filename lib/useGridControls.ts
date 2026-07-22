"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";

/** Both a row's minimum drag height and a column's minimum drag width —
 * dragging past this point doesn't clamp uselessly, it "closes" that
 * column/row down to a thin solid-red bar (rendered by each table's own
 * closed-state styling), which can be dragged back out to reopen. Picked
 * small enough to read as "closed" but still wide/tall enough to grab with
 * a mouse or finger. */
export const CLOSED_SIZE = 10;

export function isClosed(size: number | undefined, fallback: number): boolean {
  return (size ?? fallback) <= CLOSED_SIZE + 1;
}

/**
 * Shared row-height drag-resize for every table component (FilterableTable,
 * ParticipantsTable, ParticipantRecordsTable, AccessComparisonTableView) —
 * identical mechanic to each table's own column-width resize, just
 * vertical: grab a row's bottom edge and drag to make it taller/shorter,
 * all the way down to a closed thin bar. Height state is per-table-instance
 * and resets on reload, matching the existing column-width behavior.
 */
export function useGridControls() {
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const resizingRow = useRef<{ key: string; startY: number; startHeight: number } | null>(null);

  const handleRowMove = useCallback((e: MouseEvent) => {
    const r = resizingRow.current;
    if (!r) return;
    const next = Math.max(CLOSED_SIZE, r.startHeight + (e.clientY - r.startY));
    setRowHeights((prev) => ({ ...prev, [r.key]: next }));
  }, []);

  const handleRowUp = useCallback(() => {
    resizingRow.current = null;
    window.removeEventListener("mousemove", handleRowMove);
    window.removeEventListener("mouseup", handleRowUp);
  }, [handleRowMove]);

  const handleRowResizeStart = useCallback(
    (e: React.MouseEvent, key: string, startHeight: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRow.current = { key, startY: e.clientY, startHeight };
      window.addEventListener("mousemove", handleRowMove);
      window.addEventListener("mouseup", handleRowUp);
    },
    [handleRowMove, handleRowUp],
  );

  /** Applied to a <tr> alongside its own classes — shrinks/grows every
   * direct <td> via a CSS variable so callers don't need to touch each
   * cell individually. Fills every cell solid red once closed, so a
   * collapsed row still reads clearly as "there's a row here". */
  const rowSizeClass = useCallback(
    (key: string) => {
      const h = rowHeights[key];
      if (h == null) return "";
      const closed = isClosed(h, h);
      return closed
        ? "[&>td]:h-[var(--row-h)] [&>td]:max-h-[var(--row-h)] [&>td]:overflow-hidden [&>td]:p-0 [&>td]:bg-red-600"
        : "[&>td]:h-[var(--row-h)] [&>td]:max-h-[var(--row-h)] [&>td]:overflow-hidden [&>td]:py-1";
    },
    [rowHeights],
  );
  const rowSizeStyle = useCallback(
    (key: string): CSSProperties | undefined =>
      rowHeights[key] != null ? ({ "--row-h": `${rowHeights[key]}px` } as CSSProperties) : undefined,
    [rowHeights],
  );

  return {
    rowHeights,
    handleRowResizeStart,
    rowSizeClass,
    rowSizeStyle,
  };
}

export type GridControls = ReturnType<typeof useGridControls>;
