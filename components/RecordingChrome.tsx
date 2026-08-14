"use client";

import type { CSSProperties } from "react";
import { fontStackFor } from "@/lib/site-appearance";
import {
  RECORDING_APPEARANCE_FALLBACK,
  POSE_GUIDE_NOTE,
  type RecordingAppearance,
} from "@/lib/recording-appearance";

/**
 * The banner and footer watermark that frame every recording screen, driven
 * by the Recording Appearance section on the admin Competitions page.
 *
 * Split out of the recorders rather than written inline in each: the kata
 * recorder and the testimonial recorder must show identical chrome, and two
 * hand-maintained copies of a banner is exactly how they drift apart.
 *
 * Falls back to the organizer's own wording when the settings row hasn't
 * loaded — a competitor is about to record with this on screen, and a blank
 * header reads as broken.
 */

function textStyle(
  color: string,
  size: number,
  family: string,
  bold: boolean,
  align: string,
  lineHeight: number,
): CSSProperties {
  return {
    color,
    fontSize: `${size}px`,
    fontFamily: fontStackFor(family),
    fontWeight: bold ? 700 : 400,
    textAlign: align as CSSProperties["textAlign"],
    lineHeight,
  };
}

export function RecordingBanner({
  settings,
  logoUrl,
  className = "",
}: {
  settings: RecordingAppearance | null;
  logoUrl: string | null;
  className?: string;
}) {
  const line1 = settings?.line1_text ?? RECORDING_APPEARANCE_FALLBACK.line1;
  const line2 = settings?.line2_text ?? RECORDING_APPEARANCE_FALLBACK.line2;

  return (
    <div
      className={
        "flex items-center gap-3 bg-gradient-to-r from-[#8b1e3f] via-[#6b2f7a] to-[#1e3a8a] px-3 py-2 " + className
      }
    >
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a Supabase
        // public-bucket URL, not a build-time asset, so next/image's
        // optimizer would need a remote-pattern allowlist for no gain on a
        // single small logo.
        <img src={logoUrl} alt="" className="h-9 w-auto shrink-0 object-contain" />
      )}
      <div className="min-w-0 flex-1">
        {line1 && (
          <p
            className="truncate"
            style={textStyle(
              settings?.line1_color ?? "#ffffff",
              settings?.line1_font_size ?? 18,
              settings?.line1_font_family ?? "serif",
              settings?.line1_bold ?? true,
              settings?.line1_align ?? "center",
              settings?.line1_line_height ?? 1.2,
            )}
          >
            {line1}
          </p>
        )}
        {line2 && (
          <p
            className="truncate"
            style={textStyle(
              settings?.line2_color ?? "#ffffff",
              settings?.line2_font_size ?? 11,
              settings?.line2_font_family ?? "sans",
              settings?.line2_bold ?? false,
              settings?.line2_align ?? "center",
              settings?.line2_line_height ?? 1.2,
            )}
          >
            {line2}
          </p>
        )}
      </div>
    </div>
  );
}

export function RecordingFooterWatermark({
  settings,
  className = "",
}: {
  settings: RecordingAppearance | null;
  className?: string;
}) {
  const text = settings?.footer_text ?? RECORDING_APPEARANCE_FALLBACK.footer;
  if (!text) return null;
  return (
    <div className={"bg-black/70 px-3 py-1.5 " + className}>
      <p
        style={textStyle(
          settings?.footer_color ?? "#ffffff",
          settings?.footer_font_size ?? 12,
          settings?.footer_font_family ?? "sans",
          settings?.footer_bold ?? true,
          settings?.footer_align ?? "center",
          settings?.footer_line_height ?? 1.2,
        )}
      >
        {text}
      </p>
    </div>
  );
}

/**
 * The dotted head/body/arms outline a winner lines themselves up against
 * before recording a video testimonial.
 *
 * Drawn as an SVG with a viewBox rather than fixed pixels so it scales to
 * whatever size the camera view ends up — the same guide has to work on a
 * phone in portrait and a laptop in landscape, and a pixel-positioned
 * outline would only frame correctly at one width. `preserveAspectRatio`
 * keeps the figure's proportions instead of stretching a person-shaped
 * guide into whatever the video's aspect happens to be.
 *
 * Purely an on-screen aid: it is never drawn into the recorded frames, and
 * it is hidden during replay and after submission (see TestimonialRecorder)
 * because by then there is nothing left to line up against.
 */
export function PoseGuideOverlay({
  label = "Testimonial",
  note = POSE_GUIDE_NOTE,
  className = "",
}: {
  label?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={"pointer-events-none absolute inset-0 " + className} aria-hidden="true">
      <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
        {/* Screen label, top left, matching the organizer's mock-up. */}
        <text x={12} y={26} fill="#ffffff" fontSize={15} fontFamily="ui-sans-serif, system-ui, sans-serif">
          {label}
        </text>

        <g
          fill="none"
          stroke="#ffffff"
          strokeWidth={3}
          strokeDasharray="10 8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.95}
        >
          {/* Head */}
          <circle cx={150} cy={92} r={57} />
          {/* Neck */}
          <path d="M132 143 V166" />
          <path d="M168 143 V166" />
          {/* Shoulders and torso — rounded, so it reads as a body rather
              than a box, with the arms continuing off the bottom edge. */}
          <path d="M78 400 V196 Q78 166 108 166 H192 Q222 166 222 196 V400" />
          {/* Inner arm lines, so the arms read as arms and not as one solid
              block with the torso. */}
          <path d="M112 305 V400" />
          <path d="M188 305 V400" />
        </g>

        {/* The instruction sits INSIDE the torso rather than under the
            camera view: the sentence is about the outline it is printed in,
            and a competitor lining themselves up is looking at the body
            shape, not at caption text below the picture. Wrapped by hand
            because SVG text has no automatic wrapping. */}
        <text
          x={150}
          y={232}
          fill="#ffffff"
          fontSize={16}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          textAnchor="middle"
        >
          {wrapNote(note).map((line, i) => (
            <tspan key={i} x={150} dy={i === 0 ? 0 : 21}>
              {line}
            </tspan>
          ))}
        </text>
      </svg>
    </div>
  );
}

/** Breaks the instruction into lines narrow enough to sit inside the torso.
 * Greedy fill at a fixed character budget rather than measured text: the
 * SVG scales with the video, so a pixel measurement taken at one size would
 * be wrong at every other one, while a character count stays proportional.
 *
 * 15 is not arbitrary — the torso is 144 user units wide (x 78→222) and at
 * 16px sans a character averages ~8.2 units, so 15 characters is ~123 units
 * and leaves a margin on both sides. Raising either number pushes the
 * longest line out through the dotted outline. */
function wrapNote(note: string, maxChars = 15): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of note.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export { POSE_GUIDE_NOTE };
