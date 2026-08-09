"use client";

import { useState } from "react";
import FloatingWindow from "@/components/FloatingWindow";

/**
 * Small "🏅 Certificate" button next to Full View on each /winners row —
 * opens a small floating window with the Winner Certificate image. Open to
 * every viewer, signed in or not (see the isPublicWinnerView exception in
 * app/api/certificates/[kind]/[id]/route.tsx), same "open to public"
 * treatment already given to the testimonial text itself. Shown dim/
 * disabled rather than omitted before the winner's testimonial unlocks it
 * — same "deem not missing" pattern used elsewhere on this page.
 */
export default function CertificatePreviewButton({
  registrationId,
  participantName,
  unlocked,
}: {
  registrationId: string;
  participantName: string;
  unlocked: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!unlocked) {
    return (
      <span
        aria-disabled="true"
        title="Unlocks once this winner submits their testimonial"
        className="shrink-0 cursor-not-allowed rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-400 opacity-50"
      >
        🏅 Certificate
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded border border-amber-700 bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600"
      >
        🏅 Certificate
      </button>
      {open && (
        <FloatingWindow
          title={`Winner Certificate — ${participantName}`}
          onClose={() => setOpen(false)}
          defaultWidth={460}
          defaultHeight={420}
        >
          <div className="flex h-full items-center justify-center bg-neutral-100 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/certificates/winner/${registrationId}?view=1`}
              alt={`Winner Certificate — ${participantName}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
