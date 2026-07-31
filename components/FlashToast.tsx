"use client";

import { useEffect, useState } from "react";
import { consumeClickAnchor } from "@/components/ClickAnchorCapture";

/**
 * Replaces the old top-of-page flash banner. A server action's redirect()
 * always lands the browser scrolled to the top of the new page, so a banner
 * placed right under the <h1> forced the admin to scroll all the way back
 * down to whatever they were working on (e.g. deep in a long table) just to
 * see it.
 *
 * Reads the click anchor ClickAnchorCapture stashed in sessionStorage right
 * before the action's form submitted: scrolls the acted-on row back into
 * view, and positions this toast near the click itself (clamped to stay
 * on-screen) instead of a fixed corner -- "the popup shows up where the
 * button was clicked, not at the top of the page." Falls back to
 * bottom-right when there's no anchor (e.g. the action wasn't inside a
 * FilterableTable row, or sessionStorage was unavailable).
 */
export default function FlashToast({ ok, error }: { ok?: string; error?: string }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!ok && !error) return;
    setVisible(true);
    const anchor = consumeClickAnchor();
    if (anchor) {
      if (anchor.rowId) {
        // Let the toast's own layout settle first so scrollIntoView isn't
        // fighting a still-shifting page.
        requestAnimationFrame(() => {
          document.getElementById(anchor.rowId!)?.scrollIntoView({ block: "center" });
        });
      }
      const TOAST_W = 320;
      const TOAST_H = 90;
      const left = Math.min(Math.max(anchor.x - TOAST_W / 2, 12), window.innerWidth - TOAST_W - 12);
      const top = Math.min(Math.max(anchor.y - TOAST_H - 16, 12), window.innerHeight - TOAST_H - 12);
      setPos({ top, left });
    } else {
      setPos(null);
    }
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [ok, error]);

  if (!visible || (!ok && !error)) return null;
  const isError = !!error;
  return (
    <div
      role="status"
      style={pos ? { position: "fixed", top: pos.top, left: pos.left, maxWidth: 320 } : undefined}
      className={`${pos ? "" : "fixed bottom-4 right-4"} z-[70] max-w-sm rounded-md border py-3 pr-9 pl-4 text-sm shadow-lg relative ${
        isError ? "border-red-300 bg-red-50 text-red-800" : "border-green-300 bg-green-50 text-green-800"
      }`}
    >
      {error || ok}
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        className={`absolute right-1.5 top-1.5 rounded p-1 text-base leading-none ${
          isError ? "text-red-400 hover:bg-red-100" : "text-green-500 hover:bg-green-100"
        }`}
      >
        ✕
      </button>
    </div>
  );
}
