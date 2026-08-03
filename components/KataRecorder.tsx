"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRecordAttempt, submitKataVideo } from "@/app/actions/account";
import BuyExtraAttemptsButton from "@/components/BuyExtraAttemptsButton";
import { formatDate, formatDateTime } from "@/components/ui";

const MAX_SECONDS = 5 * 60;

type Phase = "idle" | "live" | "recording" | "review" | "uploading" | "done";

/** Safari (and every browser on iOS/iPadOS — Chrome, Telegram's in-app
 * browser, etc. all run on the same WebKit engine there, Apple requires
 * it) has never supported MediaRecorder with a webm mimeType at all, only
 * mp4 -- MediaRecorder.isTypeSupported correctly returns false for every
 * webm candidate below on those browsers, but the old fallback ignored
 * that and returned "video/webm" anyway, unconditionally. `new
 * MediaRecorder(stream, { mimeType: "video/webm" })` then threw
 * immediately on construction, with nothing checking for that error --
 * exactly the "Could not access/start recording" symptom reported only
 * on iPhone, across every browser tried there, and only there. */
function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

/** The file's real extension, matching whichever mimeType MediaRecorder
 * actually used to produce it — used to be hardcoded to .webm regardless,
 * which produced a .webm-named file containing mp4 data on Safari. */
function extensionForMimeType(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/** Light watermark, bottom center of frame -- font size and bottom margin
 * both scale with the actual recorded resolution (was a fixed "8px"/10px,
 * which reads fine on a small preview thumbnail but is practically
 * invisible once phones and tablets started negotiating much taller/wider
 * real camera resolutions than that was ever sized for). Shared by both
 * the portrait and landscape banner layouts below.
 *
 * The size was purely height-proportional with no check against the
 * frame's WIDTH at all -- fine on a wide landscape frame, but on a narrow
 * portrait one that let the text run past the left/right edges instead of
 * shrinking to fit, same class of bug the title/subtitle already guard
 * against with their own shrink-to-fit loops. */
function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, watermark: string) {
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.textAlign = "center";
  let fontPx = Math.max(11, Math.round(h * 0.022));
  ctx.font = `${fontPx}px Arial, sans-serif`;
  const maxWidth = w * 0.92;
  while (fontPx > 7 && ctx.measureText(watermark).width > maxWidth) {
    fontPx -= 1;
    ctx.font = `${fontPx}px Arial, sans-serif`;
  }
  ctx.fillText(watermark, w / 2, h - Math.max(14, Math.round(h * 0.025)));
  ctx.restore();
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
 * height as a fraction of the frame height, so the caller can line up the
 * DOM title bar directly underneath it instead of guessing a fixed
 * percentage that may not match what got drawn. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
  watermark: string,
): number {
  ctx.drawImage(video, 0, 0, w, h);

  const maxTitleWidth = w * 0.97;
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
  if (h > w) {
    const bannerTitle = "MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION";
    let titleFontPx = Math.round(w * 0.075);
    ctx.font = `900 ${titleFontPx}px Georgia, serif`;
    while (titleFontPx > 4 && ctx.measureText(bannerTitle).width > maxTitleWidth) {
      titleFontPx -= 1;
      ctx.font = `900 ${titleFontPx}px Georgia, serif`;
    }
    // Sized from its OWN width fit now (capped at a generous 85% of the
    // title, just to keep it reading as secondary) instead of a tight 55%
    // of the title -- the subtitle's own ~54-character string, in a
    // lighter/narrower weight than the title's bold 900, has real room of
    // its own to grow into that the old flat ratio was leaving unused.
    let subtitleFontPx = Math.round(w * 0.05);
    ctx.font = `${subtitleFontPx}px Arial, sans-serif`;
    while (subtitleFontPx > 3 && ctx.measureText(subtitle).width > maxTitleWidth) {
      subtitleFontPx -= 1;
      ctx.font = `${subtitleFontPx}px Arial, sans-serif`;
    }
    subtitleFontPx = Math.min(subtitleFontPx, Math.round(titleFontPx * 0.85));
    ctx.font = `${subtitleFontPx}px Arial, sans-serif`;
    // Padding multipliers deliberately generous (roughly 2.5x the previous
    // ones) -- this is what actually grows the banner bar itself by the
    // requested ~150-200%, since the text's own size is already maxed out
    // against the frame width above.
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
    ctx.font = `900 ${titleFontPx}px Georgia, serif`;
    ctx.fillText(bannerTitle, w / 2, titleY);
    ctx.font = `${subtitleFontPx}px Arial, sans-serif`;
    ctx.fillText(subtitle, w / 2, subtitleY);
    ctx.shadowBlur = 0;

    drawWatermark(ctx, w, h, watermark);
    return topH / h;
  }

  // Landscape: unchanged single-line layout, sized from the frame's height.
  const bannerTitle = "MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION";
  const topH = Math.round(h * 0.13);
  let titleFontPx = Math.max(14, Math.round(topH * 0.4));
  ctx.font = `900 ${titleFontPx}px Georgia, serif`;
  while (titleFontPx > 4 && ctx.measureText(bannerTitle).width > maxTitleWidth) {
    titleFontPx -= 1;
    ctx.font = `900 ${titleFontPx}px Georgia, serif`;
  }
  // Capped at a fraction of whatever the title actually ended up at (not
  // just its own independent proportional guess + floor) -- on a
  // narrow-but-tall recording, the (longer) title needs much more
  // shrinking than the (shorter) subtitle, and two independent floors
  // could let the subtitle end up the same size as, or bigger than, the
  // title it's supposed to sit under.
  let subtitleFontPx = Math.min(Math.max(8, Math.round(topH * 0.16)), Math.round(titleFontPx * 0.55));
  ctx.font = `${subtitleFontPx}px Arial, sans-serif`;
  while (subtitleFontPx > 3 && ctx.measureText(subtitle).width > maxTitleWidth) {
    subtitleFontPx -= 1;
    ctx.font = `${subtitleFontPx}px Arial, sans-serif`;
  }
  const titleY = topH * 0.4;
  const subtitleY = topH * 0.82;

  drawBannerRect(ctx, w, topH);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.font = `900 ${titleFontPx}px Georgia, serif`;
  ctx.fillText(bannerTitle, w / 2, titleY);
  ctx.font = `${subtitleFontPx}px Arial, sans-serif`;
  ctx.fillText(subtitle, w / 2, subtitleY);
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
 * than a fixed preset. */
function idealVideoDimensions(): { width: number; height: number } {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { width: 1280, height: 720 };
  }
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  const screenLong = Math.max(window.innerWidth, window.innerHeight, 480);
  const screenShort = Math.max(Math.min(window.innerWidth, window.innerHeight), 240);
  const longEdge = 1280;
  const shortEdge = Math.max(400, Math.round(longEdge * (screenShort / screenLong)));
  return landscape ? { width: shortEdge, height: longEdge } : { width: longEdge, height: shortEdge };
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
  watermark: string;
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

  // Keeps our own state in sync if the browser's own fullscreen exits some
  // other way than our own button — the OS back gesture/button on mobile,
  // or Escape on desktop.
  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setFullscreen(false);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: width }, height: { ideal: height } },
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
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ratio = video.videoWidth / video.videoHeight;
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

  // Fit the box within an 85dvh-tall, viewport-width-minus-margins budget
  // while preserving the real video's aspect ratio -- whichever dimension
  // (the height budget or the width budget) is more restrictive wins,
  // exactly like object-contain's own math, but applied to the CONTAINER
  // so it hugs the video instead of leaving it stranded inside a
  // mis-shaped box. Falls back to a portrait guess before the camera has
  // reported its real dimensions (idle placeholder / not started yet).
  // Defensive fallback: even though renderLoop now guards against feeding
  // a degenerate value into videoAspect, a bad value here would divide the
  // box's height by zero/Infinity and make the whole recording screen
  // silently vanish, so re-check it right at the point of use too.
  const previewRatio = videoAspect && Number.isFinite(videoAspect) && videoAspect > 0 ? videoAspect : 9 / 16;
  const previewMaxHeightPx = viewport.h * 0.85;
  const previewMaxWidthCapPx = previewRatio > 1 ? 896 : 448;
  const previewAvailableWidthPx = Math.max(200, viewport.w - 32);
  const previewBoxWidthPx = Math.min(previewMaxHeightPx * previewRatio, previewMaxWidthCapPx, previewAvailableWidthPx);
  const previewBoxHeightPx = previewBoxWidthPx / previewRatio;

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
      className={fullscreen ? "fixed inset-0 z-[300] bg-black" : "space-y-4"}
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
          fullscreen
            ? "relative h-[100dvh] w-full overflow-hidden bg-black"
            : "relative mx-auto overflow-hidden rounded-lg border border-neutral-300 bg-black"
        }
        style={fullscreen ? undefined : { width: previewBoxWidthPx, height: previewBoxHeightPx }}
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
        <div className="absolute inset-x-0 z-20 flex flex-col" style={{ top: `${bannerRatio * 100}%` }}>
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
          className={phase === "live" || phase === "recording" ? "block h-full w-full object-contain" : "hidden"}
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
