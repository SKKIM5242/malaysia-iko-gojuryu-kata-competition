"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSubmittedVideo, type DeleteVideoState } from "@/app/actions/account";
import BuyExtraAttemptsButton from "@/components/BuyExtraAttemptsButton";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";

const initialDeleteState: DeleteVideoState = { ok: false };

/** Opens the recording in a floating window (movable by dragging anywhere,
 * resizable from every border line, minimize / maximize / snap-to-half /
 * close buttons at the top right) — used on Kata Arena, Judging, and the
 * admin Participant Records table. The browser's three-dot video menu is
 * Admin/Organizer only via `allowAdvancedControls`. Pass `deletable` (only
 * for the signed-in participant's own, not-yet-scored recording) to add a
 * Delete button + "X of 3 deletions used" counter — deleting frees them to
 * record again. */
export default function VideoWatchButton({
  url,
  label = "Watch",
  className,
  deletable,
  allowAdvancedControls = false,
}: {
  url: string | null;
  label?: string;
  className?: string;
  deletable?: { registrationId: string; attemptsUsed: number; maxAttempts: number; hasPendingPurchase: boolean };
  allowAdvancedControls?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(deleteSubmittedVideo, initialDeleteState);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setConfirming(false);
      router.refresh();
    }
  }, [state, router]);

  if (!url) return null;

  const attemptsUsed = state.attemptsUsed ?? deletable?.attemptsUsed ?? 0;
  const maxAttempts = deletable?.maxAttempts ?? 3;
  const attemptsLeft = Math.max(0, maxAttempts - attemptsUsed);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "shrink-0 rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        }
      >
        {label}
      </button>
      {open && (
        <FloatingWindow title="Watch Recording" onClose={() => setOpen(false)} defaultWidth={760} defaultHeight={560}>
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 bg-black">
              <LockedVideo src={url} autoPlay allowAdvancedControls={allowAdvancedControls} />
            </div>
            {deletable && (
              <div className="shrink-0 border-t border-neutral-200 bg-white p-3">
                <p className="mb-2 text-xs font-semibold text-neutral-500">
                  {attemptsUsed} of {maxAttempts} deletions used
                </p>
                {state.error && <p className="mb-2 text-xs font-semibold text-red-600">{state.error}</p>}
                {attemptsLeft <= 0 && (
                  <div className="mb-2">
                    <BuyExtraAttemptsButton hasPendingPurchase={deletable.hasPendingPurchase} />
                  </div>
                )}
                {!confirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={attemptsLeft <= 0}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete recording
                  </button>
                ) : (
                  <form action={formAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="registration_id" value={deletable.registrationId} />
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
              </div>
            )}
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
