"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveAutoAssignCriterion } from "@/app/actions/admin";
import { adminInput, adminLabel, adminBtn, adminBtnSecondary } from "@/components/admin-styles";

/** Save button that knows the form is in flight. Without this a slow save
 * looked like a dead button: nothing changed on screen until the server
 * action's redirect landed, so the natural response was to press it again. */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${adminBtnSecondary} disabled:opacity-60`}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

/** Add (blank) or Edit (pre-filled) a row of the Auto-Assign Criteria
 * list — same centered-modal pattern as SignInControlBox/ScoreDetailButton,
 * so the form always has room regardless of the table column it's
 * triggered from. */
export default function AutoAssignCriterionModal({
  criterion,
  returnTo,
}: {
  criterion?: { id: string; position: number; title: string; description: string };
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = !!criterion;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          isEdit
            ? "rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
            : adminBtn
        }
      >
        {isEdit ? "Edit" : "Add criterion"}
      </button>
      {open && (
        // Deliberately NOT closable by clicking the backdrop. Save sits at the
        // bottom-left of the card, and on a phone a tap that lands a few
        // pixels outside it hit the backdrop instead -- the dialog closed and
        // the edit was thrown away silently, which reads exactly like "the
        // Save button does nothing". Leaving is now always a deliberate act:
        // Cancel or the ✕.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">
                {isEdit ? "Edit criterion" : "Add criterion"}
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
                ✕
              </button>
            </div>
            <form action={saveAutoAssignCriterion} className="space-y-3">
              {criterion && <input type="hidden" name="id" value={criterion.id} />}
              <input type="hidden" name="return_to" value={returnTo} />
              <div>
                <label htmlFor="aac_position" className={adminLabel}>Order</label>
                <input
                  id="aac_position"
                  name="position"
                  type="number"
                  // min 0, not 1: the column's own default is 0, and a 0 (or a
                  // cleared field re-typed as 0) failed the browser's built-in
                  // validation, which silently refuses to submit and shows its
                  // tooltip against a field that may be scrolled out of view
                  // inside this dialog. The action coerces the value anyway.
                  min={0}
                  defaultValue={criterion?.position ?? ""}
                  className={`${adminInput} w-24`}
                />
              </div>
              <div>
                <label htmlFor="aac_title" className={adminLabel}>Title *</label>
                <input id="aac_title" name="title" required defaultValue={criterion?.title ?? ""} className={adminInput} />
              </div>
              <div>
                <label htmlFor="aac_description" className={adminLabel}>Description</label>
                <textarea
                  id="aac_description"
                  name="description"
                  rows={3}
                  defaultValue={criterion?.description ?? ""}
                  className={adminInput}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SaveButton />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
