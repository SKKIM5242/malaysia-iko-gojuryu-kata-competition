"use client";

import { useState } from "react";
import { submitScore } from "@/app/actions/account";
import { DISQUALIFICATION_REASONS, OTHER_DISQUALIFICATION_REASON } from "@/lib/scoring-rubric";

/** The plain single-number "Admin/Organizer override" score field on the
 * Judging page (no rubric sheet, just a Total Score straight in) — same
 * "0 requires a reason" rule as Score Sheet 1/2 in RefereeScoring.tsx, so
 * an override score of 0 can't be submitted without picking a reason
 * (dropdown) or typing one ("Others"). */
export default function QuickScoreForm({
  videoId,
  existingScore,
}: {
  videoId: string;
  existingScore: number | null;
}) {
  const [score, setScore] = useState(existingScore != null ? String(existingScore) : "");
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
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
          {existingScore != null ? "Update your score" : "Score this recording"} (0–10) — Admin/Organizer override
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
      </div>
      {isZero && (
        <div className="mt-2 max-w-md rounded-md border-2 border-red-300 bg-red-50 p-3">
          <p className="text-xs font-semibold text-red-700">
            0 = Disqualified — this participant will not be announced as a winner. A reason is required.
          </p>
          <label htmlFor={`override_reason_${videoId}`} className="mb-1 mt-2 block text-xs font-bold text-neutral-700">
            Reason *
          </label>
          <select
            id={`override_reason_${videoId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="" disabled>Select a reason…</option>
            {DISQUALIFICATION_REASONS.map((r, i) => (
              <option key={r} value={r}>{i + 1}) {r}</option>
            ))}
            <option value={OTHER_DISQUALIFICATION_REASON}>{DISQUALIFICATION_REASONS.length + 1}) {OTHER_DISQUALIFICATION_REASON}</option>
          </select>
          {reason === OTHER_DISQUALIFICATION_REASON && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Type the reason…"
              required
              className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          )}
        </div>
      )}
    </form>
  );
}
