"use client";

import { useMemo, useState } from "react";
import { submitScore } from "@/app/actions/account";
import { CategoryName } from "@/components/ui";

export interface ScoringItem {
  videoId: string;
  participantName: string;
  participantCountry: string | null;
  categoryName: string | null;
  playbackUrl: string | null;
  existingScore: number | null;
}

/** The organiser's official scoring rubric — copied exactly from
 * "SCORE TABLE 2 WITH FORMULA.xlsx": 7 criteria, each judge fills in every
 * one, and they sum to that judge's Total Score (matching the sheet's
 * =SUM(D4:D10) formula) — no separate DB column per criterion, only the
 * total is submitted, same as before. */
const CRITERIA: Array<{ label: string; max: number }> = [
  { label: "Neat appearance of uniform and person", max: 1 },
  { label: "Approach, formal bowing, and exit", max: 1 },
  { label: "Proper performance of techniques", max: 1 },
  { label: "Balance and flow", max: 1 },
  { label: "Completion of kata", max: 1 },
  { label: "Spirit or feeling in kata", max: 3 },
  { label: "Execution of techniques (sharpness)", max: 3 },
];

function splitEvenly(total: number | null): number[] {
  if (total == null) return CRITERIA.map(() => 0);
  // Distribute a previously-submitted total back across criteria proportional
  // to each row's max, so re-opening a scored entry shows a plausible split
  // rather than all zeros — the judge can always adjust before re-submitting.
  const maxSum = CRITERIA.reduce((a, c) => a + c.max, 0);
  return CRITERIA.map((c) => Math.round((total * (c.max / maxSum)) * 10) / 10);
}

function ScoreRow({ item }: { item: ScoringItem }) {
  const [saved, setSaved] = useState(item.existingScore != null);
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<number[]>(() => splitEvenly(item.existingScore));

  const total = useMemo(() => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10, [values]);
  const disqualifying = total === 0;

  function setCriterion(i: number, raw: string) {
    const n = Math.max(0, Math.min(CRITERIA[i].max, Number(raw) || 0));
    setValues((v) => v.map((x, idx) => (idx === i ? n : x)));
    setSaved(false);
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-neutral-900">{item.participantName}</p>
          <p className="text-xs text-neutral-500">
            {item.participantCountry ?? "—"} · <CategoryName name={item.categoryName} />
          </p>
        </div>
        {saved && <span className="text-xs font-semibold text-green-700">✔ Score saved</span>}
      </div>

      {item.playbackUrl ? (
        <video src={item.playbackUrl} controls playsInline className="mt-3 w-full max-w-sm rounded-md border border-neutral-200" />
      ) : (
        <p className="mt-3 text-sm text-neutral-400">Video not available.</p>
      )}

      <form
        action={async (formData) => {
          setPending(true);
          await submitScore(formData);
          setPending(false);
          setSaved(true);
        }}
        className="mt-3"
      >
        <input type="hidden" name="video_id" value={item.videoId} />
        <input type="hidden" name="score" value={total} />
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-2 py-1.5">No.</th>
                <th className="px-2 py-1.5">Criteria</th>
                <th className="px-2 py-1.5">Range</th>
                <th className="px-2 py-1.5">Your score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {CRITERIA.map((c, i) => (
                <tr key={c.label}>
                  <td className="px-2 py-1.5 text-neutral-400">{i + 1}.</td>
                  <td className="px-2 py-1.5">{c.label}</td>
                  <td className="px-2 py-1.5 text-neutral-400">0–{c.max}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      max={c.max}
                      step={0.1}
                      value={values[i]}
                      onChange={(e) => setCriterion(i, e.target.value)}
                      className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    />
                  </td>
                </tr>
              ))}
              <tr className="bg-neutral-50 font-semibold">
                <td colSpan={3} className="px-2 py-2 text-right">Total Score</td>
                <td className={`px-2 py-2 ${disqualifying ? "text-red-700" : "text-neutral-900"}`}>
                  {total.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {disqualifying && (
          <p className="mt-2 text-xs font-semibold text-red-700">
            A Total Score of 0 disqualifies this participant — they will not be announced as a
            winner, regardless of the other judges&apos; scores.
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-400">
          Submitting is final — scores cannot be appealed or changed once judging closes.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : item.existingScore != null ? "Update score" : "Submit score"}
        </button>
      </form>
    </div>
  );
}

export default function RefereeScoring({
  refereeName,
  refereeCountry,
  items,
}: {
  refereeName: string;
  refereeCountry: string | null;
  items: ScoringItem[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        Signed in as Referee/Judge <strong>{refereeName}</strong>
        {refereeCountry ? ` (${refereeCountry})` : ""}. You can only score the participants assigned
        to you by the organiser. Your score is final once submitted — no appeal is available.
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-neutral-500">
          No participants assigned to you yet. Check back once the organiser assigns recordings for
          you to judge.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ScoreRow key={item.videoId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
