"use client";

import { useActionState, useState } from "react";
import { saveJudgeSelfIntro } from "@/app/actions/account";
import type { AccountActionState } from "@/app/actions/account";
import { JUDGE_SELF_INTRO_MAX_WORDS } from "@/lib/text-limits";
import WordCountedTextarea from "@/components/WordCountedTextarea";

const initial: AccountActionState = { ok: false };

function SingleRefereeIntroForm({ refereeId, defaultValue }: { refereeId: string; defaultValue: string }) {
  const [state, formAction, pending] = useActionState(saveJudgeSelfIntro, initial);
  const [overLimit, setOverLimit] = useState(false);

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="referee_id" value={refereeId} />
      <WordCountedTextarea
        name="judge_self_intro"
        defaultValue={defaultValue}
        maxWords={JUDGE_SELF_INTRO_MAX_WORDS}
        placeholder="Introduce yourself or your school -- phone number or website link are welcome. Shown publicly on the Confirmed Judges section."
        onOverLimitChange={setOverLimit}
      />
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="mt-1 text-xs font-semibold text-green-700">Saved.</p>}
      <button
        type="submit"
        disabled={pending || overLimit}
        className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save introduction"}
      </button>
    </form>
  );
}

/** Self-service editor for the judge's own Confirmed Judges introduction --
 * only ever writable by that judge's own account (see saveJudgeSelfIntro).
 * Takes an array since one login can, rarely, own more than one referees
 * row (e.g. a Sensei independently registered as a judge too). */
export default function JudgeSelfIntroForm({
  referees,
}: {
  referees: Array<{ id: string; judge_self_intro: string | null }>;
}) {
  if (referees.length === 0) return null;
  return (
    <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-sm font-semibold text-neutral-700">
        Your Confirmed Judges introduction <span className="font-normal text-neutral-400">(optional)</span>
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">
        Up to {JUDGE_SELF_INTRO_MAX_WORDS} words, shown on the public Confirmed Judges section once your tier is
        published. Only you can write or edit this.
      </p>
      {referees.map((r) => (
        <SingleRefereeIntroForm key={r.id} refereeId={r.id} defaultValue={r.judge_self_intro ?? ""} />
      ))}
    </div>
  );
}
