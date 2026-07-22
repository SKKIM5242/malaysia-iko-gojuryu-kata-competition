"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";

const MIN_ROW_HEIGHT = 26;

/**
 * Spreadsheet-like column/row selection for data tables: click a column
 * header or a row's leading cell to highlight it, hide a highlighted
 * column/row, or drag its edge to resize. Shared across every table
 * component (FilterableTable, ParticipantsTable, ParticipantRecordsTable,
 * AccessComparisonTableView) so the interaction is identical everywhere.
 * Selection/hidden/height state is per-table-instance and resets on reload,
 * matching the existing column-width behavior.
 */
export function useGridControls() {
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(new Set());
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const resizingRow = useRef<{ key: string; startY: number; startHeight: number } | null>(null);

  const toggleColSelect = useCallback((key: string) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleRowSelect = useCallback((key: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const hideCol = useCallback((key: string) => {
    setHiddenCols((prev) => new Set(prev).add(key));
    setSelectedCols((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const hideRow = useCallback((key: string) => {
    setHiddenRows((prev) => new Set(prev).add(key));
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const showAllCols = useCallback(() => setHiddenCols(new Set()), []);
  const showAllRows = useCallback(() => setHiddenRows(new Set()), []);

  const handleRowMove = useCallback((e: MouseEvent) => {
    const r = resizingRow.current;
    if (!r) return;
    const next = Math.max(MIN_ROW_HEIGHT, r.startHeight + (e.clientY - r.startY));
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
   * cell individually. */
  const rowSizeClass = useCallback(
    (key: string) => (rowHeights[key] != null ? "[&>td]:h-[var(--row-h)] [&>td]:max-h-[var(--row-h)] [&>td]:overflow-hidden [&>td]:py-1" : ""),
    [rowHeights],
  );
  const rowSizeStyle = useCallback(
    (key: string): CSSProperties | undefined =>
      rowHeights[key] != null ? ({ "--row-h": `${rowHeights[key]}px` } as CSSProperties) : undefined,
    [rowHeights],
  );

  return {
    selectedCols,
    selectedRows,
    hiddenCols,
    hiddenRows,
    rowHeights,
    toggleColSelect,
    toggleRowSelect,
    hideCol,
    hideRow,
    showAllCols,
    showAllRows,
    handleRowResizeStart,
    rowSizeClass,
    rowSizeStyle,
  };
}

export type GridControls = ReturnType<typeof useGridControls>;
