"use client";

import { useEffect } from "react";

export const CLICK_ANCHOR_KEY = "__admin_click_anchor";

interface ClickAnchor {
  /** DOM id of the FilterableTable row the clicked button lives in, if any
   * (see the `id={`row-${key}`}` on FilterableTable's <tr>). Lets the next
   * page scroll back to that exact row instead of landing at the top. */
  rowId: string | null;
  /** Viewport-relative click point, for positioning the confirmation toast
   * near where the admin actually clicked instead of a fixed corner. */
  x: number;
  y: number;
  ts: number;
}

/**
 * Mounted once in AdminShell -- applies to every submit button on every
 * admin page with no per-page or per-form changes needed.
 *
 * A server action's redirect() always lands the browser at the top of a
 * fresh page load, which on a long table (Registrations, Participants,
 * Schools...) scrolls the admin away from whichever row they just acted on.
 * This captures, at the moment of click -- before the browser processes the
 * native form submission -- which row and where on screen, into
 * sessionStorage (survives the navigation; a new tab or closing this one
 * clears it). FlashToast and RowAnchorScroll read it back on the next page
 * to restore position and place the confirmation near the click instead of
 * a fixed corner.
 *
 * Also gives the clicked button itself an immediate "pressed" look (turns
 * white/pale, subtle scale-down) so there's visible feedback in the instant
 * before the page actually navigates away -- the button element itself
 * doesn't survive the reload, so this is necessarily a brief flash, not a
 * lasting state; the toast + scroll-restore on the far side is what
 * confirms the action really landed.
 */
export default function ClickAnchorCapture() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const button = target.closest<HTMLElement>(
        'button[type="submit"], input[type="submit"]',
      );
      if (!button) return;
      const form = button.closest("form");
      if (!form) return;

      // Immediate visual "pressed" feedback -- reverts naturally on the next
      // page load, or after a couple of seconds if the form never actually
      // submits (e.g. blocked by required-field validation elsewhere in it).
      const prevStyle = button.getAttribute("style") ?? "";
      button.style.transition = "background-color 120ms, opacity 120ms";
      button.style.backgroundColor = "#fff";
      button.style.opacity = "0.6";
      setTimeout(() => {
        if (button.isConnected) button.setAttribute("style", prevStyle);
      }, 2500);

      const row = button.closest<HTMLElement>('[id^="row-"]');
      const anchor: ClickAnchor = {
        rowId: row?.id ?? null,
        x: e.clientX,
        y: e.clientY,
        ts: Date.now(),
      };
      try {
        sessionStorage.setItem(CLICK_ANCHOR_KEY, JSON.stringify(anchor));
      } catch {
        // sessionStorage can throw in locked-down/private-browsing contexts
        // -- losing the position hint is harmless, so just skip it.
      }
    }
    // Capture phase: must run before the button's own click handler (if
    // any) or the browser's native form submission.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}

/** Reads back a still-fresh click anchor (within the last 15s -- long
 * enough for a slow connection's redirect, short enough that it never
 * applies to an unrelated later click), and clears it so it isn't reused by
 * a subsequent plain navigation (e.g. clicking a sidebar link). */
export function consumeClickAnchor(): ClickAnchor | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CLICK_ANCHOR_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CLICK_ANCHOR_KEY);
    const parsed = JSON.parse(raw) as ClickAnchor;
    if (Date.now() - parsed.ts > 15000) return null;
    return parsed;
  } catch {
    return null;
  }
}
