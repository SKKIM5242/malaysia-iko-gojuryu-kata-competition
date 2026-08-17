"use client";

import { useRef, useState } from "react";
import { saveCertificateTemplate, deleteCertificateTemplateImage } from "@/app/actions/admin";
import { adminBtn, adminInput, adminLabel } from "@/components/admin-styles";

type Align3 = "left" | "center" | "right";
type LineStyle = "solid" | "dashed";
const LINE_STYLE_OPTIONS: LineStyle[] = ["solid", "dashed"];

type LineLengthMode = "auto" | "fixed";
type LineColorMode = "frame" | "custom";
type LineSpacingMode = "single" | "1.5" | "double" | "atLeast" | "exactly" | "multiple";

export interface TextStyleValue {
  fontSize?: number;
  color?: string;
  align?: Align3;
  weight?: number;
  italic?: boolean;
  underline?: boolean;
  lineLengthMode?: LineLengthMode;
  lineLength?: number;
  lineAlignment?: Align3;
  lineStyle?: LineStyle;
  lineColorMode?: LineColorMode;
  lineColor?: string;
  lineThickness?: number;
  lineNoGapToText?: boolean;
  lineNoGapAbove?: boolean;
  lineSpacingMode?: LineSpacingMode;
  lineSpacingAt?: number;
  maxLines?: number;
}

export interface CertificateTemplateRow {
  kind: string;
  header1: string;
  header2: string;
  body1: string;
  body2: string;
  body3: string;
  logo_count: 1 | 2;
  show_medal: boolean;
  medal_position: "between" | "left" | "right";
  logo1_size: number;
  logo2_size: number;
  medal_size: number;
  logos_alignment: Align3;
  logos_no_spacing: boolean;
  date_color: string;
  date_size: number;
  date_alignment: Align3;
  date_description: string;
  date_description_alignment: Align3;
  date_description_line_spacing_mode: LineSpacingMode;
  date_description_line_spacing_at: number | null;
  date_line_style: LineStyle;
  date_line_width: number;
  signer_name_size: number;
  signer_title_size: number;
  signer_name_bold: boolean;
  signer_title_bold: boolean;
  signer_name_line_spacing_mode: LineSpacingMode;
  signer_name_line_spacing_at: number | null;
  signer_title_line_spacing_mode: LineSpacingMode;
  signer_title_line_spacing_at: number | null;
  signer_position: Align3;
  signer_line_style: LineStyle;
  signer_line_width: number;
  frame_outer_width: number;
  frame_inner_width: number;
  frame_color: string | null;
  header1_style: TextStyleValue;
  header2_style: TextStyleValue;
  body1_style: TextStyleValue;
  body2_style: TextStyleValue;
  body3_style: TextStyleValue;
}

// A representative accent per kind, purely so the Header 1 color swatch
// doesn't start on a meaningless black -- the real default (used whenever
// the organizer never touches this picker) is the certificate's own dynamic
// accent color (rank-colored for Winner), computed server-side; touching
// the swatch is what actually locks in a fixed override. See
// lib/certificate-render.tsx's ACCENT/RANK_ACCENT.
const KIND_ACCENT: Record<string, string> = {
  winner: "#B8860B", participant: "#B91C1C", referee: "#1D4ED8",
  sensei: "#7C3AED", school: "#0F766E", support: "#B45309",
};

const ORDINAL_LABEL: Record<1 | 2 | 3, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

const MERGE_TOKENS = [
  { token: "{name}", label: "Name" },
  { token: "{kata_name}", label: "Kata Name" },
  { token: "{category}", label: "Category (Belt/Gender/Age)" },
  { token: "{competition_tier}", label: "Competition Tier" },
] as const;

const FONT_WEIGHTS = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extra Bold" },
  { value: 900, label: "Black" },
] as const;

const LINE_SPACING_MODES: Array<{ value: LineSpacingMode; label: string }> = [
  { value: "single", label: "Single" },
  { value: "1.5", label: "1.5 lines" },
  { value: "double", label: "Double" },
  { value: "atLeast", label: "At least" },
  { value: "exactly", label: "Exactly" },
  { value: "multiple", label: "Multiple" },
];
// Word's Single/Double etc. don't need a value typed in; the other 3 do.
const LINE_SPACING_NEEDS_AT: Record<LineSpacingMode, boolean> = {
  single: false, "1.5": false, double: false, atLeast: true, exactly: true, multiple: true,
};

/** The Word-style Single/1.5/Double/At least/Exactly/Multiple + "At:" pair
 * -- shared by every text region that can wrap (Header 1/2, Body 1/2/3 via
 * TextStyleControls above, and the Date description / Signer name / Signer
 * title below, each with their own plain useState instead of a TextStyle
 * object since those live as individual saveCertificateTemplate columns,
 * not inside a *_style jsonb blob). */
function LineSpacingControl({
  mode, at, onModeChange, onAtChange, modeName, atName,
}: {
  mode: LineSpacingMode;
  at: number | null | undefined;
  onModeChange: (m: LineSpacingMode) => void;
  onAtChange: (v: number | undefined) => void;
  /** Only needed when this control isn't already carried inside a
   * TextStyleControls JSON blob (Date description / Signer name / Signer
   * title, which save as their own plain columns) -- gives the <select>/
   * <input> real `name`s so saveCertificateTemplate's formData.get() picks
   * them up directly. */
  modeName?: string;
  atName?: string;
}) {
  return (
    <div className="flex gap-1">
      <select
        name={modeName} value={mode}
        onChange={(e) => onModeChange(e.target.value as LineSpacingMode)}
        className={smallInput}
      >
        {LINE_SPACING_MODES.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      {LINE_SPACING_NEEDS_AT[mode] && (
        <input
          type="number" name={atName} min={0.1} step={0.1} placeholder="At"
          value={at ?? ""}
          onChange={(e) => onAtChange(e.target.value ? Number(e.target.value) : undefined)}
          className={`${smallInput} w-14`}
        />
      )}
    </div>
  );
}
// 5 preset choices rather than a free-number field, matching how thick a
// hand-drawn underline reads at a glance rather than an exact pixel count.
const LINE_THICKNESSES = [
  { value: 1, label: "Hairline (1px)" },
  { value: 2, label: "Thin (2px)" },
  { value: 4, label: "Medium (4px)" },
  { value: 7, label: "Thick (7px)" },
  { value: 10, label: "Extra thick (10px)" },
];

const smallLabel = "block text-[11px] font-semibold text-neutral-500";
const smallInput = "w-full rounded border border-neutral-300 px-1.5 py-1 text-xs";

/** Font size / color / alignment / boldness / italic / underline(+thickness)
 * / line spacing / "no spacing between line" / approximate max-lines, for
 * one Header or Body field. Bundled as one JSON object in a single hidden
 * input (`name`) rather than ~10 separately-named fields -- the server
 * action re-validates the shape (sanitizeTextStyle) before it's saved, so
 * this is just a convenient wire format, not a trust boundary. */
function TextStyleControls({
  name, value, onChange, defaultFontSize, defaultColor, defaultUnderline = false,
}: {
  name: string;
  value: TextStyleValue;
  onChange: (v: TextStyleValue) => void;
  defaultFontSize: number;
  defaultColor: string;
  /** Mirrors this field's own hardcoded `defaults.underline` in
   * lib/certificate-render.tsx (true only for Body 1) -- without this, an
   * as-yet-unedited Body 1 template would show its Underline box unchecked
   * (nothing in `value` says otherwise) even though the certificate itself
   * always renders it underlined, hiding the whole new Line panel below
   * until the organizer happened to uncheck-then-recheck the box. */
  defaultUnderline?: boolean;
}) {
  const set = <K extends keyof TextStyleValue>(k: K, v: TextStyleValue[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 rounded border border-neutral-200 bg-neutral-50 p-2 sm:grid-cols-4">
      <input type="hidden" name={name} value={JSON.stringify(value)} />
      <div>
        <label className={smallLabel}>Font size</label>
        <input
          type="number" min={8} max={300}
          value={value.fontSize ?? defaultFontSize}
          onChange={(e) => set("fontSize", Number(e.target.value) || defaultFontSize)}
          className={smallInput}
        />
      </div>
      <div>
        <label className={smallLabel}>Color</label>
        <input
          type="color"
          value={value.color ?? defaultColor}
          onChange={(e) => set("color", e.target.value)}
          className="h-[26px] w-full rounded border border-neutral-300"
        />
      </div>
      <div>
        <label className={smallLabel}>Align</label>
        <select value={value.align ?? "center"} onChange={(e) => set("align", e.target.value as Align3)} className={smallInput}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      <div>
        <label className={smallLabel}>Boldness</label>
        <select value={value.weight ?? 700} onChange={(e) => set("weight", Number(e.target.value))} className={smallInput}>
          {FONT_WEIGHTS.map((w) => (
            <option key={w.value} value={w.value}>{w.label} ({w.value})</option>
          ))}
        </select>
      </div>
      <div>
        <label className={smallLabel}>Line spacing</label>
        <LineSpacingControl
          mode={value.lineSpacingMode ?? "single"}
          at={value.lineSpacingAt}
          onModeChange={(m) => set("lineSpacingMode", m)}
          onAtChange={(v) => set("lineSpacingAt", v)}
        />
      </div>
      <div>
        <label className={smallLabel}>Max lines (wrap)</label>
        <input
          type="number" min={0} max={20}
          value={value.maxLines ?? ""}
          placeholder="No limit"
          onChange={(e) => set("maxLines", e.target.value ? Number(e.target.value) : undefined)}
          className={smallInput}
        />
      </div>
      {/* Each on its own full-width row (col-span-full) rather than sharing
          a cell with its neighbors -- these labels are long enough that
          packed side-by-side they wrapped into an unreadable stack instead
          of just breaking cleanly. */}
      <label className="col-span-2 flex items-center gap-1.5 pb-1 text-xs sm:col-span-4">
        <input type="checkbox" checked={!!value.italic} onChange={(e) => set("italic", e.target.checked)} />
        Italic
      </label>
      <label className="col-span-2 flex items-center gap-1.5 pb-1 text-xs sm:col-span-4">
        <input type="checkbox" checked={value.underline ?? defaultUnderline} onChange={(e) => set("underline", e.target.checked)} />
        Underline
      </label>
      {(value.underline ?? defaultUnderline) && <UnderlineLineControls value={value} set={set} />}
    </div>
  );
}

/** The divider-line panel that appears once "Underline" is checked --
 * richer than a plain underline: a length mode ("auto" hugs the text's own
 * width via a border, e.g. matching a recipient's name exactly regardless
 * of how long it is; "fixed" draws an independent line at a set px width,
 * positioned by its own alignment), a color mode (follow the certificate's
 * Frame color, or pick a custom one), a 5-tier thickness, and two spacing
 * toggles -- one per length mode, since "gap to the text" only means
 * something in auto mode and "gap above the line" only in fixed mode. Most
 * visible on Body 1 (recipient), which defaults Underline on, but works
 * identically for any Header/Body field that has it checked. */
function UnderlineLineControls({
  value, set,
}: {
  value: TextStyleValue;
  set: <K extends keyof TextStyleValue>(k: K, v: TextStyleValue[K]) => void;
}) {
  const lengthMode = value.lineLengthMode ?? "auto";
  const colorMode = value.lineColorMode ?? "frame";
  return (
    <div className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-2 rounded border border-neutral-200 bg-white p-2 sm:col-span-4 sm:grid-cols-4">
      <p className="col-span-2 text-[11px] font-semibold text-neutral-500 sm:col-span-4">Line</p>
      <div>
        <label className={smallLabel}>Line type</label>
        <select value={value.lineStyle ?? "solid"} onChange={(e) => set("lineStyle", e.target.value as LineStyle)} className={smallInput}>
          {LINE_STYLE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={smallLabel}>Line color</label>
        <select value={colorMode} onChange={(e) => set("lineColorMode", e.target.value as LineColorMode)} className={smallInput}>
          <option value="frame">As per frame</option>
          <option value="custom">Choose a color</option>
        </select>
      </div>
      {colorMode === "custom" && (
        <div>
          <label className={smallLabel}>Color</label>
          <input
            type="color" value={value.lineColor ?? "#1c1917"}
            onChange={(e) => set("lineColor", e.target.value)}
            className="h-[26px] w-full rounded border border-neutral-300"
          />
        </div>
      )}
      <div>
        <label className={smallLabel}>Line thickness</label>
        <select
          value={value.lineThickness ?? 4}
          onChange={(e) => set("lineThickness", Number(e.target.value))}
          className={smallInput}
        >
          {LINE_THICKNESSES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={smallLabel}>Line length</label>
        <select value={lengthMode} onChange={(e) => set("lineLengthMode", e.target.value as LineLengthMode)} className={smallInput}>
          <option value="auto">As per text length</option>
          <option value="fixed">Standard length</option>
        </select>
      </div>
      {lengthMode === "fixed" ? (
        <>
          <div>
            <label className={smallLabel}>Length (px)</label>
            <input
              type="number" min={40} max={1700} value={value.lineLength ?? 380}
              onChange={(e) => set("lineLength", Number(e.target.value) || 380)}
              className={smallInput}
            />
          </div>
          <div>
            <label className={smallLabel}>Line alignment</label>
            <select value={value.lineAlignment ?? "center"} onChange={(e) => set("lineAlignment", e.target.value as Align3)} className={smallInput}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <label className="col-span-2 flex items-center gap-1.5 pb-1 text-xs sm:col-span-4">
            <input type="checkbox" checked={!!value.lineNoGapAbove} onChange={(e) => set("lineNoGapAbove", e.target.checked)} />
            No spacing above line
          </label>
        </>
      ) : (
        <label className="col-span-2 flex items-center gap-1.5 pb-1 text-xs sm:col-span-4">
          <input type="checkbox" checked={!!value.lineNoGapToText} onChange={(e) => set("lineNoGapToText", e.target.checked)} />
          No spacing between line
        </label>
      )}
    </div>
  );
}

/** Header 1 / Header 2: a plain text input plus its TextStyleControls
 * panel. No merge-token buttons (Body fields only), matching today. */
function HeaderField({
  id, name, label, value, onChange, styleValue, onStyleChange, styleName, defaultFontSize, defaultColor,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  styleValue: TextStyleValue;
  onStyleChange: (v: TextStyleValue) => void;
  styleName: string;
  defaultFontSize: number;
  defaultColor: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={adminLabel}>{label}</label>
      <input id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} className={adminInput} />
      <TextStyleControls name={styleName} value={styleValue} onChange={onStyleChange} defaultFontSize={defaultFontSize} defaultColor={defaultColor} />
    </div>
  );
}

/** One Body textarea plus small "insert" buttons for the merge tokens it
 * can pull live data from -- clicking a button appends the token at the end
 * rather than tracking cursor position, simple and predictable for a field
 * that's usually short -- plus its TextStyleControls panel. */
function BodyField({
  id, name, label, value, onChange, showRankToken, styleValue, onStyleChange, styleName, defaultFontSize, defaultColor, defaultUnderline,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  showRankToken: boolean;
  styleValue: TextStyleValue;
  onStyleChange: (v: TextStyleValue) => void;
  styleName: string;
  defaultFontSize: number;
  defaultColor: string;
  defaultUnderline?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(token: string) {
    onChange(value + (value && !value.endsWith(" ") ? " " : "") + token);
    ref.current?.focus();
  }
  return (
    <div>
      <label htmlFor={id} className={adminLabel}>{label}</label>
      <textarea
        ref={ref} id={id} name={name} rows={2} value={value}
        onChange={(e) => onChange(e.target.value)}
        className={adminInput}
      />
      <div className="mt-1 flex flex-wrap gap-1.5">
        {MERGE_TOKENS.map((t) => (
          <button
            key={t.token} type="button" onClick={() => insert(t.token)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            + {t.label}
          </button>
        ))}
        {showRankToken && (
          <button
            type="button" onClick={() => insert("{rank}")}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            + Rank (1st/2nd/3rd)
          </button>
        )}
      </div>
      <TextStyleControls
        name={styleName} value={styleValue} onChange={onStyleChange}
        defaultFontSize={defaultFontSize} defaultColor={defaultColor} defaultUnderline={defaultUnderline}
      />
    </div>
  );
}

/** One image slot (Logo 1 / Logo 2 / Medal): current preview (if any) with
 * its own Remove button — a separate form/action from the file input below
 * it, so deleting doesn't depend on also re-submitting the rest of the
 * template — plus a file input that uploads a replacement on the next
 * "Save template" click (same "leave blank to keep the existing image"
 * convention as Certificate Settings' signature/stamp fields). */
function ImageSlot({
  kind, field, label, currentUrl, returnTo,
}: {
  kind: string;
  field: "logo1" | "logo2" | "medal";
  label: string;
  currentUrl: string | null;
  returnTo: string;
}) {
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
      <p className="mb-1 text-xs font-semibold text-neutral-600">{label}</p>
      {currentUrl && (
        <div className="mb-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentUrl} alt="" className="h-12 w-12 rounded border border-neutral-200 bg-white object-contain" />
          <form action={deleteCertificateTemplateImage}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="field" value={field} />
            <input type="hidden" name="return_to" value={returnTo} />
            <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
              Remove
            </button>
          </form>
        </div>
      )}
      <input type="file" name={field} accept="image/png,image/jpeg,image/webp" className="block w-full text-xs" />
      <p className="mt-1 text-[11px] text-neutral-400">
        {currentUrl ? "Choose a file to replace it, or leave blank to keep it." : "PNG/JPEG/WEBP, max 5 MB."}
      </p>
    </div>
  );
}

export default function CertificateTemplateForm({
  kind,
  kindLabel,
  template,
  logo1Url,
  logo2Url,
  medalUrl,
  returnTo,
}: {
  kind: string;
  kindLabel: string;
  template: CertificateTemplateRow;
  logo1Url: string | null;
  logo2Url: string | null;
  medalUrl: string | null;
  returnTo: string;
}) {
  const [logoCount, setLogoCount] = useState<1 | 2>(template.logo_count);
  const [showMedal, setShowMedal] = useState(template.show_medal);
  const [medalPosition, setMedalPosition] = useState<"between" | "left" | "right">(template.medal_position);
  const [header1, setHeader1] = useState(template.header1);
  const [header2, setHeader2] = useState(template.header2);
  const [body1, setBody1] = useState(template.body1);
  const [body2, setBody2] = useState(template.body2);
  const [body3, setBody3] = useState(template.body3);

  const [logo1Size, setLogo1Size] = useState(template.logo1_size);
  const [logo2Size, setLogo2Size] = useState(template.logo2_size);
  const [medalSize, setMedalSize] = useState(template.medal_size);
  const [logosAlignment, setLogosAlignment] = useState<Align3>(template.logos_alignment);
  const [logosNoSpacing, setLogosNoSpacing] = useState(template.logos_no_spacing);

  const [dateColor, setDateColor] = useState(template.date_color);
  const [dateSize, setDateSize] = useState(template.date_size);
  const [dateAlignment, setDateAlignment] = useState<Align3>(template.date_alignment);
  const [dateDescription, setDateDescription] = useState(template.date_description);
  const [dateDescriptionAlignment, setDateDescriptionAlignment] = useState<Align3>(template.date_description_alignment);
  const [dateDescriptionLineSpacingMode, setDateDescriptionLineSpacingMode] = useState<LineSpacingMode>(template.date_description_line_spacing_mode);
  const [dateDescriptionLineSpacingAt, setDateDescriptionLineSpacingAt] = useState<number | undefined>(template.date_description_line_spacing_at ?? undefined);
  const [dateLineStyle, setDateLineStyle] = useState<LineStyle>(template.date_line_style);
  const [dateLineWidth, setDateLineWidth] = useState(template.date_line_width);

  const [signerNameSize, setSignerNameSize] = useState(template.signer_name_size);
  const [signerTitleSize, setSignerTitleSize] = useState(template.signer_title_size);
  const [signerNameBold, setSignerNameBold] = useState(template.signer_name_bold);
  const [signerTitleBold, setSignerTitleBold] = useState(template.signer_title_bold);
  const [signerNameLineSpacingMode, setSignerNameLineSpacingMode] = useState<LineSpacingMode>(template.signer_name_line_spacing_mode);
  const [signerNameLineSpacingAt, setSignerNameLineSpacingAt] = useState<number | undefined>(template.signer_name_line_spacing_at ?? undefined);
  const [signerTitleLineSpacingMode, setSignerTitleLineSpacingMode] = useState<LineSpacingMode>(template.signer_title_line_spacing_mode);
  const [signerTitleLineSpacingAt, setSignerTitleLineSpacingAt] = useState<number | undefined>(template.signer_title_line_spacing_at ?? undefined);
  const [signerPosition, setSignerPosition] = useState<Align3>(template.signer_position);
  const [signerLineStyle, setSignerLineStyle] = useState<LineStyle>(template.signer_line_style);
  const [signerLineWidth, setSignerLineWidth] = useState(template.signer_line_width);

  const [frameOuterWidth, setFrameOuterWidth] = useState(template.frame_outer_width);
  const [frameInnerWidth, setFrameInnerWidth] = useState(template.frame_inner_width);
  const [frameColorOverride, setFrameColorOverride] = useState(template.frame_color !== null);
  const [frameColor, setFrameColor] = useState(template.frame_color ?? KIND_ACCENT[kind] ?? "#1c1917");

  const [header1Style, setHeader1Style] = useState<TextStyleValue>(template.header1_style ?? {});
  const [header2Style, setHeader2Style] = useState<TextStyleValue>(template.header2_style ?? {});
  const [body1Style, setBody1Style] = useState<TextStyleValue>(template.body1_style ?? {});
  const [body2Style, setBody2Style] = useState<TextStyleValue>(template.body2_style ?? {});
  const [body3Style, setBody3Style] = useState<TextStyleValue>(template.body3_style ?? {});

  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const isWinner = kind === "winner";
  const kindAccent = KIND_ACCENT[kind] ?? "#1c1917";

  async function handlePreview(rank?: 1 | 2 | 3) {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const payload = {
        header1, header2, body1, body2, body3,
        logo_count: logoCount,
        show_medal: showMedal,
        medal_position: medalPosition,
        logo1_size: logo1Size, logo2_size: logo2Size, medal_size: medalSize,
        logos_alignment: logosAlignment, logos_no_spacing: logosNoSpacing,
        date_color: dateColor, date_size: dateSize, date_alignment: dateAlignment,
        date_description: dateDescription, date_description_alignment: dateDescriptionAlignment,
        date_description_line_spacing_mode: dateDescriptionLineSpacingMode,
        date_description_line_spacing_at: dateDescriptionLineSpacingAt,
        date_line_style: dateLineStyle, date_line_width: dateLineWidth,
        signer_name_size: signerNameSize, signer_title_size: signerTitleSize,
        signer_name_bold: signerNameBold, signer_title_bold: signerTitleBold, signer_position: signerPosition,
        signer_name_line_spacing_mode: signerNameLineSpacingMode, signer_name_line_spacing_at: signerNameLineSpacingAt,
        signer_title_line_spacing_mode: signerTitleLineSpacingMode, signer_title_line_spacing_at: signerTitleLineSpacingAt,
        signer_line_style: signerLineStyle, signer_line_width: signerLineWidth,
        frame_outer_width: frameOuterWidth, frame_inner_width: frameInnerWidth,
        frame_color_override: frameColorOverride, frame_color: frameColor,
        header1_style: header1Style, header2_style: header2Style,
        body1_style: body1Style, body2_style: body2Style, body3_style: body3Style,
        rank,
      };
      const res = await fetch(`/api/certificates/${kind}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setPreviewError((await res.text().catch(() => "")) || "Preview failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch {
      setPreviewError("Preview failed. Please try again.");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <form action={saveCertificateTemplate} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="return_to" value={returnTo} />
      <p className="text-sm font-bold text-neutral-800">{kindLabel}</p>

      <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
        <p className="mb-1 text-xs font-semibold text-neutral-600">Frame</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className={smallLabel}>Outer line boldness (px)</label>
            <input
              type="number" name="frame_outer_width" min={0} max={60} value={frameOuterWidth}
              onChange={(e) => setFrameOuterWidth(Number(e.target.value) || 0)}
              className={smallInput}
            />
          </div>
          <div>
            <label className={smallLabel}>Inner line boldness (px)</label>
            <input
              type="number" name="frame_inner_width" min={0} max={30} value={frameInnerWidth}
              onChange={(e) => setFrameInnerWidth(Number(e.target.value) || 0)}
              className={smallInput}
            />
          </div>
          <label className="flex items-end gap-1 pb-1.5 text-xs">
            <input type="checkbox" name="frame_color_override" checked={frameColorOverride} onChange={(e) => setFrameColorOverride(e.target.checked)} />
            Override color
          </label>
          <div>
            <label className={smallLabel}>Color</label>
            {frameColorOverride ? (
              <input
                type="color" name="frame_color" value={frameColor}
                onChange={(e) => setFrameColor(e.target.value)}
                className="h-[26px] w-full rounded border border-neutral-300"
              />
            ) : (
              <>
                <input type="hidden" name="frame_color" value={frameColor} />
                <p className="pt-1 text-[11px] text-neutral-400">Automatic (kind / rank color)</p>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className={adminLabel}>Logos</label>
        <div className="flex gap-4 text-sm">
          {([1, 2] as const).map((n) => (
            <label key={n} className="flex items-center gap-1.5">
              <input
                type="radio" name="logo_count" value={n} checked={logoCount === n}
                onChange={() => setLogoCount(n)}
              />
              {n} logo{n === 2 ? "s" : ""}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ImageSlot kind={kind} field="logo1" label="Logo 1" currentUrl={logo1Url} returnTo={returnTo} />
        {logoCount === 2 && (
          <ImageSlot kind={kind} field="logo2" label="Logo 2" currentUrl={logo2Url} returnTo={returnTo} />
        )}
      </div>

      <div>
        {isWinner ? (
          <>
            {/* Winner's medal is always on -- no checkbox is shown since
                there's nothing to choose -- but saveCertificateTemplate
                reads show_medal from the form regardless, so without this
                hidden input every Winner save (for any reason, e.g. just a
                color tweak) silently wrote show_medal=false and the medal
                vanished from the rendered certificate. */}
            <input type="hidden" name="show_medal" value="on" />
            <p className="text-xs text-neutral-400">
              Medal: uses the automatic gold / silver / bronze artwork, centered between Logo 1 and Logo 2 — not
              an uploaded image.
            </p>
          </>
        ) : (
          <>
            <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
              <input type="checkbox" name="show_medal" checked={showMedal} onChange={(e) => setShowMedal(e.target.checked)} />
              Show a medal graphic
            </label>
            {showMedal && (
              <div className="mt-2 space-y-2">
                <ImageSlot kind={kind} field="medal" label="Medal" currentUrl={medalUrl} returnTo={returnTo} />
                {logoCount === 1 ? (
                  <div>
                    <label className={adminLabel}>Medal position, relative to Logo 1</label>
                    <div className="flex gap-4 text-sm">
                      {(["left", "right"] as const).map((pos) => (
                        <label key={pos} className="flex items-center gap-1.5 capitalize">
                          <input
                            type="radio" name="medal_position" value={pos} checked={medalPosition === pos}
                            onChange={() => setMedalPosition(pos)}
                          />
                          {pos}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <input type="hidden" name="medal_position" value="between" />
                    <p className="text-[11px] text-neutral-400">With 2 logos, the medal renders centered between them.</p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <label className={adminLabel}>Logo / medal size, alignment &amp; spacing</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className={smallLabel}>Logo 1 size (px)</label>
            <input
              type="number" name="logo1_size" min={40} max={800} value={logo1Size}
              onChange={(e) => setLogo1Size(Number(e.target.value) || 420)}
              className={smallInput}
            />
          </div>
          <div>
            <label className={smallLabel}>Logo 2 size (px)</label>
            {logoCount === 2 ? (
              <input
                type="number" name="logo2_size" min={40} max={800} value={logo2Size}
                onChange={(e) => setLogo2Size(Number(e.target.value) || 420)}
                className={smallInput}
              />
            ) : (
              <>
                <input type="hidden" name="logo2_size" value={logo2Size} />
                <input type="number" disabled value={logo2Size} className={`${smallInput} opacity-50`} />
              </>
            )}
          </div>
          <div>
            <label className={smallLabel}>Medal size (px)</label>
            {isWinner || showMedal ? (
              <input
                type="number" name="medal_size" min={40} max={800} value={medalSize}
                onChange={(e) => setMedalSize(Number(e.target.value) || 368)}
                className={smallInput}
              />
            ) : (
              <>
                <input type="hidden" name="medal_size" value={medalSize} />
                <input type="number" disabled value={medalSize} className={`${smallInput} opacity-50`} />
              </>
            )}
          </div>
          <div>
            <label className={smallLabel}>Logos alignment</label>
            <select
              name="logos_alignment" value={logosAlignment}
              onChange={(e) => setLogosAlignment(e.target.value as Align3)}
              className={smallInput}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <input type="checkbox" name="logos_no_spacing" checked={logosNoSpacing} onChange={(e) => setLogosNoSpacing(e.target.checked)} />
          No spacing between logos
        </label>
      </div>

      <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
        <p className="mb-1 text-xs font-semibold text-neutral-600">Footer — Date</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="col-span-2">
            <label className={smallLabel}>Description (below the date — wraps if long)</label>
            <input
              type="text" name="date_description" value={dateDescription}
              onChange={(e) => setDateDescription(e.target.value)}
              className={smallInput}
            />
          </div>
          <div>
            <label className={smallLabel}>Description alignment</label>
            <select
              name="date_description_alignment" value={dateDescriptionAlignment}
              onChange={(e) => setDateDescriptionAlignment(e.target.value as Align3)}
              className={smallInput}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div>
            <label className={smallLabel}>Description line spacing</label>
            <LineSpacingControl
              mode={dateDescriptionLineSpacingMode} at={dateDescriptionLineSpacingAt}
              onModeChange={setDateDescriptionLineSpacingMode} onAtChange={setDateDescriptionLineSpacingAt}
              modeName="date_description_line_spacing_mode" atName="date_description_line_spacing_at"
            />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div>
            <label className={smallLabel}>Color</label>
            <input
              type="color" name="date_color" value={dateColor}
              onChange={(e) => setDateColor(e.target.value)}
              className="h-[26px] w-full rounded border border-neutral-300"
            />
          </div>
          <div>
            <label className={smallLabel}>Size</label>
            <input
              type="number" name="date_size" min={10} max={150} value={dateSize}
              onChange={(e) => setDateSize(Number(e.target.value) || 55)}
              className={smallInput}
            />
          </div>
          <div>
            <label className={smallLabel}>Alignment</label>
            <select name="date_alignment" value={dateAlignment} onChange={(e) => setDateAlignment(e.target.value as Align3)} className={smallInput}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div>
            <label className={smallLabel}>Line type</label>
            <select name="date_line_style" value={dateLineStyle} onChange={(e) => setDateLineStyle(e.target.value as LineStyle)} className={smallInput}>
              {LINE_STYLE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={smallLabel}>Line length (px)</label>
            <input
              type="number" name="date_line_width" min={100} max={900} value={dateLineWidth}
              onChange={(e) => setDateLineWidth(Number(e.target.value) || 380)}
              className={smallInput}
            />
          </div>
        </div>
      </div>

      <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
        <p className="mb-1 text-xs font-semibold text-neutral-600">Footer — Signer name &amp; title</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div>
            <label className={smallLabel}>Name size</label>
            <input
              type="number" name="signer_name_size" min={10} max={100} value={signerNameSize}
              onChange={(e) => setSignerNameSize(Number(e.target.value) || 28)}
              className={smallInput}
            />
          </div>
          <div>
            <label className={smallLabel}>Title size</label>
            <input
              type="number" name="signer_title_size" min={10} max={100} value={signerTitleSize}
              onChange={(e) => setSignerTitleSize(Number(e.target.value) || 22)}
              className={smallInput}
            />
          </div>
          <label className="flex items-end gap-1 pb-1.5 text-xs">
            <input type="checkbox" name="signer_name_bold" checked={signerNameBold} onChange={(e) => setSignerNameBold(e.target.checked)} />
            Name bold
          </label>
          <label className="flex items-end gap-1 pb-1.5 text-xs">
            <input type="checkbox" name="signer_title_bold" checked={signerTitleBold} onChange={(e) => setSignerTitleBold(e.target.checked)} />
            Title bold
          </label>
          <div>
            <label className={smallLabel}>Position</label>
            <select name="signer_position" value={signerPosition} onChange={(e) => setSignerPosition(e.target.value as Align3)} className={smallInput}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className={smallLabel}>Name line spacing</label>
            <LineSpacingControl
              mode={signerNameLineSpacingMode} at={signerNameLineSpacingAt}
              onModeChange={setSignerNameLineSpacingMode} onAtChange={setSignerNameLineSpacingAt}
              modeName="signer_name_line_spacing_mode" atName="signer_name_line_spacing_at"
            />
          </div>
          <div>
            <label className={smallLabel}>Title line spacing</label>
            <LineSpacingControl
              mode={signerTitleLineSpacingMode} at={signerTitleLineSpacingAt}
              onModeChange={setSignerTitleLineSpacingMode} onAtChange={setSignerTitleLineSpacingAt}
              modeName="signer_title_line_spacing_mode" atName="signer_title_line_spacing_at"
            />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className={smallLabel}>Line type</label>
            <select name="signer_line_style" value={signerLineStyle} onChange={(e) => setSignerLineStyle(e.target.value as LineStyle)} className={smallInput}>
              {LINE_STYLE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={smallLabel}>Line length (px)</label>
            <input
              type="number" name="signer_line_width" min={100} max={900} value={signerLineWidth}
              onChange={(e) => setSignerLineWidth(Number(e.target.value) || 500)}
              className={smallInput}
            />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">Applies to both signers when a second signer is set in Certificate Settings above.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <HeaderField
          id={`${kind}_header1`} name="header1" label="Header 1 (title)" value={header1} onChange={setHeader1}
          styleValue={header1Style} onStyleChange={setHeader1Style} styleName="header1_style"
          defaultFontSize={112} defaultColor={kindAccent}
        />
        <HeaderField
          id={`${kind}_header2`} name="header2" label="Header 2 (intro line)" value={header2} onChange={setHeader2}
          styleValue={header2Style} onStyleChange={setHeader2Style} styleName="header2_style"
          defaultFontSize={88} defaultColor="#57534e"
        />
      </div>

      <BodyField
        id={`${kind}_body1`} name="body1" label="Body 1 (recipient)" value={body1} onChange={setBody1} showRankToken={isWinner}
        styleValue={body1Style} onStyleChange={setBody1Style} styleName="body1_style"
        defaultFontSize={112} defaultColor="#1c1917" defaultUnderline
      />
      <BodyField
        id={`${kind}_body2`} name="body2" label="Body 2 (reason)" value={body2} onChange={setBody2} showRankToken={isWinner}
        styleValue={body2Style} onStyleChange={setBody2Style} styleName="body2_style"
        defaultFontSize={46} defaultColor="#57534e"
      />
      <BodyField
        id={`${kind}_body3`} name="body3" label="Body 3 (competition)" value={body3} onChange={setBody3} showRankToken={isWinner}
        styleValue={body3Style} onStyleChange={setBody3Style} styleName="body3_style"
        defaultFontSize={46} defaultColor="#57534e"
      />

      {previewError && <p className="text-xs font-semibold text-red-600">{previewError}</p>}
      <div className="flex items-center justify-between pt-1">
        {isWinner ? (
          <div className="flex gap-1.5">
            {([1, 2, 3] as const).map((rank) => (
              <button
                key={rank} type="button" onClick={() => handlePreview(rank)} disabled={previewing}
                className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {previewing ? "…" : `Preview ${ORDINAL_LABEL[rank]}`}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button" onClick={() => handlePreview()} disabled={previewing}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {previewing ? "Rendering…" : "Preview"}
          </button>
        )}
        <button type="submit" className={adminBtn}>Save {kindLabel} template</button>
      </div>
    </form>
  );
}
