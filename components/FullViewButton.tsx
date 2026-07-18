"use client";

import { useState } from "react";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";
import { RubricTable } from "@/components/RefereeScoring";
import { SCORING_CRITERIA, splitEvenly } from "@/lib/scoring-rubric";

export interface FullViewJudge {
  judgeName: string;
  country: string | null;
  total: number | null;
  criteria: number[] | null;
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
                  const values =
                    j.criteria && j.criteria.length === SCORING_CRITERIA.length
                      ? j.criteria
                      : splitEvenly(j.total);
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
                          {(!j.criteria || j.criteria.length !== SCORING_CRITERIA.length) && (
                            <p className="mb-1 text-[11px] text-amber-700">
                              Even split of the total — per-row detail wasn&apos;t recorded for this score.
                            </p>
                          )}
                          <RubricTable values={values} readOnly />
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
            </div>
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
