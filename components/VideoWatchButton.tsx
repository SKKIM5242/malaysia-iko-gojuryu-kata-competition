"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSubmittedVideo, type DeleteVideoState } from "@/app/actions/account";

const initialDeleteState: DeleteVideoState = { ok: false };
const MAX_ATTEMPTS = 3;

/** Opens the recording in an in-page modal instead of a new tab — used on
 * Kata Arena, Judging, and the admin Participant Records table so watching
 * a submission never navigates away from the list you're working through.
 * Pass `deletable` (only for the signed-in participant's own, not-yet-scored
 * recording) to add a Delete button + "X of 3 deletions used" counter next
 * to Close — deleting frees them to record again. */
export default function VideoWatchButton({
  url,
  label = "Watch",
  className,
  deletable,
}: {
  url: string | null;
  label?: string;
  className?: string;
  deletable?: { registrationId: string; attemptsUsed: number };
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
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attemptsUsed);

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
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="absolute -top-10 right-0 flex items-center gap-3">
              {deletable && (
                <span className="text-xs font-semibold text-white">
                  {attemptsUsed} of {MAX_ATTEMPTS} deletions used
                </span>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close video"
                title="Close"
                className="text-sm font-semibold text-white hover:text-neutral-300"
              >
                ✕ Close
              </button>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={url} controls autoPlay className="w-full rounded-lg bg-black shadow-2xl" />

            {deletable && (
              <div className="mt-3 rounded-lg bg-white p-3">
                {state.error && (
                  <p className="mb-2 text-xs font-semibold text-red-600">{state.error}</p>
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
        </div>
      )}
    </>
  );
}
