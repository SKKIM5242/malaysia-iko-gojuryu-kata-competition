"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitTestimonial, editTestimonial } from "@/app/actions/account";
import {
  pickVideoMimeType,
  pickAudioMimeType,
  extensionForMimeType,
  bareMimeType,
  recordingBitrates,
} from "@/lib/media-recording";
import { playDingDong, playAlarmTick } from "@/lib/chime";
import { startClapDetector } from "@/lib/clap-detector";
import {
  TESTIMONIAL_KIND_LABEL,
  TESTIMONIAL_MIN_VIDEO_SECONDS,
  TESTIMONIAL_MAX_VIDEO_SECONDS,
  type TestimonialKind,
} from "@/lib/testimonials";
import {
  SCRIPT_LENGTH_LABEL,
  scriptsForBand,
  scriptText,
  type ScriptLengthBand,
  type TestimonialScript,
} from "@/lib/testimonial-scripts";
import LockedVideo from "@/components/LockedVideo";
import { PoseGuideOverlay } from "@/components/RecordingChrome";
import { chromeHeights, drawRecordingChrome } from "@/lib/recording-chrome-canvas";
import { POSE_GUIDE_NOTE, type RecordingAppearance } from "@/lib/recording-appearance";

const COUNTDOWN_CHOICES = [10, 15, 20, 25, 30] as const;

type Phase = "idle" | "live" | "countdown" | "recording" | "review" | "uploading";

type ScreenLightLevel = "off" | "low" | "medium" | "high";

/** Warm off-white rather than pure #FFFFFF. Two reasons: a full-brightness
 * pure-white panel at arm's length is genuinely uncomfortable to look into
 * and makes people squint on camera, and pure white from a phone display is
 * a cold, slightly blue light that drains colour out of skin. A warm tone
 * (roughly 3500-4000K) reads as flattering rather than clinical.
 *
 * The three levels hold the same hue and drop luminance, which is the only
 * intensity control available -- no web API can change screen brightness,
 * so the colour itself has to carry it. */
const SCREEN_LIGHT_TONES: Record<Exclude<ScreenLightLevel, "off">, string> = {
  low: "#D9C7AC",
  medium: "#F0DFC5",
  high: "#FFF3E3",
};

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** One opened script: the lettered cues on the left of the organizer's
 * template, and the written-out first-person version on the right.
 *
 * The written half is a real <textarea>, not styled text, for three
 * reasons the organizer asked for directly: it can be selected, it can be
 * edited in place (fill in the XXX and ______ before recording), and it can
 * be copied in one press. Local state starts from the shared template so
 * edits never leak between scripts or across sessions. */
function ScriptDetail({ script }: { script: TestimonialScript }) {
  const [text, setText] = useState(() => scriptText(script));
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard permission can be refused — the textarea is still
      // selectable by hand, so this is not worth an error message.
    }
  }

  return (
    <div className="grid gap-3 px-3 pb-3 pt-1 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
          What to cover
        </p>
        <ol className="list-[lower-alpha] space-y-1 pl-4 text-xs text-neutral-600">
          {script.prompts.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">
            Your script — edit the blanks
          </p>
          <button
            type="button"
            onClick={copy}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          className="w-full select-text rounded border border-neutral-300 bg-white p-2 text-xs leading-relaxed text-neutral-800"
        />
        <p className="mt-1 text-[11px] text-neutral-400">
          Replace XXX with names and fill in each ______ with your own details.
        </p>
      </div>
    </div>
  );
}

/** Sample scripts to prepare with. Each one carries the organizer's own
 * two-column template: lettered cues on one side, the same thing written
 * out in the first person on the other (see lib/testimonial-scripts.ts).
 * Shown for Video/Voice/Message, the three "make it yourself" paths — not
 * for Choose file, since there's nothing left to prepare once you already
 * have a finished recording. */
function ScriptPicker() {
  const [band, setBand] = useState<ScriptLengthBand | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const bands: ScriptLengthBand[] = ["3min", "5min", "10min"];

  return (
    <div className="mb-3 rounded-md border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-600">📝 Sample scripts to practice with — pick a length:</p>
        <a
          href="/winner-testimonial-sample-scripts.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
        >
          ⬇ Download all 40 as PDF
        </a>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {bands.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBand(band === b ? null : b)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              band === b ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-600"
            }`}
          >
            {SCRIPT_LENGTH_LABEL[b]}
          </button>
        ))}
      </div>
      {band && (
        <ul className="mt-2 max-h-[32rem] space-y-1 overflow-y-auto">
          {scriptsForBand(band).map((script) => (
            <li key={script.id} className="rounded border border-neutral-200">
              <button
                type="button"
                onClick={() => setOpenId(openId === script.id ? null : script.id)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                {script.title}
                <span className="text-neutral-400">{openId === script.id ? "▲" : "▼"}</span>
              </button>
              {openId === script.id && <ScriptDetail script={script} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Video and voice testimonials share the same record/review/retake flow —
 * only the constraints (min/max length) and the media element (video vs
 * audio) differ. A "Practice take" never uploads — it's local-only
 * rehearsal, per the organizer's "pre-recorded then time adjustment"
 * instruction — only "Actual recording" submits. */
function MediaTestimonialPanel({
  kind,
  mode,
  registrationId,
  onDone,
  recordingAppearance,
  recordingLogoUrl,
}: {
  kind: "video" | "voice";
  mode: "submit" | "edit";
  registrationId: string;
  onDone: () => void;
  recordingAppearance: RecordingAppearance | null;
  recordingLogoUrl: string | null;
}) {
  const [takeType, setTakeType] = useState<"practice" | "actual">("practice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Video testimonials are recorded from a CANVAS, not straight off the
  // camera: MediaRecorder can only capture a MediaStream, and the banner
  // and watermark are DOM, which never reaches the file. Compositing the
  // camera frame plus the chrome into a canvas each frame and recording
  // canvas.captureStream() is the only way to get them into the video (see
  // lib/recording-chrome-canvas.ts).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const chromeRef = useRef<{ bannerH: number; footerH: number } | null>(null);
  // The banner/watermark bands as a fraction of the composited frame, so
  // the DOM framing guide can be inset to sit exactly over the picture
  // area of the canvas rather than over the whole thing.
  const [bannerRatio, setBannerRatio] = useState(0);
  const [footerRatio, setFooterRatio] = useState(0);
  const logoRef = useRef<HTMLImageElement | null>(null);
  /** Front camera by default here, the opposite of the kata recorder: a
   * testimonial is spoken TO the camera, so the speaker has to see
   * themselves framed and read their script off the same screen. Rear is
   * offered because it is the better sensor on every phone, and is the
   * right choice when someone else is filming them. */
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tap-to-start countdown + clap-to-stop -- same hands-free flow as the
  // kata recorder (see components/KataRecorder.tsx and lib/clap-detector.ts
  // for why: no phone browser can ever see a Bluetooth shutter remote's
  // button press, since those work by emulating the volume key).
  const [countdownDuration, setCountdownDuration] = useState<number>(10);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const clapDetectorStopRef = useRef<(() => void) | null>(null);

  const isVideo = kind === "video";
  const minSeconds = isVideo ? TESTIMONIAL_MIN_VIDEO_SECONDS : 0;
  // Voice gets 15 minutes, not 10: the sample scripts offer a ~10 minute
  // option, and people read a prepared speech noticeably slower than the
  // word count suggests, so a 10 minute cap was cutting off the longest
  // scripts mid-sentence.
  const maxSeconds = isVideo ? TESTIMONIAL_MAX_VIDEO_SECONDS : 15 * 60;

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (clapDetectorStopRef.current) clapDetectorStopRef.current();
      if (audioContextRef.current) void audioContextRef.current.close().catch(() => {});
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl],
  );

  // Preloaded well before Start is pressed so the first recorded frame
  // already has the logo in it. crossOrigin="anonymous" is mandatory, not
  // cosmetic: without it the decoded image taints the canvas and
  // captureStream() throws, which would break recording entirely rather
  // than just dropping the logo.
  useEffect(() => {
    if (!isVideo || !recordingLogoUrl) {
      logoRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      logoRef.current = img;
    };
    img.onerror = () => {
      logoRef.current = null;
    };
    img.src = recordingLogoUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [isVideo, recordingLogoUrl]);

  async function startLive(requestedFacing: "user" | "environment" = facing) {
    setError(null);
    try {
      // Same audio treatment as the kata recorder: the browser defaults are
      // tuned for a phone held to your face on a call, and echo cancellation
      // in particular gates out a voice speaking from across a room, which
      // is how a testimonial is usually recorded.
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      };
      (audioConstraints as Record<string, unknown>).voiceIsolation = false;
      const stream = await navigator.mediaDevices.getUserMedia(
        isVideo
          ? {
              // HD 30fps, fixed -- matches the kata recorder so both
              // submissions arrive in one consistent format.
              video: {
                // Not "exact": a laptop webcam reports no facing mode, and
                // an exact constraint fails outright there instead of
                // falling back to the only camera available.
                facingMode: requestedFacing,
                width: { ideal: 1280, max: 1280 },
                height: { ideal: 720, max: 1280 },
                frameRate: { ideal: 30, max: 30 },
              },
              audio: audioConstraints,
            }
          : { audio: audioConstraints },
      );
      streamRef.current = stream;
      if (isVideo && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        rafRef.current = requestAnimationFrame(renderLoop);
      }
      setFacing(requestedFacing);
      setPhase("live");
    } catch {
      setError("Could not access your camera/microphone. Check your browser permissions and try again.");
    }
  }

  /** Tap Start -> visible countdown -> ding-dong chime -> recording begins
   * on its own. Replaces startRecording as the Start button's own handler;
   * startRecording now only fires once the countdown reaches 0. */
  function startCountdown() {
    setError(null);
    // Created on the tap itself (a real user gesture), reused for both the
    // chime and the clap detector -- creating it later inside the
    // countdown's own timer callback would not count as a gesture, and iOS
    // Safari silently refuses to play sound from a context that was never
    // unlocked that way.
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

  /** Composites camera frame + banner + watermark into the canvas that is
   * actually being recorded. Re-schedules itself, so it keeps the canvas
   * live from the moment the camera starts through the whole take.
   *
   * The canvas is sized ONCE, the first time the camera reports real
   * dimensions, and never resized afterwards: changing a canvas's size
   * mid-recording disturbs the video track that captureStream() already
   * handed to MediaRecorder, which is a corrupted take rather than a
   * cosmetic glitch. */
  function renderLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!chromeRef.current) {
      const width = video.videoWidth;
      const { bannerH, footerH } = chromeHeights(width, recordingAppearance);
      chromeRef.current = { bannerH, footerH };
      canvas.width = width;
      canvas.height = video.videoHeight + bannerH + footerH;
    }
    const { bannerH, footerH } = chromeRef.current;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, bannerH, canvas.width, canvas.height - bannerH - footerH);
    drawRecordingChrome(ctx, canvas.width, canvas.height, bannerH, footerH, recordingAppearance, logoRef.current);

    rafRef.current = requestAnimationFrame(renderLoop);
  }

  /** facingMode cannot be changed on a running track, and applyConstraints
   * with a different one is silently ignored on most phones — so the only
   * reliable switch is to stop this stream and open the other camera. The
   * canvas is re-sized from scratch afterwards because the two cameras
   * rarely share a resolution. Live phase only: swapping the source
   * mid-take would change the picture halfway through the testimonial. */
  async function switchCamera() {
    const next = facing === "user" ? "environment" : "user";
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chromeRef.current = null;
    await startLive(next);
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = isVideo ? pickVideoMimeType() : pickAudioMimeType();

    // Voice takes have no picture to composite, so they still record the
    // microphone stream directly. Video takes record the CANVAS instead, so
    // the banner and watermark end up in the file and not just on screen.
    let recordStream: MediaStream = stream;
    if (isVideo) {
      const canvas = canvasRef.current;
      if (!canvas || typeof canvas.captureStream !== "function") {
        setError("Your browser doesn't support in-app recording — please update it, or try the latest Chrome or Safari.");
        return;
      }
      const canvasStream = canvas.captureStream(30);
      const audioTrack = stream.getAudioTracks()[0];
      // Built as ONE stream carrying both tracks rather than addTrack()-ing
      // the microphone on afterwards: several WebKit/iOS versions only mux
      // the tracks a MediaStream was CONSTRUCTED with and silently drop
      // later additions, which records perfect picture with no sound (the
      // same trap already documented in KataRecorder).
      recordStream = new MediaStream(
        audioTrack ? [...canvasStream.getVideoTracks(), audioTrack] : canvasStream.getVideoTracks(),
      );
      // A track that arrives disabled records as pure silence.
      if (audioTrack) audioTrack.enabled = true;
    }

    // Sized against THIS recording's own cap, not the kata recorder's. A
    // video testimonial may run to 10 minutes -- twice a kata's 5 -- and at
    // the flat 1.0 Mbit/s this used to share with KataRecorder that came out
    // at 78.4MB, well past Supabase's 50MB project ceiling. Anything longer
    // than 6:23 simply could not be uploaded, while the screen above invites
    // winners to record up to 10:00. recordingBitrates() derives the figure
    // from maxSeconds instead, so a full-length testimonial now lands around
    // 44MB and the ceiling is unreachable by construction.
    const recorder = new MediaRecorder(
      recordStream,
      isVideo ? { mimeType, ...recordingBitrates(maxSeconds) } : { mimeType },
    );
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      if (clapDetectorStopRef.current) {
        clapDetectorStopRef.current();
        clapDetectorStopRef.current = null;
      }
      const blob = new Blob(chunksRef.current, { type: mimeType });
      recordedBlobRef.current = blob;
      setBlobUrl(URL.createObjectURL(blob));
      setPhase("review");
    };
    recorderRef.current = recorder;
    recorder.start();
    // Auto-stop on a hand clap -- starts right as recording does, well
    // after the countdown's own chime has already finished, so the chime
    // itself is never mistaken for the cue. Reuses the SAME AudioContext
    // the chime just played through (created on the Start tap itself)
    // rather than a fresh one -- see startClapDetector's own doc comment.
    if (audioContextRef.current) {
      clapDetectorStopRef.current = startClapDetector(audioContextRef.current, stream, { onClap: stopRecording });
    }
    setSeconds(0);
    setPhase("recording");
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        if (next >= maxSeconds) {
          recorderRef.current?.stop();
          if (timerRef.current) clearInterval(timerRef.current);
        }
        return next;
      });
    }, 1000);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function retake() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    recordedBlobRef.current = null;
    setPhase("live");
  }

  async function useThisTake() {
    if (takeType === "practice") {
      // Rehearsal only — clear back to live and switch straight into the
      // real recording, timing already dialed in.
      retake();
      setTakeType("actual");
      return;
    }
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
        .from("testimonials")
        .upload(path, blob, { contentType: bareMimeType(blob.type || (isVideo ? "video/webm" : "audio/webm")) });
      if (upErr) {
        setError(
          `Upload failed: ${upErr.message || "unknown error"} (type: ${blob.type || "unknown"}, size: ${(blob.size / 1024 / 1024).toFixed(1)}MB) — please try again or contact support with this message.`,
        );
        setPhase("review");
        return;
      }
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("path", path);
      fd.set("registration_id", registrationId);
      const action = mode === "edit" ? editTestimonial : submitTestimonial;
      const result = await action({ ok: false }, fd);
      if (!result.ok) {
        setError(result.error ?? "Could not submit your testimonial.");
        setPhase("review");
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onDone();
    } catch {
      setError("Something went wrong uploading your testimonial. Please try again.");
      setPhase("review");
    }
  }

  const tooShort = takeType === "actual" && isVideo && seconds < minSeconds;

  // Screen flash. This panel records on the FRONT camera, which faces the
  // same way as the display -- so filling the screen with white genuinely
  // lights the speaker's face, which is the trick selfie-flash apps use.
  // It's also the only light available here at all: no browser on iOS can
  // switch the camera's LED on, and the front camera has no usable torch on
  // Android either. Only meaningful for video, and only while the camera is
  // actually live -- deriving that rather than resetting state on every
  // phase change means it can never be left stuck on over the review
  // screen.
  const [screenLight, setScreenLight] = useState<ScreenLightLevel>("off");
  const screenLightOn =
    screenLight !== "off" && isVideo && (phase === "live" || phase === "countdown" || phase === "recording");

  return (
    <>
      {/* Above the site's own fixed chrome (footer sits at 40, the
          accessibility toolbar at 60) so the white really does fill the
          screen, but below the app's modals (150-200) so a dialog can still
          appear over it. */}
      {screenLightOn && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[90]"
          style={{ backgroundColor: SCREEN_LIGHT_TONES[screenLight as Exclude<ScreenLightLevel, "off">] }}
        />
      )}
    <div className={"mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4" + (screenLightOn ? " relative z-[95]" : "")}>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          disabled={phase === "recording" || phase === "uploading"}
          onClick={() => setTakeType("practice")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
            takeType === "practice" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-600"
          }`}
        >
          🎬 Practice take
        </button>
        <button
          type="button"
          disabled={phase === "recording" || phase === "uploading"}
          onClick={() => setTakeType("actual")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
            takeType === "actual" ? "border-red-700 bg-red-700 text-white" : "border-neutral-300 bg-white text-neutral-600"
          }`}
        >
          ⏺ Actual recording
        </button>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        {takeType === "practice"
          ? "Rehearse here first — practice takes are never saved or uploaded. Switch to “Actual recording” once your timing is right."
          : "This take will be uploaded and submitted as your testimonial."}
      </p>

      {phase === "idle" && (
        <button type="button" onClick={() => void startLive()} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700">
          {isVideo ? "📷 Record now" : "🎙️ Turn on microphone"}
        </button>
      )}

      {isVideo && (phase === "live" || phase === "countdown" || phase === "recording") && (
        <>
          {/* What is shown here is the CANVAS being recorded, not the raw
              camera — banner and watermark included — so the preview is
              literally the frame that lands in the file. The <video> is
              still needed as the pixel source for that canvas, but it is
              never displayed; hidden with sizing rather than `display:none`,
              which some mobile browsers treat as permission to stop
              decoding frames altogether. */}
          <div className="mb-3 w-full max-w-md overflow-hidden rounded-md bg-black">
            <div className="relative">
              <video
                ref={videoRef}
                muted
                playsInline
                className="pointer-events-none absolute h-px w-px opacity-0"
                aria-hidden
              />
              <canvas ref={canvasRef} className="block w-full bg-black" />
              {/* Overlaid on the DOM only, never drawn into the canvas: a
                  framing aid burned across a winner's face for the life of
                  the video would be a defect. Inset past the banner and
                  watermark bands so the outline lines up with the picture
                  rather than with the whole composited frame. */}
              <div
                className="absolute inset-x-0"
                style={{ top: `${bannerRatio * 100}%`, bottom: `${footerRatio * 100}%` }}
              >
                <PoseGuideOverlay label="Testimonial" note={POSE_GUIDE_NOTE} />
              </div>
            </div>
          </div>
          {phase === "live" && (
            <div className="mb-3">
              <button
                type="button"
                onClick={switchCamera}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                {facing === "user" ? "📷 Switch to rear camera" : "🤳 Switch to front camera"}
              </button>
              <p className="mt-1 text-[11px] text-neutral-500">
                Front camera lets you see yourself and read your script. Rear camera is sharper, and is the
                right choice if someone else is filming you.
              </p>
            </div>
          )}
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs font-semibold text-neutral-600">💡 Screen light</span>
              {(["off", "low", "medium", "high"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setScreenLight(level)}
                  aria-pressed={screenLight === level}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-semibold capitalize " +
                    (screenLight === level
                      ? "border-amber-500 bg-amber-300 text-neutral-900"
                      : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50")
                  }
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">
              Lights your face with a warm off-white — easier on the eyes than pure white, and it keeps skin tone
              natural on camera. Your preview stays visible in the middle. No browser can switch the camera&apos;s own
              flash on for a front-camera recording, so the screen is the light — raise your phone&apos;s brightness
              for more of it.
            </p>
          </div>
        </>
      )}

      {phase === "live" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-1.5 py-1">
            {COUNTDOWN_CHOICES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setCountdownDuration(d)}
                aria-pressed={countdownDuration === d}
                className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                  countdownDuration === d ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
          <button type="button" onClick={startCountdown} className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
            ⏺ Start recording
          </button>
        </div>
      )}

      {phase === "countdown" && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-neutral-200 bg-white py-6">
          <span className="text-5xl font-black text-neutral-900" aria-live="assertive">
            {countdownSeconds}
          </span>
          <p className="text-sm font-semibold text-neutral-600">Get ready…</p>
          <button
            type="button"
            onClick={cancelCountdown}
            className="mt-1 rounded-md border border-neutral-300 px-4 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div>
          <p className="mb-2 font-mono text-lg font-bold text-red-700">
            ● {mmss(seconds)}
            {isVideo ? ` / max ${mmss(maxSeconds)}` : ""}
          </p>
          {isVideo && takeType === "actual" && seconds < minSeconds && (
            <p className="mb-2 text-xs text-amber-700">Keep going — at least {mmss(minSeconds)} needed.</p>
          )}
          <p className="mb-2 text-xs font-semibold text-neutral-500">👏 Clap once to stop, or tap Stop below.</p>
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            ⏹ Stop
          </button>
        </div>
      )}

      {phase === "review" && blobUrl && (
        <div>
          {isVideo ? (
            // No DOM banner or watermark here any more: they are baked into
            // the recorded frames now, so drawing them again around the
            // player would show each of them twice. The dotted guide is
            // gone as intended — it was never recorded, and there is
            // nothing left to line up against once the take exists.
            <LockedVideo src={blobUrl} className="mb-3 block w-full max-w-md rounded-md bg-black" />
          ) : (
            <audio src={blobUrl} controls className="mb-3 w-full max-w-md" />
          )}
          <p className="mb-2 text-xs text-neutral-500">Length: {mmss(seconds)}</p>
          {tooShort && (
            <p className="mb-2 text-xs font-semibold text-red-700">Too short — needs at least {mmss(minSeconds)}. Please retake.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={retake}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              🔁 Retake
            </button>
            <button
              type="button"
              onClick={useThisTake}
              disabled={tooShort}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {takeType === "practice" ? "✓ Done practicing — record the actual one" : "✅ Submit this testimonial"}
            </button>
          </div>
        </div>
      )}

      {phase === "uploading" && <p className="text-sm font-semibold text-neutral-600">Uploading…</p>}
      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
    </>
  );
}

function MessageTestimonialPanel({
  mode,
  registrationId,
  onDone,
}: {
  mode: "submit" | "edit";
  registrationId: string;
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!message.trim()) {
      setError("Type your testimonial message.");
      return;
    }
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("kind", "message");
    fd.set("message", message.trim());
    fd.set("registration_id", registrationId);
    const action = mode === "edit" ? editTestimonial : submitTestimonial;
    const result = await action({ ok: false }, fd);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not submit your testimonial.");
      return;
    }
    onDone();
  }

  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        disabled={pending}
        placeholder="Share your experience competing with us…"
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "✅ Submit testimonial"}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

/** Already have a recording or a file saved elsewhere (not made live in the
 * browser)? Pick it directly — video or audio, auto-detected from the file
 * itself. No practice-take step, since there's nothing to rehearse: pick a
 * different file if this isn't the one. */
function UploadTestimonialPanel({
  mode,
  registrationId,
  onDone,
}: {
  mode: "submit" | "edit";
  registrationId: string;
  onDone: (kind: TestimonialKind) => void;
}) {
  const [kind, setKind] = useState<"video" | "voice" | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  function pick(file: File) {
    setError(null);
    const detected = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "voice" : null;
    if (!detected) {
      setError("Please choose a video or audio file.");
      return;
    }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    fileRef.current = file;
    setKind(detected);
    setBlobUrl(URL.createObjectURL(file));
    setSeconds(0);
  }

  function chooseDifferent() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    fileRef.current = null;
    setKind(null);
    setBlobUrl(null);
    setError(null);
  }

  const tooShort = kind === "video" && seconds > 0 && seconds < TESTIMONIAL_MIN_VIDEO_SECONDS;

  async function submit() {
    const file = fileRef.current;
    if (!file || !kind) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Your session expired — please sign in again.");
        setUploading(false);
        return;
      }
      const path = `${user.id}/${crypto.randomUUID()}.${extensionForMimeType(file.type)}`;
      const { error: upErr } = await supabase.storage.from("testimonials").upload(path, file, { contentType: bareMimeType(file.type) });
      if (upErr) {
        setError(
          `Upload failed: ${upErr.message || "unknown error"} (type: ${file.type || "unknown"}, size: ${(file.size / 1024 / 1024).toFixed(1)}MB) — please try again or contact support with this message.`,
        );
        setUploading(false);
        return;
      }
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("path", path);
      fd.set("registration_id", registrationId);
      const action = mode === "edit" ? editTestimonial : submitTestimonial;
      const result = await action({ ok: false }, fd);
      if (!result.ok) {
        setError(result.error ?? "Could not submit your testimonial.");
        setUploading(false);
        return;
      }
      onDone(kind);
    } catch {
      setError("Something went wrong uploading your testimonial. Please try again.");
      setUploading(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
      {!blobUrl ? (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            📁 Choose a video or audio file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pick(file);
              e.target.value = "";
            }}
          />
        </>
      ) : (
        <div>
          {kind === "video" ? (
            <LockedVideo
              src={blobUrl}
              onLoadedMetadata={(e) => setSeconds(Math.round(e.currentTarget.duration) || 0)}
              className="mb-3 w-full max-w-md rounded-md bg-black"
            />
          ) : (
            <audio src={blobUrl} controls className="mb-3 w-full max-w-md" />
          )}
          <p className="mb-2 text-xs text-neutral-500">
            Detected as: {kind === "video" ? "🎥 Video" : "🎙️ Voice"}
            {seconds > 0 ? ` — Length: ${mmss(seconds)}` : ""}
          </p>
          {tooShort && (
            <p className="mb-2 text-xs font-semibold text-red-700">
              Video testimonials need at least {mmss(TESTIMONIAL_MIN_VIDEO_SECONDS)}. Please choose a longer file.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={chooseDifferent}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              🔁 Choose a different file
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={uploading || tooShort}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "✅ Submit this testimonial"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

type ChooserOption = TestimonialKind | "upload";

/** The 4-button chooser a Top-3 winner sees, whether on /winners (own row)
 * or, going forward, wherever else it's embedded — see
 * components/WinnerTestimonialInline.tsx for the gate notes and the
 * "already submitted" replay shown once one exists. */
export default function TestimonialRecorder({
  mode = "submit",
  registrationId,
  onSaved,
  recordingAppearance = null,
  recordingLogoUrl = null,
}: {
  /** "edit" re-records/re-types an already-submitted testimonial (calls
   * editTestimonial, an UPDATE) instead of the default first-time "submit"
   * (calls submitTestimonial, an INSERT) — see WinnerTestimonialInline.tsx,
   * which shows this in "edit" mode inside its own Edit/Retake toggle. */
  mode?: "submit" | "edit";
  /** Which registration this testimonial is for — a login linked to
   * several participants (a Sensei recording for several students) needs
   * this explicit, since it may not be the account's own primary link (see
   * submitTestimonial/editTestimonial in app/actions/account.ts). */
  registrationId: string;
  /** "edit" mode only — called once the update succeeds, so the parent can
   * collapse back to the read-only view instead of showing the "thank you"
   * screen below (which only makes sense for a first submission). */
  onSaved?: () => void;
  /** Banner + footer watermark for the recording screen, from the Recording
   * Appearance section on the admin Competitions page. Passed down rather
   * than fetched here: this is a client component, and one fetch per
   * recorder mount would flash an unbranded header over the camera before
   * it resolved. */
  recordingAppearance?: RecordingAppearance | null;
  recordingLogoUrl?: string | null;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ChooserOption | null>(null);
  const [done, setDone] = useState(false);
  const [submittedKind, setSubmittedKind] = useState<TestimonialKind | null>(null);

  function handleDone(kind: TestimonialKind) {
    router.refresh();
    if (mode === "edit") {
      onSaved?.();
      return;
    }
    setSubmittedKind(kind);
    setDone(true);
  }

  if (done) {
    return (
      <p className="mt-3 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
        ✅ Thank you — your testimonial has been submitted. Your certificate download is now unlocked.
        {submittedKind === "video" && " Since it's video, it also plays back automatically as your voice testimonial."}
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(["video", "voice", "message"] as TestimonialKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setChosen(k)}
            className={`rounded-md border px-4 py-2 text-sm font-semibold ${
              chosen === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {TESTIMONIAL_KIND_LABEL[k]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setChosen("upload")}
          className={`rounded-md border px-4 py-2 text-sm font-semibold ${
            chosen === "upload" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          📁 Choose file
        </button>
      </div>
      {chosen === "video" && (
        <div className="mt-3">
          <ScriptPicker />
          <MediaTestimonialPanel kind="video" mode={mode} registrationId={registrationId} onDone={() => handleDone("video")} recordingAppearance={recordingAppearance} recordingLogoUrl={recordingLogoUrl} />
        </div>
      )}
      {chosen === "voice" && (
        <div className="mt-3">
          <ScriptPicker />
          <MediaTestimonialPanel kind="voice" mode={mode} registrationId={registrationId} onDone={() => handleDone("voice")} recordingAppearance={recordingAppearance} recordingLogoUrl={recordingLogoUrl} />
        </div>
      )}
      {chosen === "message" && (
        <div className="mt-3">
          <ScriptPicker />
          <MessageTestimonialPanel mode={mode} registrationId={registrationId} onDone={() => handleDone("message")} />
        </div>
      )}
      {chosen === "upload" && <UploadTestimonialPanel mode={mode} registrationId={registrationId} onDone={handleDone} />}
    </div>
  );
}
