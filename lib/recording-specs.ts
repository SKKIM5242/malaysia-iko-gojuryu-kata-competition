import { UPLOAD_CEILING_BYTES, KATA_MAX_SECONDS, recordingBitrates } from "@/lib/media-recording";

/** The three kinds of recording the app makes, each with its own length cap
 * and therefore its own sensible quality settings. */
export const SPEC_IDS = ["kata", "testimonial_video", "testimonial_voice"] as const;
export type SpecId = (typeof SPEC_IDS)[number];

export const SPEC_LABEL: Record<SpecId, string> = {
  kata: "Kata Recording",
  testimonial_video: "Video Testimonial",
  testimonial_voice: "Voice Testimonial",
};

/** Video only. The voice row has no picture, so its resolution reads
 * "audio" and every pixel-derived figure is blank rather than zero — a
 * zero would read as "very bad quality" instead of "not applicable". */
export const RESOLUTION_CHOICES = ["480p", "720p", "1080p", "4K", "8K"] as const;
export type ResolutionChoice = (typeof RESOLUTION_CHOICES)[number];

export const RESOLUTION_PIXELS: Record<ResolutionChoice, { w: number; h: number }> = {
  "480p": { w: 854, h: 480 },
  "720p": { w: 1280, h: 720 },
  "1080p": { w: 1920, h: 1080 },
  "4K": { w: 3840, h: 2160 },
  "8K": { w: 7680, h: 4320 },
};

export const FPS_CHOICES = [30, 60] as const;

/** Mbit/s. The organizer's own list, kept exactly as given so the numbers on
 * screen line up with the ones they have been reasoning about. */
export const BITRATE_CHOICES_MBPS = [1, 1.1, 1.3, 1.5, 2, 3, 4] as const;

/** The lengths worth pricing: the three kata family caps (1.5 / 2.5 min and
 * the 5 min maximum) and the testimonial's own 3 and 10. */
export const ESTIMATE_MINUTES = [1.5, 2.5, 3, 5, 10] as const;

export interface RecordingSpec {
  id: SpecId;
  resolution: string;
  fps: number;
  videoKbps: number;
  audioKbps: number;
  /** false = a what-if being modelled here, with no effect on recording.
   * true = the recorders should adopt it. */
  applied: boolean;
  updatedAt: string | null;
}

/** What the CODE does right now, read from the same helper the recorders
 * use — so "Use default" restores the truth rather than a number typed into
 * this file that could drift away from it. */
export function codeDefault(id: SpecId): Omit<RecordingSpec, "applied" | "updatedAt"> {
  if (id === "testimonial_voice") {
    return { id, resolution: "audio", fps: 0, videoKbps: 0, audioKbps: 96 };
  }
  if (id === "testimonial_video") {
    const b = recordingBitrates(10 * 60);
    return {
      id,
      resolution: "480p",
      fps: 24,
      videoKbps: Math.round(b.videoBitsPerSecond / 1000),
      audioKbps: Math.round(b.audioBitsPerSecond / 1000),
    };
  }
  const b = recordingBitrates(KATA_MAX_SECONDS);
  return {
    id,
    resolution: "720p",
    fps: 30,
    videoKbps: Math.round(b.videoBitsPerSecond / 1000),
    audioKbps: Math.round(b.audioBitsPerSecond / 1000),
  };
}

export interface SpecMetrics {
  /** Bits per pixel per frame — the honest measure of picture quality,
   * because it is the only one that accounts for resolution AND frame rate
   * AND bitrate together. Null for an audio-only row. */
  bpp: number | null;
  /** Bytes for each entry in ESTIMATE_MINUTES. */
  sizes: number[];
  /** Seconds of recording that still land under the upload ceiling. */
  longestSeconds: number;
  /** True where a full-length take of this kind would not fit. */
  overCeilingAt: boolean[];
}

export function computeMetrics(spec: {
  resolution: string;
  fps: number;
  videoKbps: number;
  audioKbps: number;
}): SpecMetrics {
  const totalBps = (spec.videoKbps + spec.audioKbps) * 1000;
  const px = RESOLUTION_PIXELS[spec.resolution as ResolutionChoice];
  const bpp = px && spec.fps > 0 && spec.videoKbps > 0 ? (spec.videoKbps * 1000) / (px.w * px.h * spec.fps) : null;
  const sizes = ESTIMATE_MINUTES.map((m) => (totalBps * m * 60) / 8);
  return {
    bpp,
    sizes,
    longestSeconds: totalBps > 0 ? (UPLOAD_CEILING_BYTES * 8) / totalBps : 0,
    overCeilingAt: sizes.map((b) => b > UPLOAD_CEILING_BYTES),
  };
}

/** How the current kata recording's density compares — the yardstick the
 * organizer already has a feel for. */
export function referenceBpp(): number {
  const d = codeDefault("kata");
  const px = RESOLUTION_PIXELS[d.resolution as ResolutionChoice];
  return (d.videoKbps * 1000) / (px.w * px.h * d.fps);
}
