"use client";

import { useState } from "react";

/** Opens the recording in an in-page modal instead of a new tab — used on
 * Kata Arena, Judging, and the admin Participant Records table so watching
 * a submission never navigates away from the list you're working through. */
export default function VideoWatchButton({
  url,
  label = "Watch",
  className,
}: {
  url: string | null;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!url) return null;

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
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close video"
              title="Close"
              className="absolute -top-10 right-0 text-sm font-semibold text-white hover:text-neutral-300"
            >
              ✕ Close
            </button>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={url} controls autoPlay className="w-full rounded-lg bg-black shadow-2xl" />
          </div>
        </div>
      )}
    </>
  );
}
