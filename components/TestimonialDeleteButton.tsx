"use client";

import { useState } from "react";
import { deleteTestimonial } from "@/app/actions/admin";

/** Admin/Organizer/Staff-only "✕" on an active testimonial — the only
 * account tier that ever sees this button (see the isManager check at each
 * call site). Confirms first: this notifies the winner and the whole
 * organizer team by email + Telegram DM, and can't be undone from here (the
 * winner can't resubmit either), so a stray click shouldn't be able to
 * trigger it. */
export default function TestimonialDeleteButton({ testimonialId, returnTo }: { testimonialId: string; returnTo: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Remove this testimonial (Admin/Organizer/Staff only)"
        className="text-neutral-400 hover:text-red-600"
      >
        ✕
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">Remove this testimonial?</h3>
            <p className="mt-2 text-xs text-neutral-600">
              This emails and Telegram-DMs the winner and the organizer team. The winner won&apos;t be able to submit
              another one for this competition — but their certificate download and reward payout are not affected.
            </p>
            <form action={deleteTestimonial} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={testimonialId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <textarea
                name="reason"
                rows={2}
                placeholder="Reason (optional) — included in the notification"
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:border-red-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button type="submit" className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
                  Remove testimonial
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
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
