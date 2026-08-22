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
  UPLOAD_CEILING_BYTES,
} from "@/lib/media-recording";
import { playDingDong } from "@/lib/chime";
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
import type { AppliedSpec } from "@/lib/recording-specs";

// No countdown and no clap-to-stop here, unlike the kata recorder. Those
// exist so a competitor can walk out to their mark and perform hands-free.
// A testimonial is given sitting in front of the phone, within arm's reach
// of the screen the whole time: a countdown only delays the start, and a
// clap in the middle of a spoken sentence cut people off mid-word.
type Phase = "idle" | "live" | "recording" | "review" | "uploading";

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

/** The project-wide Supabase upload ceiling, in whole MB, for the copy that
 * tells a winner what they may pick. */
const MAX_TESTIMONIAL_MB = Math.floor(UPLOAD_CEILING_BYTES / 1024 / 1024);

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
function ScriptDetail({
  script,
  onUseForMessage,
}: {
  script: TestimonialScript;
  /** Hands this winner's EDITED text to the Type Message panel and switches
   * to it, so a script they have just filled in doesn't have to be copied
   * and re-pasted by hand. */
  onUseForMessage?: (text: string) => void;
}) {
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

  /** Saves the edited script as a plain .txt. Deliberately not a PDF: the
   * point is a file that can be reopened and kept editing on a phone, and
   * every device opens .txt. The full 40-script PDF is its own download at
   * the top of the picker. */
  function save() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${script.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Prints just this script, at a size readable from a stand while
   * speaking — which is what a printed script is for. Silently does nothing
   * if a popup blocker refuses the window. */
  function print() {
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return;
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(
      "<!doctype html><html><head><title>" +
        esc(script.title) +
        "</title><style>body{font:16pt/1.7 Georgia,serif;margin:2.5cm}h1{font-size:18pt;margin:0 0 1em}" +
        "pre{font:inherit;white-space:pre-wrap}</style></head><body><h1>" +
        esc(script.title) +
        "</h1><pre>" +
        esc(text) +
        "</pre></body></html>",
    );
    w.document.close();
    w.focus();
    w.print();
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
        {onUseForMessage && (
          <button
            type="button"
            onClick={() => onUseForMessage(text)}
            className="mb-1.5 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-neutral-700"
          >
            💬 Use this script for Message Testimonial
          </button>
        )}
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">
            Your script — edit the blanks
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={save}
              className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              💾 Save
            </button>
            <button
              type="button"
              onClick={copy}
              className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={print}
              className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              🖨 Print
            </button>
          </div>
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
function ScriptPicker({ onUseForMessage }: { onUseForMessage?: (text: string) => void }) {
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
              {openId === script.id && <ScriptDetail script={script} onUseForMessage={onUseForMessage} />}
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
  onExit,
  recordingAppearance,
  recordingLogoUrl,
  appliedSpec,
}: {
  kind: "video" | "voice";
  mode: "submit" | "edit";
  registrationId: string;
  onDone: () => void;
  /** Leave without submitting — releases the camera and collapses the panel
   * back to the page it was opened from. */
  onExit: () => void;
  recordingAppearance: RecordingAppearance | null;
  recordingLogoUrl: string | null;
  /** Organizer-applied video settings, or null to use the code default. */
  appliedSpec: AppliedSpec | null;
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
  // Kept only for the one short chime that plays as a take begins. The
  // kata recorder's countdown and clap-to-stop are deliberately absent here
  // -- see the note at the top of this file.
  const audioContextRef = useRef<AudioContext | null>(null);

  const isVideo = kind === "video";
  const minSeconds = isVideo ? TESTIMONIAL_MIN_VIDEO_SECONDS : 0;
  // Voice gets 15 minutes, not 10: the sample scripts offer a ~10 minute
  // option, and people read a prepared speech noticeably slower than the
  // word count suggests, so a 10 minute cap was cutting off the longest
  // scripts mid-sentence.
  const nominalMaxSeconds = isVideo ? TESTIMONIAL_MAX_VIDEO_SECONDS : 15 * 60;
  // What the encoder settings can actually deliver inside the 50MB upload
  // ceiling. For today's caps this is a no-op -- a 10:00 video fits, and a
  // 15:00 voice-only take is barely 10MB -- but it makes the cap and the
  // bitrate impossible to drift apart: raise TESTIMONIAL_MAX_VIDEO_SECONDS
  // to 15:00 and the recorder shortens itself rather than producing a file
  // Supabase will refuse. Video only; audio-only has no video budget to
  // trade against and is nowhere near the ceiling.
  const videoBudget = recordingBitrates(nominalMaxSeconds);
  const maxSeconds = isVideo ? Math.min(nominalMaxSeconds, videoBudget.fitsSeconds) : nominalMaxSeconds;

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
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
              // 480p24, NOT the kata recorder's 720p30 -- deliberately a
              // different spec for a different job. A testimonial may run
              // ten minutes, twice a kata's cap, so its share of the 50MB
              // ceiling works out at about 0.52 Mbit/s. Spending that on
              // 720p30 gives 0.019 bits per pixel per frame, which is
              // genuinely bad -- blocky on every gesture. The same 0.52
              // Mbit/s at 854x480 and 24fps is 0.053 bits per pixel, ahead
              // of even the kata recording's 0.041, because a person
              // sitting and talking has a fraction of a kata's motion and
              // none of its fine detail to preserve. Fewer, better pixels.
              video: {
                // Not "exact": a laptop webcam reports no facing mode, and
                // an exact constraint fails outright there instead of
                // falling back to the only camera available.
                facingMode: requestedFacing,
                width: { ideal: appliedSpec?.width ?? 854, max: appliedSpec?.width ?? 854 },
                height: { ideal: appliedSpec?.width ?? 854, max: appliedSpec?.width ?? 854 },
                frameRate: { ideal: appliedSpec?.fps ?? 24, max: appliedSpec?.fps ?? 24 },
              },
              audio: audioConstraints,
            }
          : { audio: audioConstraints },
      );
      streamRef.current = stream;
      setFacing(requestedFacing);
      // Attaching the stream to the <video> USED to happen right here, and
      // it could not work: this function runs while the phase is still
      // "idle", and the <video> is only rendered once the phase is "live".
      // videoRef.current was therefore null, the assignment was skipped
      // silently, the render loop never started -- and the canvas (which is
      // what gets recorded) stayed black for the whole take. Flipping the
      // phase is all this does now; the effect below wires the stream up
      // once the element actually exists.
      setPhase("live");
    } catch {
      setError("Could not access your camera/microphone. Check your browser permissions and try again.");
    }
  }

  /** Tap Start -> one short chime -> recording. The AudioContext is still
   * created here, on the tap itself, because that is a real user gesture and
   * iOS Safari silently refuses to play sound from a context that was never
   * unlocked by one. */
  async function beginTake() {
    setError(null);
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext();
      } catch {
        audioContextRef.current = null;
      }
    }
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume().catch(() => {});
    }
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
  /** Connects the camera to the <video>, and the <video> to the canvas
   * render loop, as soon as BOTH exist.
   *
   * Keyed on phase because the <video> mounts with the "live" phase, one
   * render after startLive() has the stream in hand. Doing it here rather
   * than inside startLive() removes the ordering assumption entirely: it no
   * longer matters whether the element or the stream arrives first.
   *
   * Idempotent on purpose — it re-runs on every phase change (live ->
   * recording -> review), and starting a second requestAnimationFrame loop
   * would double the frame rate written into the canvas. */
  useEffect(() => {
    if (!isVideo) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(renderLoop);
    // renderLoop is stable for the life of the component and re-creating
    // this effect on every render would restart the loop constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isVideo]);

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
      // The footer no longer gets height of its own. It used to add a band
      // BELOW the picture, so the bottom of every testimonial was a strip of
      // black with a line of text on it. Now the picture runs all the way to
      // the bottom of the frame and the watermark floats over it -- which is
      // what "see-through" has to mean, since a transparent band over black
      // is still black. The banner keeps its own height: it carries the
      // competition title and has to be readable, not a watermark.
      canvas.height = video.videoHeight + bannerH;
      // These drive the DOM overlay's inset. They were declared and never
      // assigned, so both sat at 0 and the overlay spanned the WHOLE canvas
      // -- which is why the "Testimonial" label rode up over the banner and
      // the record button landed on top of the watermark.
      setBannerRatio(bannerH / canvas.height);
      setFooterRatio(footerH / canvas.height);
    }
    const { bannerH, footerH } = chromeRef.current;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, bannerH, canvas.width, canvas.height - bannerH);
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
    // Null, not just cancelled: the attach effect uses this as its "is a
    // loop already running?" guard, and a stale handle would stop it ever
    // starting a new one.
    rafRef.current = null;
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
      isVideo
        ? {
            mimeType,
            videoBitsPerSecond: appliedSpec?.videoBitsPerSecond ?? videoBudget.videoBitsPerSecond,
            audioBitsPerSecond: appliedSpec?.audioBitsPerSecond ?? videoBudget.audioBitsPerSecond,
          }
        : { mimeType },
    );
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      recordedBlobRef.current = blob;
      setBlobUrl(URL.createObjectURL(blob));
      setPhase("review");
    };
    recorderRef.current = recorder;
    recorder.start();
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

  /** Setting phase back to "live" was NOT enough. Stopping a take ends the
   * camera tracks, and with them the render loop that paints the canvas — so
   * the next screen showed the banner and the framing guide over a frozen
   * black canvas, with no picture and no microphone. That is exactly what
   * "Actual recording" looked like: Practice seemed fine only because it was
   * usually the first take of the session, before anything had been stopped.
   * Re-acquiring the camera is the whole fix, and is what the kata recorder
   * already does between attempts. */
  async function retake() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    recordedBlobRef.current = null;
    setSeconds(0);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chromeRef.current = null;
    setPhase("idle");
    await startLive();
  }

  /** Saves the take straight to the device. Offered on every review screen,
   * not only after a failed upload: a testimonial can run ten minutes, and
   * nobody should be one flaky connection away from losing it. */
  function saveToDevice() {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `testimonial-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extensionForMimeType(blob.type)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Leaves the recorder without submitting: releases the camera and mic
   * (which otherwise stay live behind the collapsed panel) and hands control
   * back to the page underneath. */
  function exitRecorder() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    onExit();
  }

  /** Discards the practice take and moves to the real one. Split out of
   * useThisTake, which now always submits — on request, a practice take that
   * came out well can be submitted directly rather than performed again. */
  async function recordTheActualOne() {
    setTakeType("actual");
    await retake();
  }

  async function useThisTake() {
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
    screenLight !== "off" && isVideo && (phase === "live" || phase === "recording");

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

      {isVideo && (phase === "live" || phase === "recording") && (
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
                {/* The dotted body outline is a framing aid, useful only
                    BEFORE the take starts -- during recording it just sits
                    across the speaker's own face. The "Testimonial" label
                    stays in both, top-left directly under the banner. This
                    wrapper is already inset past the banner and footer
                    bands, so "top" here means under the banner, never over
                    it. */}
                {phase === "live" && <PoseGuideOverlay label="" note={POSE_GUIDE_NOTE} />}

                {/* One stack, top-left, in the order asked for: the word,
                    then the timer with its red dot, then the "keep going"
                    note. All three live INSIDE this inset wrapper, which
                    spans banner-bottom to footer-top, so none of them can
                    ride up over the banner the way the SVG's own label did
                    -- that label sat in the guide's letterboxed coordinate
                    space, not in the picture's. */}
                <div className="pointer-events-none absolute left-2 top-1 flex flex-col items-start gap-1">
                  <span
                    className="text-xs font-semibold text-white"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}
                  >
                    Testimonial
                  </span>
                  {phase === "recording" && (
                    <>
                      <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                        {mmss(seconds)} / {mmss(maxSeconds)}
                      </span>
                      {takeType === "actual" && seconds < minSeconds && (
                        <span className="rounded-full bg-amber-400/95 px-2 py-0.5 text-[10px] font-semibold text-neutral-900">
                          Keep going — {mmss(minSeconds)} needed
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Sits at the BOTTOM of the picture area, so it clears the
                    footer watermark instead of covering it. Inside the inset
                    wrapper is what makes that automatic -- pinned to the
                    outer box it tracked the canvas edge and landed on top of
                    the watermark. */}
                <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-3">
                  {phase === "live" ? (
                    <button
                      type="button"
                      onClick={switchCamera}
                      className="rounded-full border border-white/50 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/70"
                    >
                      {facing === "user" ? "📷 Rear" : "🤳 Front"}
                    </button>
                  ) : (
                    <span className="w-16" />
                  )}
                  <button
                    type="button"
                    onClick={phase === "live" ? () => void beginTake() : stopRecording}
                    aria-label={phase === "live" ? "Start recording" : "Stop recording"}
                    className={
                      "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-white/80 text-xl text-white shadow-lg active:scale-95 " +
                      (phase === "live" ? "bg-red-600/90" : "bg-neutral-800/90")
                    }
                  >
                    {phase === "live" ? "●" : "■"}
                  </button>
                  <span
                    className="w-16 text-center text-[10px] font-semibold text-white/85"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}
                  >
                    {phase === "live" ? "Tap to start" : "Tap to stop"}
                  </span>
                </div>
              </div>
            </div>
          </div>
          {phase === "live" && (
            <p className="mb-3 text-[11px] text-neutral-500">
              Front camera lets you see yourself and read your script. Rear camera is sharper, and is the right
              choice if someone else is filming you.
            </p>
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

      {/* Video's Start/Stop is drawn on the picture itself (above). Voice
          has no picture, so it keeps plain buttons down here. */}
      {phase === "live" && !isVideo && (
        <button
          type="button"
          onClick={() => void beginTake()}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
        >
          ⏺ Start recording
        </button>
      )}

      {phase === "recording" && !isVideo && (
        <div>
          <p className="mb-2 font-mono text-lg font-bold text-red-700">● {mmss(seconds)}</p>
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
            <p className="mb-2 text-xs font-semibold text-red-700">
              Too short — needs at least {mmss(minSeconds)}. Please retake.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void retake()}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              🔁 Retake
            </button>
            {/* Save to device sits beside Submit, not behind a failure: if
                the upload does fall over, the take is already on the phone
                and nothing has been lost. */}
            <button
              type="button"
              onClick={saveToDevice}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              💾 Save to device
            </button>
            {takeType === "practice" && (
              <button
                type="button"
                onClick={() => void recordTheActualOne()}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                ✓ Done practicing — record the actual one
              </button>
            )}
            {/* Submit is offered on a PRACTICE take too, on request: if the
                rehearsal came out well there is no reason to make someone
                perform the whole thing a second time. */}
            <button
              type="button"
              onClick={() => void useThisTake()}
              disabled={tooShort}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
            >
              ✅ Submit this testimonial
            </button>
            <button
              type="button"
              onClick={exitRecorder}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-50"
            >
              ✕ Exit
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
  onExit,
  initialMessage = "",
}: {
  mode: "submit" | "edit";
  registrationId: string;
  onDone: () => void;
  onExit: () => void;
  /** Pre-filled when a winner pressed "Use this script for Message
   * Testimonial" on one of the samples — their own edited text, not the
   * blank template. */
  initialMessage?: string;
}) {
  const [message, setMessage] = useState(initialMessage);
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

  /** A typed testimonial can be several hundred words. Losing it to a
   * mis-tap or a session timeout would be as bad as losing a recording, so
   * it gets the same "keep a copy" escape as the media panels. */
  function saveDraft() {
    const blob = new Blob([message], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `testimonial-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "✅ Submit testimonial"}
        </button>
        <button
          type="button"
          onClick={saveDraft}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          💾 Save to device
        </button>
        <button
          type="button"
          onClick={onExit}
          disabled={pending}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-50 disabled:opacity-60"
        >
          ✕ Exit
        </button>
      </div>
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
  onExit,
}: {
  mode: "submit" | "edit";
  registrationId: string;
  onDone: (kind: TestimonialKind) => void;
  onExit: () => void;
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
          {/* Spelled out BEFORE the picker opens, not after a rejection: on
              a phone the file picker is a full-screen takeover, and finding
              out a 200MB 4K clip is no good only once you are back is the
              worst possible moment to learn it. */}
          <div className="mt-3 rounded-md border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
            <p className="mb-1 font-bold text-neutral-700">What you can upload</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="font-semibold text-neutral-400">Video</dt>
              <dd>MP4, MOV, WEBM, M4V — 3 to 10 minutes long</dd>
              <dt className="font-semibold text-neutral-400">Audio</dt>
              <dd>M4A, MP3, AAC, WAV, WEBM, OGG — up to 15 minutes</dd>
              <dt className="font-semibold text-neutral-400">Max size</dt>
              <dd>
                <strong>{MAX_TESTIMONIAL_MB} MB</strong> for either
              </dd>
            </dl>
            <p className="mt-2 leading-relaxed text-neutral-500">
              Bigger than that? It was almost certainly recorded at 4K or 60fps, which a talking-head testimonial
              never needs. Re-save it at <strong>1080p or 720p, 30fps</strong> and it will come back well under the
              limit with nothing lost.
            </p>
          </div>
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
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "✅ Submit this testimonial"}
            </button>
            <button
              type="button"
              onClick={onExit}
              disabled={uploading}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-50 disabled:opacity-60"
            >
              ✕ Exit
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
  appliedSpec = null,
}: {
  /** Organizer-applied video settings for testimonials, from
   * /admin/storage. Null — the state until somebody deliberately applies
   * one — means use the code's own settings. */
  appliedSpec?: AppliedSpec | null;
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
  /** Carried across from a sample script when the winner presses "Use this
   * script for Message Testimonial", so the typing panel opens already
   * holding the version they filled in rather than an empty box. */
  const [seededMessage, setSeededMessage] = useState("");

  /** Leave whichever panel is open and go back to the chooser — the page
   * this recorder was embedded in is then exactly as it was. */
  function backToChooser() {
    setChosen(null);
  }

  function useScriptForMessage(text: string) {
    setSeededMessage(text);
    setChosen("message");
  }

  function handleDone(kind: TestimonialKind) {
    // Close the recorder/typing panel FIRST, then refresh. Leaving the panel
    // open behind the confirmation meant the camera stayed live and the
    // winner had to find their own way out of a screen whose work was
    // already finished.
    setChosen(null);
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
          <ScriptPicker onUseForMessage={useScriptForMessage} />
          <MediaTestimonialPanel kind="video" mode={mode} registrationId={registrationId} onDone={() => handleDone("video")} onExit={() => setChosen(null)} recordingAppearance={recordingAppearance} recordingLogoUrl={recordingLogoUrl} appliedSpec={appliedSpec} />
        </div>
      )}
      {chosen === "voice" && (
        <div className="mt-3">
          <ScriptPicker onUseForMessage={useScriptForMessage} />
          <MediaTestimonialPanel kind="voice" mode={mode} registrationId={registrationId} onDone={() => handleDone("voice")} onExit={() => setChosen(null)} recordingAppearance={recordingAppearance} recordingLogoUrl={recordingLogoUrl} appliedSpec={appliedSpec} />
        </div>
      )}
      {chosen === "message" && (
        <div className="mt-3">
          <ScriptPicker onUseForMessage={useScriptForMessage} />
          <MessageTestimonialPanel
            mode={mode}
            registrationId={registrationId}
            onDone={() => handleDone("message")}
            onExit={backToChooser}
            /* Remounts when a different script is chosen, so the textarea
               actually picks up the new seed instead of keeping the first
               one it was initialised with. */
            key={seededMessage.slice(0, 40)}
            initialMessage={seededMessage}
          />
        </div>
      )}
      {chosen === "upload" && (
        <UploadTestimonialPanel
          mode={mode}
          registrationId={registrationId}
          onDone={handleDone}
          onExit={backToChooser}
        />
      )}
    </div>
  );
}
