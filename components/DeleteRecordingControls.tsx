"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSubmittedVideo, type DeleteVideoState } from "@/app/actions/account";
import BuyExtraAttemptsButton from "@/components/BuyExtraAttemptsButton";

const initialDeleteState: DeleteVideoState = { ok: false };

/** The "X of 3 deletions used" counter and Delete button for the signed-in
 * participant's own, not-yet-scored recording.
 *
 * These used to live inside the playback window itself, where they ate a
 * fixed strip off the bottom of every frame — on a phone that strip is a
 * large share of the window, and it pushed an already letterboxed portrait
 * recording smaller still. Out here beside the Watch button they cost the
 * video nothing, and they're reachable without opening the recording
 * first. */
export default function DeleteRecordingControls({
  registrationId,
  attemptsUsed,
  maxAttempts,
  hasPendingPurchase,
}: {
  registrationId: string;
  attemptsUsed: number;
  maxAttempts: number;
  hasPendingPurchase: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(deleteSubmittedVideo, initialDeleteState);

  useEffect(() => {
    if (state.ok) {
      setConfirming(false);
      router.refresh();
    }
  }, [state, router]);

  const used = state.attemptsUsed ?? attemptsUsed;
  const left = Math.max(0, maxAttempts - used);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-neutral-500">
        {used} of {maxAttempts} deletions used
      </span>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={left <= 0}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete recording
        </button>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="registration_id" value={registrationId} />
          <span className="text-xs font-semibold text-neutral-700">
            Delete this recording? You&apos;ll need to record again — this can&apos;t be undone.
          </span>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Cancel
          </button>
        </form>
      )}
      {state.error && <p className="w-full text-xs font-semibold text-red-600">{state.error}</p>}
      {left <= 0 && (
        <div className="w-full">
          <BuyExtraAttemptsButton registrationId={registrationId} hasPendingPurchase={hasPendingPurchase} />
        </div>
      )}
    </div>
  );
}
