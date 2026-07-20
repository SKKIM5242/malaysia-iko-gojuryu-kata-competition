"use client";

import { useState } from "react";
import { saveAutoAssignCriterion } from "@/app/actions/admin";
import { adminInput, adminLabel, adminBtn, adminBtnSecondary } from "@/components/admin-styles";

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
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
                  min={1}
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
              <button type="submit" className={adminBtnSecondary}>Save</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
