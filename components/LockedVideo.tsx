"use client";

import { forwardRef } from "react";

/**
 * The recording player used inside every floating window. Playback rate is
 * always hidden — normal speed only, no exceptions. Download, Picture-in-
 * Picture, and remote playback are also always hidden for everyone,
 * Admin/Organizer included, per the organizer's explicit instruction —
 * plain play/pause/seek/volume/fullscreen controls only, right-click
 * disabled too so the browser's native context menu can't offer them
 * another way in.
 */
const LockedVideo = forwardRef<
  HTMLVideoElement,
  {
    src: string;
    autoPlay?: boolean;
    className?: string;
    onEnded?: () => void;
    /** Fires once the browser knows the recording's real pixel dimensions
     * — the only point at which its shape can be read. */
    onLoadedMetadata?: React.ReactEventHandler<HTMLVideoElement>;
  }
>(function LockedVideo({ src, autoPlay = false, className, onEnded, onLoadedMetadata }, ref) {
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
      onLoadedMetadata={onLoadedMetadata}
      className={className ?? "h-full w-full bg-black object-contain"}
      controlsList="nodownload noplaybackrate noremoteplayback"
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});

export default LockedVideo;
