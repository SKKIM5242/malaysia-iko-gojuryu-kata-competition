"use client";

import { useState, useTransition } from "react";
import { saveRecordingSpec } from "@/app/actions/admin";
import {
  BITRATE_CHOICES_MBPS,
  ESTIMATE_MINUTES,
  FPS_CHOICES,
  RESOLUTION_CHOICES,
  SPEC_LABEL,
  codeDefault,
  computeMetrics,
  referenceBpp,
  type RecordingSpec,
  type SpecId,
} from "@/lib/recording-specs";
import { UPLOAD_CEILING_BYTES } from "@/lib/media-recording";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function minuteLabel(m: number): string {
  return Number.isInteger(m) ? `${m}:00` : `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, "0")}`;
}

/**
 * The recording specification table on /admin/storage.
 *
 * Every figure to the right of the three inputs is DERIVED — change the
 * resolution, frame rate or bitrate and the sizes, the longest take that
 * fits, and the detail-per-pixel all move with it, before anything is
 * saved. That is the whole point: it answers "what would 1080p at 2 Mbit/s
 * actually cost us?" without anyone having to work it out by hand.
 *
 * Saving records the choice; it does NOT change how recordings are made.
 * See saveRecordingSpec for why the two are kept apart.
 */
export default function RecordingSpecTable({
  specs,
  returnTo,
  canEdit,
}: {
  specs: RecordingSpec[];
  returnTo: string;
  canEdit: boolean;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">
        Recording specifications
      </h2>
      <div className="space-y-3">
        {specs.map((spec) => (
          <SpecRow key={spec.id} spec={spec} returnTo={returnTo} canEdit={canEdit} />
        ))}
      </div>
      <p className="mt-2 max-w-3xl text-[11px] text-neutral-500">
        Everything right of the three inputs is calculated live from them, so you can try a setting before saving
        it. <strong>Saving records the choice but does not change how recordings are made</strong> — the recorders
        still read their settings from the code. Wiring a saved spec through to live recording is a separate,
        deliberate step, because it changes the quality of takes competitors have already been told to make.
      </p>
    </section>
  );
}

function SpecRow({ spec, returnTo, canEdit }: { spec: RecordingSpec; returnTo: string; canEdit: boolean }) {
  const isVoice = spec.id === "testimonial_voice";
  const [editing, setEditing] = useState(false);
  const [resolution, setResolution] = useState(spec.resolution);
  const [fps, setFps] = useState(spec.fps);
  const [videoMbps, setVideoMbps] = useState(spec.videoKbps / 1000);
  const [pending, startTransition] = useTransition();

  const live = editing
    ? { resolution, fps, videoKbps: Math.round(videoMbps * 1000), audioKbps: spec.audioKbps }
    : { resolution: spec.resolution, fps: spec.fps, videoKbps: spec.videoKbps, audioKbps: spec.audioKbps };
  const m = computeMetrics(live);
  const ref = referenceBpp();
  const def = codeDefault(spec.id as SpecId);
  const isDefault =
    spec.resolution === def.resolution && spec.fps === def.fps && spec.videoKbps === def.videoKbps;

  function cancel() {
    setResolution(spec.resolution);
    setFps(spec.fps);
    setVideoMbps(spec.videoKbps / 1000);
    setEditing(false);
  }

  function submit(reset: boolean) {
    const fd = new FormData();
    fd.set("id", spec.id);
    fd.set("return_to", returnTo);
    if (reset) fd.set("reset", "1");
    else {
      fd.set("resolution", resolution);
      fd.set("fps", String(fps));
      fd.set("video_mbps", String(videoMbps));
      fd.set("audio_kbps", String(spec.audioKbps));
    }
    startTransition(() => {
      saveRecordingSpec(fd);
      setEditing(false);
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
        <p className="text-sm font-bold text-neutral-800">
          {SPEC_LABEL[spec.id as SpecId]}
          {!isDefault && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              changed from default
            </span>
          )}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-white"
              >
                Edit
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit(false)}
                  className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={cancel}
                  className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-white disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="button"
              disabled={pending || isDefault}
              onClick={() => submit(true)}
              title="Restore whatever the app's code currently does"
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-white disabled:opacity-40"
            >
              Use default
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="border-b border-neutral-200 text-[10px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-1.5">Resolution</th>
              <th className="px-3 py-1.5">FPS</th>
              <th className="px-3 py-1.5">Video bitrate</th>
              {ESTIMATE_MINUTES.map((mm) => (
                <th key={mm} className="px-2 py-1.5 text-right">
                  {minuteLabel(mm)}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">Longest under {Math.round(UPLOAD_CEILING_BYTES / 1024 / 1024)}MB</th>
              <th className="px-2 py-1.5 text-right">Detail / pixel</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-2">
                {isVoice ? (
                  <span className="text-neutral-400">audio only</span>
                ) : editing ? (
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-sm"
                  >
                    {RESOLUTION_CHOICES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-semibold text-neutral-800">{spec.resolution}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {isVoice ? (
                  <span className="text-neutral-400">—</span>
                ) : editing ? (
                  <select
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-sm"
                  >
                    {FPS_CHOICES.map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-neutral-700">{spec.fps} fps</span>
                )}
              </td>
              <td className="px-3 py-2">
                {isVoice ? (
                  <span className="text-neutral-400">{spec.audioKbps} kbps audio</span>
                ) : editing ? (
                  <select
                    value={videoMbps}
                    onChange={(e) => setVideoMbps(Number(e.target.value))}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-sm"
                  >
                    {BITRATE_CHOICES_MBPS.map((b) => (
                      <option key={b} value={b}>
                        {b.toFixed(2)} Mbit/s
                      </option>
                    ))}
                    {!BITRATE_CHOICES_MBPS.includes(videoMbps as (typeof BITRATE_CHOICES_MBPS)[number]) && (
                      // The live figure is often between two choices (1.134
                      // today). Keeping it in the list means opening Edit
                      // never silently rounds the current setting away.
                      <option value={videoMbps}>{videoMbps.toFixed(3)} Mbit/s (current)</option>
                    )}
                  </select>
                ) : (
                  <span className="text-neutral-700">{(spec.videoKbps / 1000).toFixed(2)} Mbit/s</span>
                )}
              </td>
              {m.sizes.map((bytes, i) => (
                <td
                  key={i}
                  className={
                    "px-2 py-2 text-right tabular-nums " +
                    (m.overCeilingAt[i] ? "font-bold text-red-700" : "text-neutral-800")
                  }
                  title={m.overCeilingAt[i] ? "Over the upload ceiling — this length could not be submitted" : undefined}
                >
                  {mb(bytes)}
                  {m.overCeilingAt[i] ? " ✗" : ""}
                </td>
              ))}
              <td className="px-2 py-2 text-right font-semibold tabular-nums text-neutral-900">
                {mmss(m.longestSeconds)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {m.bpp == null ? (
                  <span className="text-neutral-400">—</span>
                ) : (
                  <span
                    className={
                      m.bpp >= ref ? "font-semibold text-green-700" : m.bpp >= ref * 0.6 ? "text-amber-700" : "font-semibold text-red-700"
                    }
                    title={`Kata recording today is ${ref.toFixed(4)} bits/pixel/frame — the yardstick`}
                  >
                    {m.bpp.toFixed(4)}
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
