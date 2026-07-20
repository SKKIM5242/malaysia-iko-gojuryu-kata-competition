"use client";

import { useState } from "react";
import { DISQUALIFICATION_REASONS, OTHER_DISQUALIFICATION_REASON } from "@/lib/scoring-rubric";

/** Disqualification-reason picker for a 0 score. A native <select> can't
 * wrap long option text onto a second line and its dropdown width is
 * whatever the OS gives it — several of the organizer's reasons are long
 * enough that they were getting cut off entirely. This opens a wide,
 * centered modal instead (same pattern as SignInControlBox/
 * ScoreDetailButton), so every reason wraps properly with the wrapped
 * lines hanging-indented under the text (not the number), at a width
 * that isn't constrained by whatever narrow box triggered it. */
export default function ReasonPicker({
  reason,
  customReason,
  onReasonChange,
  onCustomReasonChange,
}: {
  reason: string;
  customReason: string;
  onReasonChange: (v: string) => void;
  onCustomReasonChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isOther = reason === OTHER_DISQUALIFICATION_REASON;
  const numberOf = (r: string) => DISQUALIFICATION_REASONS.indexOf(r) + 1;

  let triggerLabel = "Select a reason…";
  if (isOther) {
    triggerLabel = customReason.trim()
      ? `${DISQUALIFICATION_REASONS.length + 1}) ${customReason.trim()}`
      : `${DISQUALIFICATION_REASONS.length + 1}) ${OTHER_DISQUALIFICATION_REASON}`;
  } else if (reason) {
    triggerLabel = `${numberOf(reason)}) ${reason}`;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-start justify-between gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-left text-sm hover:bg-neutral-50"
      >
        <span className={reason ? "text-neutral-900" : "text-neutral-400"}>{triggerLabel}</span>
        <span className="shrink-0 text-neutral-400">▾</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">
                Select a disqualification reason
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="space-y-1">
              {DISQUALIFICATION_REASONS.map((r, i) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    onReasonChange(r);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                    reason === r ? "bg-red-50 font-semibold text-red-700" : "text-neutral-700"
                  }`}
                >
                  <span className="shrink-0">{i + 1})</span>
                  <span>{r}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => onReasonChange(OTHER_DISQUALIFICATION_REASON)}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                  isOther ? "bg-red-50 font-semibold text-red-700" : "text-neutral-700"
                }`}
              >
                <span className="shrink-0">{DISQUALIFICATION_REASONS.length + 1})</span>
                <span>{OTHER_DISQUALIFICATION_REASON}</span>
              </button>
              {isOther && (
                <div className="pl-8 pt-1">
                  <input
                    type="text"
                    value={customReason}
                    onChange={(e) => onCustomReasonChange(e.target.value)}
                    placeholder="Type the reason…"
                    autoFocus
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                  >
                    Use this reason
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
