/** Shared vocabulary for participant-filed technical issue reports — used
 * by the reporting form, the server action that validates it, and the
 * admin triage table, so the three can't drift apart on what a valid
 * value is. */

export const MAX_ISSUE_SCREENSHOTS = 20;

/** The 3-way "or" in the report form's own heading, turned into a pick --
 * "viewing" covers the page/site/app-display case, "recording_window"
 * covers the portrait/landscape recorder specifically, and "technical"
 * covers everything else (login/access problems and similar). */
export type IssueType = "viewing" | "recording_window" | "technical";

export const ISSUE_TYPE_OPTIONS: Array<{ value: IssueType; label: string; hint: string }> = [
  {
    value: "viewing",
    label: "Viewing the page, site, or app",
    hint: "Something looks wrong or inconsistent on a page.",
  },
  {
    value: "recording_window",
    label: "Recording window (portrait/landscape)",
    hint: "The kata recording screen itself, in either orientation.",
  },
  {
    value: "technical",
    label: "Other technical issue",
    hint: "e.g. Sign In / Access Matrix on the Kata Arena log-in page.",
  },
];

export const ISSUE_TYPES = ISSUE_TYPE_OPTIONS.map((o) => o.value);

export function issueTypeLabel(value: string): string {
  return ISSUE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export type IssueViewType = "portrait" | "landscape" | "both";

export const VIEW_TYPE_OPTIONS: Array<{ value: IssueViewType; label: string }> = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
  { value: "both", label: "Both Portrait & Landscape" },
];

export const VIEW_TYPES = VIEW_TYPE_OPTIONS.map((o) => o.value);

/** Screen sizes offered in the "what specification is your screen" list.
 * Deliberately the same set the organizer tests against in the browser's
 * device toolbar, so a report can be reproduced by picking the same entry
 * there. `other` is always last and switches on a free-text box. */
export const SCREEN_SPEC_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "375x667", label: "375 × 667 — iPhone SE" },
  { value: "390x844", label: "390 × 844 — iPhone 12 / 13 / 14" },
  { value: "393x852", label: "393 × 852 — iPhone 15 / 16" },
  { value: "414x896", label: "414 × 896 — iPhone XR / 11" },
  { value: "430x932", label: "430 × 932 — iPhone Pro Max" },
  { value: "360x740", label: "360 × 740 — Samsung Galaxy S8+" },
  { value: "412x915", label: "412 × 915 — Pixel 7 / 8 / 9 / 10" },
  { value: "412x883", label: "412 × 883 — Samsung Galaxy S20 Ultra" },
  { value: "344x882", label: "344 × 882 — Galaxy Z Fold (folded)" },
  { value: "540x720", label: "540 × 720 — Surface Duo" },
  { value: "768x1024", label: "768 × 1024 — iPad Mini" },
  { value: "820x1180", label: "820 × 1180 — iPad Air" },
  { value: "1024x1366", label: "1024 × 1366 — iPad Pro" },
  { value: "912x1368", label: "912 × 1368 — Surface Pro" },
  { value: "1280x800", label: "1280 × 800 — small laptop" },
  { value: "1366x768", label: "1366 × 768 — laptop" },
  { value: "1920x1080", label: "1920 × 1080 — desktop monitor" },
  { value: "2560x1440", label: "2560 × 1440 — large desktop monitor" },
  { value: "other", label: "None of the above — state yours below" },
];

export const SCREEN_SPECS = SCREEN_SPEC_OPTIONS.map((o) => o.value);

export type IssueStatus = "open" | "in_progress" | "resolved" | "cannot_fix";

export const STATUS_OPTIONS: Array<{ value: IssueStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "cannot_fix", label: "Cannot fix" },
];

export const STATUSES = STATUS_OPTIONS.map((o) => o.value);

export type IssueMessageChannel = "telegram_dm" | "telegram_group" | "email";

export const CHANNEL_LABELS: Record<IssueMessageChannel, string> = {
  telegram_dm: "Telegram DM",
  telegram_group: "Telegram group",
  email: "Email",
};

/** The organizer's standing apology shown under the reporting form. Kept
 * here rather than inline so the wording stays identical everywhere it's
 * shown. */
export const ISSUE_REPORT_NOTE =
  "We sincerely apologise for whatever technical issue(s) you are facing — we will try to fix it as soon as possible. " +
  "However, please note that some technical issues are not fixable, due to there being no such device specification, " +
  "AI app, or a shortfall in AI skills. Your patience, accommodation and co-operation would be greatly appreciated. Thank you.";

export function viewTypeLabel(value: string): string {
  return VIEW_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function statusLabel(value: string): string {
  return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** What to show for a report's screen size: the picked option's label, or
 * whatever the reporter typed when they chose "none of the above". */
export function screenSpecLabel(spec: string, other: string | null): string {
  if (spec === "other") return other?.trim() || "Not stated";
  return SCREEN_SPEC_OPTIONS.find((o) => o.value === spec)?.label ?? spec;
}
