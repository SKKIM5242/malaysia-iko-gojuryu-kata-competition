"use client";

import { forwardRef } from "react";

/**
 * The recording player used inside every floating window. Playback rate is
 * always hidden now — normal speed only, no exceptions — per the
 * organizer's explicit instruction; the browser's three-dot overflow menu
 * still additionally exposes Download/Picture-in-Picture only when
 * `allowAdvancedControls` is true (Admin/Organizer), everyone else gets
 * plain play/pause/seek/volume/fullscreen controls with right-click
 * disabled.
 */
const LockedVideo = forwardRef<
  HTMLVideoElement,
  {
    src: string;
    allowAdvancedControls?: boolean;
    autoPlay?: boolean;
    className?: string;
    onEnded?: () => void;
  }
>(function LockedVideo({ src, allowAdvancedControls = false, autoPlay = false, className, onEnded }, ref) {
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={ref}
      src={src}
      controls
      autoPlay={autoPlay}
      playsInline
      preload="auto"
      onEnded={onEnded}
      className={className ?? "h-full w-full bg-black object-contain"}
      controlsList={allowAdvancedControls ? "noplaybackrate" : "nodownload noplaybackrate noremoteplayback"}
      {...(allowAdvancedControls
        ? {}
        : {
            disablePictureInPicture: true,
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
          })}
    />
  );
});

export default LockedVideo;
