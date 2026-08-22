"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRecordAttempt, submitKataVideo } from "@/app/actions/account";
import BuyExtraAttemptsButton from "@/components/BuyExtraAttemptsButton";
import { formatDate, formatDateTime } from "@/components/ui";
import {
  pickVideoMimeType as pickMimeType,
  extensionForMimeType,
  bareMimeType,
  recordingBitrates,
  KATA_MAX_SECONDS,
} from "@/lib/media-recording";
import { playDingDong, playAlarmTick } from "@/lib/chime";
import { startClapDetector } from "@/lib/clap-detector";
import { saveLocalRecording, clearLocalRecording } from "@/lib/local-recording-store";
import { uploadRecording } from "@/lib/upload-recording";
import { torchSupported, setTorch } from "@/lib/camera-torch";
import type { WatermarkSettings } from "@/lib/watermark";
import type { AppliedSpec } from "@/lib/recording-specs";

const MAX_SECONDS = KATA_MAX_SECONDS;
const COUNTDOWN_CHOICES = [10, 15, 20, 25, 30] as const;
/** Digital zoom range. 1x is the camera's untouched field of view; the 4x
 * ceiling is where a 720p-class frame starts visibly softening, since this
 * scales a smaller crop up rather than reaching for optical detail that
 * isn't there. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

type Phase = "idle" | "live" | "countdown" | "recording" | "review" | "uploading" | "done";

/** Organizer-configurable watermark (Create/Edit Competition page, per
 * tier) -- font size and margins still scale with the actual recorded
 * resolution when the organizer leaves size on auto (was always the case
 * before this was configurable at all: a fixed "8px"/10px read fine on a
 * small preview thumbnail but was practically invisible once phones and
 * tablets started negotiating much taller/wider real camera resolutions
 * than that was ever sized for). Shared by both the portrait and
 * landscape banner layouts below.
 *
 * direction covers 8 layouts: normal horizontal, 4 vertical placements
 * (top-to-bottom/bottom-to-top, at the left or right border -- done as a
 * whole-string 90°/-90° rotation, not true character-by-character CJK
 * vertical stacking), 2 diagonals, and a horizontal right-to-left layout
 * for CJK-style reading order (via canvas's own built-in `direction`
 * property, not a rotation). */
function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, settings: WatermarkSettings) {
  const { text, fontSizePx, fontFamily, bold, color, direction } = settings;
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.textAlign = "center";

  const isVertical =
    direction === "vertical_ltr_left" ||
    direction === "vertical_rtl_left" ||
    direction === "vertical_ltr_right" ||
    direction === "vertical_rtl_right";
  const isDiagonal = direction === "diagonal_up" || direction === "diagonal_down";
  // The text's rendered baseline runs along h once rotated vertical, along
  // roughly the shorter side (with a bit extra for the diagonal's longer
  // reach corner-to-corner) once diagonal, and along w otherwise.
  const availableLength = isVertical ? h * 0.9 : isDiagonal ? Math.min(w, h) * 1.3 : w * 0.92;

  const weight = bold ? "900" : "400";
  // Auto size is taken from availableLength -- the axis the text actually
  // runs along -- not from the frame HEIGHT regardless of direction, which
  // is what it used to do. Height-based sizing made the same watermark
  // render about three times larger relative to the frame in portrait than
  // in landscape (2.2% of a 720-wide portrait frame's width vs 1.2% of a
  // 1280-wide landscape one), so it looked like a different design on
  // every device and orientation. Measuring against the axis it's drawn
  // along makes one setting look the same everywhere -- and it's the axis
  // the shrink-to-fit below tests against anyway, so the starting size and
  // the constraint are finally in the same units.
  //
  // Deliberately NOT rounded to a whole pixel: canvas takes fractional font
  // sizes, and rounding reintroduced a few percent of per-frame variation
  // (a 14.6px ideal rounding up to 15 on one frame and 17.5 down to 17 on
  // another) in exactly the consistency this is here to deliver.
  const AUTO_SIZE_OF_LENGTH = 0.027;
  let fontPx = fontSizePx ?? Math.max(10, availableLength * AUTO_SIZE_OF_LENGTH);
  const applyFont = () => {
    ctx.font = `${weight} ${fontPx}px ${fontFamily}`;
  };
  applyFont();
  // Only auto-shrink when the organizer left size on auto -- an explicit
  // px value is a deliberate choice, left alone even if it overflows, same
  // as every other explicit-vs-auto field in this app (e.g. category caps).
  if (fontSizePx == null) {
    while (fontPx > 7 && ctx.measureText(text).width > availableLength) {
      fontPx -= 1;
      applyFont();
    }
  }

  const margin = Math.max(14, Math.round(Math.min(w, h) * 0.025));
  if (direction === "rtl_cjk") ctx.direction = "rtl";

  switch (direction) {
    case "vertical_ltr_left":
      ctx.translate(margin + fontPx * 0.8, h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(text, 0, 0);
      break;
    case "vertical_rtl_left":
      ctx.translate(margin + fontPx * 0.8, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      break;
    case "vertical_ltr_right":
      ctx.translate(w - margin - fontPx * 0.8, h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(text, 0, 0);
      break;
    case "vertical_rtl_right":
      ctx.translate(w - margin - fontPx * 0.8, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      break;
    case "diagonal_down": // Left Top to Right Bottom
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillText(text, 0, 0);
      break;
    case "diagonal_up": // Left Bottom to Right Top
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(text, 0, 0);
      break;
    case "rtl_cjk":
    case "ltr":
    default:
      ctx.fillText(text, w / 2, h - margin);
      break;
  }
  ctx.restore();
}

/** Scales a font to make `text` render at `targetWidth`, capped at
 * `maxPx`. Text width scales almost exactly linearly with font-size for a
 * fixed string/font/weight, so one proportional correction lands very
 * close and a second pass tightens it -- far cheaper and more precise than
 * stepping down a pixel at a time until it happens to fit. */
function fitCanvasFontToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  targetWidth: number,
  buildFont: (px: number) => string,
  startPx: number,
  maxPx = Infinity,
): number {
  let px = Math.max(4, startPx);
  ctx.font = buildFont(px);
  for (let pass = 0; pass < 2; pass++) {
    const current = ctx.measureText(text).width;
    if (current <= 0) break;
    px = Math.max(4, Math.min(px * (targetWidth / current), maxPx));
    ctx.font = buildFont(px);
  }
  return px;
}

/** Draws `text` centred on `centerX` spanning `targetWidth`, keeping
 * whatever font size is already set on `ctx` and making up the shortfall
 * with letter spacing (tracking) instead of by growing the type.
 *
 * This is what lets row 2 span its share of the banner while still
 * rendering markedly smaller than row 1. The two only look contradictory
 * if width has to come from font size alone: row 2's string is LONGER
 * than row 1's (51 characters vs 47) and set in a lighter, narrower face,
 * so matching row 1's share of the width by size would need it about 3%
 * BIGGER than the title it sits under. Spreading a small face across the
 * width is the ordinary typographic answer, and reads as deliberate.
 *
 * Silently falls back to plain centred text where canvas letterSpacing
 * isn't supported (pre-2023 browsers), which loses the spread but never
 * the legibility. */
function drawTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  targetWidth: number,
  centerX: number,
  y: number,
) {
  const tracked = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (typeof tracked.letterSpacing !== "string" || text.length < 2) {
    ctx.fillText(text, centerX, y);
    return;
  }
  tracked.letterSpacing = "0px";
  const natural = ctx.measureText(text).width;
  if (natural <= 0 || targetWidth <= natural) {
    ctx.fillText(text, centerX, y);
    return;
  }
  let spacing = (targetWidth - natural) / text.length;
  tracked.letterSpacing = `${spacing}px`;
  // Browsers differ on whether the gap after the LAST character counts
  // toward the measured width, so re-measure once and correct rather than
  // trusting the first estimate.
  const measured = ctx.measureText(text).width;
  if (measured > 0) {
    spacing += (targetWidth - measured) / text.length;
    tracked.letterSpacing = `${spacing}px`;
  }
  // Shift back by half a gap: the trailing space is included in the run's
  // measured width, so a centred draw would otherwise sit visibly right of
  // true centre.
  ctx.fillText(text, centerX - spacing / 2, y);
  tracked.letterSpacing = "0px";
}

function drawBannerRect(ctx: CanvasRenderingContext2D, w: number, topH: number) {
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#b91c1c");
  grad.addColorStop(0.5, "#7c2d92");
  grad.addColorStop(1, "#1d4ed8");
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, topH);
  ctx.globalAlpha = 1;
}

/** Draws the branded competition frame: colorful title banner, live camera
 * feed, and a light watermark — all burned into the recorded pixels via
 * canvas.captureStream(), never the raw camera feed. Returns the banner's
 * height as a fraction of the frame height so the caller can line the DOM
 * title bar up against what actually got drawn.
 *
 * The camera frame is CENTER-CROPPED into whatever shape the canvas
 * already is, rather than squeezed to fit it. The caller shapes the canvas
 * to match the screen, so this is what makes the recording and the
 * on-screen preview one and the same picture: no letterboxing (the canvas
 * is the screen's shape), no preview-only crop (the crop happens here, in
 * the recorded pixels), and no stretching (a center crop preserves the
 * camera's proportions). */
/** bannerRatio: fraction of h taken up by the burned banner PLUS the
 * identity (name/category) overlay below it -- where the DOM controls that
 * belong below both need to start. bannerOnlyRatio: fraction of h taken up
 * by the banner alone -- where controls that belong right under the
 * banner but ABOVE the identity overlay (Exit full screen, moved there on
 * request to sit one row higher than the identity text) need to start. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
  watermark: WatermarkSettings,
  participantName: string,
  categoryName: string,
  zoom = 1,
): { bannerRatio: number; bannerOnlyRatio: number } {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const canvasAspect = w / h;
  let sw = srcW;
  let sh = srcH;
  if (srcW / srcH > canvasAspect) {
    // Camera frame is wider than the canvas -> take a full-height slice.
    sh = srcH;
    sw = srcH * canvasAspect;
  } else {
    // Taller than the canvas -> take a full-width slice.
    sw = srcW;
    sh = srcW / canvasAspect;
  }
  // Digital zoom: take a smaller slice from the middle of the camera frame
  // and let drawImage scale it up to fill the canvas. Done here, on the
  // canvas, rather than through the camera's own zoom because a hardware
  // zoom constraint exists on barely any of the devices this has to serve --
  // no browser on iPhone or iPad exposes one at all, and almost no
  // laptop/desktop webcam reports the capability either. Cropping the frame
  // ourselves behaves identically everywhere, and because the canvas IS what
  // gets recorded, what the performer frames is exactly what the judges see.
  // zoom = 1 leaves the slice untouched, so the default is still the
  // camera's full field of view.
  const z = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  sw /= z;
  sh /= z;
  ctx.drawImage(video, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, 0, 0, w, h);

  // The organizer's spec: row 1 fills 95% of the banner's width, row 2
  // fills 88% while rendering 40-50% smaller than row 1. Row 2 gets there
  // on tracking rather than size (see drawTextToWidth) -- 45%, the middle
  // of the requested range.
  const TITLE_WIDTH_FRACTION = 0.95;
  const SUBTITLE_WIDTH_FRACTION = 0.88;
  const SUBTITLE_SIZE_OF_TITLE = 0.55;
  const subtitle = "Organized by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD";

  // Portrait only: size the title from the frame's WIDTH (how large it can
  // get before needing to shrink to fit) and make the banner just tall
  // enough to hold it -- a fixed height-proportional slice left a lot of
  // empty colored background around comparatively small type on a tall
  // portrait recording. Splitting the title across multiple lines was
  // tried to make it bigger, but the organizer confirmed that reads worse
  // (the whole point is ONE row, matching landscape's own layout) -- back
  // to a single line. A ~50-character title fit to the frame's own width
  // is a hard ceiling on the FONT itself (there's no more width to give it
  // without wrapping) -- the generous padding below is what actually makes
  // the banner read as bigger/more substantial, per the organizer's ask for
  // a noticeably taller bar, without touching that ceiling. Landscape is
  // unchanged.
  const bannerTitle = "MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION";
  const titleFont = (px: number) => `900 ${px}px Georgia, serif`;
  const subtitleFont = (px: number) => `${px}px Arial, sans-serif`;

  if (h > w) {
    // Portrait: size the title from the frame's WIDTH and make the banner
    // just tall enough to hold it -- a fixed height-proportional slice left
    // a lot of empty colored background around comparatively small type on
    // a tall portrait recording. Splitting the title across multiple lines
    // was tried to make it bigger, but the organizer confirmed that reads
    // worse (the whole point is ONE row, matching landscape's own layout).
    const titleFontPx = fitCanvasFontToWidth(ctx, bannerTitle, w * TITLE_WIDTH_FRACTION, titleFont, Math.round(w * 0.075));
    const subtitleFontPx = titleFontPx * SUBTITLE_SIZE_OF_TITLE;
    // Padding multipliers deliberately generous -- this is what actually
    // grows the banner bar itself, since the text's own size is already
    // pinned to its share of the frame width above.
    const padTop = Math.round(titleFontPx * 1.8);
    const gap = Math.round(titleFontPx * 1.1);
    const padBottom = Math.round(subtitleFontPx * 2.0);
    const titleY = padTop + titleFontPx * 0.8;
    const subtitleY = titleY + titleFontPx * 0.3 + gap + subtitleFontPx * 0.8;
    const topH = Math.round(subtitleY + subtitleFontPx * 0.35 + padBottom);

    drawBannerRect(ctx, w, topH);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 4;
    ctx.font = titleFont(titleFontPx);
    ctx.fillText(bannerTitle, w / 2, titleY);
    ctx.font = subtitleFont(subtitleFontPx);
    drawTextToWidth(ctx, subtitle, w * SUBTITLE_WIDTH_FRACTION, w / 2, subtitleY);
    ctx.shadowBlur = 0;

    drawWatermark(ctx, w, h, watermark);
    const identityH = drawIdentityOverlay(ctx, w, h, topH, participantName, categoryName);
    return { bannerRatio: (topH + identityH) / h, bannerOnlyRatio: topH / h };
  }

  // Landscape: single-line layout, banner height taken from the frame's own
  // height rather than grown around the text.
  const topH = Math.round(h * 0.13);
  const titleFontPx = fitCanvasFontToWidth(
    ctx,
    bannerTitle,
    w * TITLE_WIDTH_FRACTION,
    titleFont,
    Math.max(14, Math.round(topH * 0.4)),
  );
  const subtitleFontPx = titleFontPx * SUBTITLE_SIZE_OF_TITLE;
  const titleY = topH * 0.4;
  const subtitleY = topH * 0.82;

  drawBannerRect(ctx, w, topH);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.font = titleFont(titleFontPx);
  ctx.fillText(bannerTitle, w / 2, titleY);
  ctx.font = subtitleFont(subtitleFontPx);
  drawTextToWidth(ctx, subtitle, w * SUBTITLE_WIDTH_FRACTION, w / 2, subtitleY);
  ctx.shadowBlur = 0;

  drawWatermark(ctx, w, h, watermark);
  const identityH = drawIdentityOverlay(ctx, w, h, topH, participantName, categoryName);
  return { bannerRatio: (topH + identityH) / h, bannerOnlyRatio: topH / h };
}

/** Row 1: participant name (bold, clearly readable). Row 2+: kata/category,
 * smaller, wrapping onto further rows rather than shrinking indefinitely or
 * running off-canvas. Burned in just under the main title banner,
 * left-aligned — deliberately still smaller than the banner/watermark so it
 * never competes with either, but no longer the near-illegible single line
 * this used to be, which is what collided with the DOM title bar sitting
 * directly on top of it (see the returned height below). Only drawn when
 * there's actually a participant name to show (a solo account with no
 * linked co-participants has nothing worth labelling).
 *
 * Returns the pixel height this overlay actually used, so the caller
 * (drawFrame) can push the DOM title bar stacked on top of the canvas down
 * far enough to clear it — previously that stack started right at topH,
 * the SAME position this overlay's own text started at, which is exactly
 * why the two visually overlapped/collided on screen. */
function drawIdentityOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  topH: number,
  participantName: string,
  categoryName: string,
): number {
  if (!participantName) return 0;
  ctx.save();
  const margin = Math.max(10, Math.round(Math.min(w, h) * 0.02));
  const nameFontPx = Math.max(14, Math.round(Math.min(w, h) * 0.034));
  const categoryFontPx = Math.max(11, Math.round(nameFontPx * 0.7));
  const maxWidth = w - margin * 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 3;

  let y = topH + nameFontPx + margin * 0.5;
  ctx.font = `900 ${nameFontPx}px Arial, sans-serif`;
  ctx.fillText(participantName, margin, y);

  if (categoryName) {
    ctx.font = `700 ${categoryFontPx}px Arial, sans-serif`;
    // Word-wraps onto as many rows as needed at a FIXED size, instead of
    // the old single-line overlay which just ran under everything else
    // uncontrolled at whatever length the category name happened to be.
    const words = categoryName.split(" ");
    let line = "";
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(attempt).width > maxWidth) {
        y += categoryFontPx * 1.3;
        ctx.fillText(line, margin, y);
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) {
      y += categoryFontPx * 1.3;
      ctx.fillText(line, margin, y);
    }
  }
  ctx.restore();
  return y + margin * 0.4 - topH;
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/** Requests a camera resolution shaped like the screen it'll actually be
 * displayed on. This used to always ask for a near-square 1280x1280 frame
 * regardless of device — since the video renders with object-contain
 * (preserves its own aspect ratio, never crops, so the whole kata always
 * stays in frame), a mismatched request is exactly what left large black
 * letterboxed bars on every device: top/bottom on a tall phone screen,
 * left/right on a wide desktop or landscape-tablet window. Real camera
 * hardware only offers a handful of discrete resolutions, so this can't
 * guarantee an exact edge-to-edge fill, but matching the device's actual
 * proportions (not just a generic 16:9 guess) gets it as close as the
 * hardware allows -- a modern phone screen is routinely taller/narrower
 * than any standard camera ratio, so some residual letterboxing in
 * fullscreen is a real hardware ceiling, not something this can fully
 * eliminate.
 *
 * The width/height requested here are in the CAMERA SENSOR's own frame,
 * not the screen's -- on a phone in portrait, the sensor itself is mounted
 * landscape (rotated 90° by the OS to produce the portrait preview you see),
 * so asking for a tall/narrow ideal while the screen is in portrait actually
 * fights the sensor's native orientation on real devices. Confirmed on
 * device: request the SENSOR-shaped shape opposite the screen's own
 * orientation, scaled to this device's own measured proportions rather
 * than a fixed preset.
 *
 * That inversion is a PHONE-only quirk, though -- a desktop/laptop webcam
 * has no such physical rotation, so inverting there instead asks for a
 * narrow portrait frame from a sensor that's always landscape, and the
 * driver hands back a badly cropped sliver instead of the full picture.
 * That's exactly what left desktop's fullscreen view heavily letterboxed
 * left/right even after the phone-orientation fix above. Desktop requests
 * the SAME shape as its own screen, never inverted. */
/** Playback has effectively finished, whether or not the browser ever got
 * around to saying so.
 *
 * A MediaRecorder blob routinely declares a duration slightly LONGER than
 * its last decodable frame -- the container's duration is patched up from
 * timestamps, and the tail can be a few hundred milliseconds of header with
 * no picture behind it. Playback therefore runs out of frames just short of
 * `duration`, and the element sits there with ended=false, paused=false and
 * readyState dropping back to HAVE_METADATA, waiting for data that is never
 * coming. Confirmed on a real take: frozen at 19.904s of a declared 20.304s,
 * with the whole file buffered. Anything keyed purely off the "ended" event
 * waits forever in that state. */
function isEffectivelyEnded(v: HTMLVideoElement, knownDuration = 0): boolean {
  if (v.ended) return true;
  // knownDuration (the length the recorder timed itself) is what makes this
  // work at all on a file reporting Infinity -- which is the common case, not
  // an edge one.
  const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : knownDuration;
  return d > 0 && v.currentTime >= d - 0.75;
}

/** Phone or tablet, as opposed to a desktop/laptop webcam. iPadOS 13+
 * reports itself as a Mac, so the touch-point count is what separates a
 * real iPad from desktop Safari. */
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iP(hone|od|ad)/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function idealVideoDimensions(): { width: number; height: number; constrainAspect: boolean } {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { width: 1280, height: 720, constrainAspect: true };
  }
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  // PHONE/TABLET: ask for a STANDARD 16:9 frame in the current orientation
  // and never pin aspectRatio, so the camera is free to hand back its own
  // native field of view.
  //
  // Asking for the screen's exact shape (what the desktop branch below
  // still does) looks harmless but isn't on a phone: iOS honours a custom
  // aspectRatio by CROPPING the sensor down to it. A portrait iPhone with
  // Safari's toolbars up measures roughly 375x635, so this used to request
  // 756x1280 -- a 0.59 ratio that matches no sensor -- and iOS delivered
  // exactly that by slicing the sides off a native 16:9 (0.5625) or 4:3
  // (0.75) frame. Nothing was distorted, but the recording was narrower
  // than what the camera could actually see, and it moved every time
  // Safari's chrome slid in or out. Landscape was worse: an ultra-wide
  // 2.6-ish viewport asks for a shape no sensor has, so the crop was
  // heavier still. Requesting a real preset instead gives the participant
  // their camera's true framing, which is what was asked for; whatever
  // letterboxing is left over is handled by the preview box, not by
  // throwing away picture.
  if (isMobileDevice()) {
    return landscape
      ? { width: 1280, height: 720, constrainAspect: false }
      : { width: 720, height: 1280, constrainAspect: false };
  }
  const screenLong = Math.max(window.innerWidth, window.innerHeight, 480);
  const screenShort = Math.max(Math.min(window.innerWidth, window.innerHeight), 240);
  const longEdge = 1280;
  const shortEdge = Math.max(400, Math.round(longEdge * (screenShort / screenLong)));
  // DESKTOP/LAPTOP: unchanged. A webcam is a fixed landscape sensor that
  // reports a short list of real resolutions and simply picks the nearest
  // one, so the shape hint steers it toward the widest available rather
  // than cropping anything -- and asking for something other than the
  // screen's shape here is what previously left desktop's fullscreen view
  // heavily letterboxed left/right.
  return landscape
    ? { width: longEdge, height: shortEdge, constrainAspect: true }
    : { width: shortEdge, height: longEdge, constrainAspect: true };
}

export default function KataRecorder({
  registrationId,
  initialAttempts,
  maxAttempts,
  hasPendingPurchase,
  watermark,
  recordingStart,
  recordingEnd,
  categoryName,
  participantName,
  appliedSpec = null,
}: {
  /** Resolution / frame rate / bitrate an organizer has switched on for kata
   * recording on /admin/storage. Null — the state of every install until
   * somebody deliberately applies one — means use the code's own settings,
   * so this is purely additive. */
  appliedSpec?: AppliedSpec | null;
  /** Which linked registration this recording is for — a login tied to
   * several participants (e.g. a Sensei recording for several students)
   * can have more than one; this is what tells the server which one a
   * submission belongs to, instead of always trusting the account's own
   * primary link. */
  registrationId: string;
  initialAttempts: number;
  maxAttempts: number;
  hasPendingPurchase: boolean;
  watermark: WatermarkSettings;
  recordingStart?: string | null;
  recordingEnd?: string | null;
  /** Which kata this specific registration is for — shown on the recorder
   * itself so switching which pending item is active (via the "Start
   * Recording" button on the pending list) is actually visible, instead
   * of the screen looking identical no matter which one is now current. */
  categoryName?: string | null;
  /** Whose kata this is — burned into the recording itself (small, below
   * the main banner) alongside categoryName, so a login linked to several
   * participants can tell whose take is whose after the fact. */
  participantName?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempts, setAttempts] = useState(initialAttempts);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // A snapshot of the canvas's own last frame, captured synchronously the
  // instant recording stops -- used as the review <video>'s poster so the
  // banner/watermark (already burned into that frame) show immediately,
  // instead of a blank black box while the browser takes a moment to
  // decode the very first frame of a freshly-created recording blob.
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<Date | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Tap-to-start countdown -- lets a solo performer walk into position
  // before recording actually begins, instead of needing a second person
  // (or a remote-control button no phone browser can ever see -- see the
  // volume-button-shutter-remote discussion this replaces) to hit Start
  // right as they're ready.
  const [countdownDuration, setCountdownDuration] = useState<number>(10);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Created on the Start tap itself (a real user gesture) and reused for
  // both the ding-dong chime and the clap detector -- creating either
  // later, when the countdown timer itself fires, would not count as a
  // gesture and iOS Safari would refuse to let it produce sound at all.
  const audioContextRef = useRef<AudioContext | null>(null);
  const clapDetectorStopRef = useRef<(() => void) | null>(null);
  // renderLoop re-schedules itself through requestAnimationFrame, so the
  // `fullscreen` it closed over on the frame it started is frozen at that
  // value forever. It needs the CURRENT one (to know which shape to give
  // the canvas), hence a ref mirroring the state rather than the state.
  const fullscreenRef = useRef(false);
  useEffect(() => {
    fullscreenRef.current = fullscreen;
  }, [fullscreen]);
  // Custom minimal controls for the review player, replacing the browser's
  // native <video controls> entirely -- on iOS, native controls' own
  // fullscreen-toggle icon has an "X"/collapse affordance that doesn't
  // actually call this component's own exitFullscreen, leaving the
  // participant stuck in a confusing state with no reliable way out. With
  // no native controls at all, there's no OS chrome to conflict with the
  // app's own "✕ Exit full screen" button, which stays the one way to leave.
  // When the current take started, on the monotonic clock, and how long it
  // ran. This is the seek bar's real source of truth -- see recorder.start
  // for why the recorded file's own duration cannot be trusted. Held in a
  // ref as well as state because the <video>'s own event handlers need the
  // latest value without being re-bound on every change.
  const recordingStartMsRef = useRef(0);
  const measuredDurationRef = useRef(0);
  // Digital zoom, 1x (full field of view) to 4x. Mirrored into a ref because
  // renderLoop re-schedules itself through requestAnimationFrame and would
  // otherwise keep drawing with whatever value it closed over on its first
  // frame.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);
  // 0..1 while a submission is in flight, so a phone on a slow uplink shows
  // something moving instead of a "Submitting…" button that looks frozen for
  // a minute and invites the participant to leave the page.
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reviewPlaying, setReviewPlaying] = useState(false);
  const [reviewCurrentTime, setReviewCurrentTime] = useState(0);
  const [reviewDuration, setReviewDuration] = useState(0);
  const [reviewMuted, setReviewMuted] = useState(false);
  // What the participant can ACTUALLY see, as opposed to the layout
  // viewport `fixed inset-0` resolves against -- see the container's own
  // style prop for why the difference matters. Null until measured, and on
  // any browser without visualViewport (where the two are the same thing
  // anyway) it stays null and the plain inset-0 behaviour is kept.
  const [visualViewportBox, setVisualViewportBox] = useState<{ height: number; offsetTop: number } | null>(null);
  // Playback volume for the review player, 0..1. Starts at full -- the
  // organizer's requirement is that maximum volume is always available and
  // never capped, so nothing here ever clamps it below 1.
  const [reviewVolume, setReviewVolume] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const recordingBoxRef = useRef<HTMLDivElement>(null);
  // The recording box's REAL painted size, kept in a ref because
  // renderLoop re-schedules itself through requestAnimationFrame and would
  // otherwise read whatever value it closed over on its first frame. This
  // is what the canvas is sized against, so that the picture and the box
  // it sits in can never disagree and leave a letterbox gap.
  const containerBoxRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);
  // Real cameras rarely honor the `ideal` width/height sent to getUserMedia
  // exactly -- a desktop webcam in particular is a landscape-only sensor and
  // will hand back a landscape stream even when asked for a portrait one.
  // Sizing the preview box from a static "assume portrait unless the window
  // itself looks landscape" guess (the old min-h-[85dvh]/max-w-md/
  // landscape:max-w-4xl classes) is exactly what left the box shaped nothing
  // like whatever the camera actually delivered -- object-contain then
  // faithfully shrinks that real video to fit the mis-shaped box, wasting
  // most of it as plain black. Tracking the box's shape from the stream's
  // OWN dimensions instead removes that mismatch regardless of device or
  // orientation.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const videoAspectRef = useRef(0);
  // Camera flash. Hidden entirely where the device/browser can't do it
  // (iOS Safari never can) rather than shown as a dead control.
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  /** Which camera is live. Rear by default for kata: the performer stands
   * several metres from a propped-up phone, which is the rear camera's job
   * -- it is the better sensor on every phone, and the front one cannot be
   * aimed at the performer while the screen faces them. Switchable because
   * a webcam-only laptop has no rear camera at all, and some participants
   * film themselves at arm's length to check framing first. */
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  // iPhone/iPad get a written Control Centre hint instead of a light
  // button, because no browser on iOS can switch the camera flash on from a
  // web page at all -- there is no API to call, so there is nothing to put
  // behind a button. Detected after mount (never during render) so the
  // server and first client paint agree. iPadOS reports itself as a Mac,
  // hence the touch-points check.
  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  }, []);
  // How tall the burned-in header banner actually came out (as a fraction
  // of frame height), reported back by drawFrame -- the DOM title bar below
  // uses this to sit directly under the real banner instead of a fixed
  // guessed percentage that could leave a gap or overlap depending on
  // orientation and how much the banner's own text needed to shrink.
  const [bannerRatio, setBannerRatio] = useState(0.13);
  const bannerRatioRef = useRef(0.13);
  // Where Exit full screen + the deleted-recording counter sit -- one row
  // higher than bannerRatio (which is banner + identity/name-category
  // combined), so this cluster lands right under the main banner instead
  // of below the name/category text too.
  const [bannerOnlyRatio, setBannerOnlyRatio] = useState(0.08);
  const bannerOnlyRatioRef = useRef(0.08);
  // The same two figures as drawFrame reported them -- still relative to the
  // CANVAS, before the box conversion. Kept so the overlay offsets can be
  // recomputed on a rotation after the camera has been released (a take
  // ending shuts the camera off, so there are no new drawFrame results
  // coming), which is what keeps the review controls pinned to the banner.
  const rawBannerRatioRef = useRef(0.13);
  const rawBannerOnlyRatioRef = useRef(0.08);
  // Fraction of the box's WIDTH taken by the black pillarbox bar on each
  // side -- the horizontal twin of bannerRatio. The canvas is drawn
  // object-contain, so on any device whose camera frame is a different
  // shape from the box (a 16:9 sensor in a 21:9 landscape window, a phone
  // held sideways) there is dead black either side of the picture. Every
  // overlay used to be pinned to inset-x-0, i.e. to the BOX, which put
  // "Clap to stop", the canvas debug line, "✕ Exit full screen" and the
  // deleted-recording counter out on those bars and, on a wide enough
  // window, hard against (or past) the physical screen edge. Pinning them
  // to this inset instead keeps every control on the picture itself, on
  // every device, whatever its camera's native aspect ratio.
  const [contentInsetRatio, setContentInsetRatio] = useState(0);
  const contentInsetRatioRef = useRef(0);
  // Left/right in place of inset-x-0 on every overlay row. Percentages, not
  // pixels, so a rotation or a window resize moves the controls with the
  // picture on the very next measured frame rather than needing its own
  // listener.
  const overlayInsetStyle = useMemo<CSSProperties>(
    () => ({ left: `${contentInsetRatio * 100}%`, right: `${contentInsetRatio * 100}%` }),
    [contentInsetRatio],
  );
  // CSS `aspect-ratio` on a plain block element doesn't shrink-to-fit the
  // way it does on a replaced element (img/video) -- a statically-positioned
  // div with width:auto fills its container's full width first, THEN derives
  // height from that, so a tall aspect-ratio box would just overflow past
  // any max-height instead of shrinking back down. Computing explicit pixel
  // width/height here sidesteps that entirely.
  //
  // Always starts at this SAME placeholder value on both server and client
  // -- reading the real window size here directly (guarded by `typeof
  // window`) made the server-rendered box a different size than what the
  // client immediately computed during hydration (window already exists by
  // then), which React flags as a hydration mismatch. The mount effect
  // below corrects it to the real size right after hydration instead.
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 400, h: 800 });

  const attemptsLeft = Math.max(0, maxAttempts - attempts);
  const canReRecord = attemptsLeft > 0;

  // Both comparisons use the viewer's own browser clock — new Date() and
  // the plain (no explicit offset) date-time strings below both resolve in
  // whatever timezone this component is actually running in, so "today"
  // and "the deadline" are always evaluated in the participant's own
  // country's time frame, not the server's.
  const now = new Date();
  const windowOpensAt = recordingStart ? new Date(recordingStart + "T00:00:00") : null;
  const windowClosesAt = recordingEnd ? new Date(recordingEnd + "T23:59:59") : null;
  const notYetOpen = !!windowOpensAt && now < windowOpensAt;
  const windowClosed = !!windowClosesAt && now > windowClosesAt;
  const daysLeft = recordingEnd ? daysBetween(now, new Date(recordingEnd + "T23:59:59")) : null;

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (clapDetectorStopRef.current) clapDetectorStopRef.current();
      if (audioContextRef.current) void audioContextRef.current.close().catch(() => {});
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The `disablepictureinpicture` HTML attribute alone doesn't reliably
  // suppress every way iOS Safari can offer Picture-in-Picture on a video
  // (its own "now playing"/Control Center surface in particular) -- setting
  // the DOM property directly, once the element actually exists, is the
  // more reliable belt-and-suspenders way to keep it off entirely.
  useEffect(() => {
    if (reviewVideoRef.current) reviewVideoRef.current.disablePictureInPicture = true;
    // Carry the chosen volume onto each newly-loaded take, so re-recording
    // doesn't silently reset the player back to full after the participant
    // has turned it down.
    if (reviewVideoRef.current) {
      reviewVideoRef.current.muted = reviewVolume === 0;
      reviewVideoRef.current.volume = reviewVolume;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobUrl]);

  useEffect(() => {
    function onResize() {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    }
    // Correct the placeholder to the real size right after mount -- safe to
    // read window here (this only runs client-side, after hydration).
    onResize();
    // iOS Safari fires "orientationchange" before window.innerWidth/
    // innerHeight have actually updated to the new orientation -- reading
    // them immediately in the handler captures the OLD (pre-rotation)
    // values, which is exactly what left the box computing itself from a
    // stale, mismatched viewport size right after rotating back from
    // landscape to portrait. Re-reading a couple times shortly after
    // catches up once the browser settles, on every engine's own timing.
    function onOrientationChange() {
      onResize();
      setTimeout(onResize, 60);
      setTimeout(onResize, 300);
      // Rotating can bring Safari's own chrome back regardless of the CSS
      // overlay (a genuine platform limit -- real Fullscreen API support
      // for a non-<video> element like this one isn't there on iOS Safari
      // to prevent it), so the same scroll nudge as enterFullscreen is
      // re-applied here to at least re-collapse it as fast as possible
      // instead of leaving it up until the participant swipes themselves.
      if (fullscreenRef.current) {
        requestAnimationFrame(() => window.scrollTo(0, 1));
        setTimeout(() => window.scrollTo(0, 1), 350);
      }
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientationChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the visual viewport. Both events matter on iOS: "resize" fires
  // when Safari's toolbars slide in or out (which is exactly the moment the
  // controls would otherwise disappear under them), and "scroll" fires when
  // the visual viewport is panned relative to the layout viewport, which
  // changes offsetTop and would leave the overlay misaligned.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setVisualViewportBox({ height: vv.height, offsetTop: vv.offsetTop });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Watchdog for a replay that stops advancing without ever firing "ended".
  //
  // This is the actual reason the Full screen / Save to device / Delete &
  // re-record / Submit row "never popped up at the end of the replay, no
  // matter how many times it was touched": those four are hidden while
  // reviewPlaying is true, and reviewPlaying is cleared by onPause/onEnded.
  // When a MediaRecorder blob stalls a few hundred milliseconds short of its
  // declared duration (see isEffectivelyEnded), NEITHER event ever fires --
  // the element reports paused=false, ended=false forever -- so the row had
  // nothing to bring it back and the participant was left rotating to
  // portrait hunting for buttons that were never going to appear.
  //
  // Polls only while a replay is actually running, and only acts once
  // currentTime has genuinely stopped moving, so ordinary buffering on a
  // slow device doesn't trip it.
  const lastPlaybackProgressRef = useRef({ time: -1, at: 0 });
  useEffect(() => {
    if (!reviewPlaying) return;
    lastPlaybackProgressRef.current = { time: -1, at: Date.now() };
    const id = setInterval(() => {
      const v = reviewVideoRef.current;
      if (!v || v.paused) return;
      const now = Date.now();
      const last = lastPlaybackProgressRef.current;
      if (last.time < 0 || Math.abs(v.currentTime - last.time) > 0.05) {
        lastPlaybackProgressRef.current = { time: v.currentTime, at: now };
        return;
      }
      // Stopped moving. Give it a beat in case this is a genuine stall it
      // can recover from, then hand the controls back either way -- being
      // stuck with no way to reach Submit is far worse than ending a replay
      // a fraction of a second early.
      if (now - last.at >= 1200) {
        try {
          v.pause();
        } catch {
          // Pausing is only to keep the element's own state honest; the
          // state update below is what actually restores the controls.
        }
        setReviewPlaying(false);
      }
    }, 400);
    return () => clearInterval(id);
  }, [reviewPlaying]);

  // Keyboard zoom, for laptop and desktop where there is no pinch gesture:
  // + / = zooms in, - zooms out, 0 resets to the full field of view. Only
  // while the camera is actually live, and never while the participant is
  // typing in a field, so it can't hijack ordinary input elsewhere on the
  // page.
  useEffect(() => {
    if (phase !== "live" && phase !== "countdown" && phase !== "recording") return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") applyZoom(zoomRef.current + ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") applyZoom(zoomRef.current - ZOOM_STEP);
      else if (e.key === "0") applyZoom(1);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, applyZoom]);

  // Pinch to zoom, for phones and tablets. Tracks two pointers on the
  // recording box and scales from the distance between them, so it behaves
  // like the zoom gesture in any camera app rather than needing the buttons.
  useEffect(() => {
    const el = recordingBoxRef.current;
    if (!el) return;
    if (phase !== "live" && phase !== "countdown" && phase !== "recording") return;
    const points = new Map<number, { x: number; y: number }>();
    let startGap = 0;
    let startZoom = 1;
    const gap = () => {
      const [a, b] = [...points.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    function down(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 2) {
        startGap = gap();
        startZoom = zoomRef.current;
      }
    }
    function move(e: PointerEvent) {
      if (!points.has(e.pointerId)) return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 2 && startGap > 0) {
        applyZoom(startZoom * (gap() / startGap));
        e.preventDefault();
      }
    }
    function up(e: PointerEvent) {
      points.delete(e.pointerId);
      if (points.size < 2) startGap = 0;
    }
    // iOS Safari zooms the PAGE on a two-finger pinch, and it does so
    // through its own non-standard gesture* events -- which is why the
    // whole interface (Clap to stop, Exit full screen, the countdown row,
    // the record button) ballooned to several times its size the moment a
    // participant tried to zoom the camera. Our handler was setting the
    // canvas zoom correctly at the same time; the two were simply running
    // in parallel. preventDefault on gesturestart/gesturechange is the only
    // thing that stops Safari's half.
    function blockBrowserZoom(e: Event) {
      e.preventDefault();
    }
    // passive: false on pointermove too -- without it Safari ignores the
    // preventDefault inside move() entirely (a passive listener may not
    // cancel), so the page kept scrolling and rubber-banding under the
    // gesture as well.
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move, { passive: false });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("gesturestart", blockBrowserZoom);
    el.addEventListener("gesturechange", blockBrowserZoom);
    el.addEventListener("gestureend", blockBrowserZoom);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("gesturestart", blockBrowserZoom);
      el.removeEventListener("gesturechange", blockBrowserZoom);
      el.removeEventListener("gestureend", blockBrowserZoom);
    };
  }, [phase, applyZoom]);

  // Take the site's fixed footer out of the page entirely while full
  // screen is up (see app/globals.css). Cleaned up on exit AND on unmount,
  // so navigating away mid-recording can't strand the footer hidden.
  useEffect(() => {
    if (!fullscreen) return;
    document.body.classList.add("kata-recorder-fullscreen");
    return () => document.body.classList.remove("kata-recorder-fullscreen");
  }, [fullscreen]);

  // Same reasoning as scrollRecorderIntoView, for the case where a take
  // ENDS outside full screen (the recording stopped on its own, or full
  // screen was already exited): the review controls appear on a box that's
  // far below the fold, so without this they're invisible until the
  // participant happens to scroll down and find them.
  useEffect(() => {
    if (fullscreen || phase !== "review") return;
    scrollRecorderIntoView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, phase]);

  // Track the recording box's real size. A ResizeObserver rather than the
  // window resize handler above: this fires for every reason the box's own
  // size can change -- rotation, browser UI appearing or retracting,
  // entering or leaving fullscreen, a device-toolbar resize -- including
  // the ones that never produce a window resize event at all, and it
  // reports the element's own measured box rather than a viewport figure
  // that may not match it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        containerBoxRef.current = { w: rect.width, h: rect.height };
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // phase is a dependency because the box only exists once past the
    // early returns above, and fullscreen because entering it swaps the
    // element's positioning entirely.
  }, [fullscreen, phase]);

  // Re-ask the camera for the CURRENT orientation's shape whenever the
  // viewport changes.
  //
  // getUserMedia was only ever called once, in startCamera, so the stream
  // kept whatever shape it was negotiated with at that moment. Start in
  // portrait and rotate to landscape and the stream stayed portrait while
  // the screen turned landscape -- and since the canvas may only depart
  // from the camera's shape by the crop clamp's 15%, it stayed pinned
  // portrait too, leaving about 65% of a landscape screen as black bars.
  // That is the landscape recording window in the organizer's screenshots;
  // portrait looked fine purely because it was the orientation the stream
  // happened to be negotiated in.
  //
  // applyConstraints re-negotiates the live track in place, so there's no
  // visible restart and no new permission prompt. Deliberately NOT run
  // while recording: the take in progress is being captured from the
  // canvas, whose size is frozen for the duration, and swapping the source
  // shape underneath it mid-recording risks disturbing that.
  useEffect(() => {
    if (phase !== "live") return;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const { width, height, constrainAspect } = idealVideoDimensions();
    void track
      .applyConstraints({
        width: { ideal: width },
        height: { ideal: height },
        // Phones/tablets deliberately send no aspectRatio at all -- see
        // idealVideoDimensions: pinning it there makes iOS crop the sensor
        // to match, which is exactly the narrowing this removes. On a
        // phone this call now only ever swaps the orientation's standard
        // 16:9 preset (720x1280 <-> 1280x720), never a custom shape.
        ...(constrainAspect ? { aspectRatio: { ideal: width / height } } : {}),
      })
      // Best-effort: a camera that can't honour the new shape just keeps
      // its old one, and the crop clamp still bounds how far the canvas
      // may drift from it.
      .catch(() => {});
  }, [phase, viewport.w, viewport.h]);

  // This used to collapse our OWN fullscreen state the instant the
  // browser's native Fullscreen API dropped for ANY reason, on the
  // assumption that only an intentional exit (OS gesture, Escape) could
  // cause that. But native fullscreen is also known to drop on its own in
  // some browsers when a fresh <video> element mounts inside it -- exactly
  // what happens the moment Stop finishes and the review player appears --
  // with nothing to do with the participant wanting to leave. That made
  // full screen "randomly" vanish right after Stop, and again if it had to
  // remount during replay.
  //
  // Our OWN "fullscreen" state (the CSS fixed-inset-0 overlay) is the real
  // source of truth for whether the recording UI is maximized; the native
  // API is just a bonus layered on top (per enterFullscreen's own comment).
  // So instead of following native fullscreen down, this now tries to bring
  // native fullscreen back INTO sync with our state -- if it drops while we
  // should still be fullscreen, just re-request it. The explicit "Exit full
  // screen" button (and the "done" phase) are the only two places that
  // actually call setFullscreen(false), and by the time this fires for
  // either of those, `fullscreen` has already updated to false, so the
  // re-request is correctly skipped -- this doesn't defeat exiting.
  useEffect(() => {
    function onFsChange() {
      if (document.fullscreenElement || !fullscreen) return;
      const el = containerRef.current as
        | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> })
        | null;
      if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
      else if (el?.webkitRequestFullscreen) void el.webkitRequestFullscreen().catch(() => {});
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [fullscreen]);

  // Full screen now covers the entire flow -- live, recording, AND review
  // (the header/footer should stay gone through the replay + delete/submit
  // step too, not just while composing the shot) -- so the only automatic
  // exit left is once it's actually done and there's nothing left to keep
  // the page maximized for.
  useEffect(() => {
    if (fullscreen && phase === "done") {
      setFullscreen(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** The fixed inset-0 CSS overlay is what actually guarantees the header/
   * footer disappear and the recorder fills the whole screen, on every
   * device regardless of Fullscreen API support (mobile Safari's support
   * for arbitrary elements — as opposed to just <video> — is still
   * inconsistent). Requesting real Fullscreen too is a bonus layered on
   * top where it works (also hides the browser's own address bar), never
   * required — its failure is silently ignored since the CSS overlay
   * already covers the requirement either way. */
  function enterFullscreen() {
    setFullscreen(true);
    // A tiny scroll nudge -- iOS Safari's own chrome (URL bar, tab strip)
    // can still be showing at this exact instant, and the fixed inset-0
    // overlay gets sized against whichever viewport state Safari committed
    // to at its LAST layout pass, not the one this triggers -- leaving a
    // visible gap at the top until something (normally the participant
    // swiping the page themselves) makes Safari recompute. This is the same
    // trick Safari's own address-bar-hiding behaviour has always relied on;
    // doing it ourselves here means the participant doesn't have to.
    requestAnimationFrame(() => window.scrollTo(0, 1));
    const el = containerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> })
      | null;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else if (el?.webkitRequestFullscreen) void el.webkitRequestFullscreen().catch(() => {});
  }

  /** Brings the recording box (and therefore every control layered on it)
   * back into view. Outside full screen the box sits in normal page flow,
   * BELOW the two instruction blocks -- measured on a 812x375 landscape
   * phone that puts it over 1100px down the page, roughly three screenfuls
   * past the fold. The controls are all present and clickable there, but a
   * participant looking at the instructions can't see any of them, which
   * reads exactly like the buttons never appeared. */
  function scrollRecorderIntoView() {
    // setTimeout rather than requestAnimationFrame: rAF is throttled to
    // zero whenever the tab isn't actively compositing, and the scroll then
    // simply never happens. Two attempts because the box only settles into
    // its final non-fullscreen size once React has committed the layout
    // change AND the render loop has re-measured it -- scrolling to a
    // half-sized box would land short. Instant, not smooth: a smooth scroll
    // that gets interrupted leaves the page parked halfway there.
    const scroll = () => recordingBoxRef.current?.scrollIntoView({ block: "center" });
    setTimeout(scroll, 60);
    setTimeout(scroll, 300);
  }

  function exitFullscreen() {
    setFullscreen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    scrollRecorderIntoView();
  }

  async function startCamera(requestedFacing: "user" | "environment" = facing) {
    setError(null);
    try {
      const { width, height, constrainAspect } = idealVideoDimensions();
      // aspectRatio alongside width/height: a webcam's supported resolution
      // list rarely contains the exact pixels requested, and browsers weigh
      // width/height "ideal" hints fairly loosely when picking among what's
      // actually available. Giving the ratio explicitly too makes shape
      // matching (not just pixel count) part of what the browser optimizes
      // for, so it's less likely to hand back something needlessly narrower
      // than the screen even when it can't hit the exact size requested.
      // `audio: true` silently accepts every browser default, and all of
      // those defaults are tuned for a phone held against your face in a
      // voice call -- the opposite of a kata performed several metres away
      // in a hall:
      //  - echoCancellation gates hard on anything it decides is "far" or
      //    room-reflected, which is most of a kata's own sound and is the
      //    most likely reason a recording comes back near-silent.
      //  - noiseSuppression is built to delete short, sharp, non-speech
      //    sounds -- i.e. precisely a hand clap, and most aggressively the
      //    faint distant one we need to detect.
      //  - autoGainControl is the one default worth KEEPING on: it lifts a
      //    quiet, distant source up to a usable level.
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      };
      // Phones and tablets: capture from every direction, not just from
      // whoever is in front of the phone.
      //
      // A phone has several microphones and, left alone, the browser hands
      // the page a single beam-formed "voice" channel aimed at the front of
      // the device -- correct for a call, wrong for a kata performed several
      // metres away in a hall with sound arriving from all round. Asking for
      // TWO channels is what actually engages more than one microphone, so
      // the room is captured rather than a single aimed pickup; `ideal`
      // means a device that only has one mic simply gives mono back instead
      // of failing the whole request.
      if (isMobileDevice()) {
        audioConstraints.channelCount = { ideal: 2 };
      }
      // Chrome/Android keeps a second, older set of switches for the same
      // processing chain, and honours these even when the standard ones
      // above are already set -- they are what actually turns the
      // beam-forming and directional noise gate off on a lot of Android
      // builds. Unknown constraint keys are ignored everywhere else, so this
      // is inert on browsers that never had them.
      Object.assign(audioConstraints as Record<string, unknown>, {
        googEchoCancellation: false,
        googAutoGainControl: false,
        googNoiseSuppression: false,
        googHighpassFilter: false,
        googTypingNoiseDetection: false,
        googAudioMirroring: false,
      });
      // Safari 17+ only, and not in the DOM typings yet. Apple's Voice
      // Isolation beam-forms toward whoever is speaking in front of the
      // phone and actively attenuates whatever arrives from other
      // directions -- a literal match for "the clap is only picked up from
      // one direction". Unknown constraint keys are ignored elsewhere, so
      // this is harmless on browsers that don't implement it.
      (audioConstraints as Record<string, unknown>).voiceIsolation = false;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // Not "exact": a laptop or desktop webcam reports no facing mode
          // at all, and an exact constraint there fails outright with
          // OverconstrainedError rather than falling back to the only
          // camera present.
          facingMode: requestedFacing,
          // HD, fixed: 1280 on the long edge (720p class) and 30fps, with
          // `max` alongside `ideal` so a phone that would otherwise hand
          // back 1080p60 is actually held to it. Every judge sees the same
          // format, and the file stays a size a participant on a modest
          // connection can realistically upload.
          // An organizer-applied spec overrides the built-in 720p cap.
          // Same shape of constraint, just a different ceiling, so nothing
          // about how the constraint behaves changes -- see appliedSpec.
          width: { ideal: appliedSpec ? appliedSpec.width : width, max: appliedSpec ? appliedSpec.width : 1280 },
          height: { ideal: appliedSpec ? appliedSpec.height : height, max: appliedSpec ? appliedSpec.height : 1280 },
          // Desktop only -- see idealVideoDimensions for why a phone must
          // not pin this (iOS crops the sensor to honour it, narrowing the
          // participant's own field of view).
          ...(constrainAspect ? { aspectRatio: { ideal: width / height } } : {}),
          frameRate: { ideal: appliedSpec?.fps ?? 30, max: appliedSpec?.fps ?? 30 },
        },
        audio: audioConstraints,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setFacing(requestedFacing);
      // Torch is a rear-camera feature on every phone that has one; a
      // front camera reports no torch capability, so this re-checks per
      // switch rather than assuming what was true for the other camera.
      setTorchAvailable(torchSupported(stream));
      setTorchOn(false);
      setPhase("live");
      requestAnimationFrame(renderLoop);
      enterFullscreen();
    } catch {
      setError("Could not access your camera. Please allow camera & microphone permission and try again.");
    }
  }

  /** Backs out of an enabled-but-not-yet-recording camera session -- stops
   * the stream (so the camera/mic indicator actually turns off), cancels
   * the render loop, leaves full screen, and drops back to the same idle
   * "Enable camera" screen this all started from. Only reachable during
   * "live" (before the countdown/recording commits to anything), which is
   * also the only phase that had no way back out short of leaving the page
   * entirely. */
  /** Kept honest against the hardware: if applyConstraints refuses, the
   * button stays where it was rather than claiming a light that isn't on. */
  async function toggleTorch() {
    const next = !torchOn;
    const applied = await setTorch(streamRef.current, next);
    if (applied) setTorchOn(next);
    else setTorchAvailable(false);
  }

  /** Stops the camera and microphone WITHOUT touching the phase, so the
   * device's own camera/mic indicator goes out while whatever is on screen
   * stays exactly where it is. Used the moment a take ends (see
   * recorder.onstop) -- the organizer asked for the camera and mic to shut
   * off by themselves as soon as recording stops, however it stopped: the
   * clap detector, the Stop button, or the 5-minute cap. The review screen
   * plays back the recorded FILE, never the live camera, so nothing on it
   * needs the stream alive; re-recording re-opens it (see handleReRecord). */
  function releaseCameraAndMic() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchOn(false);
    setTorchAvailable(false);
  }

  function disableCamera() {
    releaseCameraAndMic();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    exitFullscreen();
    setError(null);
    setPhase("idle");
  }

  /** Converts drawFrame's "fraction of the CANVAS's height" figures into
   * "fraction of the BOX's height", which is what the DOM overlays' top:%
   * actually needs -- the two differ whenever the canvas is letterboxed
   * inside the box. Split out of renderLoop so it can also run on frames
   * where there's no live video left to draw (the camera is released as
   * soon as a take ends, but the review controls still have to stay pinned
   * to the banner if the phone is rotated during playback). */
  function applyOverlayOffsets(rawBannerRatio: number, rawBannerOnlyRatio: number) {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    const liveBoxRect = recordingBoxRef.current?.getBoundingClientRect();
    let finalRatio = rawBannerRatio;
    let finalBannerOnlyRatio = rawBannerOnlyRatio;
    let finalInset = 0;
    if (liveBoxRect && liveBoxRect.width > 0 && liveBoxRect.height > 0) {
      const canvasAspect = canvas.width / canvas.height;
      const boxAspect = liveBoxRect.width / liveBoxRect.height;
      const contentHeightPx = canvasAspect > boxAspect ? liveBoxRect.width / canvasAspect : liveBoxRect.height;
      const contentTopFraction = (liveBoxRect.height - contentHeightPx) / 2 / liveBoxRect.height;
      const contentHeightFraction = contentHeightPx / liveBoxRect.height;
      finalRatio = contentTopFraction + rawBannerRatio * contentHeightFraction;
      finalBannerOnlyRatio = contentTopFraction + rawBannerOnlyRatio * contentHeightFraction;
      // Pillarbox: the mirror of the letterbox maths above. Only one of the
      // two can be non-zero for a given frame, so this is a no-op whenever
      // the picture already fills the box edge to edge.
      const contentWidthPx = canvasAspect > boxAspect ? liveBoxRect.width : liveBoxRect.height * canvasAspect;
      finalInset = (liveBoxRect.width - contentWidthPx) / 2 / liveBoxRect.width;
    }
    if (Math.abs(contentInsetRatioRef.current - finalInset) > 0.002) {
      contentInsetRatioRef.current = finalInset;
      setContentInsetRatio(finalInset);
    }
    if (Math.abs(bannerRatioRef.current - finalRatio) > 0.002) {
      bannerRatioRef.current = finalRatio;
      setBannerRatio(finalRatio);
    }
    if (Math.abs(bannerOnlyRatioRef.current - finalBannerOnlyRatio) > 0.002) {
      bannerOnlyRatioRef.current = finalBannerOnlyRatio;
      setBannerOnlyRatio(finalBannerOnlyRatio);
    }
  }

  function renderLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    // Guard on BOTH dimensions, not just width -- a rotation on a real
    // device can briefly report one of the two as 0 while the stream
    // reflows, and a ratio computed from a 0 height is Infinity, which
    // then collapses the preview box's computed height to 0 (width /
    // Infinity) and makes the whole recording screen appear to vanish.
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      // No live frame to draw -- either a rotation is briefly reporting a 0
      // dimension, or (the normal case now) the take has ended and the
      // camera has been released. The canvas keeps its last painted frame
      // either way, so the overlay offsets are still recomputed here off
      // the box's CURRENT size: rotating the phone during playback would
      // otherwise leave the review controls pinned to a stale position.
      applyOverlayOffsets(rawBannerRatioRef.current, rawBannerOnlyRatioRef.current);
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    // Shape the canvas EXACTLY like the camera's own delivered frame -- no
    // cropping to match the screen's shape. This used to crop toward the
    // screen's own aspect (down to 68% of the camera's frame kept, as a
    // backstop) specifically to avoid letterbox bars, but that crop is
    // what a participant sees as their own recording looking artificially
    // zoomed in / narrower than what their camera actually sees -- the
    // participant explicitly asked for their camera's true field of view
    // over avoiding letterbox bars, so this no longer trades one for the
    // other. Whatever letterboxing results from a camera/screen aspect
    // mismatch is handled by the DOM controls tracking the canvas's real
    // rendered position within the box (see the bannerRatio conversion
    // below), not by cropping the picture itself.
    //
    // Resizing a canvas mid-recording disturbs the track captureStream()
    // is feeding MediaRecorder, so once a take is rolling the shape is
    // frozen until it stops (a mid-take rotation keeps the shape it
    // started with rather than corrupting the recording).
    const recording = recorderRef.current?.state === "recording";
    if (!recording) {
      // Still re-measured every frame -- containerBoxRef feeds the
      // bannerRatio-to-box conversion below regardless of whether the
      // canvas itself is cropped to it.
      if (containerRef.current) {
        const liveRect = containerRef.current.getBoundingClientRect();
        if (liveRect.width > 0 && liveRect.height > 0) {
          containerBoxRef.current = { w: liveRect.width, h: liveRect.height };
        }
      }
      const targetAspect = video.videoWidth / video.videoHeight;
      // No cropping: canvas dimensions are the camera's own delivered
      // pixels, exactly. (The videoWidth/videoHeight branch below always
      // resolves to a straight copy now that targetAspect IS that same
      // ratio -- kept in this shape rather than simplified to a flat
      // assignment so a future backstop, if one's ever needed again, has
      // an obvious place to reintroduce itself.)
      let canvasW: number;
      let canvasH: number;
      if (video.videoWidth / video.videoHeight > targetAspect) {
        canvasH = video.videoHeight;
        canvasW = Math.round(video.videoHeight * targetAspect);
      } else {
        canvasW = video.videoWidth;
        canvasH = Math.round(video.videoWidth / targetAspect);
      }
      if (canvasW > 0 && canvasH > 0) {
        if (canvas.width !== canvasW) canvas.width = canvasW;
        if (canvas.height !== canvasH) canvas.height = canvasH;
      }
    }
    // Tracked from the CANVAS (not the raw camera frame) now -- the canvas
    // is what actually gets displayed, so it's the shape the non-fullscreen
    // preview box has to match to avoid leaving black gutters of its own.
    const ratio = canvas.width / canvas.height;
    if (Number.isFinite(ratio) && ratio > 0 && Math.abs(videoAspectRef.current - ratio) > 0.01) {
      videoAspectRef.current = ratio;
      setVideoAspect(ratio);
    }
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const { bannerRatio: bannerRatioOfCanvas, bannerOnlyRatio: bannerOnlyRatioOfCanvas } = drawFrame(
        ctx,
        video,
        canvas.width,
        canvas.height,
        watermark,
        participantName ?? "",
        categoryName ?? "",
        zoomRef.current,
      );
      if (Number.isFinite(bannerRatioOfCanvas) && bannerRatioOfCanvas > 0) {
        rawBannerRatioRef.current = bannerRatioOfCanvas;
        rawBannerOnlyRatioRef.current = bannerOnlyRatioOfCanvas;
        // Converts "fraction of the CANVAS's own height" (what drawFrame
        // returns) into "fraction of the BOX's CURRENT height" (what the
        // DOM stack's top:% actually needs) -- these agree exactly when
        // canvas and box share the same aspect, which is true in normal
        // steady state, but NOT once recording starts: canvas.width/height
        // are then frozen (resizing mid-take would corrupt the
        // captureStream() feeding MediaRecorder, see above), while the
        // box's real on-screen size can still change for a few more
        // seconds after that -- Safari's own chrome finishing its collapse
        // is the common case, since enterFullscreen's scroll nudge doesn't
        // guarantee it settles before the countdown/recording start. In
        // that window the canvas ends up object-contain letterboxed WITHIN
        // the box, and the DOM stack has to land on that actual letterboxed
        // picture, not a flat percentage of the raw box -- which is what
        // left it floating in the resulting black gap on real devices,
        // reported as happening well into an active recording (not just at
        // the very start), consistent with exactly this freeze. Measured
        // fresh every frame, recording or not, so it self-corrects the
        // instant the two next agree (recording stopping unfreezes canvas
        // sizing above) rather than only catching up once.
        applyOverlayOffsets(bannerRatioOfCanvas, bannerOnlyRatioOfCanvas);
      }
    }
    rafRef.current = requestAnimationFrame(renderLoop);
  }

  /** Tap Start -> a visible countdown (participant's chosen length) so a
   * solo performer can walk into position -> ding-dong chime -> recording
   * begins on its own. Replaces startRecording as the round Start button's
   * handler; startRecording itself now only fires once the countdown ends. */
  function startCountdown() {
    setError(null);
    // Created here, on the tap itself, so it's a genuine user gesture --
    // creating it later inside the countdown's own timer callback would
    // not count as one, and iOS Safari silently refuses to play any sound
    // from a context that was never unlocked that way.
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext();
      } catch {
        audioContextRef.current = null;
      }
    }
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume().catch(() => {});
    }
    setCountdownSeconds(countdownDuration);
    setPhase("countdown");
    // Alarm-style tick on every second the countdown is visibly showing
    // (loud, sharp, deliberately different from the softer ding-dong) --
    // audible from several metres away without needing to watch the
    // screen. The tick stream stops the instant the chime takes over,
    // which is itself the "counting down is over, recording is starting"
    // cue.
    if (audioContextRef.current) playAlarmTick(audioContextRef.current);
    countdownTimerRef.current = setInterval(() => {
      setCountdownSeconds((s) => {
        if (s <= 1) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
          void beginRecordingAfterCountdown();
          return 0;
        }
        if (audioContextRef.current) playAlarmTick(audioContextRef.current);
        return s - 1;
      });
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
    setPhase("live");
  }

  async function beginRecordingAfterCountdown() {
    const ctx = audioContextRef.current;
    if (ctx) {
      try {
        await playDingDong(ctx);
      } catch {
        // Best-effort -- a chime failure shouldn't block the recording.
      }
    }
    startRecording();
  }

  /** Had no error handling at all -- any failure here (captureStream
   * unsupported on this device/browser, MediaRecorder rejecting the
   * mimeType, etc.) threw silently in the click handler: the button looked
   * like it did nothing, with no error shown and nothing to diagnose from.
   * Now mirrors startCamera's own try/catch, so a real failure is at least
   * visible instead of indistinguishable from a touch/hit-area problem. */
  function startRecording() {
    setError(null);
    const canvas = canvasRef.current;
    const camStream = streamRef.current;
    if (!canvas || !camStream) return;
    try {
      if (typeof canvas.captureStream !== "function") {
        setError("Your browser doesn't support in-app recording — please update it, or try the latest Chrome or Safari.");
        return;
      }
      const canvasStream = canvas.captureStream(30);
      const audioTrack = camStream.getAudioTracks()[0];
      // Build ONE stream holding both tracks up front, rather than
      // addTrack()-ing the microphone onto the canvas stream afterwards.
      // Several WebKit/iOS versions only mux the tracks a MediaStream was
      // CONSTRUCTED with and quietly ignore any added later -- which
      // produces exactly the reported symptom: the picture records fine and
      // the sound is missing, with no error anywhere.
      const recordStream = new MediaStream(
        audioTrack ? [...canvasStream.getVideoTracks(), audioTrack] : canvasStream.getVideoTracks(),
      );
      // A track that arrives disabled records as pure silence.
      if (audioTrack) audioTrack.enabled = true;

      const mimeType = pickMimeType();
      // Explicit bitrates, sized so a full-length take fits the upload
      // limit.
      //
      // Left to itself MediaRecorder picks whatever bitrate it likes, and on
      // a real iPhone that came out around 10 Mbit/s -- a 1m30s take weighed
      // 111.6MB, which means a full 5-minute kata would be roughly 370MB.
      // Supabase rejects it long before that: the project-wide ceiling is
      // 50MB (the kata-videos bucket's own 500MB setting sits above it and
      // never applies), which is the "object exceeded the maximum allowed
      // size" failure participants were hitting.
      //
      // MAX_SECONDS is the hard recording cap, so budgeting against it
      // bounds the worst case rather than the typical one. The figures now
      // come from recordingBitrates(), which derives them from that cap and
      // the upload ceiling instead of hardcoding one number for every kind
      // of recording in the app -- see the note there. For a 5:00 kata that
      // works out at ~1.13 Mbit/s (about 44MB worst case), up from the flat
      // 1.0 Mbit/s this used to use, so the extra room the shorter cap
      // earns actually goes into the picture. Smaller files also upload far
      // faster and more reliably on mobile data, which is why the helper
      // caps the video rate rather than simply spending the whole budget.
      // An applied spec wins over the derived figure. It is the organizer's
      // deliberate choice, made on /admin/storage where the resulting file
      // sizes and the 50MB ceiling are shown alongside it, so it is not
      // second-guessed here.
      const derived = recordingBitrates(MAX_SECONDS);
      const videoBitsPerSecond = appliedSpec?.videoBitsPerSecond ?? derived.videoBitsPerSecond;
      const audioBitsPerSecond = appliedSpec?.audioBitsPerSecond ?? derived.audioBitsPerSecond;
      const recorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond, audioBitsPerSecond });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (clapDetectorStopRef.current) {
          clapDetectorStopRef.current();
          clapDetectorStopRef.current = null;
        }
        // Fix the take's real length now, before anything tries to read it
        // off the file. Capped at MAX_SECONDS so a stray clock reading can
        // never claim a longer take than the recorder allows.
        const measured =
          recordingStartMsRef.current > 0
            ? Math.min(MAX_SECONDS, (performance.now() - recordingStartMsRef.current) / 1000)
            : 0;
        measuredDurationRef.current = measured;
        if (measured > 0) setReviewDuration(measured);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        recordedBlobRef.current = blob;
        // Cached locally the instant a take finishes, before the
        // participant has even tapped Submit -- if the actual submit later
        // fails on a bad connection, this backup already exists and can be
        // retried from the pending-recordings list without re-recording.
        // Cleared again once a submission actually succeeds (handleSubmit).
        saveLocalRecording(registrationId, blob, mimeType).catch(() => {});
        const url = URL.createObjectURL(blob);
        // Grab the canvas's own last-drawn frame synchronously, right now --
        // it already has the banner/watermark burned in, same as every frame
        // in the recording itself, so there's zero decode delay before the
        // review screen shows them (unlike waiting on the video element to
        // decode the actual file, which is what previously left a blank/
        // banner-less gap right after tapping Stop).
        try {
          const poster = canvasRef.current?.toDataURL("image/jpeg", 0.85);
          if (poster) setPosterUrl(poster);
        } catch {
          // Best-effort -- a missing poster just falls back to the video's
          // own first frame once it decodes, not a hard failure.
        }
        setBlobUrl(url);
        setPhase("review");
        if (timerRef.current) clearInterval(timerRef.current);
        // Camera and mic off the moment the take ends, on the organizer's
        // instruction -- and this is the one place every way of ending a
        // take converges on (the clap detector, the Stop button, and the
        // 5-minute cap all reach here through recorder.stop()), so none of
        // them can leave the camera running. Deliberately AFTER the poster
        // grab above, which reads the canvas's last painted frame. The
        // review screen plays the recorded file, not the camera, so nothing
        // it shows needs the stream; handleReRecord re-opens it.
        releaseCameraAndMic();
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      // The authoritative length of this take. MediaRecorder writes a
      // STREAMING container -- built to be emitted live, of unknown length --
      // so it carries no duration in its header and the browser answers
      // Infinity until it has scanned the entire file, which it may never
      // bother to do. Timing the take ourselves is exact, immediate, and
      // identical on every device and in every format, so nothing downstream
      // has to interrogate the file at all. performance.now() rather than
      // Date.now(): monotonic, so a clock adjustment mid-take can't produce a
      // negative or wildly wrong length.
      recordingStartMsRef.current = performance.now();
      // Auto-stop on a hand clap -- starts right as recording does, well
      // after the countdown's own ding-dong chime has already finished
      // playing, so the chime itself is never mistaken for the cue. Reuses
      // the SAME AudioContext the chime just played through (created back
      // on the Start tap, a real user gesture) rather than a fresh one --
      // see startClapDetector's own doc comment for why that distinction
      // is what was actually silencing the detector entirely.
      if (audioContextRef.current) {
        clapDetectorStopRef.current = startClapDetector(audioContextRef.current, camStream, { onClap: stopRecording });
      }
      setSeconds(0);
      setRecordingStartedAt(new Date());
      setPhase("recording");
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            stopRecording();
            return MAX_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Could not start recording. Please try again, or use a different browser (latest Chrome or Safari).");
    }
  }

  function stopRecording() {
    try {
      recorderRef.current?.stop();
    } catch {
      setError("Could not stop recording. Please try again.");
    }
  }

  /** Settles on a length for the seek bar, preferring the one we timed
   * ourselves over whatever the file claims.
   *
   * The element's own duration is only believed when there's nothing
   * measured to compare against (a take restored from this device's cache
   * after a reload, which never went through this session's recorder) or
   * when it broadly agrees with what we timed. A MediaRecorder file
   * routinely reports Infinity, 0, or a value padded past its last real
   * frame, and any of those becomes a seek bar that can't be dragged or a
   * total time that reads as nonsense. */
  function resolveReviewDuration(v: HTMLVideoElement) {
    const measured = measuredDurationRef.current;
    const fromFile = v.duration;
    const fileUsable = Number.isFinite(fromFile) && fromFile > 0;
    if (!measured) {
      setReviewDuration(fileUsable ? fromFile : 0);
      return;
    }
    const agrees = fileUsable && Math.abs(fromFile - measured) <= Math.max(2, measured * 0.25);
    setReviewDuration(agrees ? fromFile : measured);
  }

  function toggleReviewPlayback() {
    const v = reviewVideoRef.current;
    if (!v) return;
    if (isEffectivelyEnded(v, measuredDurationRef.current)) {
      // Calling play() while currentTime is still sitting at duration
      // doesn't restart playback -- most browsers just fire "play" once,
      // with nothing left to actually play, and never fire "ended" again
      // since no further time-to-end transition happens. That's exactly
      // why the 4-button row (which listens for onEnded/onPause to know
      // when to reappear) came back after the FIRST watch-through but not
      // the second or third -- there was never a second "ended" event to
      // hear. Seeking back to 0 first guarantees a real play-through, and
      // a real "ended" event, every single time.
      v.currentTime = 0;
      void v.play();
    } else if (v.paused) {
      void v.play();
    } else {
      v.pause();
    }
  }

  /** Volume slider handler. Sliding all the way down to 0 mutes, anything
   * above unmutes, and the top of the slider is full volume -- never capped.
   *
   * Both `muted` and `volume` are set deliberately, because iOS is the odd
   * one out: on iPhone/iPad `video.volume` is READ-ONLY and assigning to it
   * does nothing at all (Apple reserves playback level for the hardware
   * buttons). `muted` however is honoured everywhere. So on a phone this
   * slider works as a mute/unmute at the bottom of its travel with the
   * hardware buttons setting the actual level, while on desktop and Android
   * it behaves as a true continuous volume control. */
  function applyReviewVolume(next: number) {
    const clamped = Math.min(1, Math.max(0, next));
    setReviewVolume(clamped);
    setReviewMuted(clamped === 0);
    const v = reviewVideoRef.current;
    if (!v) return;
    v.muted = clamped === 0;
    v.volume = clamped;
  }

  function formatPlaybackTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function handleReRecord() {
    if (!canReRecord) return;
    const newCount = await useRecordAttempt(registrationId);
    setAttempts(newCount);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setPosterUrl(null);
    setReviewPlaying(false);
    setReviewCurrentTime(0);
    setReviewDuration(0);
    // Cleared with the take it belonged to, so a fresh recording can never
    // inherit the previous one's length.
    measuredDurationRef.current = 0;
    recordingStartMsRef.current = 0;
    recordedBlobRef.current = null;
    // The take being discarded is no longer a valid "saved recording" to
    // offer for upload later -- without this, a stale previous take could
    // sit in local storage and get submitted by mistake from the pending
    // list while a fresh one is being recorded here.
    void clearLocalRecording(registrationId);
    // Drop to idle FIRST, then re-open the camera. The stream was released
    // when the previous take ended (see recorder.onstop), so "live" on its
    // own would show a frozen last frame and a Start button that records
    // nothing -- startCamera sets the phase to live, restarts the render
    // loop and re-enters full screen itself once it succeeds. Going through
    // idle rather than straight to live is what makes the failure path
    // recoverable: if the camera can't be re-opened (permission revoked in
    // Settings between takes, or another app holding it), startCamera shows
    // its error and the participant is left on the "Enable camera" screen
    // they can retry from -- not on a review screen whose recording has
    // just been cleared. Safe on iOS: this runs inside the Delete &
    // re-record tap, a real user gesture, and permission already granted
    // this session isn't re-prompted.
    setPhase("idle");
    await startCamera();
  }

  /** Puts a copy of the just-recorded take directly into the participant's
   * own device (their Photos/video album, via the native share sheet where
   * available) -- purely a personal backup for a poor-connection moment,
   * independent of the automatic local cache above (which this component
   * already keeps for the in-app retry path). Failure here is silent: the
   * automatic cache already covers the retry case, so a share-sheet
   * cancellation or an unsupported browser isn't a real error. */
  async function handleSaveToDevice() {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    const file = new File([blob], `kata-recording.${extensionForMimeType(blob.type)}`, {
      type: bareMimeType(blob.type || "video/webm"),
    });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Kata recording" });
        return;
      }
    } catch {
      // Share sheet cancelled or unsupported -- fall through to a direct
      // download instead of leaving the tap looking like it did nothing.
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit() {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    if (blob.size < 1024) {
      // A near-empty Blob (MediaRecorder handed back nothing usable) would
      // otherwise upload "successfully" — no storage error — and only be
      // caught later server-side, after already occupying a judge's slot.
      setError("This recording came out empty. Please record again before submitting.");
      return;
    }
    setPhase("uploading");
    setUploadProgress(0);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Your session expired — please sign in again.");
        setPhase("review");
        return;
      }
      // A fresh path per attempt -- see uploadRecording for why a retry
      // cannot reuse one.
      const ext = extensionForMimeType(blob.type);
      const makePath = () => `${user.id}/${crypto.randomUUID()}.${ext}`;
      // Keep the screen awake for the duration. An upload of tens of
      // megabytes from a phone takes long enough that the display can dim
      // and lock on its own, and iOS suspends the page when it does --
      // killing the request mid-flight with no error worth showing. Not
      // supported everywhere; where it isn't, the upload just runs as
      // before.
      let wakeLock: { release: () => Promise<void> } | null = null;
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        wakeLock = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        // Denied or unsupported -- nothing to do, the upload still runs.
      }
      let outcome;
      try {
        outcome = await uploadRecording(
          supabase,
          "kata-videos",
          makePath,
          blob,
          bareMimeType(blob.type || "video/webm"),
          { onProgress: setUploadProgress },
        );
      } finally {
        await wakeLock?.release().catch(() => {});
      }
      if (!outcome.ok || !outcome.path) {
        setError(
          `${outcome.error ?? "Upload failed."} (type: ${blob.type || "unknown"}, size: ${(blob.size / 1024 / 1024).toFixed(1)}MB${outcome.detail ? ` — ${outcome.detail}` : ""})`,
        );
        setPhase("review");
        return;
      }
      const fd = new FormData();
      fd.set("path", outcome.path);
      fd.set("mime", blob.type || "video/webm");
      fd.set("registration_id", registrationId);
      const result = await submitKataVideo({ ok: false }, fd);
      if (!result.ok) {
        setError(result.error ?? "Could not submit your recording.");
        setPhase("review");
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      void clearLocalRecording(registrationId);
      setPhase("done");
    } catch {
      setError("Something went wrong submitting your recording. Please try again.");
      setPhase("review");
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  /** Sits ABOVE the round button now, not to its left -- the left and right
   * flanks either side of that button are the camera controls' home (see
   * the live-phase block below), and the torch used to overlap them. Only
   * rendered where the hardware can actually switch the flash on, which is
   * never any browser on iPhone -- see lib/camera-torch.ts. */
  const torchButton = torchAvailable ? (
    <button
      type="button"
      onClick={toggleTorch}
      aria-pressed={torchOn}
      className={
        "absolute bottom-full left-1/2 mb-3 -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold " +
        (torchOn ? "border-amber-300 bg-amber-400/90 text-neutral-900" : "border-white/50 bg-black/60 text-white")
      }
    >
      {torchOn ? "🔦 Light on" : "🔦 Light off"}
    </button>
  ) : null;

  /** Zoom control, available before AND during a take -- framing is a camera
   * adjustment like aiming the phone, not an edit of the footage. Buttons
   * rather than a slider so it works the same under a fingertip and a mouse;
   * pinch and the +/-/0 keys drive the same value (see the effects above). */
  const zoomControls = (
    <div className="flex items-center gap-1 rounded-full bg-black/55 px-1 py-0.5" data-no-drag>
      <button
        type="button"
        onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}
        disabled={zoom <= ZOOM_MIN}
        aria-label="Zoom out"
        className="flex h-7 w-7 items-center justify-center rounded-full text-base font-bold text-white disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => applyZoom(1)}
        aria-label="Reset zoom to full view"
        className="min-w-[3rem] rounded-full px-1 text-[11px] font-semibold text-white/90"
        title="Tap to reset to the camera's full view"
      >
        {zoom.toFixed(2).replace(/\.?0+$/, "")}×
      </button>
      <button
        type="button"
        onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}
        disabled={zoom >= ZOOM_MAX}
        aria-label="Zoom in"
        className="flex h-7 w-7 items-center justify-center rounded-full text-base font-bold text-white disabled:opacity-40"
      >
        +
      </button>
    </div>
  );

  /** Backs all the way out to "Enable camera". Paired with the camera
   * switch below it: these two flank the round Start/Stop button, disable
   * on the LEFT and switch on the RIGHT, so the round button stays exactly
   * centred and neither control sits on top of anything else. */
  const disableCameraButton = (
    <button
      type="button"
      onClick={disableCamera}
      className="shrink-0 whitespace-nowrap rounded-full border border-white/50 bg-black/45 px-3 py-1 text-[11px] font-semibold text-white/90 hover:bg-black/65"
    >
      Disable camera
    </button>
  );

  /** Switching cameras has to tear the stream down and open a new one:
   * facingMode cannot be changed on a track that is already running, and
   * applyConstraints() with a different facing mode is silently ignored on
   * most phones. Only offered before recording starts -- swapping the
   * source mid-take would change the picture halfway through a scored
   * performance. */
  async function switchCamera() {
    const next = facing === "environment" ? "user" : "environment";
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    await startCamera(next);
  }

  const cameraSwitchButton = (
    <button
      type="button"
      onClick={switchCamera}
      className="shrink-0 whitespace-nowrap rounded-full border border-white/50 bg-black/60 px-3 py-1 text-[11px] font-semibold text-white"
    >
      {facing === "environment" ? "🤳 Front camera" : "📷 Rear camera"}
    </button>
  );

  // Fit the box within a height and viewport-width-minus-margins budget
  // while preserving the real video's aspect ratio -- whichever dimension
  // (the height budget or the width budget) is more restrictive wins,
  // exactly like object-contain's own math, but applied to the CONTAINER
  // so it hugs the video instead of leaving it stranded inside a
  // mis-shaped box.
  //
  // Before the camera has reported anything, fall back to the SCREEN's own
  // shape rather than a fixed 9/16 portrait guess: that guess turned the
  // idle placeholder into a tall black slab on any landscape screen (a
  // 370x657 column on a laptop), and it isn't even what the recording will
  // look like -- the canvas is drawn at the screen's shape now, so the
  // screen's shape is the honest preview of what's coming.
  // Defensive fallback: even though renderLoop now guards against feeding
  // a degenerate value into videoAspect, a bad value here would divide the
  // box's height by zero/Infinity and make the whole recording screen
  // silently vanish, so re-check it right at the point of use too.
  const idleRatio = viewport.w > 0 && viewport.h > 0 ? viewport.w / viewport.h : 9 / 16;
  const previewRatio = videoAspect && Number.isFinite(videoAspect) && videoAspect > 0 ? videoAspect : idleRatio;
  // Idle gets a smaller share of the screen than a running camera does --
  // nothing is being watched yet, and an 85%-tall black box pushed the
  // "Enable camera" button and the instructions around it off the bottom
  // on a short screen, which is the one thing that has to stay reachable
  // at this point.
  const previewMaxHeightPx = viewport.h * (phase === "idle" ? 0.5 : 0.85);
  const previewMaxWidthCapPx = previewRatio > 1 ? 896 : 448;
  const previewAvailableWidthPx = Math.max(200, viewport.w - 32);
  const previewBoxWidthPx = Math.min(previewMaxHeightPx * previewRatio, previewMaxWidthCapPx, previewAvailableWidthPx);
  const previewBoxHeightPx = previewBoxWidthPx / previewRatio;

  // No crop/letterbox compensation is needed anywhere below any more: the
  // canvas is drawn at the screen's own shape (see renderLoop), so it
  // displays 1:1 with neither black bars nor a preview-only crop, and its
  // burned-in banner and watermark are therefore ALWAYS fully on screen.
  // That also retires the separate DOM banner/watermark overlays this
  // component used to layer on top to survive a crop -- with nothing being
  // cropped there is nothing for them to rescue, and their whole
  // duplicate-banner failure mode goes with them. bannerRatio maps
  // straight through as the title bar's offset.

  if (phase === "done") {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
        <p className="text-3xl">✅</p>
        <h2 className="mt-2 text-xl font-bold text-green-900">Kata recording submitted!</h2>
        <p className="mt-2 text-sm text-green-800">
          Your recording has been received and is ready for judging. Thank you.
        </p>
      </div>
    );
  }

  // The not-yet-open/window-closed messaging for THIS registration's tier
  // now lives in the tier-grouped summary rendered alongside this component
  // (see PendingRecordingsList) -- that summary covers every tier a
  // participant has pending kata in, including this one, instead of this
  // component repeating the same message for just its own single tier.
  if (notYetOpen || windowClosed) return null;

  return (
    <div
      ref={containerRef}
      // The attribute is what the stylesheet keys the "hide the site's
      // footer" rule off (via body:has(...)), so hiding it needs no
      // JavaScript beyond rendering this element -- one less moving part
      // than the body class, which is kept alongside it as a fallback for
      // browsers without :has().
      data-kata-fullscreen={fullscreen ? "" : undefined}
      // z-index raised well clear of every other fixed layer in the app
      // (the footer sits at 40, the accessibility toolbar at 60, modals at
      // 150-200) so nothing can paint over the recording area.
      className={fullscreen ? "fixed inset-0 z-[999] bg-black" : "space-y-4"}
      // Sized to the VISUAL viewport, not the layout viewport that
      // `fixed inset-0` resolves against.
      //
      // This is the root cause of the review controls "missing" in
      // landscape on iPhone. On iOS Safari the layout viewport is the FULL
      // screen, while Safari's own toolbars are drawn on top of the bottom
      // of it. So a bar pinned to bottom-0 of this container is rendered
      // underneath Safari's chrome -- present in the DOM, correct in every
      // measurement, and completely invisible and untappable on the actual
      // phone. Landscape is where it bites hardest, because the viewport is
      // barely 375px tall to begin with and Safari's bar eats a large share
      // of it. visualViewport.height is exactly "how much can the user
      // actually see right now", so constraining to it puts the seek bar,
      // play/pause, volume, timer and date back above the chrome. It also
      // means every measurement taken off this box (bannerRatio included)
      // is finally taken against the real visible area.
      style={
        fullscreen && visualViewportBox
          ? { top: visualViewportBox.offsetTop, height: visualViewportBox.height, bottom: "auto" }
          : undefined
      }
    >
      {!fullscreen && categoryName && (
        <p className="text-sm font-bold text-neutral-800">Recording: {categoryName}</p>
      )}
      {!fullscreen && (
      <>
      <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        <p>
          Please start your recording as soon as possible — don&apos;t wait until the last minute
          (i.e. the deadline) to start recording.
        </p>
        <p>
          After your recording, you may view it back. If you are satisfied with the performance,
          then submit. If you are not satisfied, you may continue training, then come back to
          delete the recording and record a new one to submit again. You can repeat this{" "}
          <strong>3 times only</strong> — you have <strong>{attemptsLeft}</strong> of {maxAttempts}{" "}
          delete-and-re-record chances left for this recording (the 4th recording is the final one
          to submit — recommendation).
        </p>
        <p>
          Even if you are still not satisfied with your submitted recording, you may purchase
          another 3 more delete chances to redo your recording. This has no effect on scoring, no
          matter how many delete chances you buy.
        </p>
        <p>
          Recording is limited to <strong>5 minutes</strong> to perform{" "}
          <strong>1 set of Kata only, from one angle</strong>. Your kata must be recorded using{" "}
          <strong>this in-app camera recorder</strong> — no screen recording, and no editing of the
          footage afterward. It carries the header on top and a watermark with the date and time of
          recording at the footer.
        </p>
        <p>
          If a recording made here could not be submitted at the time (a connection problem, for
          example), you may upload that same, unedited file afterward using{" "}
          <strong>&quot;Upload previously saved file&quot;</strong> next to Start Recording — it is
          for retrying a submission, not for a video made outside this recorder.
        </p>
        <p>
          Recording opens as per your competition tier&apos;s event start date, and closes on its
          registration deadline
          {recordingStart && recordingEnd && (
            <>
              {" "}
              — for your tier: <strong>{formatDate(recordingStart)}</strong> to{" "}
              <strong>{formatDate(recordingEnd)}</strong>
              {daysLeft != null && daysLeft >= 0 && (
                <>
                  {" "}
                  (<strong>
                    {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                  </strong>{" "}
                  to record and submit, based on today&apos;s date where you are)
                </>
              )}
            </>
          )}
          .
        </p>
        {attemptsLeft <= 0 && (
          <div className="pt-1">
            <BuyExtraAttemptsButton registrationId={registrationId} hasPendingPurchase={hasPendingPurchase} />
          </div>
        )}
        <p className="border-t border-neutral-200 pt-2 text-xs text-neutral-500">
          <strong>Reminder:</strong> please do not leave your recording and submission to the last
          minute — the system may be slow or unavailable if a large number of people rush to
          record and submit at the same time. Thank you for your co-operation.
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <p>
          <strong>Camera placement:</strong> Prop your phone up (on a chair, or a tripod) about{" "}
          <strong>300cm (≈118 inch)</strong> away from your starting point, at roughly chest
          height, in the same direction you bow or 45 degrees to the left or right, for this
          Malaysia Open Virtual Kata Competition. Leave enough space in frame for the full routine
          — the recording should be able to see your whole kata move from start to end.
        </p>
        {isIOS && (
          <p>
            <strong>iPhone / iPad — if the room is dim:</strong> Safari can&apos;t switch the camera flash on from a
            web page (Apple has never allowed it), so there is no light button here. Swipe into Control Centre and
            turn the torch on <em>before</em> you start — the LED sits beside the rear camera, so it lights the same
            direction the recording is pointing. Better still, record with the room lights on or facing a window:
            a phone torch does very little at 300cm.
          </p>
        )}
        <p>
          Pick a countdown length (10–30 seconds), then tap <strong>Start</strong> — you&apos;ll
          hear a <strong>ding-dong</strong> chime and recording begins on its own once it reaches
          0, giving you time to walk into position first. Imagine you are just outside the Tatami
          box or Kata Arena: bow first, then walk 3–6 steps forward into position, then bow again.
          State the name of the kata you are performing, then start with{" "}
          <strong>&quot;Yo e&quot;</strong> with hard breathing and perform your kata to the end,
          then <strong>&quot;Na o te&quot;</strong> with hard or soft breathing depending on your
          kata, and bow. After that, walk backward 3–5 steps and bow again, then either tap{" "}
          <strong>Stop</strong> or simply <strong>clap your hands once</strong> — recording stops
          on its own. (A shouted kiai will not stop it — only a clap does; if a clap isn&apos;t
          picked up, tap Stop instead.)
        </p>
        <p>All the best to you — may your recording be a successful one. Thank you for participating.</p>
      </div>
      </>
      )}

      <div
        ref={recordingBoxRef}
        className={
          // h-full (not h-[100dvh]) -- this div's own parent (containerRef,
          // just above) is already `fixed inset-0`, which the browser
          // always resolves to the EXACT viewport box directly (no unit
          // conversion involved at all), so inheriting that via a plain
          // percentage is strictly more reliable than re-deriving the
          // viewport height a second time through a dvh calculation --
          // some emulated/embedded viewports (device-toolbar previews in
          // particular) have been seen resolving 100dvh a little short of
          // the real fixed box, leaving a sliver at the very bottom edge
          // where whatever else on the page also sits fixed-to-bottom
          // (the site footer) could show through.
          // touch-pan-y (touch-action: pan-y): the declarative half of the
          // same fix as the gesture* listeners above. It tells the browser
          // this box handles pinch itself, while still allowing a one-finger
          // vertical drag so the review controls' own overflow-y-auto stack
          // stays scrollable in cramped landscape.
          (fullscreen
            ? "relative h-full w-full overflow-hidden bg-black"
            : "relative mx-auto overflow-hidden rounded-lg border border-neutral-300 bg-black") + " touch-pan-y"
        }
        style={
          fullscreen
            ? undefined
            : {
                width: previewBoxWidthPx,
                height: previewBoxHeightPx,
                // Hard CSS guard on top of the pixel maths above. `viewport`
                // deliberately starts at a fixed 400x800 placeholder so the
                // server and client render the same thing, and is only
                // corrected to the real size by an effect after mount -- on
                // any screen narrower than 400 that first paint computes a
                // box wider than the page, which is what was pushing the
                // whole layout sideways and clipping this box's right edge
                // (and the Enable camera button with it). maxWidth is
                // resolved by the browser against the real container, so it
                // holds on that first paint too, before any JS has measured
                // anything.
                maxWidth: "100%",
              }
        }
      >
        {/* Exit full screen (or, outside full screen, the toggle to enter
            it) -- an independent block, positioned at bannerOnlyRatio (the
            banner's own height alone), one row higher than the stack below
            it which sits under the identity/name-category row too. Moved
            out to its own offset on request, so it lands right under the
            main banner instead of below the performer's name and category
            as well. */}
        {!fullscreen && phase !== "idle" && phase !== "review" && phase !== "uploading" && (
          <div
            className="absolute z-20 flex justify-end px-2 pt-1"
            style={{ top: `${bannerOnlyRatio * 100}%`, ...overlayInsetStyle }}
          >
            <button
              type="button"
              onClick={enterFullscreen}
              className="rounded border border-white/50 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/65"
            >
              ⛶ Full screen
            </button>
          </div>
        )}
        {fullscreen && phase !== "review" && phase !== "uploading" && (
          <div
            className="absolute z-20 flex items-start justify-end gap-2 px-3 py-2 text-white"
            style={{
              top: `${bannerOnlyRatio * 100}%`,
              textShadow: "0 1px 3px rgba(0,0,0,0.85)",
              ...overlayInsetStyle,
            }}
          >
            {/* Deleted Recording sits right under Exit full screen, in the
                SAME row as the title, instead of its own row below --
                plain text with just the row's own drop-shadow (no
                background box), matching the "Recording dated…" and
                watermark text style elsewhere instead of reading as a
                separate dark chip. */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                onClick={exitFullscreen}
                className="rounded border border-white/50 bg-black/30 px-2 py-0.5 text-[10px] font-semibold hover:bg-black/50"
                style={{ textShadow: "none" }}
              >
                ✕ Exit full screen
              </button>
              {(phase === "live" || phase === "countdown" || phase === "recording") && (
                <span className="text-[9px] font-semibold leading-tight">
                  Deleted Recording: {attempts} / {maxAttempts}
                </span>
              )}
            </div>
          </div>
        )}
        {/* Title bar, error banner, the live/recording badges, and the
            review controls all stack in ONE column starting right below the
            burned-in header banner -- previously each piece was
            independently absolute-positioned at its own guessed offset
            (top-0, top-12, a fixed top-[13%]), which only worked as long as
            the title stayed on one line AND the banner itself was always
            the same proportion of the frame. Now it tracks bannerRatio (the
            real height drawFrame just used, reported back from the render
            loop) so it always sits directly under the banner with no gap
            or overlap, on any orientation. Stacking in flex-col underneath
            that means every piece pushes the next one down automatically,
            so nothing can overlap no matter how tall the title grows. A
            background bar behind the title (rather than just a
            drop-shadow) keeps it legible now that it can span multiple
            lines over whatever's playing underneath. */}
        <div
          // overflow-y-auto + a maxHeight bound: in landscape fullscreen on
          // a short-viewport phone, this stack (title bar + error banner +
          // review's Delete/Submit row) can be taller than the room left
          // below the banner, and with the default overflow:visible the
          // overflow was silently clipped by the container's own
          // overflow-hidden below the fold -- Delete/Submit existed in the
          // DOM but were literally unreachable until exiting full screen or
          // rotating back to portrait. Scrolling this stack independently
          // keeps every case that already fit (most of them) pixel-identical
          // and just makes the cramped ones reachable instead of invisible.
          className="absolute z-30 flex transform-gpu flex-col overflow-y-auto"
          style={{
            ...overlayInsetStyle,
            // Straight off the burned-in banner's own measured height. The
            // canvas (and the recorded file the review <video> plays back)
            // is drawn at the screen's shape, so it displays without crop
            // or letterbox and this percentage lands exactly on the real
            // banner's bottom edge -- no offset math in between.
            top: `${bannerRatio * 100}%`,
            maxHeight: `${100 - bannerRatio * 100}%`,
          }}
        >
          {error && phase !== "review" && phase !== "uploading" && (
            <div className="bg-red-50/95 px-4 py-2 text-sm text-red-800 backdrop-blur-sm">{error}</div>
          )}
          {/* LIVE REC is the first thing in this stack now that the
              "canvas WxH box WxH raw… final… rec…" diagnostic above it is
              gone. That line was added to find out why the button row
              wasn't lining up with the picture; the answer turned out to
              be that every overlay was pinned to the BOX rather than to
              the letterboxed picture inside it (see contentInsetRatio), so
              the diagnostic has done its job and no longer ships to
              participants. */}
          {phase === "recording" && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-1">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-xs font-semibold text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE REC {mm}:{ss} / 05:00
              </div>
            </div>
          )}
          {/* Clap-to-stop lives in this top-left stack, directly under the
              row above, rather than under the round button where it used to
              be absolutely positioned -- down there it overlapped the camera
              controls sharing the same corner. Shown from the moment the
              camera is on, not just once recording starts, so the
              participant knows the option exists BEFORE walking out to
              begin, which is the only time they can plan around it, and it
              stays put through the take itself. */}
          {(phase === "live" || phase === "countdown" || phase === "recording") && (
            <div className="px-2 pt-1">
              <span className="inline-block whitespace-nowrap rounded-full bg-black/70 px-2.5 py-0.5 text-xs font-semibold text-white">
                👏 Clap to stop
              </span>
            </div>
          )}
        </div>
        {/* Review/uploading's own control stack -- Exit full screen, Save to
            device, Delete & re-record, and Submit all sit together here.
            Positioned off bannerRatio (same reference the live/recording
            controls use, and just as continuously self-correcting -- the
            render loop keeps drawing the live camera feed to the canvas
            underneath even during review, in case of a re-record, so this
            value never goes stale) plus a fixed two-row offset on request,
            rather than a one-off measurement of the review video's own
            rendered rect: that measurement only ever recomputed on a
            genuine viewport-resize event, which on a real device can also
            fire mid-playback (iOS Safari's chrome hiding/showing as a video
            plays, in particular) -- landing on a bad reading at exactly the
            wrong moment left the whole control stack, seek bar included,
            stuck invisible with no further trigger to correct it. All four
            hide while the replay is actually playing (nothing to act on
            until it's paused or has ended) and reappear the instant it
            isn't -- the seek bar below is a SEPARATE stack and stays up
            throughout, since pause/seek/mute need to stay reachable while
            playing. */}
        {(phase === "review" || phase === "uploading") && !reviewPlaying && (
          <div
            // z-30 + transform-gpu for the same iOS compositing reason as
            // the bottom bar (see the video element's own comment).
            //
            // The overflow pair matters just as much: this stack is pinned
            // a fixed 3.5rem below the banner, and in landscape on a phone
            // -- especially once Safari's toolbars slide back in during
            // playback and shrink the box -- Full screen / Save to device /
            // Delete & re-record / Submit could be pushed past the bottom
            // edge, where the box's own overflow-hidden simply clipped
            // them. They were in the DOM, correct in every measurement, and
            // unreachable without rotating to portrait. Bounding the height
            // and letting this scroll keeps every case that already fitted
            // pixel-identical and makes the cramped ones reachable instead
            // of invisible -- the same treatment the live/recording stack
            // above already had.
            className="absolute z-30 flex transform-gpu flex-col gap-1.5 overflow-y-auto px-3 pt-2"
            style={{
              top: `calc(${bannerRatio * 100}% + 3.5rem)`,
              maxHeight: `calc(${100 - bannerRatio * 100}% - 3.5rem)`,
              // Same picture-relative inset as the live controls: on a
              // landscape window wider than the recording's own shape, Exit
              // full screen / Delete & re-record on the left and Save to
              // device / Submit on the right were sitting out on the black
              // bars, right against the screen edge.
              ...overlayInsetStyle,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              {fullscreen ? (
                <button
                  type="button"
                  onClick={exitFullscreen}
                  className="rounded border border-white/50 bg-black/60 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/80"
                >
                  ✕ Exit full screen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={enterFullscreen}
                  className="rounded border border-white/50 bg-black/60 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/80"
                >
                  ⛶ Full screen
                </button>
              )}
              <button
                onClick={handleSaveToDevice}
                className="rounded-md border border-white/50 bg-black/60 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-black/80"
              >
                💾 Save to device
              </button>
            </div>
            {error && (
              <div className="rounded bg-red-50/95 px-4 py-2 text-sm text-red-800 backdrop-blur-sm">{error}</div>
            )}
            <div className="flex w-full items-center justify-between gap-2">
              <button
                onClick={handleReRecord}
                disabled={!canReRecord}
                className="rounded-md border border-neutral-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
              >
                Delete &amp; re-record ({attemptsLeft} left)
              </button>
              <button
                onClick={() => {
                  setAgreed(false);
                  setAgreementOpen(true);
                }}
                className="rounded-md bg-red-700/90 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-600 sm:text-sm"
              >
                Submit this recording
              </button>
            </div>
            {/* Buy more delete-and-re-record chances -- only reachable once
                the free 3 are gone. This used to live in the instructional
                text block above the recording area, which full screen mode
                now hides for the whole live/recording/review flow, making
                the button effectively unreachable right when it's actually
                needed. compact: no white card, no explanatory paragraph --
                the label alone is clear enough here. */}
            {attemptsLeft <= 0 && (
              <BuyExtraAttemptsButton registrationId={registrationId} hasPendingPurchase={hasPendingPurchase} compact />
            )}
          </div>
        )}
        <video ref={videoRef} playsInline muted className="hidden" />
        <canvas
          ref={canvasRef}
          className={
            // object-contain, never object-cover: the canvas is already
            // drawn at this box's own shape, so contain fills it edge to
            // edge with nothing to letterbox -- while still guaranteeing
            // that if the two ever disagree (a rotation landing between
            // frames, say) the participant sees the whole recorded frame
            // shrunk rather than a cropped view of a picture whose edges
            // are silently going into the file regardless.
            phase === "live" || phase === "countdown" || phase === "recording"
              ? "block h-full w-full object-contain"
              : "hidden"
          }
        />
        {/* Review (and uploading) shows the actual recorded file, in this
            SAME box, instead of a separate plain video underneath it --
            "the same recording screen for the replay." The canvas above is
            hidden here since the live camera feed keeps rendering to it in
            the background (still needed if the participant re-records)
            and would otherwise show through underneath.

            No native `controls` at all -- iOS's own native video-fullscreen
            chrome (its expand icon, its own "X"/close affordance) doesn't
            call this component's exitFullscreen, leaving no reliable way
            out once tapped. A small custom bar below (play/pause, seek,
            mute -- no fullscreen toggle, no playback rate, no download)
            covers everything a participant reviewing their own take
            actually needs, with zero OS chrome to conflict with the app's
            own "✕ Exit full screen" button. */}
        {(phase === "review" || phase === "uploading") && blobUrl && (
          <>
            <video
              ref={reviewVideoRef}
              src={blobUrl}
              poster={posterUrl ?? undefined}
              playsInline
              preload="auto"
              disablePictureInPicture
              onClick={toggleReviewPlayback}
              onPlay={() => {
                setReviewPlaying(true);
                // iOS Safari tends to slide its own toolbars back in when
                // media starts playing, which is what turns the clean
                // full-screen review into the shorter, chrome-framed one --
                // the container tracks the visual viewport, so it correctly
                // shrinks to stay above that chrome rather than hiding
                // underneath it. Re-apply the same scroll nudge full screen
                // and rotation already use, to re-collapse the toolbars as
                // fast as possible. Best-effort by nature: there is no API
                // on iPhone to keep browser chrome down, so this reduces how
                // often it happens rather than preventing it outright.
                if (fullscreenRef.current) {
                  requestAnimationFrame(() => window.scrollTo(0, 1));
                  setTimeout(() => window.scrollTo(0, 1), 350);
                }
              }}
              onPause={() => setReviewPlaying(false)}
              onEnded={() => setReviewPlaying(false)}
              onTimeUpdate={(e) => setReviewCurrentTime(e.currentTarget.currentTime)}
              // Blocks iOS Safari's own long-press "Enter Full Screen"
              // context-menu entry, which exists on any <video> regardless
              // of the `controls` attribute -- that native fullscreen is
              // OS-level video chrome with zero access to this component's
              // own overlay (Delete/Submit, Exit full screen), so a
              // participant who long-presses lands in a bare video player
              // with none of those controls reachable. preventDefault here
              // stops the menu from appearing in the first place on the
              // platforms that respect it; it's a best-effort mitigation of
              // a real OS-level gesture, not a guaranteed block on every
              // iOS version.
              onContextMenu={(e) => e.preventDefault()}
              // Both events resolve the same way, because a MediaRecorder
              // file's duration can arrive late, never, or as Infinity
              // forever depending on the browser and container.
              //
              // This replaces a "seek to Number.MAX_SAFE_INTEGER, wait for a
              // timeupdate, seek back to 0" probe that used to live here to
              // force the browser to scan the file for a length. That probe
              // was unreliable -- it still left duration as Infinity on a
              // real take -- and dragging the playhead past the end of a
              // container with no index is very likely what left the
              // demuxer unable to finish playback, which is the same stall
              // that stopped the replay controls ever coming back. Nothing
              // seeks speculatively any more.
              onLoadedMetadata={(e) => resolveReviewDuration(e.currentTarget)}
              onDurationChange={(e) => resolveReviewDuration(e.currentTarget)}
              // relative + z-0, not a bare block: iOS Safari promotes a
              // PLAYING video to its own hardware compositing layer, and a
              // promoted layer paints above ordinary siblings regardless of
              // their z-index. That is why every control here was visible
              // while the take sat paused on its poster, then disappeared
              // behind the picture the moment Play was pressed -- the seek
              // bar showing only in the letterbox margins either side of
              // the video, and the Delete/Submit row never "popping up" at
              // the end because it was rendering *underneath*. Giving the
              // video a real stacking position of its own puts it in the
              // same ordering system as the overlays, which are pinned
              // above it (z-30) and given their own layers via transform-gpu
              // so the compositor cannot reorder them either.
              className="relative z-0 block h-full w-full object-contain"
            />
            {!reviewPlaying && (
              <button
                type="button"
                onClick={toggleReviewPlayback}
                aria-label="Play"
                // z-10, below both control clusters (z-20 top stack, z-20
                // bottom bar) -- explicit rather than relying on it being
                // the lowest z-index:auto by default, so there's no
                // ambiguity about the video's own play/replay icon ever
                // sitting in front of Delete/Submit or the seek bar,
                // including right as the replay ends and this button
                // reappears.
                className="absolute left-1/2 top-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 transform-gpu items-center justify-center rounded-full bg-black/55 text-3xl text-white shadow-lg"
              >
                ▶
              </button>
            )}
            <div
              // z-30 + transform-gpu: see the video element above -- a
              // playing video gets its own compositing layer on iOS, and
              // only another composited layer is reliably drawn over it.
              className="absolute inset-x-0 bottom-0 z-30 flex transform-gpu flex-col gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-3 pb-3 pt-10"
              // Clear of the iPhone home indicator, which is drawn over the
              // bottom edge and otherwise sits right on top of the
              // play/volume row. Resolves to 0 on devices without one.
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
            >
              {/* Was a SEPARATE element pinned at its own flat bottom-20 --
                  now it's one row in this SAME bar, so it always moves
                  together with the rest of these controls instead of
                  drifting independently. */}
              {recordingStartedAt && (
                <p
                  className="pointer-events-none text-center text-xs font-semibold text-white"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}
                >
                  Recording dated {formatDateTime(recordingStartedAt.toISOString())}
                </p>
              )}
              <input
                type="range"
                min={0}
                max={reviewDuration || 0}
                step={0.1}
                value={Math.min(reviewCurrentTime, reviewDuration || 0)}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  if (reviewVideoRef.current) reviewVideoRef.current.currentTime = t;
                  setReviewCurrentTime(t);
                }}
                aria-label="Seek"
                className="h-1.5 w-full cursor-pointer accent-red-600"
              />
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-white">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleReviewPlayback}
                    aria-label={reviewPlaying ? "Pause" : "Play"}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
                  >
                    {reviewPlaying ? "❚❚" : "▶"}
                  </button>
                  {/* Volume slider in place of the old mute-only button.
                      Slid to the far left it mutes; the far right is full
                      volume, never capped. */}
                  <span aria-hidden className="text-sm leading-none">
                    {reviewMuted ? "🔇" : "🔊"}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={reviewVolume}
                    onChange={(e) => applyReviewVolume(Number(e.target.value))}
                    aria-label="Volume"
                    className="h-1.5 w-20 cursor-pointer accent-white"
                  />
                </div>
                <span style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>
                  {formatPlaybackTime(reviewCurrentTime)} / {formatPlaybackTime(reviewDuration)}
                </span>
              </div>
            </div>
          </>
        )}
        {phase === "idle" && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-neutral-300">
            <p>Camera preview appears here once camera is enable — click below button.</p>
            <button
              onClick={() => void startCamera()}
              className="w-full max-w-md rounded-lg bg-white px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg hover:bg-neutral-100 sm:w-auto"
            >
              Enable camera
            </button>
          </div>
        )}
        {/* Start/Stop (round) lives INSIDE the recording area itself instead
            of a separate row below it -- that row used to eat into the
            height available for the actual preview, most noticeable in
            full screen mode where every pixel of vertical space matters.
            Sits a bit clear of the very bottom edge so it doesn't crowd
            the burned-in watermark text there. */}
        {phase === "live" && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
            {zoomControls}
            {/* Countdown length -- picked before Start, so a solo performer
                gets long enough to walk into position and no unwanted
                surprise silence during the wait. */}
            <div className="flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-1">
              {COUNTDOWN_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCountdownDuration(d)}
                  aria-pressed={countdownDuration === d}
                  className={
                    "rounded-full px-2 py-1 text-[11px] font-semibold " +
                    (countdownDuration === d ? "bg-white text-neutral-900" : "text-white/80 hover:text-white")
                  }
                >
                  {d}s
                </button>
              ))}
            </div>
            {/* One row: Disable camera on the LEFT, the round Start button
                dead-centre, camera switch on the RIGHT. These used to be
                stacked in a separate row UNDER the button, with the clap
                hint absolutely positioned over that same space -- which is
                what left all three overlapping each other. Flanking the
                button instead gives each control its own room and keeps the
                button itself centred. */}
            <div className="flex items-center justify-center gap-3">
              {disableCameraButton}
              <div className="relative shrink-0">
                <button
                  onClick={startCountdown}
                  aria-label="Start countdown"
                  className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 bg-red-600/90 text-2xl text-white shadow-lg active:scale-95"
                >
                  ●
                </button>
                {torchButton}
              </div>
              {cameraSwitchButton}
            </div>
          </div>
        )}
        {phase === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45">
            <span
              className="text-7xl font-black text-white"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.7)" }}
              aria-live="assertive"
            >
              {countdownSeconds}
            </span>
            <p className="text-sm font-semibold text-white/90">Get into position…</p>
            <button
              type="button"
              onClick={cancelCountdown}
              className="mt-2 rounded-md border border-white/60 bg-black/40 px-4 py-1.5 text-xs font-semibold text-white hover:bg-black/60"
            >
              Cancel
            </button>
          </div>
        )}
        {/* Stop button alone -- same bottom-3 flex-col shape the live phase
            uses for its own Start button, so the round button doesn't jump
            when recording begins. The clap hint now lives in the top-left
            stack instead (it stays visible right through the take), and the
            camera controls are deliberately absent: switching or disabling
            the camera mid-take would change the picture halfway through a
            performance that's being scored. */}
        {phase === "recording" && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
            {zoomControls}
            <div className="relative">
              <button
                onClick={stopRecording}
                aria-label="Stop recording"
                className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/80 bg-neutral-900/90 text-2xl text-white shadow-lg active:scale-95"
              >
                ■
              </button>
              {torchButton}
            </div>
          </div>
        )}
        {/* Manual way back into full screen after tapping "Exit full
            screen" -- without this there was no way back in short of
            reloading the page. */}
        {!fullscreen &&
          (phase === "live" ||
            phase === "countdown" ||
            phase === "recording" ||
            phase === "review" ||
            phase === "uploading") && (
            <button
              type="button"
              onClick={enterFullscreen}
              aria-label="Full screen"
              title="Fill the whole phone/tablet screen for recording, header and footer temporarily hidden"
              className={
                // Clears the review screen's own bottom control bar (seek/
                // play/mute, roughly the bottom ~90px) -- live/recording
                // have nothing else down there, so sitting a bit higher
                // there too is harmless, just avoids two different
                // positions for one button depending on phase.
                (phase === "review" || phase === "uploading" ? "bottom-24" : "bottom-3") +
                " absolute right-3 flex h-11 w-11 items-center justify-center rounded-md border border-white/50 bg-black/60 text-lg text-white shadow-lg"
              }
            >
              ⛶
            </button>
          )}
      </div>

      {/* "Enable camera" now lives inside the preview box itself (right
          under the placeholder text) instead of a separate row below it --
          this row is only for "Submitting…" now. Keeping it inside the box
          means it's always reachable regardless of box shape, including a
          short landscape box where a separate row below could get cramped
          or pushed off-screen. */}
      {phase === "uploading" && (
        <div
          className={
            fullscreen
              ? "flex shrink-0 items-center justify-center gap-3 bg-black px-4 py-4"
              : "flex flex-wrap justify-center gap-3"
          }
        >
          <div className="flex flex-col items-center gap-2">
            <button disabled className="rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white opacity-70">
              {uploadProgress > 0 && uploadProgress < 1
                ? `Uploading… ${Math.round(uploadProgress * 100)}%`
                : uploadProgress >= 1
                  ? "Finishing…"
                  : "Submitting…"}
            </button>
            <p className={fullscreen ? "text-xs text-white/70" : "text-xs text-neutral-500"}>
              Keep this page open until it finishes — leaving or locking the phone stops the upload.
            </p>
          </div>
        </div>
      )}
      {agreementOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <p className="font-bold text-neutral-900">Publication &amp; Advertising Agreement</p>
            <p className="mt-2 text-sm text-neutral-600">
              By submitting this recording, you grant the organizer the rights to publish it and to
              use it in any advertising or promotion of the competition and the organizer&apos;s
              activities, in any media, provided nothing illegal is involved. You confirm the
              recording is your own performance.
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-red-700"
              />
              <span>I have read and agree to the above. *</span>
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => {
                  if (!agreed) return;
                  setAgreementOpen(false);
                  void handleSubmit();
                }}
                disabled={!agreed}
                className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                I agree — submit my recording
              </button>
              <button
                onClick={() => setAgreementOpen(false)}
                className="rounded-md border border-neutral-300 px-5 py-2.5 font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
