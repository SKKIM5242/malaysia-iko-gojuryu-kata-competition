"use client";

import type { TableInteractions } from "@/lib/useTableInteractions";

/** The touch-confirm popup and right-click "Copied" toast shared by every
 * table wired up to useTableInteractions() — render this once per table,
 * anywhere in its tree. */
export default function TableInteractionOverlays({ t }: { t: TableInteractions }) {
  return (
    <>
      {t.fillPopup && (
        <div className="fixed inset-0 z-50" onClick={() => t.setFillPopup(null)}>
          <div
            className="absolute w-56 rounded-md border border-neutral-300 bg-white p-3 shadow-xl"
            style={{
              left: Math.min(t.fillPopup.x, (typeof window !== "undefined" ? window.innerWidth : 400) - 230),
              top: Math.min(t.fillPopup.y, (typeof window !== "undefined" ? window.innerHeight : 400) - 110),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-neutral-600">
              Copy &quot;{t.fillPopup.value}&quot; to {t.fillPopup.targets.length} cell{t.fillPopup.targets.length === 1 ? "" : "s"}?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  t.applyFill(t.fillPopup!.value, t.fillPopup!.targets);
                  t.setFillPopup(null);
                }}
                className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => t.setFillPopup(null)}
                className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {t.copyToast && (
        <div
          className="pointer-events-none fixed z-50 rounded bg-neutral-900 px-2 py-1 text-xs font-semibold text-white shadow-lg"
          style={{ left: t.copyToast.x + 8, top: t.copyToast.y + 8 }}
        >
          Copied
        </div>
      )}
    </>
  );
}
