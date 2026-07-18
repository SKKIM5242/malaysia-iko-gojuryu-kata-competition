"use client";

import { useMemo, useState } from "react";
import { submitScore } from "@/app/actions/account";
import { CategoryName } from "@/components/ui";
import { SCORING_CRITERIA, splitEvenly } from "@/lib/scoring-rubric";

export interface ScoringItem {
  videoId: string;
  participantName: string;
  participantCountry: string | null;
  categoryName: string | null;
  playbackUrl: string | null;
  existingScore: number | null;
}

/** The rubric table itself — shared by the popup (editable, for a referee)
 * and the read-only admin detail view via the `readOnly` prop. Matches
 * "SCORE TABLE 2 WITH FORMULA.xlsx" exactly: No. / Criteria / Range / Score,
 * ending in a Total Score row. */
export function RubricTable({
  values,
  onChange,
  readOnly,
}: {
  values: number[];
  onChange?: (i: number, raw: string) => void;
  readOnly?: boolean;
}) {
  const total = useMemo(() => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10, [values]);
  const disqualifying = total === 0;
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-2 py-1.5">No.</th>
              <th className="px-2 py-1.5">Criteria</th>
              <th className="px-2 py-1.5">Range</th>
              <th className="px-2 py-1.5">{readOnly ? "Score" : "Your score"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {SCORING_CRITERIA.map((c, i) => (
              <tr key={c.label}>
                <td className="px-2 py-1.5 text-neutral-400">{i + 1}.</td>
                <td className="px-2 py-1.5">{c.label}</td>
                <td className="px-2 py-1.5 text-neutral-400">0–{c.max}</td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="font-semibold text-neutral-800">{(values[i] ?? 0).toFixed(1)}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={c.max}
                      step={0.1}
                      value={values[i]}
                      onChange={(e) => onChange?.(i, e.target.value)}
                      className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    />
                  )}
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
    </>
  );
}

function ScorePopup({ item, onClose }: { item: ScoringItem; onClose: () => void }) {
  const [saved, setSaved] = useState(item.existingScore != null);
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<number[]>(() => splitEvenly(item.existingScore));

  const total = useMemo(() => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10, [values]);

  function setCriterion(i: number, raw: string) {
    const n = Math.max(0, Math.min(SCORING_CRITERIA[i].max, Number(raw) || 0));
    setValues((v) => v.map((x, idx) => (idx === i ? n : x)));
    setSaved(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-neutral-900">{item.participantName}</p>
            <p className="text-xs text-neutral-500">
              {item.participantCountry ?? "—"} · <CategoryName name={item.categoryName} />
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
            ✕
          </button>
        </div>

        {item.playbackUrl ? (
          <video src={item.playbackUrl} controls playsInline className="mb-3 w-full rounded-md border border-neutral-200" />
        ) : (
          <p className="mb-3 text-sm text-neutral-400">Video not available.</p>
        )}

        <form
          action={async (formData) => {
            setPending(true);
            await submitScore(formData);
            setPending(false);
            setSaved(true);
          }}
        >
          <input type="hidden" name="video_id" value={item.videoId} />
          <input type="hidden" name="score" value={total} />
          {values.map((v, i) => (
            <input key={i} type="hidden" name="criteria" value={v} />
          ))}
          <RubricTable values={values} onChange={setCriterion} />
          <p className="mt-2 text-xs text-neutral-400">
            Submitting is final — scores cannot be appealed or changed once judging closes.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {pending ? "Saving…" : item.existingScore != null ? "Update score" : "Submit score"}
            </button>
            {saved && <span className="text-xs font-semibold text-green-700">✔ Score saved</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function ScoreRow({ item }: { item: ScoringItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-neutral-900">{item.participantName}</p>
          <p className="text-xs text-neutral-500">
            {item.participantCountry ?? "—"} · <CategoryName name={item.categoryName} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.existingScore != null && (
            <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
              Total {item.existingScore.toFixed(1)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
          >
            {item.existingScore != null ? "Update score" : "Score this recording"}
          </button>
        </div>
      </div>
      {open && <ScorePopup item={item} onClose={() => setOpen(false)} />}
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
        to you by the organiser. Your score is final once submitted — no appeal is available. Click
        &quot;Score this recording&quot; to open the official scoring sheet — works the same on
        laptop, desktop, tablet, or phone.
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
