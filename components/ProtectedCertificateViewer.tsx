"use client";

import { useEffect, useState } from "react";

/**
 * Opens a certificate image in an in-app modal instead of a new tab, with
 * best-effort deterrents against saving/cropping/printing: no download
 * link is ever rendered (the API route itself also refuses to serve
 * "participant" kind as an attachment — see route.tsx), right-click and
 * drag are disabled on the image, printing is suppressed via CSS, and the
 * image blurs out whenever the window loses focus — the moment most
 * screenshot tools (Snipping Tool, Win+Shift+S, a capture app) steal it.
 *
 * None of this can stop someone determined enough — a phone camera always
 * works, and browser dev tools can always find the image URL — so this is
 * a friction layer, not a guarantee.
 */
export default function ProtectedCertificateViewer({ viewHref, label }: { viewHref: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!open) return;
    const hide = () => setHidden(true);
    const show = () => setHidden(false);
    const onVisibility = () => (document.hidden ? hide() : show());
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
      >
        👁 View
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 print:hidden" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] max-w-3xl overflow-auto rounded-lg bg-white p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-neutral-500">{label} — view only</p>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
                ✕
              </button>
            </div>
            {hidden ? (
              <div className="flex h-64 w-full max-w-2xl items-center justify-center rounded-md bg-neutral-100 text-xs text-neutral-400">
                Hidden while this window isn't in focus
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewHref}
                alt={label}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                className="max-w-full select-none rounded-md"
              />
            )}
            <p className="mt-2 text-center text-[11px] text-neutral-400">
              Right-click, download, and printing are disabled for this certificate.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
