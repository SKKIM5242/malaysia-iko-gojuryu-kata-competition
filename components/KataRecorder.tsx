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

/** Draws the branded competition frame: colorful title banner, live camera
 * feed, and a light watermark — all burned into the recorded pixels via
 * canvas.captureStream(), never the raw camera feed. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
  watermark: string,
) {
  ctx.drawImage(video, 0, 0, w, h);

  const topH = Math.round(h * 0.11);

  // Top banner — colorful gradient declaration
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#b91c1c");
  grad.addColorStop(0.5, "#7c2d92");
  grad.addColorStop(1, "#1d4ed8");
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, topH);
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  // Longer than the old "MALAYSIA OPEN — ONLINE KATA COMPETITION" -- shrink
  // the font (down to a 10px floor) until it actually measures within the
  // frame width, instead of a fixed ratio that could still overflow to a
  // second line on a narrower recording resolution.
  const bannerTitle = "MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION";
  let titleFontPx = Math.max(12, Math.round(topH * 0.32));
  ctx.font = `bold ${titleFontPx}px Georgia, serif`;
  const maxTitleWidth = w * 0.94;
  while (titleFontPx > 10 && ctx.measureText(bannerTitle).width > maxTitleWidth) {
    titleFontPx -= 1;
    ctx.font = `bold ${titleFontPx}px Georgia, serif`;
  }
  ctx.fillText(bannerTitle, w / 2, topH * 0.48);
  ctx.font = `${Math.max(9, Math.round(topH * 0.2))}px Arial, sans-serif`;
  ctx.fillText("Organized by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD", w / 2, topH * 0.82);
  ctx.shadowBlur = 0;

  // Light watermark, bottom of frame
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.font = "8px Arial, sans-serif";
  ctx.fillText(watermark, w / 2, h - 10);
  ctx.restore();
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
 * guarantee an exact edge-to-edge fill, but matching portrait/landscape
 * gets far closer on every device than a fixed square ever could. */
function idealVideoDimensions(): { width: number; height: number } {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { width: 720, height: 1280 };
  }
  const landscape = window.matchMedia("(orientation: landscape)").matches;
  return landscape ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
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
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<Date | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);

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
    if (!video || !canvas || video.videoWidth === 0) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) drawFrame(ctx, video, canvas.width, canvas.height, watermark);
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

  async function handleReRecord() {
    if (!canReRecord) return;
    const newCount = await useRecordAttempt();
    setAttempts(newCount);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
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
            : "relative mx-auto min-h-[85dvh] max-w-md overflow-hidden rounded-lg border border-neutral-300 bg-black [@media(orientation:landscape)]:max-w-4xl"
        }
      >
        {/* Title bar and error banner float directly on the recording area
            itself (absolute, top of the box) instead of taking their own
            row above it -- in full screen especially, every bit of height
            given to a separate row is height taken away from the actual
            preview, which is the whole point of full screen. No background
            box behind the title bar -- just the text and button themselves,
            with a drop-shadow for legibility over whatever's playing
            underneath, so it doesn't read as its own separate strip sitting
            in front of the recording header banner. */}
        {(fullscreen || error) && (
          <div className="absolute inset-x-0 top-0 z-20 flex flex-col">
            {fullscreen && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-white" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>
                <p className="truncate text-sm font-bold">
                  Kata Recording{categoryName ? ` — ${categoryName}` : ""}
                </p>
                <button
                  type="button"
                  onClick={exitFullscreen}
                  className="rounded border border-white/50 bg-black/30 px-2.5 py-1 text-xs font-semibold hover:bg-black/50"
                  style={{ textShadow: "none" }}
                >
                  ✕ Exit full screen
                </button>
              </div>
            )}
            {error && (
              <div className="bg-red-50/95 px-4 py-2 text-sm text-red-800 backdrop-blur-sm">{error}</div>
            )}
          </div>
        )}
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
            and would otherwise show through underneath. */}
        {(phase === "review" || phase === "uploading") && blobUrl && (
          <video
            src={blobUrl}
            controls
            playsInline
            disablePictureInPicture
            className="block h-full w-full object-contain"
          />
        )}
        {phase === "idle" && (
          <div className="flex h-full items-center justify-center p-8 text-center text-neutral-300">
            Camera preview appears here once started.
          </div>
        )}
        {phase !== "idle" && phase !== "review" && phase !== "uploading" && (
          <div className="absolute right-2 top-12 rounded bg-black/70 px-1.5 py-0.5 text-right text-[10px] font-semibold leading-tight text-white">
            Deleted Recording: {attempts} / Available: {maxAttempts}
          </div>
        )}
        {phase === "recording" && (
          <div className="absolute left-3 top-12 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-xs font-semibold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE REC {mm}:{ss} / 05:00
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
              className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-md border border-white/50 bg-black/60 text-lg text-white shadow-lg"
            >
              ⛶
            </button>
          )}
        {/* Delete & re-record / Submit sit just under the burned-in header
            banner (top ~11% of the recorded frame), overlaid on the replay
            itself, instead of a row below the video. */}
        {phase === "review" && (
          <div className="absolute inset-x-0 top-[13%] flex flex-col items-center gap-1.5 px-3">
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
        {/* Only shown once there's an actual submitted/reviewable take --
            bottom-center, plain white text (no background box) so it reads
            as part of the recording itself, right above the burned-in
            watermark rather than competing with the video controls bar. */}
        {phase === "review" && recordingStartedAt && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-12 text-center text-xs font-semibold text-white"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}
          >
            Recording dated {formatDateTime(recordingStartedAt.toISOString())}
          </div>
        )}
      </div>

      {(phase === "idle" || phase === "uploading") && (
        <div
          className={
            fullscreen
              ? "flex shrink-0 items-center justify-center gap-3 bg-black px-4 py-4"
              : "flex flex-wrap justify-center gap-3"
          }
        >
          {phase === "idle" && (
            <button
              onClick={startCamera}
              className="w-full max-w-md rounded-lg bg-red-700 px-6 py-4 text-lg font-bold text-white hover:bg-red-600 sm:w-auto"
            >
              Enable camera
            </button>
          )}
          {phase === "uploading" && (
            <button disabled className="rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white opacity-70">
              Submitting…
            </button>
          )}
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
