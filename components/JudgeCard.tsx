"use client";

import { useState } from "react";
import type { ConfirmedJudge } from "@/lib/data";

/** One judge's public card inside a Confirmed Judges family box: photo,
 * name, role, rank, then an always-present "More detail" toggle -- clicking
 * it reveals the judge's own self-written introduction if they've written
 * one, or a dimmed placeholder if not (they need to fill it in themselves
 * from their own /account page -- see JudgeSelfIntroForm). */
export default function JudgeCard({ judge }: { judge: ConfirmedJudge }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-neutral-100 bg-neutral-50 p-2.5">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {judge.photoUrl ? (
          <img src={judge.photoUrl} alt={judge.fullName} className="h-12 w-12 shrink-0 rounded-full border border-neutral-200 object-cover" />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-neutral-300 bg-white text-[9px] text-neutral-400">
            No photo
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-neutral-900">{judge.fullName}</p>
          {judge.judgeTitle && <p className="truncate text-xs text-neutral-600">{judge.judgeTitle}</p>}
          {judge.karateRank && <p className="truncate text-xs text-neutral-400">{judge.karateRank}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-100"
      >
        {expanded ? "Hide detail" : "More detail"}
      </button>
      {expanded && (
        <p className={`mt-2 whitespace-pre-wrap text-xs ${judge.selfIntro ? "text-neutral-700" : "italic text-neutral-400"}`}>
          {judge.selfIntro || "More detail of judge…"}
        </p>
      )}
    </div>
  );
}
