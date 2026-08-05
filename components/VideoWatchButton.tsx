"use client";

import { useEffect, useRef, useState } from "react";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";

/** Opens the recording in a floating window (movable by dragging anywhere,
 * resizable from every border line, minimize / maximize / snap-to-half /
 * close buttons at the top right) — used on Kata Arena, Judging, and the
 * admin Participant Records table. Nothing about the video is editable,
 * including its own controls — see LockedVideo.
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
}: {
  url: string | null;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Null until the browser reports the recording's real dimensions. The
  // window opens maximized on that first beat and reshapes to hug the
  // video the moment its shape is known, rather than guessing at one.
  const [aspect, setAspect] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // The whole reshape hangs on learning the recording's dimensions, and
  // loadedmetadata is a single event that has to be caught: if it fires
  // before this listener is attached, or the element is swapped, or the
  // browser reports it in a way that beats the first paint, the window
  // simply never reshapes and the recording sits letterboxed -- which is
  // exactly the state the organizer kept photographing. So the event is
  // now a fast path, not the only path: while the window is open and the
  // shape is still unknown, poll the element for it as well. Both write
  // the same value, whichever gets there first, and polling stops as soon
  // as it is known.
  useEffect(() => {
    if (!open || aspect !== null) return;
    let frames = 0;
    const timer = setInterval(() => {
      const v = videoRef.current;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        setAspect(v.videoWidth / v.videoHeight);
        clearInterval(timer);
      } else if (++frames > 60) {
        // ~12s: the recording is unplayable or still buffering. Give up
        // rather than poll forever; the window keeps its opening size.
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [open, aspect]);

  if (!url) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Cleared on every open so a window reopened for a DIFFERENT
          // recording re-fits to that one, instead of keeping the shape
          // the previous video happened to have.
          setAspect(null);
          setOpen(true);
        }}
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
          fitAspect={aspect}
        >
          <div className="h-full bg-black">
            <LockedVideo
              ref={videoRef}
              src={url}
              autoPlay
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth > 0 && v.videoHeight > 0) {
                  setAspect(v.videoWidth / v.videoHeight);
                }
              }}
            />
          </div>
        </FloatingWindow>
      )}
    </>
  );
}
