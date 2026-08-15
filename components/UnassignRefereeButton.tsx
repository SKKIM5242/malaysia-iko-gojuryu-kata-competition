"use client";

import { useState } from "react";
import { unassignRefereeFromVideo } from "@/app/actions/admin";

/** The plain "✕" unassign form, same look either way — split out so the
 * forfeit-choice popup below can share it exactly. */
function UnassignForm({
  videoId, refereeUserId, returnTo, forfeit, children,
}: {
  videoId: string; refereeUserId: string; returnTo: string; forfeit?: "true" | "false"; children: React.ReactNode;
}) {
  return (
    <form action={unassignRefereeFromVideo}>
      <input type="hidden" name="video_id" value={videoId} />
      <input type="hidden" name="referee_user_id" value={refereeUserId} />
      <input type="hidden" name="return_to" value={returnTo} />
      {forfeit && <input type="hidden" name="forfeit" value={forfeit} />}
      {children}
    </form>
  );
}

/** Unassign button for the Judging page. When an Organizer/Admin/Staff
 * removes a DIFFERENT referee (askForfeit), a popup asks whether the
 * removal should count as a forfeited assignment before submitting --
 * feeds referees.unassigned_forfeit_count / unassigned_not_forfeit_count.
 * A referee removing themselves (askForfeit false) skips the popup
 * entirely, same one-click behavior as before. */
export default function UnassignRefereeButton({
  videoId,
  refereeUserId,
  returnTo,
  askForfeit,
  title,
}: {
  videoId: string;
  refereeUserId: string;
  returnTo: string;
  askForfeit: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  if (!askForfeit) {
    return (
      <UnassignForm videoId={videoId} refereeUserId={refereeUserId} returnTo={returnTo}>
        <button className="text-neutral-400 hover:text-red-600" title={title}>
          ✕
        </button>
      </UnassignForm>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-neutral-400 hover:text-red-600" title={title}>
        ✕
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">Unassign judge</h3>
            <p className="mt-2 text-sm text-neutral-600">
              Should this removal count as a forfeited assignment for this judge?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <UnassignForm videoId={videoId} refereeUserId={refereeUserId} returnTo={returnTo} forfeit="true">
                <button className="w-full rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
                  Forfeited count
                </button>
              </UnassignForm>
              <UnassignForm videoId={videoId} refereeUserId={refereeUserId} returnTo={returnTo} forfeit="false">
                <button className="w-full rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600">
                  Not a forfeited count
                </button>
              </UnassignForm>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-1 text-center text-xs text-neutral-400 hover:text-neutral-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
