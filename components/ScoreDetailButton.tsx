"use client";

import { useState } from "react";
import { RubricTable } from "@/components/RefereeScoring";
import { SHEET1_CRITERIA, SHEET2_CRITERIA, rubricFor, splitEvenly } from "@/lib/scoring-rubric";

/**
 * Admin/Organizer view-only detail: clicking a judge's "Total X.X" chip
 * opens the same rubric layout as the referee's own scoring popup, but with
 * every field disabled — no edit access, per the organizer's explicit
 * request. Falls back to an even split across criteria for scores
 * submitted before per-criterion storage existed (labelled as such).
 */
export default function ScoreDetailButton({
  judgeName,
  total,
  criteria,
}: {
  judgeName: string;
  total: number;
  criteria: number[] | null;
}) {
  const [open, setOpen] = useState(false);
  const isEstimated =
    !criteria ||
    (criteria.length !== SHEET1_CRITERIA.length && criteria.length !== SHEET2_CRITERIA.length);
  const values = isEstimated ? splitEvenly(total) : criteria!;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={total === 0 ? "font-bold text-red-700 underline underline-offset-2" : "text-green-700 underline underline-offset-2"}
        title="View detailed score breakdown (view only)"
      >
        Total {total.toFixed(1)}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-neutral-900">{judgeName}</p>
                <p className="text-xs text-neutral-500">View only — Admin/Organizer cannot edit a judge&apos;s score.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
                ✕
              </button>
            </div>
            {isEstimated && (
              <p className="mb-2 text-xs text-amber-700">
                This score was submitted before per-criterion detail was tracked — the breakdown
                below is an even split of the total, not the judge&apos;s original per-row entries.
              </p>
            )}
            <RubricTable values={values} rubric={rubricFor(values)} readOnly />
          </div>
        </div>
      )}
    </>
  );
}
