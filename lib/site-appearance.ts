// Client-safe: constants + types only, no server import. The fetch helper
// lives in lib/site-appearance-server.ts instead -- a "use client" form
// component (SiteAppearanceForm) needs the options/types below, and a
// server-only import chain (next/headers) anywhere in this file would
// contaminate that client bundle even though the form itself never calls
// getSiteAppearance().

export const TEXT_ALIGN_OPTIONS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGN_OPTIONS)[number];

/** Line-height presets shown as named choices rather than a free-typed
 * number — matches the "with choices" wording for every line-spacing
 * control in the Site Appearance form. */
export const LINE_HEIGHT_OPTIONS = [
  { value: 1, label: "Tight (1.0)" },
  { value: 1.25, label: "Snug (1.25)" },
  { value: 1.5, label: "Normal (1.5)" },
  { value: 1.75, label: "Relaxed (1.75)" },
  { value: 2, label: "Loose (2.0)" },
] as const;

/** Curated, web-safe font stacks — an arbitrary Google Font can't be
 * offered without adding font-loading infrastructure, so this sticks to
 * fonts every browser already has. */
export const FONT_FAMILY_OPTIONS = [
  { value: "sans", label: "Sans-serif (default)", stack: "ui-sans-serif, system-ui, sans-serif" },
  { value: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  { value: "mono", label: "Monospace", stack: "ui-monospace, 'Courier New', monospace" },
  { value: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { value: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { value: "trebuchet", label: "Trebuchet MS", stack: "'Trebuchet MS', sans-serif" },
  { value: "georgia", label: "Georgia", stack: "Georgia, serif" },
  { value: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { value: "courier", label: "Courier New", stack: "'Courier New', Courier, monospace" },
] as const;

export const FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36] as const;

export function fontStackFor(key: string): string {
  return FONT_FAMILY_OPTIONS.find((f) => f.value === key)?.stack ?? FONT_FAMILY_OPTIONS[0].stack;
}

export interface SiteButton {
  id: string;
  label: string;
  url: string;
}

export interface SiteAppearance {
  id: true;
  logo_path: string | null;

  title_text: string | null;
  title_align: TextAlign;
  title_line_height: number;
  title_color: string;
  title_font_size: number;
  title_font_family: string;
  title_bold: boolean;

  subtitle_text: string | null;
  subtitle_align: TextAlign;
  subtitle_line_height: number;
  subtitle_color: string;
  subtitle_font_size: number;
  subtitle_font_family: string;
  subtitle_bold: boolean;

  menu_color: string;
  menu_font_size: number;
  menu_bold: boolean;
  menu_font_family: string;
  menu_align: TextAlign;
  menu_line_height: number;

  footer_text: string | null;
  footer_align: TextAlign;
  footer_line_height: number;
  footer_color: string;
  footer_font_size: number;
  footer_font_family: string;
  footer_bold: boolean;

  buttons: SiteButton[];
  updated_at: string;
}
