"use client";

import { useRef } from "react";

/**
 * Pointer-Events-based drag-to-reorder, replacing the old native HTML5
 * draggable/dragstart/dragover implementation. Two real limitations that
 * motivated the switch: native drag-and-drop has no touch support at all
 * (a finger drag on a phone/tablet just scrolls the page instead), and it
 * only offered a single "drop zone = whole row" target, so there was no way
 * to tell whether a drop meant "insert before" or "insert after" the row
 * you released over — the previous drop always landed the moved item AT
 * the target's old position (effectively always "before"), never after.
 *
 * This version works identically for mouse and touch (Pointer Events unify
 * both), and while dragging shows: a small floating chip following the
 * cursor/finger naming what's being moved, and a live insertion line that
 * snaps to sit above or below whichever sibling the pointer is nearest —
 * above if you're over its top half, below if you're over its bottom half
 * (i.e. drop near a sibling's centre and it's inserted right next to it,
 * exactly on the side you dropped it).
 *
 * Usage: mark the scrollable/visible list container with
 * `data-drag-list="<some shared id>"`, mark each reorderable row with
 * `data-drag-item="<that row's own key>"`, and call `startDrag` from the
 * grip handle's onPointerDown with that row's key and a short label for
 * the floating chip. onReorder fires once, on release, with the source
 * key, the row it landed next to, and "before" | "after".
 */
export function useDragReorder(onReorder: (sourceKey: string, targetKey: string, position: "before" | "after") => void) {
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const stateRef = useRef<{
    sourceKey: string;
    sourceEl: HTMLElement;
    prevOpacity: string;
    targets: Array<{ key: string; rect: DOMRect }>;
    indicator: HTMLDivElement;
    chip: HTMLDivElement;
    activeTargetKey: string | null;
    activePosition: "before" | "after" | null;
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  } | null>(null);

  function startDrag(e: React.PointerEvent, key: string, label: string) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    const item = handle.closest<HTMLElement>("[data-drag-item]");
    const list = handle.closest<HTMLElement>("[data-drag-list]");
    if (!item || !list) return;

    // Only the TOP-LEVEL drag items of this list are valid drop targets.
    //
    // querySelectorAll is recursive, so on the kata pages it also matched
    // every sub-category row nested inside each kata group — those rows
    // carry data-drag-item too (their own id, for reordering belts/ages
    // within a kata). Dropping a kata group onto one of them sent that
    // row's category UUID as `target_base`, which matches no kata name, so
    // reorderCategoryGroups bailed with "Could not reorder — try again."
    // Since the groups are normally expanded when you are looking at them,
    // those nested rows covered most of the drop area and reordering
    // appeared to do nothing at all.
    //
    // A target counts as top-level when it has no OTHER drag item between
    // it and this list. That keeps sub-category dragging working too: for
    // their own list the enclosing kata group sits outside it, so it is not
    // an intermediate ancestor.
    const siblings = Array.from(list.querySelectorAll<HTMLElement>("[data-drag-item]")).filter((el) => {
      const parentItem = el.parentElement?.closest<HTMLElement>("[data-drag-item]");
      return !parentItem || !list.contains(parentItem);
    });
    const targets = siblings
      .filter((el) => el !== item)
      .map((el) => ({ key: el.getAttribute("data-drag-item")!, rect: el.getBoundingClientRect() }));

    const indicator = document.createElement("div");
    indicator.style.cssText =
      "position:fixed;height:3px;border-radius:2px;background:#0284c7;" +
      "box-shadow:0 0 0 3px rgba(2,132,199,0.18);pointer-events:none;z-index:9999;display:none;";
    document.body.appendChild(indicator);

    const chip = document.createElement("div");
    chip.textContent = label;
    chip.style.cssText =
      "position:fixed;pointer-events:none;z-index:9999;background:#0f172a;color:#fff;" +
      "font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.28);transform:translate(-50%,-135%);" +
      "white-space:nowrap;max-width:70vw;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(chip);

    const prevOpacity = item.style.opacity;
    item.style.opacity = "0.4";

    const onMove = (ev: PointerEvent) => {
      const s = stateRef.current;
      if (!s) return;
      s.chip.style.left = `${ev.clientX}px`;
      s.chip.style.top = `${ev.clientY}px`;

      let best: { key: string; rect: DOMRect } | null = null;
      let bestDist = Infinity;
      for (const t of s.targets) {
        if (ev.clientY >= t.rect.top && ev.clientY <= t.rect.bottom) {
          best = t;
          break;
        }
        const centerDist = Math.abs(ev.clientY - (t.rect.top + t.rect.height / 2));
        if (centerDist < bestDist) {
          bestDist = centerDist;
          best = t;
        }
      }
      if (!best) {
        s.indicator.style.display = "none";
        s.activeTargetKey = null;
        s.activePosition = null;
        return;
      }
      const center = best.rect.top + best.rect.height / 2;
      const position: "before" | "after" = ev.clientY < center ? "before" : "after";
      s.activeTargetKey = best.key;
      s.activePosition = position;
      s.indicator.style.display = "block";
      s.indicator.style.left = `${best.rect.left}px`;
      s.indicator.style.width = `${best.rect.width}px`;
      s.indicator.style.top = `${position === "before" ? best.rect.top - 2 : best.rect.bottom - 1}px`;
    };

    const onUp = () => {
      const s = stateRef.current;
      if (!s) return;
      window.removeEventListener("pointermove", s.onMove);
      window.removeEventListener("pointerup", s.onUp);
      window.removeEventListener("pointercancel", s.onUp);
      s.sourceEl.style.opacity = s.prevOpacity;
      s.indicator.remove();
      s.chip.remove();
      if (s.activeTargetKey && s.activePosition) {
        onReorderRef.current(s.sourceKey, s.activeTargetKey, s.activePosition);
      }
      stateRef.current = null;
    };

    stateRef.current = { sourceKey: key, sourceEl: item, prevOpacity, targets, indicator, chip, activeTargetKey: null, activePosition: null, onMove, onUp };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    onMove(e.nativeEvent as PointerEvent);
  }

  return { startDrag };
}
