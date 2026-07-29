"use client";

import { useEffect, useState } from "react";

/**
 * Replaces the old top-of-page flash banner. A server action's redirect()
 * always lands the browser scrolled to the top of the new page, so a banner
 * placed right under the <h1> forced the admin to scroll all the way back
 * down to whatever they were working on (e.g. deep in a long Kata Category
 * list) just to see it. Fixed-position instead, so it's visible wherever
 * the page ends up -- paired with ScrollToAnchor, which returns the page to
 * that same spot instead of leaving it scrolled to the top.
 */
export default function FlashToast({ ok, error }: { ok?: string; error?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ok && !error) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [ok, error]);

  if (!visible || (!ok && !error)) return null;
  const isError = !!error;
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-[70] max-w-sm rounded-md border py-3 pr-9 pl-4 text-sm shadow-lg relative ${
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
