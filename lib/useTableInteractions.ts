"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DRAG_THRESHOLD = 6;

/**
 * Column/row drag-to-reorder plus cell-select/right-click-copy/drag-to-fill
 * -copy, shared by every bespoke table that isn't built on the generic
 * FilterableTable (which has its own inline copy of the same behavior).
 * Column and row order live here purely as key lists — order is DOM-query
 * driven (`data-col-order-key` on each header `<th>`, `data-row-order-key`
 * on each `<tr>`, `data-cell-row`/`data-cell-col` on each `<td>`), so this
 * hook never needs to know a table's actual column/row shape. Nothing here
 * writes back to the database — fill-copy is a local display override only,
 * same lifetime as column widths (resets on reload).
 */
export function useTableInteractions(options?: {
  /** For editable grids (e.g. the bulk-registration form) where a cell is a
   * real input, not display text — fill-copy calls this instead of the
   * hook's own internal display-override map, so the copy actually writes
   * into the caller's own row state. `targets` decode the "row:col" keys
   * this hook tracks internally. */
  onFill?: (value: string, targets: Array<{ row: string; col: string }>) => void;
}) {
  const [colOrder, setColOrder] = useState<string[] | null>(null);
  const [rowOrder, setRowOrder] = useState<string[] | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: string; col: string } | null>(null);
  const [fillOverrides, setFillOverrides] = useState<Record<string, string>>({});
  const [fillPreview, setFillPreview] = useState<Set<string> | null>(null);
  const [fillPopup, setFillPopup] = useState<{ x: number; y: number; value: string; targets: string[] } | null>(null);
  const [copyToast, setCopyToast] = useState<{ x: number; y: number } | null>(null);

  const colDragRef = useRef<{ key: string; startX: number; startY: number; moved: boolean; onPlainClick: () => void } | null>(null);
  const rowDragRef = useRef<{ key: string; startX: number; startY: number; moved: boolean; onPlainClick: () => void } | null>(null);
  const fillDragRef = useRef<{ row: string; col: string; value: string; axis: "row" | "col" | null } | null>(null);

  useEffect(() => {
    if (!copyToast) return;
    const t = setTimeout(() => setCopyToast(null), 1200);
    return () => clearTimeout(t);
  }, [copyToast]);

  // ---- column reorder ------------------------------------------------------

  const orderColumnKeys = useCallback(
    (allKeys: string[]): string[] => {
      if (!colOrder) return allKeys;
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const k of colOrder) if (allKeys.includes(k) && !seen.has(k)) { ordered.push(k); seen.add(k); }
      for (const k of allKeys) if (!seen.has(k)) ordered.push(k);
      return ordered;
    },
    [colOrder],
  );

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
      const table = th?.closest("table");
      const domKeys = table
        ? Array.from(table.querySelectorAll<HTMLElement>("[data-col-order-key]")).map((el2) => el2.dataset.colOrderKey!)
        : [];
      const order = prev ?? domKeys;
      const from = order.indexOf(d.key);
      if (from === -1) return prev;
      const next = order.slice();
      const [moved] = next.splice(from, 1);
      const insertAt = next.indexOf(overKey);
      if (insertAt === -1) return prev;
      next.splice(insertAt, 0, moved);
      return next;
    });
  }, []);

  const handleColHeaderUp = useCallback(() => {
    window.removeEventListener("pointermove", handleColHeaderMove);
    window.removeEventListener("pointerup", handleColHeaderUp);
    const d = colDragRef.current;
    colDragRef.current = null;
    if (d && !d.moved) d.onPlainClick();
  }, [handleColHeaderMove]);

  const getColHeaderDownHandler = useCallback(
    (key: string, onPlainClick: () => void) => (e: React.PointerEvent) => {
      colDragRef.current = { key, startX: e.clientX, startY: e.clientY, moved: false, onPlainClick };
      window.addEventListener("pointermove", handleColHeaderMove);
      window.addEventListener("pointerup", handleColHeaderUp);
    },
    [handleColHeaderMove, handleColHeaderUp],
  );

  // ---- row reorder ----------------------------------------------------------

  const orderRowKeys = useCallback(
    (allKeys: string[]): string[] => {
      if (!rowOrder) return allKeys;
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const k of rowOrder) if (allKeys.includes(k) && !seen.has(k)) { ordered.push(k); seen.add(k); }
      for (const k of allKeys) if (!seen.has(k)) ordered.push(k);
      return ordered;
    },
    [rowOrder],
  );

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
      const table = tr?.closest("table");
      const domKeys = table
        ? Array.from(table.querySelectorAll<HTMLElement>("[data-row-order-key]")).map((el2) => el2.dataset.rowOrderKey!)
        : [];
      const order = prev ?? domKeys;
      const from = order.indexOf(d.key);
      if (from === -1) return prev;
      const next = order.slice();
      const [moved] = next.splice(from, 1);
      const insertAt = next.indexOf(overKey);
      if (insertAt === -1) return prev;
      next.splice(insertAt, 0, moved);
      return next;
    });
  }, []);

  const handleRowHandleUp = useCallback(() => {
    window.removeEventListener("pointermove", handleRowHandleMove);
    window.removeEventListener("pointerup", handleRowHandleUp);
    const d = rowDragRef.current;
    rowDragRef.current = null;
    if (d && !d.moved) d.onPlainClick();
  }, [handleRowHandleMove]);

  const getRowHandleDownHandler = useCallback(
    (key: string, onPlainClick: () => void) => (e: React.PointerEvent) => {
      rowDragRef.current = { key, startX: e.clientX, startY: e.clientY, moved: false, onPlainClick };
      window.addEventListener("pointermove", handleRowHandleMove);
      window.addEventListener("pointerup", handleRowHandleUp);
    },
    [handleRowHandleMove, handleRowHandleUp],
  );

  // ---- cell select, drag-to-fill-copy, right-click copy ---------------------

  const applyFill = useCallback((value: string, targets: string[]) => {
    if (options?.onFill) {
      options.onFill(
        value,
        targets.map((key) => {
          const i = key.indexOf(":");
          return { row: key.slice(0, i), col: key.slice(i + 1) };
        }),
      );
      return;
    }
    setFillOverrides((prev) => {
      const next = { ...prev };
      for (const t of targets) next[t] = value;
      return next;
    });
  }, [options]);

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
    const table = td.closest("table");
    const preview = new Set<string>();
    if (table) {
      if (axis === "row") {
        const colKeys = Array.from(table.querySelectorAll<HTMLElement>("[data-col-order-key]")).map((h) => h.dataset.colOrderKey!);
        const i0 = colKeys.indexOf(f.col);
        const i1 = colKeys.indexOf(targetCol);
        if (i0 !== -1 && i1 !== -1) {
          const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
          for (let i = lo; i <= hi; i++) preview.add(`${f.row}:${colKeys[i]}`);
        }
      } else {
        const rowKeys = Array.from(table.querySelectorAll<HTMLElement>("[data-row-order-key]")).map((r) => r.dataset.rowOrderKey!);
        const i0 = rowKeys.indexOf(f.row);
        const i1 = rowKeys.indexOf(targetRow);
        if (i0 !== -1 && i1 !== -1) {
          const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
          for (let i = lo; i <= hi; i++) preview.add(`${rowKeys[i]}:${f.col}`);
        }
      }
    }
    setFillPreview(preview);
  }, []);

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

  const getFillHandleDownHandler = useCallback(
    (row: string, col: string, value: string) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      fillDragRef.current = { row, col, value, axis: null };
      window.addEventListener("pointermove", handleFillMove);
      window.addEventListener("pointerup", handleFillUp);
    },
    [handleFillMove, handleFillUp],
  );

  const getContextMenuHandler = useCallback((text: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopyToast({ x: e.clientX, y: e.clientY });
  }, []);

  const isCellSelected = useCallback(
    (row: string, col: string) => selectedCell?.row === row && selectedCell?.col === col,
    [selectedCell],
  );
  const isFillPreview = useCallback((row: string, col: string) => fillPreview?.has(`${row}:${col}`) ?? false, [fillPreview]);
  const cellValue = useCallback(
    (row: string, col: string, original: string) => fillOverrides[`${row}:${col}`] ?? original,
    [fillOverrides],
  );
  const selectCell = useCallback((row: string, col: string) => setSelectedCell({ row, col }), []);

  return {
    orderColumnKeys,
    getColHeaderDownHandler,
    orderRowKeys,
    getRowHandleDownHandler,
    isCellSelected,
    isFillPreview,
    cellValue,
    selectCell,
    getFillHandleDownHandler,
    getContextMenuHandler,
    fillPopup,
    setFillPopup,
    applyFill,
    copyToast,
  };
}

export type TableInteractions = ReturnType<typeof useTableInteractions>;
