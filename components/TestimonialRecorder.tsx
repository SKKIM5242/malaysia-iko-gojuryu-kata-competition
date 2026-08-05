"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitTestimonial } from "@/app/actions/account";
import { pickVideoMimeType, pickAudioMimeType, extensionForMimeType } from "@/lib/media-recording";
import {
  TESTIMONIAL_KIND_LABEL,
  TESTIMONIAL_MIN_VIDEO_SECONDS,
  TESTIMONIAL_MAX_VIDEO_SECONDS,
  type TestimonialKind,
} from "@/lib/testimonials";
import { SCRIPT_LENGTH_LABEL, scriptsForBand, type ScriptLengthBand } from "@/lib/testimonial-scripts";

type Phase = "idle" | "live" | "recording" | "review" | "uploading";

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Sample scripts to read from during a practice take — cue cards, not
 * word-for-word text (see lib/testimonial-scripts.ts for why). Video only:
 * voice/message testimonials have no length target to practice against. */
function ScriptPicker() {
  const [band, setBand] = useState<ScriptLengthBand | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const bands: ScriptLengthBand[] = ["3min", "5min", "10min"];

  return (
    <div className="mb-3 rounded-md border border-neutral-200 bg-white p-3">
      <p className="text-xs font-semibold text-neutral-600">📝 Sample scripts to practice with — pick a length:</p>
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
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
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
              {openId === script.id && (
                <ol className="list-decimal space-y-1 px-6 pb-2 text-xs text-neutral-600">
                  {script.prompts.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ol>
              )}
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
function MediaTestimonialPanel({ kind, onDone }: { kind: "video" | "voice"; onDone: () => void }) {
  const [takeType, setTakeType] = useState<"practice" | "actual">("practice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFileUpload, setIsFileUpload] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isVideo = kind === "video";
  const minSeconds = isVideo ? TESTIMONIAL_MIN_VIDEO_SECONDS : 0;
  const maxSeconds = isVideo ? TESTIMONIAL_MAX_VIDEO_SECONDS : 10 * 60;

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl],
  );

  async function startLive() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(isVideo ? { video: true, audio: true } : { audio: true });
      streamRef.current = stream;
      if (isVideo && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("live");
    } catch {
      setError("Could not access your camera/microphone. Check your browser permissions and try again.");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = isVideo ? pickVideoMimeType() : pickAudioMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
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

  function retake() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    recordedBlobRef.current = null;
    setIsFileUpload(false);
    // A file-picked take has no live camera stream to fall back to —
    // send those back to "idle" so they can pick a file or turn the
    // camera on again, instead of showing a dead live-preview phase.
    setPhase(streamRef.current ? "live" : "idle");
  }

  function handleFilePicked(file: File) {
    setError(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    recordedBlobRef.current = file;
    setBlobUrl(URL.createObjectURL(file));
    setIsFileUpload(true);
    setSeconds(0);
    setPhase("review");
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
        .upload(path, blob, { contentType: blob.type || (isVideo ? "video/webm" : "audio/webm") });
      if (upErr) {
        setError("Upload failed — please check your connection and try again.");
        setPhase("review");
        return;
      }
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("path", path);
      const result = await submitTestimonial({ ok: false }, fd);
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

  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={startLive} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700">
            {isVideo ? "📷 Record now" : "🎙️ Turn on microphone"}
          </button>
          {isVideo && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                📁 Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFilePicked(file);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      )}

      {isVideo && (phase === "live" || phase === "recording") && (
        <video ref={videoRef} muted playsInline className="mb-3 w-full max-w-md rounded-md bg-black" />
      )}

      {phase === "live" && (
        <button type="button" onClick={startRecording} className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
          ⏺ Start recording
        </button>
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
            <video
              src={blobUrl}
              controls
              playsInline
              onLoadedMetadata={(e) => {
                // Only a file picked from disk needs its length read this
                // way — a live recording's `seconds` already comes from
                // the interval timer, which is reliable; a freshly
                // recorded webm blob's `.duration` metadata often isn't.
                if (isFileUpload) setSeconds(Math.round(e.currentTarget.duration) || 0);
              }}
              className="mb-3 w-full max-w-md rounded-md bg-black"
            />
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
  );
}

function MessageTestimonialPanel({ onDone }: { onDone: () => void }) {
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
    const result = await submitTestimonial({ ok: false }, fd);
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

/** The 3-button chooser a Top-3 winner sees on /account until they've
 * submitted one testimonial — see WinnerTestimonialSection.tsx for the
 * gate note text and the "already submitted" replay shown afterward. */
export default function TestimonialRecorder() {
  const router = useRouter();
  const [chosen, setChosen] = useState<TestimonialKind | null>(null);
  const [done, setDone] = useState(false);

  function handleDone() {
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <p className="mt-3 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
        ✅ Thank you — your testimonial has been submitted. Your certificate download is now unlocked.
        {chosen === "video" && " Since you recorded video, it also plays back automatically as your voice testimonial."}
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TESTIMONIAL_KIND_LABEL) as TestimonialKind[]).map((k) => (
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
      </div>
      {chosen === "video" && (
        <div className="mt-3">
          <ScriptPicker />
          <MediaTestimonialPanel kind="video" onDone={handleDone} />
        </div>
      )}
      {chosen === "voice" && <MediaTestimonialPanel kind="voice" onDone={handleDone} />}
      {chosen === "message" && <MessageTestimonialPanel onDone={handleDone} />}
    </div>
  );
}
