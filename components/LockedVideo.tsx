"use client";

import { forwardRef } from "react";

/**
 * The recording player used inside every floating window. The browser's
 * three-dot overflow menu (Download / Picture-in-Picture / playback rate)
 * is only exposed when `allowAdvancedControls` is true — Admin/Organizer
 * only, per the organizer's instruction; everyone else gets plain
 * play/pause/seek/volume/fullscreen controls with right-click disabled.
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
      onEnded={onEnded}
      className={className ?? "h-full w-full bg-black object-contain"}
      {...(allowAdvancedControls
        ? {}
        : {
            controlsList: "nodownload noplaybackrate noremoteplayback",
            disablePictureInPicture: true,
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
          })}
    />
  );
});

export default LockedVideo;
