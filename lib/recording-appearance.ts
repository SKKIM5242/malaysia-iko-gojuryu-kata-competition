// Client-safe: types + defaults only, no server import — same split (and
// same reason) as lib/site-appearance.ts, whose option constants
// (alignment, line height, font family, font size) this reuses rather than
// duplicating so both admin forms offer identical choices.

import type { TextAlign } from "@/lib/site-appearance";

export interface RecordingAppearance {
  id: true;
  logo_path: string | null;

  line1_text: string | null;
  line1_align: TextAlign;
  line1_line_height: number;
  line1_color: string;
  line1_font_size: number;
  line1_font_family: string;
  line1_bold: boolean;

  line2_text: string | null;
  line2_align: TextAlign;
  line2_line_height: number;
  line2_color: string;
  line2_font_size: number;
  line2_font_family: string;
  line2_bold: boolean;

  footer_text: string | null;
  footer_align: TextAlign;
  footer_line_height: number;
  footer_color: string;
  footer_font_size: number;
  footer_font_family: string;
  footer_bold: boolean;

  updated_at: string;
}

/** Used when the row hasn't loaded (or a fetch failed) so a recording
 * screen is never left with a blank banner — the competitor is about to
 * record with this chrome burned into their frame, and an empty header is
 * worse than a slightly stale one. Mirrors the seed values in
 * migration 0121. */
export const RECORDING_APPEARANCE_FALLBACK = {
  line1: "MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION",
  line2: "Organized by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD",
  footer: "Malaysia Open Virtual Karate-do Kata Competition 2026",
} as const;

/** Printed inside the dotted torso, not below the camera view: the words
 * are the instruction for the outline they sit in, and putting them in the
 * body is what makes "stand here" obvious without reading anything. Goes
 * away with the guide, since it means nothing once the take is recorded. */
export const POSE_GUIDE_NOTE =
  "Please place yourself inside this dotted line. Thank you for your co-operation.";
