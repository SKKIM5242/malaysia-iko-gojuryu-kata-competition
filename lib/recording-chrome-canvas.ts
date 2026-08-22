import { fontStackFor } from "@/lib/site-appearance";
import { RECORDING_APPEARANCE_FALLBACK, type RecordingAppearance } from "@/lib/recording-appearance";

/**
 * Draws the recording banner and footer watermark INTO a canvas, so they
 * end up in the exported video file rather than only on screen.
 *
 * The on-screen versions live in components/RecordingChrome.tsx as ordinary
 * DOM. That is deliberate duplication, not an oversight: DOM cannot be
 * captured by MediaRecorder at all — `captureStream()` exists on
 * `<canvas>`, not on a div — so anything that must survive into the file
 * has to be painted a second time with the 2D context. The two are kept
 * visually identical by driving both from the same settings row.
 *
 * The dotted framing guide is NOT drawn here on purpose. It is an aid for
 * standing in the right place; burning it across a winner's face for the
 * lifetime of the video would be a defect, not a feature.
 */

/** Font sizes in the settings are chosen against the ~420px-wide on-screen
 * preview. A canvas is typically 720–1280px, so drawing them literally
 * would produce a banner too small to read. Everything scales off this
 * reference width, which keeps the burned-in chrome looking like what the
 * organizer previewed. */
const REFERENCE_WIDTH = 420;

const BANNER_PAD_Y = 8;
const FOOTER_PAD_Y = 6;

interface ChromeText {
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  align: string;
  lineHeight: number;
}

function bannerLines(settings: RecordingAppearance | null): ChromeText[] {
  const line1 = settings?.line1_text ?? RECORDING_APPEARANCE_FALLBACK.line1;
  const line2 = settings?.line2_text ?? RECORDING_APPEARANCE_FALLBACK.line2;
  const out: ChromeText[] = [];
  if (line1) {
    out.push({
      text: line1,
      color: settings?.line1_color ?? "#ffffff",
      fontSize: settings?.line1_font_size ?? 18,
      fontFamily: settings?.line1_font_family ?? "serif",
      bold: settings?.line1_bold ?? true,
      align: settings?.line1_align ?? "center",
      lineHeight: settings?.line1_line_height ?? 1.2,
    });
  }
  if (line2) {
    out.push({
      text: line2,
      color: settings?.line2_color ?? "#ffffff",
      fontSize: settings?.line2_font_size ?? 11,
      fontFamily: settings?.line2_font_family ?? "sans",
      bold: settings?.line2_bold ?? false,
      align: settings?.line2_align ?? "center",
      lineHeight: settings?.line2_line_height ?? 1.2,
    });
  }
  return out;
}

function footerLine(settings: RecordingAppearance | null): ChromeText | null {
  const text = settings?.footer_text ?? RECORDING_APPEARANCE_FALLBACK.footer;
  if (!text) return null;
  return {
    text,
    color: settings?.footer_color ?? "#ffffff",
    fontSize: settings?.footer_font_size ?? 12,
    fontFamily: settings?.footer_font_family ?? "sans",
    bold: settings?.footer_bold ?? true,
    align: settings?.footer_align ?? "center",
    lineHeight: settings?.footer_line_height ?? 1.2,
  };
}

/** How tall the banner and footer bands need to be for a canvas this wide.
 * Computed before any drawing so the canvas can be sized once and then left
 * alone: resizing a canvas mid-recording disturbs the track that
 * captureStream() already handed to MediaRecorder. */
export function chromeHeights(
  canvasWidth: number,
  settings: RecordingAppearance | null,
): { bannerH: number; footerH: number } {
  const scale = canvasWidth / REFERENCE_WIDTH;
  const bannerH =
    bannerLines(settings).reduce((sum, l) => sum + l.fontSize * l.lineHeight * scale, 0) +
    BANNER_PAD_Y * 2 * scale;
  const footer = footerLine(settings);
  const footerH = footer ? footer.fontSize * footer.lineHeight * scale + FOOTER_PAD_Y * 2 * scale : 0;
  return { bannerH: Math.round(bannerH), footerH: Math.round(footerH) };
}

/** Shrinks a line until it fits the available width. A long competition
 * name at a large font would otherwise run off both edges of the frame —
 * on screen CSS truncates it with an ellipsis, but a canvas simply paints
 * past the edge and loses the ends of the words. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  family: string,
  bold: boolean,
): number {
  let px = startPx;
  for (let i = 0; i < 40 && px > 6; i += 1) {
    ctx.font = `${bold ? "bold " : ""}${px}px ${fontStackFor(family)}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 1;
  }
  return px;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  line: ChromeText,
  canvasWidth: number,
  baselineTop: number,
  scale: number,
): number {
  const padX = 10 * scale;
  const maxWidth = canvasWidth - padX * 2;
  const px = fitFont(ctx, line.text, maxWidth, line.fontSize * scale, line.fontFamily, line.bold);
  const rowH = line.fontSize * line.lineHeight * scale;
  ctx.fillStyle = line.color;
  ctx.textBaseline = "middle";
  if (line.align === "left") {
    ctx.textAlign = "left";
    ctx.fillText(line.text, padX, baselineTop + rowH / 2);
  } else if (line.align === "right") {
    ctx.textAlign = "right";
    ctx.fillText(line.text, canvasWidth - padX, baselineTop + rowH / 2);
  } else {
    ctx.textAlign = "center";
    ctx.fillText(line.text, canvasWidth / 2, baselineTop + rowH / 2);
  }
  return rowH;
}

/** Paints the banner across the top band and the watermark across the
 * bottom band. The caller has already drawn the camera frame into the
 * space between them. */
export function drawRecordingChrome(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  bannerH: number,
  footerH: number,
  settings: RecordingAppearance | null,
  logo?: HTMLImageElement | null,
): void {
  const scale = canvasWidth / REFERENCE_WIDTH;

  if (bannerH > 0) {
    // The same left-to-right sweep the on-screen banner uses, rebuilt as a
    // canvas gradient — a CSS class means nothing to a 2D context.
    const gradient = ctx.createLinearGradient(0, 0, canvasWidth, 0);
    gradient.addColorStop(0, "#8b1e3f");
    gradient.addColorStop(0.5, "#6b2f7a");
    gradient.addColorStop(1, "#1e3a8a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, bannerH);

    // Only drawn once it has actually decoded. A cross-origin image that
    // failed its CORS check must never reach drawImage: it would taint the
    // canvas, and a tainted canvas makes captureStream() throw — turning a
    // missing logo into a recording that cannot start at all. Skipping it
    // costs a logo; drawing it blind costs the whole take.
    if (logo && logo.complete && logo.naturalWidth > 0) {
      const pad = BANNER_PAD_Y * scale;
      const boxH = bannerH - pad * 2;
      const drawW = (logo.naturalWidth / logo.naturalHeight) * boxH;
      ctx.drawImage(logo, 10 * scale, pad, drawW, boxH);
    }

    let y = BANNER_PAD_Y * scale;
    for (const line of bannerLines(settings)) {
      y += drawLine(ctx, line, canvasWidth, y, scale);
    }
  }

  const footer = footerLine(settings);
  if (footer && footerH > 0) {
    const top = canvasHeight - footerH;
    // No band behind the footer any more -- it is a WATERMARK, so the
    // picture shows straight through it. The solid black bar it used to sit
    // on was costing real height at the bottom of every testimonial for
    // nothing but a background.
    //
    // A drop shadow replaces the band: white text alone disappears over a
    // pale wall or a bright window, which is most of the rooms people record
    // in. The shadow tracks the text rather than a rectangle, so it stays
    // legible without taking the picture back.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 4 * scale;
    ctx.shadowOffsetY = 1 * scale;
    drawLine(ctx, footer, canvasWidth, top + FOOTER_PAD_Y * scale, scale);
    ctx.restore();
  }
}
