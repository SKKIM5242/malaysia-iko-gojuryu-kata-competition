"use client";

import { useState } from "react";
import { submitScore } from "@/app/actions/account";
import ReasonPicker from "@/components/ReasonPicker";
import { DISQUALIFICATION_REASONS, OTHER_DISQUALIFICATION_REASON } from "@/lib/scoring-rubric";

/** The plain single-number "Admin/Organizer override" score field on the
 * Judging page (no rubric sheet, just a Total Score straight in) — same
 * "0 requires a reason" rule as Score Sheet 1/2 in RefereeScoring.tsx, so
 * an override score of 0 can't be submitted without picking a reason
 * (dropdown) or typing one ("Others"). `existingReason` re-hydrates a
 * previously-submitted reason after reload — without it the picker looked
 * blank even though a reason had already been saved. */
export default function QuickScoreForm({
  videoId,
  existingScore,
  existingReason,
}: {
  videoId: string;
  existingScore: number | null;
  existingReason?: string | null;
}) {
  const isKnownReason = !!existingReason && DISQUALIFICATION_REASONS.includes(existingReason);
  const [score, setScore] = useState(existingScore != null ? String(existingScore) : "");
  const [reason, setReason] = useState(
    !existingReason ? "" : isKnownReason ? existingReason : OTHER_DISQUALIFICATION_REASON,
  );
  const [customReason, setCustomReason] = useState(existingReason && !isKnownReason ? existingReason : "");
  const finalReason = (reason === OTHER_DISQUALIFICATION_REASON ? customReason : reason).trim();
  const numericScore = score === "" ? null : Math.round(Number(score) * 10) / 10;
  const isZero = numericScore === 0;
  const submitDisabled = score === "" || (isZero && !finalReason);

  return (
    <form action={submitScore} className="mt-3 border-t border-neutral-100 pt-3">
      <input type="hidden" name="video_id" value={videoId} />
      {isZero && <input type="hidden" name="reason" value={finalReason} />}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`score_${videoId}`} className="text-xs font-semibold text-neutral-500">
          Organizer/Chief Judge take over or override score (0–10)
        </label>
        <input
          id={`score_${videoId}`}
          name="score"
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={score}
          onChange={(e) => setScore(e.target.value)}
          required
          className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={submitDisabled}
          className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          Submit score
        </button>
        {existingScore != null && (
          <span className="font-bold text-green-600" title="This override score has been submitted">
            ✓
          </span>
        )}
      </div>
      {isZero && (
        <div className="mt-2 rounded-md border-2 border-red-300 bg-red-50 p-3">
          <p className="text-xs font-semibold text-red-700">
            0 = Disqualified — this participant will not be announced as a winner. A reason is required.
          </p>
          <label className="mb-1 mt-2 block text-xs font-bold text-neutral-700">Reason *</label>
          <ReasonPicker
            reason={reason}
            customReason={customReason}
            onReasonChange={setReason}
            onCustomReasonChange={setCustomReason}
          />
        </div>
      )}
    </form>
  );
}
