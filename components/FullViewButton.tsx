"use client";

import { useState } from "react";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";
import { RubricTable } from "@/components/RefereeScoring";
import { SHEET1_CRITERIA, SHEET2_CRITERIA, rubricFor, splitEvenly } from "@/lib/scoring-rubric";

export interface FullViewJudge {
  judgeName: string;
  country: string | null;
  total: number | null;
  criteria: number[] | null;
  /** This judge's own disqualification reason, if their score was 0. */
  reason: string | null;
  /** True when this "judge" slot is really an Admin/Organizer/Staff
   * override rather than a genuine referee — surfaced separately in the
   * participant info block below instead of blending in as a 4th judge. */
  isOverride: boolean;
}

/**
 * View-only "Full View" window supporting referee work: the recording at
 * the top, every assigned referee's scoreboard side by side underneath,
 * and the rest of the judging information at the bottom. Same window
 * controls as Watch Recording (drag anywhere, resize from the border,
 * minimize / maximize / snap-half / close top right); nothing here is
 * editable. The video three-dot menu stays Admin/Organizer-only via
 * `allowAdvancedControls`.
 */
export default function FullViewButton({
  url,
  participantName,
  categoryName,
  competitionName,
  judges,
  judgesRequired,
  queuePosition,
  averageText,
  disqualified,
  allowAdvancedControls = false,
}: {
  url: string | null;
  participantName: string;
  categoryName: string | null;
  competitionName: string | null;
  judges: FullViewJudge[];
  judgesRequired: number;
  queuePosition: number | null;
  averageText: string | null;
  disqualified: boolean;
  allowAdvancedControls?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!url) return null;

  const scoredCount = judges.filter((j) => j.total != null).length;
  const override = judges.find((j) => j.isOverride && j.total != null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded border border-neutral-900 bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700"
      >
        Full view
      </button>
      {open && (
        <FloatingWindow
          title={`Full View — ${participantName}`}
          onClose={() => setOpen(false)}
          initial="max"
        >
          <div className="flex min-h-full flex-col">
            <div className="h-[45vh] shrink-0 bg-black">
              <LockedVideo src={url} autoPlay allowAdvancedControls={allowAdvancedControls} />
            </div>
            <div className="grid gap-4 border-t border-neutral-200 p-4 md:grid-cols-3">
              {judges.length === 0 ? (
                <p className="text-sm text-neutral-400 md:col-span-3">No referees assigned yet.</p>
              ) : (
                judges.map((j, i) => {
                  const isEstimated =
                    !j.criteria ||
                    (j.criteria.length !== SHEET1_CRITERIA.length &&
                      j.criteria.length !== SHEET2_CRITERIA.length);
                  const values = isEstimated ? splitEvenly(j.total) : j.criteria!;
                  return (
                    <div key={`${j.judgeName}-${i}`} className="rounded-lg border border-neutral-200 p-3">
                      <p className="mb-2 text-sm font-bold text-neutral-900">
                        {j.judgeName}
                        {j.country ? <span className="font-normal text-neutral-400"> ({j.country})</span> : null}
                      </p>
                      {j.total == null ? (
                        <p className="text-sm font-semibold text-amber-600">Score pending</p>
                      ) : (
                        <>
                          {isEstimated && (
                            <p className="mb-1 text-[11px] text-amber-700">
                              Even split of the total — per-row detail wasn&apos;t recorded for this score.
                            </p>
                          )}
                          <RubricTable values={values} rubric={rubricFor(values)} readOnly dense />
                          {j.total === 0 && (
                            <p className="mt-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                              <strong>Disqualification reason:</strong>{" "}
                              {j.reason || "Not recorded (submitted before this was required)."}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              <p className="font-bold text-neutral-900">{participantName}</p>
              <p className="text-xs text-neutral-500">
                {categoryName ?? "—"}
                {competitionName ? ` · ${competitionName}` : ""}
              </p>
              <p className="mt-1 text-xs">
                Judging {scoredCount}/{judgesRequired} complete
                {disqualified
                  ? " · Disqualified (a judge gave a Total Score of 0)"
                  : averageText
                    ? ` · ${averageText}`
                    : ""}
                {queuePosition != null ? ` · Winner-in-line position #${queuePosition}` : ""}
              </p>
              <p className="mt-1 text-[11px] text-neutral-400">View only — nothing here can be edited.</p>
              {override && (
                <p className="mt-1 text-xs font-semibold text-purple-700">
                  Admin/Organizer override — {override.judgeName}: Score {override.total!.toFixed(1)}
                  {override.total === 0 ? ` · Disqualified: ${override.reason || "No reason recorded"}` : ""}
                </p>
              )}
            </div>
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
