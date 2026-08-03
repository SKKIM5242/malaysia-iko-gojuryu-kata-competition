import type { WatermarkDirection } from "@/lib/types";

/** Shown wherever no recording exists yet if the organizer hasn't set a
 * custom wording for this tier -- unchanged from the app's original,
 * hardcoded string. */
export const DEFAULT_WATERMARK_TEXT = "Malaysia Open Virtual Karate-do Kata Competition 2026";
export const DEFAULT_WATERMARK_FONT_FAMILY = "Arial, sans-serif";
export const DEFAULT_WATERMARK_COLOR = "#ffffff";

/** Font-safe choices only -- every one of these is either a system font
 * present on effectively every desktop/mobile OS, or (for the CJK options)
 * one of the handful of CJK-capable faces that ship with Windows, macOS, or
 * Android/iOS by default. Anything not actually installed on the device
 * recording falls back to the browser's own generic sans-serif/serif, same
 * as any other unavailable font-family in CSS -- there's no web-font
 * loading involved, so an organizer can't accidentally pick something that
 * fails to render. */
export const WATERMARK_FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet MS" },
  { value: "Impact, sans-serif", label: "Impact" },
  { value: "'Comic Sans MS', sans-serif", label: "Comic Sans MS" },
  { value: "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif", label: "Chinese/Japanese (Kanji-capable)" },
];

/** Matches the organizer's own numbered list exactly -- keep both the
 * order and the wording in sync with it. Also kept in sync with the CHECK
 * constraint on competitions.watermark_direction (migration 0100). */
export const WATERMARK_DIRECTION_OPTIONS: Array<{ value: WatermarkDirection; label: string }> = [
  { value: "ltr", label: "Normal — Left to Right" },
  { value: "vertical_ltr_left", label: "Top to Bottom — at left border" },
  { value: "vertical_rtl_left", label: "Bottom to Top — at left border" },
  { value: "diagonal_up", label: "Left Bottom to Right Top — Diagonally" },
  { value: "diagonal_down", label: "Left Top to Right Bottom — Diagonally" },
  { value: "vertical_ltr_right", label: "Top to Bottom — at right border" },
  { value: "vertical_rtl_right", label: "Bottom to Top — at right border" },
  { value: "rtl_cjk", label: "Chinese/Japanese Kanji font — Right to Left" },
];

/** Just the values from WATERMARK_DIRECTION_OPTIONS, for validating a
 * submitted form value against -- kept as its own export so callers that
 * only need validation don't have to map the options array themselves. */
export const WATERMARK_DIRECTIONS = WATERMARK_DIRECTION_OPTIONS.map((d) => d.value);

export interface WatermarkSettings {
  text: string;
  /** null = auto-sized from the frame's own dimensions, exactly like the
   * app's original behavior before this was configurable. */
  fontSizePx: number | null;
  fontFamily: string;
  bold: boolean;
  color: string;
  direction: WatermarkDirection;
}

/** Fills in the app's defaults for whichever fields the organizer hasn't
 * customized -- the single place both the recorder (canvas + live-preview
 * overlay) and anything else that ever needs to display a competition's
 * watermark should go through, so a null column always resolves the same
 * way everywhere. */
export function resolveWatermarkSettings(competition: {
  watermark_text: string | null;
  watermark_font_size_px: number | null;
  watermark_font_family: string | null;
  watermark_bold: boolean | null;
  watermark_color: string | null;
  watermark_direction: WatermarkDirection | null;
} | null): WatermarkSettings {
  return {
    text: competition?.watermark_text?.trim() || DEFAULT_WATERMARK_TEXT,
    fontSizePx: competition?.watermark_font_size_px ?? null,
    fontFamily: competition?.watermark_font_family?.trim() || DEFAULT_WATERMARK_FONT_FAMILY,
    bold: competition?.watermark_bold ?? false,
    color: competition?.watermark_color?.trim() || DEFAULT_WATERMARK_COLOR,
    direction: competition?.watermark_direction ?? "ltr",
  };
}
