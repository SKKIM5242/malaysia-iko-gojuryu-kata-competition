"use client";

import { useState } from "react";
import { submitScore } from "@/app/actions/account";

export interface ScoringItem {
  videoId: string;
  participantName: string;
  participantCountry: string | null;
  categoryName: string | null;
  playbackUrl: string | null;
  existingScore: number | null;
}

function ScoreRow({ item }: { item: ScoringItem }) {
  const [saved, setSaved] = useState(item.existingScore != null);
  const [pending, setPending] = useState(false);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-neutral-900">{item.participantName}</p>
          <p className="text-xs text-neutral-500">
            {item.participantCountry ?? "—"} · {item.categoryName ?? "—"}
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
        className="mt-3 flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="video_id" value={item.videoId} />
        <label htmlFor={`score-${item.videoId}`} className="text-sm font-medium text-neutral-700">
          Score (0.0–10.0)
        </label>
        <input
          id={`score-${item.videoId}`}
          name="score"
          type="number"
          min={0}
          max={10}
          step={0.1}
          required
          defaultValue={item.existingScore ?? ""}
          className="w-24 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
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
        to you by the organiser.
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
