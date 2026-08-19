"use client";

import { useState } from "react";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";
import { RubricTable } from "@/components/RefereeScoring";
import { SHEET1_CRITERIA, SHEET2_CRITERIA, rubricFor, splitEvenly } from "@/lib/scoring-rubric";

/** Collapsed to 2 lines by default so a long disqualification reason
 * doesn't push the video + judge panels below the fold in the maximized
 * Full View window — tap/click to see the full text. */
function DisqualificationReason({ reason, label }: { reason: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      className="mt-1.5 block w-full rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-left text-xs text-red-800"
    >
      <strong>{label}</strong> <span className={expanded ? "" : "line-clamp-2"}>{reason}</span>
      <span className="mt-0.5 block text-[10px] font-semibold text-red-600 underline underline-offset-2">
        {expanded ? "Show less" : "Tap to see the full reason"}
      </span>
    </button>
  );
}

export interface FullViewJudge {
  judgeName: string;
  /** No longer rendered — the organizer asked for the country to come off
   * the panel headings, where it was the first thing to push a long name
   * onto a second line. Kept on the type because both callers already supply
   * it and it costs nothing to carry if it is ever wanted back. */
  country: string | null;
  total: number | null;
  criteria: number[] | null;
  /** Per-row "Reduce Score System" deduction checkboxes, parallel shape to
   * `criteria` — one boolean[] per row. */
  deductions?: boolean[][] | null;
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
 * editable, including the video itself — see LockedVideo.
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
  canToggleDeductions,
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
  /** Admin/Super Admin/Organizer/Referee-Judge only — gates the Show/Hide
   * toggle for the 5 deduction columns inside RubricTable. */
  canToggleDeductions?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!url) return null;

  const scoredCount = judges.filter((j) => j.total != null).length;
  const override = judges.find((j) => j.isOverride && j.total != null);
  // "Judge 1 / 2 / 3" in panel order, so the columns are identifiable at a
  // glance whatever the judges happened to name themselves. An Admin/
  // Organizer override is NOT given a judge number -- it is not one of the
  // panel, and numbering it as though it were would misrepresent who scored
  // on a screen used to settle disputes. Counting skips it, so a real judge
  // never loses their number to one.
  let judgeNumber = 0;
  const panelLabels = judges.map((j) => (j.isOverride ? "Override" : `Judge ${++judgeNumber}`));

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
          {/* Exactly two halves, and the whole thing fits the window: h-full
              (not min-h-full) means this never grows past the window and
              hands a scrollbar to the page. The recording takes the top 50%,
              everything else lives in the bottom 50%, and the participant's
              details stay pinned to the very bottom where they are always
              readable -- previously they sat below the judges in normal flow,
              so three tall score sheets pushed them off the bottom edge and
              you had to scroll to find out whose recording you were even
              looking at. Only the judges' row scrolls now, and only when the
              panels genuinely need more than the half they are given. */}
          <div className="flex h-full flex-col">
            {/* Starts at half the window and never exceeds it (grow 0), but
                gives that height up readily when the score sheets below need
                more room. The lopsided shrink factor against the judges' 1 is
                what decides WHO yields: with equal factors both shrink
                together and the sheets still end up scrolling. It has to be
                this large rather than merely bigger -- shrinking is shared in
                PROPORTION to the factors, so at 100:1 the judges still
                absorbed ~1% of the deficit and were left scrolling by exactly
                the 2px that cost them (measured). It stops at 25% so the
                recording can never be squeezed away entirely; past that the
                video can shrink no further and the judges' row scrolls again,
                which is the honest trade when three full rubrics simply
                cannot fit a short screen. */}
            <div className="bg-black" style={{ flex: "0 10000 50%", minHeight: "25%" }}>
              <LockedVideo src={url} autoPlay />
            </div>
            {/* grow 1 so a short set of sheets still fills the lower half
                rather than leaving a gap above the details. */}
            <div
              className="grid min-h-0 gap-2 overflow-y-auto border-t border-neutral-200 p-2 md:grid-cols-3"
              style={{ flex: "1 1 auto" }}
            >
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
                    <div key={`${j.judgeName}-${i}`} className="h-fit rounded-lg border border-neutral-200 p-2">
                      {/* One row, always. `truncate` clips an over-long name
                          with an ellipsis rather than wrapping to a second
                          line and pushing every panel's rubric out of
                          alignment; the full name stays available on hover
                          and to screen readers via `title`. The country that
                          used to follow the name is gone at the organizer's
                          request -- it was the first thing to force a wrap on
                          a narrow column. */}
                      <p
                        className="mb-1 truncate text-xs font-bold leading-tight text-neutral-900"
                        title={`${panelLabels[i]} - ${j.judgeName}`}
                      >
                        {panelLabels[i]} - {j.judgeName}
                      </p>
                      {j.total == null ? (
                        <p className="text-sm font-semibold text-amber-600">Score pending</p>
                      ) : (
                        <>
                          {/* The "even split of the total" note that used to
                              sit here is gone at the organizer's request. The
                              even split itself still happens (see `values`
                              just above) -- only the caption explaining it
                              was removed, since it appeared on every Score
                              Sheet 2 panel and read as a fault rather than
                              as the normal presentation of a total. */}
                          <RubricTable
                            values={values}
                            rubric={rubricFor(values)}
                            readOnly
                            dense
                            deductions={j.deductions}
                            canToggleDeductions={canToggleDeductions}
                          />
                          {j.total === 0 && (
                            <DisqualificationReason
                              label="Disqualification reason:"
                              reason={j.reason || "Not recorded (submitted before this was required)."}
                            />
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {/* shrink-0 so this is never the thing that gets squeezed, and
                leading-tight throughout: three near-touching lines read as
                one block and free the height back to the score sheets. */}
            <div className="shrink-0 border-t border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm leading-tight text-neutral-700">
              <p className="font-bold leading-tight text-neutral-900">{participantName}</p>
              <p className="text-xs leading-tight text-neutral-500">
                {categoryName ?? "—"}
                {competitionName ? ` · ${competitionName}` : ""}
              </p>
              {/* Judging status and the view-only note share one line, on
                  request -- two short lines of their own were costing a row
                  of height each for very little. */}
              <p className="text-xs leading-tight">
                Judging {scoredCount}/{judgesRequired} complete
                {disqualified
                  ? " · Disqualified (a judge gave a Total Score of 0)"
                  : averageText
                    ? ` · ${averageText}`
                    : ""}
                {queuePosition != null ? ` · Winner-in-line position #${queuePosition}` : ""}
                <span className="text-neutral-400"> — View only — nothing here can be edited.</span>
              </p>
              {override && (
                <>
                  <p className="text-xs font-semibold leading-tight text-purple-700">
                    Admin/Organizer override — {override.judgeName}: Score {override.total!.toFixed(2)}
                  </p>
                  {override.total === 0 && (
                    <DisqualificationReason
                      label="Disqualified:"
                      reason={override.reason || "No reason recorded"}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
