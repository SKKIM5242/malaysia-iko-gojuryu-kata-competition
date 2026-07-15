"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRecordAttempt, submitKataVideo } from "@/app/actions/account";

const MAX_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 3;

type Phase = "idle" | "live" | "recording" | "review" | "uploading" | "done";

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
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
  ctx.font = `bold ${Math.max(12, Math.round(topH * 0.32))}px Georgia, serif`;
  ctx.fillText("MALAYSIA OPEN — ONLINE KATA COMPETITION", w / 2, topH * 0.48);
  ctx.font = `${Math.max(9, Math.round(topH * 0.2))}px Arial, sans-serif`;
  ctx.fillText("Organized by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD", w / 2, topH * 0.82);
  ctx.shadowBlur = 0;

  // Light watermark, bottom of frame
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.font = `${Math.max(9, Math.round(w * 0.018))}px Arial, sans-serif`;
  ctx.fillText(watermark, w / 2, h - 10);
  ctx.restore();
}

export default function KataRecorder({
  initialAttempts,
  watermark,
}: {
  initialAttempts: number;
  watermark: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempts, setAttempts] = useState(initialAttempts);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);

  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);
  const canReRecord = attemptsLeft > 0;

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("live");
      requestAnimationFrame(renderLoop);
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

  function startRecording() {
    const canvas = canvasRef.current;
    const camStream = streamRef.current;
    if (!canvas || !camStream) return;
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
  }

  function stopRecording() {
    recorderRef.current?.stop();
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
      const path = `${user.id}/${crypto.randomUUID()}.webm`;
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

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        You have <strong>{attemptsLeft}</strong> of {MAX_ATTEMPTS} delete-and-re-record chances left.
        Recording is limited to <strong>5 minutes</strong>. No file upload or editing is allowed — only
        this in-app camera recorder.
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <strong>Camera placement:</strong> prop your phone up (against a wall, on a chair, or a
        tripod) about <strong>12 feet (≈3.6 m)</strong> away from your starting point, at roughly
        chest height, in the same direction you will be performing your kata. Leave enough space
        in frame for the full routine — you should be able to see your whole body move throughout.
        Tap <strong>Start</strong>, walk into position, perform your kata, then walk back and tap{" "}
        <strong>Stop</strong> when you are finished.
      </div>

      <div className="relative mx-auto max-w-md overflow-hidden rounded-lg border border-neutral-300 bg-black">
        <video ref={videoRef} playsInline muted className="hidden" />
        <canvas ref={canvasRef} className={phase === "idle" ? "hidden" : "block w-full"} />
        {phase === "idle" && (
          <div className="flex aspect-[3/4] items-center justify-center p-8 text-center text-neutral-300">
            Camera preview appears here once started.
          </div>
        )}
        {phase === "recording" && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-sm font-semibold text-white">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> REC {mm}:{ss} / 05:00
          </div>
        )}
      </div>

      {phase === "review" && blobUrl && (
        <div className="mx-auto max-w-md">
          <video src={blobUrl} controls playsInline className="w-full rounded-lg border border-neutral-300" />
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {phase === "idle" && (
          <button
            onClick={startCamera}
            className="w-full max-w-md rounded-lg bg-red-700 px-6 py-4 text-lg font-bold text-white hover:bg-red-600 sm:w-auto"
          >
            Enable camera
          </button>
        )}
        {phase === "live" && (
          <button
            onClick={startRecording}
            className="w-full max-w-md rounded-lg bg-red-700 px-6 py-4 text-lg font-bold text-white hover:bg-red-600 sm:w-auto"
          >
            ● Start
          </button>
        )}
        {phase === "recording" && (
          <button
            onClick={stopRecording}
            className="w-full max-w-md rounded-lg bg-neutral-900 px-6 py-4 text-lg font-bold text-white hover:bg-neutral-700 sm:w-auto"
          >
            ■ Stop
          </button>
        )}
        {phase === "review" && (
          <>
            <button
              onClick={handleReRecord}
              disabled={!canReRecord}
              className="rounded-md border border-neutral-300 bg-white px-5 py-2.5 font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete &amp; re-record ({attemptsLeft} left)
            </button>
            <button onClick={handleSubmit} className="rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white hover:bg-red-600">
              Submit this recording
            </button>
          </>
        )}
        {phase === "uploading" && (
          <button disabled className="rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white opacity-70">
            Submitting…
          </button>
        )}
      </div>
    </div>
  );
}
