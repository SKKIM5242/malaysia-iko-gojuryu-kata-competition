"use client";

import { useState } from "react";
import { TESTIMONIAL_KIND_LABEL, type TestimonialKind } from "@/lib/testimonials";
import TestimonialDeleteButton from "@/components/TestimonialDeleteButton";

/** "Testimonial" column cell on the admin Rewards / Winners pages — a
 * clickable "✅ Done" that opens the actual testimonial in a modal (with a
 * "✕" to remove it, for Admin/Organizer/Staff only), "🚫 Removed" once an
 * organizer has done that, or a plain "⏳ Pending" when the winner hasn't
 * submitted one yet. Always reflects the current database state on every
 * page load (this is a server-rendered table with no caching layer of its
 * own), so it updates the moment a winner submits or an organizer removes
 * one, not on any kind of daily delay. */
export default function TestimonialStatusCell({
  testimonial,
  canDelete,
  returnTo,
}: {
  testimonial: { id: string; kind: TestimonialKind; mediaUrl: string | null; message: string | null; deleted: boolean } | null;
  canDelete: boolean;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);

  if (!testimonial) {
    return <span className="text-xs font-semibold text-amber-700">⏳ Pending</span>;
  }

  if (testimonial.deleted) {
    return <span className="text-xs font-semibold text-neutral-400">🚫 Removed</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-green-700 underline underline-offset-2 hover:text-green-800"
      >
        ✅ Done
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">{TESTIMONIAL_KIND_LABEL[testimonial.kind]}</h3>
              <div className="flex items-center gap-3">
                {canDelete && <TestimonialDeleteButton testimonialId={testimonial.id} returnTo={returnTo} />}
                <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>
            {testimonial.kind === "video" && testimonial.mediaUrl && (
              <video src={testimonial.mediaUrl} controls playsInline className="w-full rounded-md bg-black" />
            )}
            {testimonial.kind === "voice" && testimonial.mediaUrl && <audio src={testimonial.mediaUrl} controls className="w-full" />}
            {testimonial.kind === "message" && testimonial.message && (
              <blockquote className="rounded-md border-l-4 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm italic text-neutral-700">
                “{testimonial.message}”
              </blockquote>
            )}
          </div>
        </div>
      )}
    </>
  );
}
