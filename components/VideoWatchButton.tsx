"use client";

import { useState } from "react";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";

/** Opens the recording in a floating window (movable by dragging anywhere,
 * resizable from every border line, minimize / maximize / snap-to-half /
 * close buttons at the top right) — used on Kata Arena, Judging, and the
 * admin Participant Records table. The browser's three-dot video menu is
 * Admin/Organizer only via `allowAdvancedControls`.
 *
 * The window holds nothing but the recording. The deletion counter and
 * Delete button used to sit in a strip along the bottom here; they now
 * live beside the Watch button on the page itself (see
 * DeleteRecordingControls), which gives the video the entire window
 * instead of the window minus a fixed strip — most of a phone screen's
 * worth of difference on an already letterboxed portrait recording. */
export default function VideoWatchButton({
  url,
  label = "Watch",
  className,
  allowAdvancedControls = false,
}: {
  url: string | null;
  label?: string;
  className?: string;
  allowAdvancedControls?: boolean;
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
        <FloatingWindow
          title="Watch Recording"
          onClose={() => setOpen(false)}
          initial="max"
          defaultWidth={760}
          defaultHeight={560}
        >
          <div className="h-full bg-black">
            <LockedVideo src={url} autoPlay allowAdvancedControls={allowAdvancedControls} />
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
