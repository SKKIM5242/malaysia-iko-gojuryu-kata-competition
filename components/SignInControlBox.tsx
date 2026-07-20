"use client";

import { useState } from "react";
import { updateSignInControl } from "@/app/actions/admin";
import { adminInput, adminLabel, adminBtnSecondary } from "@/components/admin-styles";
import type { Competition } from "@/lib/types";

/** Admin/Organizer-only control over a registrant's sign-in quota — how
 * many sign-ins, which competition tier it's for, and the date range it's
 * valid over. Shown on the Schools/Senseis/Referees/Audience/Support admin
 * pages next to each linked login. Opens as a centered modal (not inline)
 * because it's rendered inside a table cell — a table column is far too
 * narrow to fit this form's fields legibly, whatever width the column is
 * resized to. Render nothing (or the "no login yet" fallback) if the
 * directory record has no linked login — there's no profiles row to
 * control yet. */
export default function SignInControlBox({
  userId,
  signInCount,
  signInLimit,
  signInCompetitionId,
  signInValidFrom,
  signInValidUntil,
  competitions,
  returnTo,
}: {
  userId: string | null;
  signInCount: number;
  signInLimit: number | null;
  signInCompetitionId: string | null;
  signInValidFrom: string | null;
  signInValidUntil: string | null;
  competitions: Competition[];
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);

  if (!userId) {
    return (
      <p className="text-xs text-neutral-400">
        Sign-in control: no linked login yet — they haven&apos;t signed in with a personal code.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Sign-in control ({signInCount})
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">Sign-in control</h3>
                <p className="text-xs text-neutral-500">
                  Admin/Organizer only — {signInCount} sign-in{signInCount === 1 ? "" : "s"} so far.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
                ✕
              </button>
            </div>
            <form action={updateSignInControl} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="user_id" value={userId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <div>
                <label htmlFor={`sil-${userId}`} className={adminLabel}>Sign-in limit (blank = unlimited)</label>
                <input
                  id={`sil-${userId}`}
                  name="sign_in_limit"
                  type="number"
                  min={0}
                  defaultValue={signInLimit ?? ""}
                  className={adminInput}
                />
              </div>
              <div>
                <label htmlFor={`sic-${userId}`} className={adminLabel}>Competition tier</label>
                <select id={`sic-${userId}`} name="sign_in_competition_id" defaultValue={signInCompetitionId ?? ""} className={adminInput}>
                  <option value="">— None —</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`sif-${userId}`} className={adminLabel}>Valid from</label>
                <input id={`sif-${userId}`} name="sign_in_valid_from" type="date" defaultValue={signInValidFrom ?? ""} className={adminInput} />
              </div>
              <div>
                <label htmlFor={`siu-${userId}`} className={adminLabel}>Valid until</label>
                <input id={`siu-${userId}`} name="sign_in_valid_until" type="date" defaultValue={signInValidUntil ?? ""} className={adminInput} />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600 sm:col-span-2">
                <input type="checkbox" name="reset_count" className="h-3.5 w-3.5" />
                Reset sign-in count to 0
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className={adminBtnSecondary}>Save sign-in control</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
