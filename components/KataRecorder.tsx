"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRecordAttempt, submitKataVideo } from "@/app/actions/account";
import BuyExtraAttemptsButton from "@/components/BuyExtraAttemptsButton";
import { formatDate, formatDateTime } from "@/components/ui";
import { pickVideoMimeType as pickMimeType, extensionForMimeType } from "@/lib/media-recording";
import type { WatermarkSettings } from "@/lib/watermark";

const MAX_SECONDS = 5 * 60;

type Phase = "idle" | "live" | "recording" | "review" | "uploading" | "done";

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
function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
  watermark: WatermarkSettings,
): number {
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
    return topH / h;
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
  return topH / h;
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
function idealVideoDimensions(): { width: number; height: number } {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { width: 1280, height: 720 };
  }
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  const screenLong = Math.max(window.innerWidth, window.innerHeight, 480);
  const screenShort = Math.max(Math.min(window.innerWidth, window.innerHeight), 240);
  const longEdge = 1280;
  const shortEdge = Math.max(400, Math.round(longEdge * (screenShort / screenLong)));
  // Always ask for the screen's OWN shape, on every device. This used to
  // ask phones for the opposite shape, to compensate for a preview that
  // letterboxed whatever it was given -- but the canvas is now drawn at the
  // screen's shape and center-crops the camera into it, so deliberately
  // requesting the wrong shape means throwing most of the frame away: a
  // landscape phone asking for a portrait stream keeps only ~32% of it,
  // which is what was cropping the performer down to their forehead.
  // Matching keeps ~100%, and any residual mismatch is bounded by the crop
  // clamp in renderLoop rather than by guessing at the request.
  return landscape ? { width: longEdge, height: shortEdge } : { width: shortEdge, height: longEdge };
}

export default function KataRecorder({
  initialAttempts,
  maxAttempts,
  hasPendingPurchase,
  watermark,
  recordingStart,
  recordingEnd,
  categoryName,
}: {
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
  const [reviewPlaying, setReviewPlaying] = useState(false);
  const [reviewCurrentTime, setReviewCurrentTime] = useState(0);
  const [reviewDuration, setReviewDuration] = useState(0);
  const [reviewMuted, setReviewMuted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
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
  // How tall the burned-in header banner actually came out (as a fraction
  // of frame height), reported back by drawFrame -- the DOM title bar below
  // uses this to sit directly under the real banner instead of a fixed
  // guessed percentage that could leave a gap or overlap depending on
  // orientation and how much the banner's own text needed to shrink.
  const [bannerRatio, setBannerRatio] = useState(0.13);
  const bannerRatioRef = useRef(0.13);
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
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientationChange);
    };
  }, []);

  // Take the site's fixed footer out of the page entirely while full
  // screen is up (see app/globals.css). Cleaned up on exit AND on unmount,
  // so navigating away mid-recording can't strand the footer hidden.
  useEffect(() => {
    if (!fullscreen) return;
    document.body.classList.add("kata-recorder-fullscreen");
    return () => document.body.classList.remove("kata-recorder-fullscreen");
  }, [fullscreen]);

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
    const { width, height } = idealVideoDimensions();
    void track
      .applyConstraints({
        width: { ideal: width },
        height: { ideal: height },
        aspectRatio: { ideal: width / height },
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
    const el = containerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> })
      | null;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else if (el?.webkitRequestFullscreen) void el.webkitRequestFullscreen().catch(() => {});
  }

  function exitFullscreen() {
    setFullscreen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  async function startCamera() {
    setError(null);
    try {
      const { width, height } = idealVideoDimensions();
      // aspectRatio alongside width/height: a webcam's supported resolution
      // list rarely contains the exact pixels requested, and browsers weigh
      // width/height "ideal" hints fairly loosely when picking among what's
      // actually available. Giving the ratio explicitly too makes shape
      // matching (not just pixel count) part of what the browser optimizes
      // for, so it's less likely to hand back something needlessly narrower
      // than the screen even when it can't hit the exact size requested.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: width },
          height: { ideal: height },
          aspectRatio: { ideal: width / height },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("live");
      requestAnimationFrame(renderLoop);
      enterFullscreen();
    } catch {
      setError("Could not access your camera. Please allow camera & microphone permission and try again.");
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
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    // Shape the canvas like the screen it's being displayed on, and let
    // drawFrame center-crop the camera into that shape. The canvas is both
    // what's shown AND (via captureStream) what's recorded, so making it
    // the screen's shape is what delivers full-bleed with no black bars
    // and what-you-see-is-what-you-record at the same time -- the earlier
    // approaches could only ever buy one at the other's expense, because
    // they left the canvas at the camera's shape and then argued about how
    // to display a mismatched picture.
    //
    // Resizing a canvas mid-recording disturbs the track captureStream()
    // is feeding MediaRecorder, so once a take is rolling the shape is
    // frozen until it stops (a mid-take rotation keeps the shape it
    // started with rather than corrupting the recording).
    const recording = recorderRef.current?.state === "recording";
    if (!recording) {
      const cameraAspect = video.videoWidth / video.videoHeight;
      // Measured from the box the canvas is actually painted into, NOT from
      // window.innerWidth/innerHeight. Those are a second, independent
      // source of truth for "how big is the screen", and when they disagree
      // with the real `fixed inset-0` box even slightly -- which they do
      // wherever the visual and layout viewports differ, mobile browser UI
      // and emulated device toolbars included -- object-contain faithfully
      // letterboxes the difference. That mismatch is the residual black
      // band along the bottom on iPhone SE and XR in portrait. Measuring
      // the element itself makes the canvas match its container by
      // construction, so there is nothing left to letterbox.
      const box = containerBoxRef.current;
      const screenAspect =
        fullscreenRef.current && box.w > 0 && box.h > 0 ? box.w / box.h : cameraAspect;
      // How much of the camera frame we must keep. Below this the canvas
      // stops matching the box and the display letterboxes the difference.
      //
      // This is the backstop for a camera that can only deliver its native
      // aspect ratio and ignores the shape we asked for; when the camera
      // does honour the request there's no mismatch and it never binds.
      // It was 0.85, which was far too strict to be a backstop: a phone in
      // LANDSCAPE has a very wide box (iPhone XR 2.16, Pixel 2.22, Z Fold
      // 2.56) and filling it from a 16:9 frame keeps 82%, 80% and 69%
      // respectively -- all of which 0.85 refused, which is why landscape
      // still had bars down both sides after every earlier fix. 0.68
      // clears every device in the organizer's list.
      //
      // Cropping this hard is safe here in a way it wouldn't be otherwise,
      // because the preview is what gets recorded: a participant framed
      // too tight sees it live and steps back, rather than finding out
      // afterwards.
      const MIN_FRAME_KEPT = 0.68;
      const targetAspect = Math.min(
        Math.max(screenAspect, cameraAspect * MIN_FRAME_KEPT),
        cameraAspect / MIN_FRAME_KEPT,
      );
      // Largest region of the source frame matching targetAspect, so the
      // canvas never upscales beyond what the camera actually delivered.
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
      const newBannerRatio = drawFrame(ctx, video, canvas.width, canvas.height, watermark);
      if (Number.isFinite(newBannerRatio) && newBannerRatio > 0 && Math.abs(bannerRatioRef.current - newBannerRatio) > 0.002) {
        bannerRatioRef.current = newBannerRatio;
        setBannerRatio(newBannerRatio);
      }
    }
    rafRef.current = requestAnimationFrame(renderLoop);
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
      if (audioTrack) canvasStream.addTrack(audioTrack);

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(canvasStream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        recordedBlobRef.current = blob;
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
      };
      recorder.start(1000);
      recorderRef.current = recorder;
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

  function toggleReviewPlayback() {
    const v = reviewVideoRef.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play();
    else v.pause();
  }

  function toggleReviewMute() {
    const v = reviewVideoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setReviewMuted(v.muted);
  }

  function formatPlaybackTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function handleReRecord() {
    if (!canReRecord) return;
    const newCount = await useRecordAttempt();
    setAttempts(newCount);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setPosterUrl(null);
    setReviewPlaying(false);
    setReviewCurrentTime(0);
    setReviewDuration(0);
    recordedBlobRef.current = null;
    setPhase("live");
  }

  async function handleSubmit() {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    setPhase("uploading");
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
      const path = `${user.id}/${crypto.randomUUID()}.${extensionForMimeType(blob.type)}`;
      const { error: upErr } = await supabase.storage
        .from("kata-videos")
        .upload(path, blob, { contentType: blob.type || "video/webm" });
      if (upErr) {
        setError("Upload failed — please check your connection and try again.");
        setPhase("review");
        return;
      }
      const fd = new FormData();
      fd.set("path", path);
      fd.set("mime", blob.type || "video/webm");
      const result = await submitKataVideo({ ok: false }, fd);
      if (!result.ok) {
        setError(result.error ?? "Could not submit your recording.");
        setPhase("review");
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setPhase("done");
    } catch {
      setError("Something went wrong submitting your recording. Please try again.");
      setPhase("review");
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

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
          <strong>1 set of Kata only, from one angle</strong>. No file upload or editing is
          allowed, and no recording on screen or screen recording is allowed — only the in-app
          camera recorder, with the header on top and a watermark with the date and time of
          recording at the footer.
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
            <BuyExtraAttemptsButton hasPendingPurchase={hasPendingPurchase} />
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
        <p>
          Tap <strong>Start</strong>. Imagine you are just outside the Tatami box or Kata Arena:
          bow first, then walk 3–6 steps forward into position, then bow again. State the name of
          the kata you are performing, then start with <strong>&quot;Yo e&quot;</strong> with hard
          breathing and perform your kata to the end, then <strong>&quot;Na o te&quot;</strong>{" "}
          with hard or soft breathing depending on your kata, and bow. After that, walk backward
          3–5 steps and bow again. Tap <strong>Stop</strong> when you have faced forward for a
          second or two after your bow.
        </p>
        <p>All the best to you — may your recording be a successful one. Thank you for participating.</p>
      </div>
      </>
      )}

      <div
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
          fullscreen
            ? "relative h-full w-full overflow-hidden bg-black"
            : "relative mx-auto overflow-hidden rounded-lg border border-neutral-300 bg-black"
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
          className="absolute inset-x-0 z-20 flex flex-col"
          style={{
            // Straight off the burned-in banner's own measured height. The
            // canvas (and the recorded file the review <video> plays back)
            // is drawn at the screen's shape, so it displays without crop
            // or letterbox and this percentage lands exactly on the real
            // banner's bottom edge -- no offset math in between.
            top: `${bannerRatio * 100}%`,
          }}
        >
          {/* enterFullscreen was only ever called once, from startCamera --
              exiting fullscreen (during live, recording, or review) had no
              way back in short of restarting the whole camera flow. This
              covers every phase that still has an active session to return
              to; idle hasn't started a camera yet, and "done" already
              returned its own JSX above (its own auto-exits fullscreen too),
              so phase can only be live/recording/review/uploading here.
              Placed as the FIRST child in this same flex-col stack (not an
              independently absolute-positioned button) so it can never
              overlap the banner above it or the Kata Recording/Submit row
              below it -- normal document flow pushes both automatically,
              the same reason the rest of this stack never overlaps either. */}
          {!fullscreen && phase !== "idle" && (
            <div className="flex justify-end px-2 pt-1">
              <button
                type="button"
                onClick={enterFullscreen}
                className="rounded border border-white/50 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/65"
              >
                ⛶ Full screen
              </button>
            </div>
          )}
          {fullscreen && (
            <div className="flex items-start justify-between gap-2 bg-black/45 px-3 py-2 text-white" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
              <p className="min-w-0 flex-1 break-words text-sm font-bold">
                Kata Recording{categoryName ? ` — ${categoryName}` : ""}
              </p>
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
                  className="rounded border border-white/50 bg-black/30 px-2.5 py-1 text-xs font-semibold hover:bg-black/50"
                  style={{ textShadow: "none" }}
                >
                  ✕ Exit full screen
                </button>
                {(phase === "live" || phase === "recording") && (
                  <span className="text-[10px] font-semibold leading-tight">
                    Deleted Recording: {attempts} / Available: {maxAttempts}
                  </span>
                )}
              </div>
            </div>
          )}
          {error && (
            <div className="bg-red-50/95 px-4 py-2 text-sm text-red-800 backdrop-blur-sm">{error}</div>
          )}
          {phase === "recording" && (
            <div className="px-2 pt-1">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-xs font-semibold text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE REC {mm}:{ss} / 05:00
              </div>
            </div>
          )}
          {/* Delete & re-record / Submit sit just under the title, overlaid
              on the replay itself, instead of a row below the video. */}
          {phase === "review" && (
            <div className="flex flex-col items-center gap-1.5 px-3 pt-2">
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
                  needed. */}
              {attemptsLeft <= 0 && (
                <div className="rounded-md bg-white/95 px-2 py-1.5 shadow">
                  <BuyExtraAttemptsButton hasPendingPurchase={hasPendingPurchase} />
                </div>
              )}
            </div>
          )}
        </div>
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
            phase === "live" || phase === "recording"
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
              onPlay={() => setReviewPlaying(true)}
              onPause={() => setReviewPlaying(false)}
              onEnded={() => setReviewPlaying(false)}
              onTimeUpdate={(e) => setReviewCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration)) {
                  setReviewDuration(v.duration);
                  return;
                }
                // A freshly-created MediaRecorder blob commonly reports
                // duration as Infinity in Chrome until the file is actually
                // seeked through once -- without this, the seek bar below
                // would have no usable max and never show a real length.
                const onProbeTimeUpdate = () => {
                  v.currentTime = 0;
                  v.removeEventListener("timeupdate", onProbeTimeUpdate);
                  setReviewDuration(Number.isFinite(v.duration) ? v.duration : 0);
                };
                v.addEventListener("timeupdate", onProbeTimeUpdate);
                v.currentTime = Number.MAX_SAFE_INTEGER;
              }}
              className="block h-full w-full object-contain"
            />
            {!reviewPlaying && (
              <button
                type="button"
                onClick={toggleReviewPlayback}
                aria-label="Play"
                className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-3xl text-white shadow-lg"
              >
                ▶
              </button>
            )}
            <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-3 pb-3 pt-10">
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
                  <button
                    type="button"
                    onClick={toggleReviewMute}
                    aria-label={reviewMuted ? "Unmute" : "Mute"}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
                  >
                    {reviewMuted ? "🔇" : "🔊"}
                  </button>
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
              onClick={startCamera}
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
          <button
            onClick={startRecording}
            aria-label="Start recording"
            className="absolute bottom-10 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/80 bg-red-600/90 text-2xl text-white shadow-lg active:scale-95"
          >
            ●
          </button>
        )}
        {phase === "recording" && (
          <button
            onClick={stopRecording}
            aria-label="Stop recording"
            className="absolute bottom-10 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/80 bg-neutral-900/90 text-2xl text-white shadow-lg active:scale-95"
          >
            ■
          </button>
        )}
        {/* Manual way back into full screen after tapping "Exit full
            screen" -- without this there was no way back in short of
            reloading the page. */}
        {!fullscreen &&
          (phase === "live" || phase === "recording" || phase === "review" || phase === "uploading") && (
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
        {/* Only shown once there's an actual submitted/reviewable take --
            bottom-center, plain white text (no background box) so it reads
            as part of the recording itself. Sits above the custom seek/
            play/mute bar now (that bar occupies roughly the bottom ~90px),
            not right above the burned-in watermark as before -- the bar's
            own gradient already covers that area. */}
        {phase === "review" && recordingStartedAt && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-20 text-center text-xs font-semibold text-white"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}
          >
            Recording dated {formatDateTime(recordingStartedAt.toISOString())}
          </div>
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
          <button disabled className="rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white opacity-70">
            Submitting…
          </button>
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
