/**
 * Renders a certificate as a PNG using Next.js's built-in next/og image
 * generator (Satori under the hood) -- no new dependency, works natively on
 * Vercel. Certificates are never stored; every download re-renders from
 * live data, same "computed live" philosophy as winners/rewards/commissions
 * elsewhere in this app.
 */
import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

export type CertificateKind = "winner" | "participant" | "referee" | "sensei" | "school" | "support";

/** Per-field typography/layout for one Header/Body text region (migration
 * 0129) -- every property is optional, and an unset one falls back to that
 * specific field's own built-in default (see the `defaults` each StyledText
 * call site passes below), which reproduces exactly what was hardcoded
 * before this became editable. The `line*` fields only matter when
 * `underline` is true -- they replace the old 3-tier `underlineWeight` with
 * a full divider-line control (style/color/length/alignment/thickness/
 * spacing), used most visibly on Body 1 (recipient), which defaults
 * `underline: true`. `lineSpacingMode`/`lineSpacingAt` replace the old
 * `lineHeight`/`tightSpacing` pair with the same Single/1.5/Double/At
 * least/Exactly/Multiple control Word uses -- see resolveLineHeight below.
 * `maxLines` is an approximation (see StyledText) since Satori has no real
 * multi-line text measurement to clamp against. */
export interface TextStyle {
  fontSize?: number;
  color?: string;
  align?: "left" | "center" | "right";
  weight?: number;
  italic?: boolean;
  underline?: boolean;
  /** "auto" (default) draws the line as a border directly under the text,
   * so it's always exactly as long as the text itself (e.g. the recipient's
   * name); "fixed" draws an independent line of `lineLength` px instead,
   * positioned by `lineAlignment`. */
  lineLengthMode?: "auto" | "fixed";
  lineLength?: number;
  lineAlignment?: "left" | "center" | "right";
  lineStyle?: "solid" | "dashed";
  /** "frame" (default) follows the certificate's frame color (which itself
   * follows the kind/rank accent unless overridden); "custom" uses
   * `lineColor` instead. */
  lineColorMode?: "frame" | "custom";
  lineColor?: string;
  lineThickness?: number;
  /** Collapses the gap between the text and its line in "auto" length mode. */
  lineNoGapToText?: boolean;
  /** Collapses the margin above the line in "fixed" length mode. */
  lineNoGapAbove?: boolean;
  lineSpacingMode?: "single" | "1.5" | "double" | "atLeast" | "exactly" | "multiple";
  /** The Word-style "At:" value -- px for atLeast/exactly, a raw multiplier
   * for multiple; unused for single/1.5/double. */
  lineSpacingAt?: number;
  maxLines?: number;
}

const LINE_SPACING_MODES = ["single", "1.5", "double", "atLeast", "exactly", "multiple"] as const;

/** Narrows an arbitrary JSON value (as read back from the `*_style` jsonb
 * columns, or posted to the preview route) into a well-typed TextStyle,
 * dropping anything with the wrong shape rather than trusting it blindly --
 * cheap defense-in-depth for a value that either came from the database or
 * from a POST body, even though both paths are already gated to Admin/
 * Organizer. */
export function sanitizeTextStyle(v: unknown): TextStyle {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const style: TextStyle = {};
  if (typeof o.fontSize === "number" && Number.isFinite(o.fontSize)) style.fontSize = o.fontSize;
  if (typeof o.color === "string") style.color = o.color;
  if (o.align === "left" || o.align === "center" || o.align === "right") style.align = o.align;
  if (typeof o.weight === "number" && Number.isFinite(o.weight)) style.weight = o.weight;
  if (typeof o.italic === "boolean") style.italic = o.italic;
  if (typeof o.underline === "boolean") style.underline = o.underline;
  if (o.lineLengthMode === "auto" || o.lineLengthMode === "fixed") style.lineLengthMode = o.lineLengthMode;
  if (typeof o.lineLength === "number" && Number.isFinite(o.lineLength)) style.lineLength = o.lineLength;
  if (o.lineAlignment === "left" || o.lineAlignment === "center" || o.lineAlignment === "right") {
    style.lineAlignment = o.lineAlignment;
  }
  if (o.lineStyle === "solid" || o.lineStyle === "dashed") style.lineStyle = o.lineStyle;
  if (o.lineColorMode === "frame" || o.lineColorMode === "custom") style.lineColorMode = o.lineColorMode;
  if (typeof o.lineColor === "string") style.lineColor = o.lineColor;
  if (typeof o.lineThickness === "number" && Number.isFinite(o.lineThickness)) style.lineThickness = o.lineThickness;
  if (typeof o.lineNoGapToText === "boolean") style.lineNoGapToText = o.lineNoGapToText;
  if (typeof o.lineNoGapAbove === "boolean") style.lineNoGapAbove = o.lineNoGapAbove;
  if ((LINE_SPACING_MODES as readonly unknown[]).includes(o.lineSpacingMode)) {
    style.lineSpacingMode = o.lineSpacingMode as TextStyle["lineSpacingMode"];
  }
  if (typeof o.lineSpacingAt === "number" && Number.isFinite(o.lineSpacingAt)) style.lineSpacingAt = o.lineSpacingAt;
  if (typeof o.maxLines === "number" && Number.isFinite(o.maxLines) && o.maxLines > 0) style.maxLines = o.maxLines;
  return style;
}

/** Word's Single/1.5 lines/Double/At least/Exactly/Multiple control, mapped
 * onto CSS `line-height`. Satori (like CSS generally) has no true "at
 * least" mode that grows only when content needs more -- both "atLeast" and
 * "exactly" render as the same fixed px line-height here; the UI still
 * offers both since that's what the organizer's reference (Word) shows. */
function resolveLineHeight(mode: TextStyle["lineSpacingMode"], at?: number): string | undefined {
  switch (mode) {
    case "1.5": return "1.5";
    case "double": return "2";
    case "atLeast":
    case "exactly": return at ? `${at}px` : undefined;
    case "multiple": return at ? String(at) : undefined;
    case "single":
    default: return undefined;
  }
}

/** The organizer-editable design for one certificate kind (certificate_templates
 * table) -- header1/header2/body1/body2/body3 are plain text that may contain
 * merge tokens (see substituteMergeTokens), resolved against this specific
 * certificate's live data at render time. logo1Url/logo2Url/medalUrl are
 * already-resolved public URLs (or null), not storage paths -- the caller
 * (lib/certificate-data.ts) resolves those, mirroring how signatureUrl/
 * stampUrl already work, so this file stays free of any Supabase dependency. */
export interface CertificateTemplate {
  header1: string;
  header2: string;
  body1: string;
  body2: string;
  body3: string;
  logoCount: 1 | 2;
  logo1Url: string | null;
  logo2Url: string | null;
  logo1Size: number;
  logo2Size: number;
  logosAlignment: "left" | "center" | "right";
  logosNoSpacing: boolean;
  showMedal: boolean;
  medalPosition: "between" | "left" | "right";
  medalUrl: string | null;
  medalSize: number;
  dateColor: string;
  dateSize: number;
  dateAlignment: "left" | "center" | "right";
  dateDescription: string;
  /** Independent of dateAlignment -- that one positions the date number
   * itself; this one positions the description text underneath it. */
  dateDescriptionAlignment: "left" | "center" | "right";
  dateLineStyle: "solid" | "dashed";
  dateLineWidth: number;
  signerNameSize: number;
  signerTitleSize: number;
  signerNameBold: boolean;
  signerTitleBold: boolean;
  signerPosition: "left" | "center" | "right";
  signerLineStyle: "solid" | "dashed";
  signerLineWidth: number;
  frameOuterWidth: number;
  frameInnerWidth: number;
  /** null preserves today's automatic kind/rank accent color on both
   * border rings; set, it overrides both uniformly. */
  frameColor: string | null;
  header1Style: TextStyle;
  header2Style: TextStyle;
  body1Style: TextStyle;
  body2Style: TextStyle;
  body3Style: TextStyle;
}

export interface CertificateInput {
  kind: CertificateKind;
  recipientName: string;
  competitionName: string;
  categoryName?: string | null;
  kataName?: string | null;
  rank?: 1 | 2 | 3 | null;
  dateLabel: string;
  signerName: string | null;
  signerTitle: string | null;
  signerName2?: string | null;
  signerTitle2?: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
  template: CertificateTemplate;
}

const ORDINAL: Record<1 | 2 | 3, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

/** Fills {name}/{kata_name}/{category}/{competition_tier}/{rank} in an
 * organizer-edited template string with this specific certificate's live
 * data -- the same data sources ("Participant field Name", "Kata Name",
 * "all categories available" i.e. belt rank/gender/age group, "competition
 * Tier") the organizer asked the Body fields to be able to pull from, plus
 * {rank} for the Winner kind's ordinal. {kata_category} is a deprecated
 * alias for {category} (see migration 0129) kept for any template text that
 * still has the old combined token in it. An unrecognized {token} is left
 * as-is rather than silently dropped, so a typo is visible instead of
 * vanishing text. */
function substituteMergeTokens(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (full, key) => (key in ctx ? ctx[key] : full));
}

/** Non-winner kinds keep one fixed accent; winner's accent is rank-based
 * (gold/silver/bronze) instead — see RANK_ACCENT below. */
const ACCENT: Record<Exclude<CertificateKind, "winner">, string> = {
  participant: "#B91C1C",
  referee: "#1D4ED8",
  sensei: "#7C3AED",
  school: "#0F766E",
  support: "#B45309",
};

const RANK_ACCENT: Record<1 | 2 | 3, string> = { 1: "#B8860B", 2: "#64748B", 3: "#A15C2E" };

/** Rank label text color -- the medal artwork's own dark tone for that
 * rank, not a fixed white, per "wreath & rank text must be the medal
 * color." */
const MEDAL_THEME: Record<1 | 2 | 3, { discDark: string; label: string }> = {
  1: { discDark: "#8B6914", label: "1ST" },
  2: { discDark: "#6B6E73", label: "2ND" },
  3: { discDark: "#7A4A1E", label: "3RD" },
};

/** Crystal-shine 3D look for the rank label, per rank's own metal color --
 * a banded top-to-bottom gradient (light -> bright -> a darker "groove" ->
 * bright again -> dark edge) reads as a polished, reflective surface, the
 * same way a chrome/gem 3D text effect works. `shadowDeep` builds the
 * beveled extrusion behind it; `outline` is a thin 4-directional ring that
 * keeps every letter reading crisply against the medal art it sits on. */
const MEDAL_LABEL_STYLE: Record<1 | 2 | 3, { gradient: string; shadowDeep: string; outline: string }> = {
  1: {
    gradient: "linear-gradient(180deg, #FFFFFF 0%, #FFF3B0 14%, #FFD700 28%, #FFEC8B 42%, #C9960C 56%, #FFD700 74%, #A67C0A 100%)",
    shadowDeep: "#4A3305",
    outline: "#6B4C08",
  },
  2: {
    gradient: "linear-gradient(180deg, #FFFFFF 0%, #F2F2F4 14%, #D6D8DB 28%, #FFFFFF 42%, #9A9DA3 56%, #E0E2E5 74%, #71747A 100%)",
    shadowDeep: "#2E3033",
    outline: "#4A4D52",
  },
  3: {
    gradient: "linear-gradient(180deg, #FFF0DD 0%, #F2C994 14%, #E8A659 28%, #FFD9A8 42%, #A9662E 56%, #E0A566 74%, #6B3F1B 100%)",
    shadowDeep: "#361F0C",
    outline: "#5C3814",
  },
};

function readAsDataUri(relPath: string, mime: string): string | null {
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), "public", relPath));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

let cachedLogo: string | null | undefined;
function logoDataUri(): string | null {
  // Square crest (not the wider logo.jpg banner) so a circular crop doesn't clip it.
  if (cachedLogo === undefined) cachedLogo = readAsDataUri("M Logo 400x400px.png", "image/png");
  return cachedLogo;
}

let cachedLogo2: string | null | undefined;
function logo2DataUri(): string | null {
  // Second org crest (IKO International / All Japan), shown on the right of
  // every certificate, mirroring the primary crest on the left. Optional --
  // renders as an empty slot until "IKO International Logo.png" is added to
  // /public, so the layout doesn't break in the meantime.
  if (cachedLogo2 === undefined) cachedLogo2 = readAsDataUri("IKO International Logo.png", "image/png");
  return cachedLogo2;
}

/** Pre-made medal artwork (ribbon + wreath-rim disc), one PNG per rank
 * color -- sourced from the organizer's own reference image with its
 * baked-in "1st" text erased (clone-stamped over from the neighboring
 * gradient, see scripts used to produce these), so a fresh rank label can
 * be rendered on top for whichever ordinal actually applies. Silver and
 * bronze are the same artwork re-toned (grayscale+tint, hue-shift) rather
 * than separate assets, so all three stay perfectly in sync. */
const MEDAL_IMAGE_FILE: Record<1 | 2 | 3, string> = {
  1: "Medal Gold.png",
  2: "Medal Silver.png",
  3: "Medal Bronze.png",
};
// These PNGs are now cropped tight to the ribbon+disc artwork itself (the
// original files had the medal filling only ~48% of a much wider canvas,
// which made the logo-medal-logo cluster read as far more spread out than
// intended even with a small flex gap -- see the coordinate note below).
const MEDAL_NATURAL_W = 247;
const MEDAL_NATURAL_H = 391;
// Bounding box (in the source image's own pixel coordinates) of the wreath's
// open center, where the rank label gets rendered -- moved up closer to the
// star (small gap only) and enlarged to better fill that circular opening,
// measured directly off a zoomed crop of the medal artwork.
const MEDAL_LABEL_BOX = { x: 35, y: 216, w: 177, h: 104 };

const cachedMedalImage: Partial<Record<1 | 2 | 3, string | null>> = {};
function medalImageDataUri(rank: 1 | 2 | 3): string | null {
  if (!(rank in cachedMedalImage)) {
    cachedMedalImage[rank] = readAsDataUri(MEDAL_IMAGE_FILE[rank], "image/png");
  }
  return cachedMedalImage[rank] ?? null;
}

/** The medal: the pre-made ribbon+wreath artwork for this rank's color,
 * with the rank label ("1ST"/"2ND"/"3RD") rendered fresh on top, in the
 * medal's own dark tone, positioned over the artwork's blank center. */
function Medal({ rank, width }: { rank: 1 | 2 | 3; width: number }) {
  const t = MEDAL_THEME[rank];
  const img = medalImageDataUri(rank);
  const scale = width / MEDAL_NATURAL_W;
  const height = Math.round(MEDAL_NATURAL_H * scale);
  return (
    <div style={{ display: "flex", position: "relative", width, height }}>
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} width={width} height={height} alt="" />
      )}
      <div
        style={{
          position: "absolute",
          left: Math.round(MEDAL_LABEL_BOX.x * scale),
          top: Math.round(MEDAL_LABEL_BOX.y * scale),
          width: Math.round(MEDAL_LABEL_BOX.w * scale),
          height: Math.round(MEDAL_LABEL_BOX.h * scale),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RankLabel3D rank={rank} width={width} />
      </div>
    </div>
  );
}

/** The "1ST"/"2ND"/"3RD" rank label, rendered as a crystal-shine 3D block:
 * a stack of solid copies offset diagonally builds the beveled extrusion
 * (deep-shadow-colored, like a chiseled edge), a single thin highlight
 * copy on the opposite corner catches the light, and the glossy banded
 * gradient face sits on top -- same construction as a chrome/gem 3D text
 * effect, per the organizer's reference image. */
// "2ND"/"3RD" carry wider glyphs (N, D, R) than "1ST"'s (S, T) at the same
// font size, so one shared ratio let them spill past the wreath's leaves
// while "1ST" fit fine -- Satori can't measure rendered text width like a
// canvas can, so these per-rank ratios are tuned by eye against the actual
// wreath opening instead of computed.
const MEDAL_LABEL_FONT_SCALE: Record<1 | 2 | 3, number> = { 1: 0.34, 2: 0.27, 3: 0.27 };

function RankLabel3D({ rank, width }: { rank: 1 | 2 | 3; width: number }) {
  const t = MEDAL_THEME[rank];
  const s = MEDAL_LABEL_STYLE[rank];
  const fontSize = Math.round(width * MEDAL_LABEL_FONT_SCALE[rank]);
  const step = Math.max(1, Math.round(width * 0.009));
  const depthSteps = 6;
  return (
    <div style={{ position: "relative", display: "flex" }}>
      {Array.from({ length: depthSteps }, (_, i) => depthSteps - i).map((i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: i * step,
            top: i * step,
            display: "flex",
            fontSize,
            fontWeight: 900,
            color: s.shadowDeep,
          }}
        >
          {t.label}
        </span>
      ))}
      {/* Thin outline in a 4-directional ring, close to the face -- keeps
          every letter reading crisply against the medal art behind it,
          which the depth stack alone (offset only down-right) doesn't
          guarantee on the up-left side. */}
      {[
        [1, 0], [-1, 0], [0, 1], [0, -1],
      ].map(([dx, dy]) => (
        <span
          key={`${dx}-${dy}`}
          style={{
            position: "absolute",
            left: dx,
            top: dy,
            display: "flex",
            fontSize,
            fontWeight: 900,
            color: s.outline,
          }}
        >
          {t.label}
        </span>
      ))}
      <span
        style={{
          display: "flex",
          fontSize,
          fontWeight: 900,
          backgroundImage: s.gradient,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
        }}
      >
        {t.label}
      </span>
    </div>
  );
}

/** Shared height for every footer column's "top" zone (signature+stamp
 * images, or the date number) -- bottom-anchored within it, so the hr line
 * that follows sits at the exact same y for the date and both signers,
 * regardless of how tall each column's own top content actually is. */
const FOOTER_TOP_H = 140;

/** left/center/right -> the flex alignItems/justifyContent value that pins a
 * block to that edge of whatever full-width row/column it sits in. Shared
 * by every new alignment/position control (logos, date, signer, and each
 * text field). */
function edgeFor(align: "left" | "center" | "right"): "flex-start" | "center" | "flex-end" {
  return align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
}

/** One signature block: signature image with the stamp overlapping its
 * trailing edge by ~10% (rather than sitting fully apart), an hr, then the
 * signer's name/title. Reused for both the primary and second signer, at
 * different scales -- and, per the organizer's style controls, the same
 * name/title size, boldness, and left/center/right position for both. */
function SignerBlock({
  name,
  title,
  signatureUrl,
  stampUrl,
  sigW,
  sigH,
  stampSize,
  hrWidth,
  hrStyle,
  nameSize,
  titleSize,
  nameBold,
  titleBold,
  position,
}: {
  name: string | null;
  title: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
  sigW: number;
  sigH: number;
  stampSize: number;
  hrWidth: number;
  hrStyle: "solid" | "dashed";
  nameSize: number;
  titleSize: number;
  nameBold: boolean;
  titleBold: boolean;
  position: "left" | "center" | "right";
}) {
  const overlap = Math.round(sigW * 0.1);
  const edge = edgeFor(position);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: edge }}>
      <div style={{ display: "flex", height: `${FOOTER_TOP_H}px`, alignItems: "flex-end", justifyContent: edge }}>
        {signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signatureUrl} width={sigW} height={sigH} style={{ objectFit: "contain" }} alt="" />
        ) : (
          <div style={{ width: `${sigW}px`, height: `${sigH}px`, display: "flex" }} />
        )}
        {stampUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stampUrl}
            width={stampSize}
            height={stampSize}
            style={{ objectFit: "contain", marginLeft: `-${overlap}px` }}
            alt=""
          />
        )}
      </div>
      <div style={{ display: "flex", width: `${hrWidth}px`, borderTop: `3px ${hrStyle} #a8a29e`, marginTop: "18px" }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: edge, marginTop: "12px" }}>
        <div style={{ display: "flex", fontSize: nameSize, fontWeight: nameBold ? 700 : 400, color: "#1c1917" }}>
          {name ?? "Organizer"}
        </div>
        {title && (
          <div
            style={{
              display: "flex", fontSize: titleSize, fontWeight: titleBold ? 700 : 400, color: "#57534e",
              textAlign: position, maxWidth: `${hrWidth + 60}px`,
            }}
          >
            {title}
          </div>
        )}
      </div>
    </div>
  );
}

/** The date column: mirrors SignerBlock's structure (fixed-height top
 * zone, hr, caption below) so its hr lines up with both signers'. */
function DateBlock({
  dateLabel, caption, width, color, size, alignment, lineStyle, captionAlignment,
}: {
  dateLabel: string;
  caption: string;
  width: number;
  color: string;
  size: number;
  alignment: "left" | "center" | "right";
  lineStyle: "solid" | "dashed";
  captionAlignment: "left" | "center" | "right";
}) {
  const edge = edgeFor(alignment);
  const captionEdge = edgeFor(captionAlignment);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: edge, width: `${width}px` }}>
      <div style={{ display: "flex", height: `${FOOTER_TOP_H}px`, alignItems: "flex-end", justifyContent: edge }}>
        <div style={{ display: "flex", fontSize: size, fontWeight: 800, color }}>{dateLabel}</div>
      </div>
      <div style={{ display: "flex", width: "100%", borderTop: `3px ${lineStyle} #a8a29e`, marginTop: "18px" }} />
      {/* textAlign on its own inner block (not just the outer row's
          justifyContent) is what makes long descriptions -- "Winner
          Announcement Date" and anything an organizer types that's
          longer -- wrap onto multiple lines and stay aligned, the same
          fix StyledText already relies on for the header/body fields.
          Independent captionAlignment (not the block's own `alignment`,
          which only positions the date number) so the description can be
          aligned on its own. */}
      <div style={{ marginTop: "12px", display: "flex", width: "100%", justifyContent: captionEdge }}>
        <div style={{ display: "flex", fontSize: 33, fontWeight: 600, color: "#78716c", textAlign: captionAlignment, maxWidth: `${width}px` }}>
          {caption}
        </div>
      </div>
    </div>
  );
}

/** The logo/medal row at the top of the certificate, shaped by the
 * organizer's template: Logo1 + Medal + Logo2 centered (logoCount 2,
 * showMedal true -- today's fixed Winner layout, now available to any
 * kind); Logo1 + Logo2 with no medal (logoCount 2, showMedal false --
 * today's non-Winner default); or a single Logo1 with the medal to its
 * left or right (logoCount 1). Winner's `medal` node is always the dynamic
 * rank-colored artwork; every other kind's, when shown, is whatever plain
 * image the organizer uploaded -- either way this component only lays it
 * out, it doesn't know which. */
function LogoMedalRow({
  logo1, logo2, medal, template,
}: {
  logo1: string | null;
  logo2: string | null;
  medal: React.ReactNode | null;
  template: CertificateTemplate;
}) {
  const showMedal = template.showMedal && !!medal;
  const gap = template.logosNoSpacing ? 0 : 20;
  const logoImg = (src: string, size: number, extraMarginLeft?: number) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src} width={size} height={size}
      style={{ objectFit: "contain", ...(extraMarginLeft ? { marginLeft: `${extraMarginLeft}px` } : {}) }}
      alt=""
    />
  );
  // Lifted so the (taller) medal artwork's top edge lines up with the logo
  // row's top rather than sitting lower, per the row's own alignItems:
  // "center" otherwise centering it against the shorter square logos.
  const medalNode = medal && <div style={{ display: "flex", marginTop: "-28px" }}>{medal}</div>;
  const rowStyle = {
    display: "flex", flexDirection: "row" as const, alignItems: "center",
    justifyContent: edgeFor(template.logosAlignment), gap: `${gap}px`, width: "100%",
    // marginBottom matches the breathing room a medal row gets "for free"
    // below its taller medal -- a no-medal row needs it added explicitly so
    // the title text underneath doesn't sit flush against the logos.
    ...(showMedal ? {} : { marginBottom: "40px" }),
  };

  if (template.logoCount === 2) {
    return (
      <div style={rowStyle}>
        {logo1 && logoImg(logo1, template.logo1Size)}
        {showMedal && medalNode}
        {logo2 && logoImg(logo2, template.logo2Size, showMedal && !template.logosNoSpacing ? 46 : undefined)}
      </div>
    );
  }
  if (!showMedal) {
    return <div style={rowStyle}>{logo1 && logoImg(logo1, template.logo1Size)}</div>;
  }
  return (
    <div style={rowStyle}>
      {template.medalPosition === "left" ? (
        <>
          {medalNode}
          {logo1 && logoImg(logo1, template.logo1Size, template.logosNoSpacing ? undefined : 20)}
        </>
      ) : (
        <>
          {logo1 && logoImg(logo1, template.logo1Size)}
          {medalNode}
        </>
      )}
    </div>
  );
}

const LINE_THICKNESS_DEFAULT = 4;

/** Renders one Header/Body text region: a full-width row whose
 * justifyContent (derived from the organizer's chosen alignment, default
 * "center") positions the shrink-to-fit text block at the left/center/right
 * edge -- textAlign alone wouldn't move a block that's centered by its
 * flex-column parent unless the text actually wraps, so this wrapper row is
 * what makes "left"/"right" visible even for a single short line like a
 * Header. `defaults` carries this specific field's own pre-existing
 * hardcoded look (the exact fontSize/weight/color/underline every kind
 * rendered before this became editable), so an empty style object ({}, i.e.
 * an as-yet-unedited template) renders pixel-identical to before -- the new
 * `line*` fields all default to reproducing the old hardcoded underline
 * exactly (solid, frame-colored, 4px, flush under the text) until an
 * organizer touches them. maxLines clips via a computed height +
 * overflow:hidden rather than a real multi-line ellipsis -- Satori has no
 * text-measurement API to lay out an exact N-line truncation the way a
 * browser's line-clamp does, so this is an approximation, not a guarantee
 * of exactly N visible lines.
 *
 * The underline itself comes in two length modes: "auto" (default) is a
 * borderBottom on the text node itself, so it's always exactly as long as
 * the text (e.g. the recipient's name, whatever its length) -- no
 * measurement needed since the border just follows the text's own
 * shrink-to-fit width. "fixed" instead renders a second, independent row
 * below the text with an explicit width and its own alignment, the same
 * pattern DateBlock/SignerBlock already use for their divider lines. */
function StyledText({
  text, style, defaults, accent, frameColor,
}: {
  text: string;
  style: TextStyle;
  defaults: { fontSize: number; weight: number; color: string; underline?: boolean; maxWidth?: number; extra?: React.CSSProperties };
  accent: string;
  frameColor: string;
}) {
  if (!text) return null;
  const fontSize = style.fontSize ?? defaults.fontSize;
  const underline = style.underline ?? defaults.underline ?? false;
  const lineHeightCss = resolveLineHeight(style.lineSpacingMode, style.lineSpacingAt);
  const lineHeightMultiplier = lineHeightCss && !lineHeightCss.endsWith("px") ? Number(lineHeightCss) : 1.2;
  const lineLengthMode = style.lineLengthMode ?? "auto";
  const lineColor = style.lineColorMode === "custom" && style.lineColor ? style.lineColor : frameColor;
  const lineStyleCss = style.lineStyle ?? "solid";
  const thickness = style.lineThickness ?? LINE_THICKNESS_DEFAULT;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", alignItems: "center" }}>
      <div style={{ display: "flex", width: "100%", justifyContent: edgeFor(style.align ?? "center") }}>
        <div
          style={{
            display: "flex",
            fontSize,
            fontWeight: style.weight ?? defaults.weight,
            color: style.color ?? defaults.color,
            textAlign: style.align ?? "center",
            ...(defaults.maxWidth ? { maxWidth: `${defaults.maxWidth}px` } : {}),
            ...(style.italic ? { fontStyle: "italic" } : {}),
            ...(lineHeightCss ? { lineHeight: lineHeightCss } : {}),
            ...(underline && lineLengthMode === "auto"
              ? {
                  borderBottom: `${thickness}px ${lineStyleCss} ${lineColor}`,
                  padding: `0 40px ${style.lineNoGapToText ? 0 : 16}px`,
                }
              : {}),
            ...(style.maxLines
              ? { height: `${Math.round(fontSize * lineHeightMultiplier * style.maxLines)}px`, overflow: "hidden" }
              : {}),
            ...defaults.extra,
          }}
        >
          {text}
        </div>
      </div>
      {underline && lineLengthMode === "fixed" && (
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: edgeFor(style.lineAlignment ?? "center"),
            marginTop: style.lineNoGapAbove ? "0px" : "16px",
          }}
        >
          <div style={{ width: `${style.lineLength ?? 380}px`, borderTop: `${thickness}px ${lineStyleCss} ${lineColor}` }} />
        </div>
      )}
    </div>
  );
}

export async function renderCertificatePng(input: CertificateInput): Promise<ImageResponse> {
  // Certificates say "Competition" even though the competition record itself
  // is still named "...Championship..." elsewhere on the site — a wording
  // choice scoped to this template only, not a site-wide rename.
  const competitionName = input.competitionName.replace(/Championship/g, "Competition");
  const isWinner = input.kind === "winner" && input.rank;
  const accent = isWinner ? RANK_ACCENT[input.rank!] : ACCENT[input.kind as Exclude<CertificateKind, "winner">];
  const template = input.template;
  // The frame (the two border rings) defaults to the same automatic kind/
  // rank accent as everything else -- frameColor only overrides it when an
  // organizer has explicitly set one.
  const frameColor = template.frameColor ?? accent;
  // A template's logo1Url/logo2Url is only set once an organizer uploads a
  // replacement — null falls back to the original hardcoded /public crests,
  // so an un-edited template renders exactly as it always has.
  const logo1 = template.logo1Url ?? logoDataUri();
  const logo2 = template.logo2Url ?? logo2DataUri();
  const medal = isWinner ? (
    <Medal rank={input.rank!} width={template.medalSize} />
  ) : template.medalUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={template.medalUrl} width={template.medalSize} style={{ objectFit: "contain" }} alt="" />
  ) : null;

  const category = input.categoryName ?? input.kataName ?? "the event";
  const mergeCtx = {
    name: input.recipientName,
    kata_name: input.kataName ?? "",
    category,
    kata_category: category, // deprecated alias -- see migration 0129
    competition_tier: competitionName,
    rank: isWinner ? ORDINAL[input.rank!] : "",
  };
  const header1 = substituteMergeTokens(template.header1, mergeCtx);
  const header2 = substituteMergeTokens(template.header2, mergeCtx);
  const body1 = substituteMergeTokens(template.body1, mergeCtx);
  const body2 = substituteMergeTokens(template.body2, mergeCtx);
  const body3 = substituteMergeTokens(template.body3, mergeCtx);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fffaf0",
          backgroundImage: "linear-gradient(135deg, #fff7ed 0%, #fffaf0 55%, #fef2f2 100%)",
          padding: "48px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            border: `${template.frameOuterWidth}px solid ${frameColor}`,
            borderRadius: "18px",
            // Top padding trimmed from the original 60px, but kept well
            // clear of the inner double-border overlay below (a fixed 20px
            // inset from this box's own border, regardless of padding) --
            // going all the way down to 20px here made the logo row start
            // at the exact same Y as that border line and draw over it,
            // erasing it wherever a logo sat. 44px leaves a clean gap.
            padding: "44px 90px 60px",
            backgroundColor: "#ffffff",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "20px",
              right: "20px",
              bottom: "20px",
              border: `${template.frameInnerWidth}px solid ${frameColor}`,
              borderRadius: "8px",
              display: "flex",
            }}
          />

          <LogoMedalRow logo1={logo1} logo2={logo2} medal={medal} template={template} />

          <div
            style={{
              marginTop: "0px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 56,
                fontWeight: 900,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: "#57534e",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              2026 Malaysia Open Virtual Karate-do Kata Competition
            </div>
            <div
              style={{
                marginTop: "4px",
                display: "flex",
                fontSize: 34,
                fontWeight: 900,
                color: "#a8a29e",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              Goju-ryu Version &amp; IKO Goju-ryu Version Only — Open Version for Kobudo (Weapon) Kata
            </div>
          </div>

          <div style={{ marginTop: "-6px", width: "100%", display: "flex" }}>
            <StyledText
              text={header1}
              style={template.header1Style}
              defaults={{ fontSize: 112, weight: 900, color: accent, extra: { letterSpacing: 1 } }}
              accent={accent}
              frameColor={frameColor}
            />
          </div>

          <div
            style={{
              marginTop: "-8px",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0px",
            }}
          >
            <StyledText
              text={header2}
              style={template.header2Style}
              defaults={{ fontSize: 88, weight: 700, color: "#57534e", maxWidth: 1700 }}
              accent={accent}
              frameColor={frameColor}
            />
            <StyledText
              text={body1}
              style={template.body1Style}
              defaults={{ fontSize: 112, weight: 700, color: "#1c1917", underline: true }}
              accent={accent}
              frameColor={frameColor}
            />
            <StyledText
              text={body2}
              style={template.body2Style}
              defaults={{ fontSize: 46, weight: 700, color: "#57534e", maxWidth: 1700 }}
              accent={accent}
              frameColor={frameColor}
            />
            <StyledText
              text={body3}
              style={template.body3Style}
              defaults={{ fontSize: 46, weight: 700, color: "#57534e", maxWidth: 1700 }}
              accent={accent}
              frameColor={frameColor}
            />
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              width: "100%",
              paddingRight: "16%",
            }}
          >
            <DateBlock
              dateLabel={input.dateLabel}
              caption={template.dateDescription}
              width={template.dateLineWidth}
              color={template.dateColor}
              size={template.dateSize}
              alignment={template.dateAlignment}
              lineStyle={template.dateLineStyle}
              captionAlignment={template.dateDescriptionAlignment}
            />

            <SignerBlock
              name={input.signerName}
              title={input.signerTitle}
              signatureUrl={input.signatureUrl}
              stampUrl={input.stampUrl}
              sigW={240}
              sigH={90}
              stampSize={140}
              hrWidth={template.signerLineWidth}
              hrStyle={template.signerLineStyle}
              nameSize={template.signerNameSize}
              titleSize={template.signerTitleSize}
              nameBold={template.signerNameBold}
              titleBold={template.signerTitleBold}
              position={template.signerPosition}
            />

            {input.signerName2 && (
              <SignerBlock
                name={input.signerName2}
                title={input.signerTitle2 ?? null}
                signatureUrl={input.signatureUrl}
                stampUrl={input.stampUrl}
                sigW={220}
                sigH={84}
                stampSize={130}
                hrWidth={template.signerLineWidth}
                hrStyle={template.signerLineStyle}
                nameSize={template.signerNameSize}
                titleSize={template.signerTitleSize}
                nameBold={template.signerNameBold}
                titleBold={template.signerTitleBold}
                position={template.signerPosition}
              />
            )}
          </div>
        </div>
      </div>
    ),
    { width: 2200, height: 1850 },
  );
}
