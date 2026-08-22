"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

/** Fixed comparison rows. Includes both current settings so the table reads
 * as "here is where we are, and here is what everything else would cost",
 * and deliberately includes the high-resolution options the organizer asked
 * about so their detail-per-pixel can be seen rather than argued about. */
const REFERENCE_ROWS: Array<{ res: string; fps: number; mbps: number; note?: string }> = [
  { res: "720p", fps: 30, mbps: 1, note: undefined },
  { res: "720p", fps: 30, mbps: 1.134, note: "kata now" },
  { res: "720p", fps: 30, mbps: 1.5 },
  { res: "720p", fps: 60, mbps: 1 },
  { res: "1080p", fps: 30, mbps: 1 },
  { res: "1080p", fps: 30, mbps: 1.5 },
  { res: "1080p", fps: 30, mbps: 2 },
  { res: "1080p", fps: 60, mbps: 3 },
  { res: "4K", fps: 30, mbps: 1 },
  { res: "4K", fps: 30, mbps: 4 },
  { res: "8K", fps: 30, mbps: 1 },
  { res: "8K", fps: 30, mbps: 1.5 },
  { res: "8K", fps: 60, mbps: 1.5 },
  { res: "480p", fps: 24, mbps: 0.52, note: "testimonial now" },
];

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
      <div className="mt-3 rounded-md border-2 border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-bold text-amber-900">⚠ Change these only BEFORE a competition opens</p>
        <div className="mt-1 space-y-1.5 text-xs leading-relaxed text-amber-900">
          <p>
            Saving a spec only records it. It becomes live when you press <strong>Apply to live recording</strong>,
            and from that moment every new take is made at the new setting. Takes already submitted keep whatever
            they were recorded at — nothing is re-encoded.
          </p>
          <p>
            <strong>That is the problem with changing it mid-competition.</strong> Competitors in the same category
            would be judged on recordings of visibly different quality depending on when they happened to submit,
            which is not a fair comparison and is very hard to defend if anyone questions a placing.
          </p>
          <p>
            If a change genuinely cannot wait, it needs an announcement to everyone affected — participants who
            already submitted, those who have not, and the judges — stating what changed, when, and that earlier
            takes were made under the previous setting. For a tier already being judged, the safer course is to
            leave it alone until that tier closes.
          </p>
        </div>
      </div>
      <p className="mt-2 max-w-3xl text-[11px] text-neutral-500">
        Everything right of the three inputs is calculated live from them, so you can try a setting before saving.
        Editing a spec always drops it back to <em>not applied</em>, so a figure can never go live just by being
        typed.
      </p>

      <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-neutral-500">
        Reference — what each combination costs
      </h3>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-1.5">Res</th>
              <th className="px-2 py-1.5">FPS</th>
              <th className="px-2 py-1.5">Mbit/s</th>
              {ESTIMATE_MINUTES.map((mm) => (
                <th key={mm} className="px-2 py-1.5 text-right">
                  {minuteLabel(mm)}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">Longest</th>
              <th className="px-2 py-1.5 text-right">Detail/px</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {REFERENCE_ROWS.map((r) => {
              const met = computeMetrics({ resolution: r.res, fps: r.fps, videoKbps: r.mbps * 1000, audioKbps: 96 });
              const ref = referenceBpp();
              return (
                <tr key={`${r.res}-${r.fps}-${r.mbps}`} className={r.note ? "bg-amber-50" : ""}>
                  <td className="px-3 py-1.5 font-semibold text-neutral-800">{r.res}</td>
                  <td className="px-2 py-1.5 text-neutral-600">{r.fps}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-neutral-700">
                    {r.mbps.toFixed(r.mbps < 1 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "")}
                    {r.note && <span className="ml-1 text-[10px] font-semibold text-amber-800">({r.note})</span>}
                  </td>
                  {met.sizes.map((bytes, i) => (
                    <td
                      key={i}
                      className={
                        "px-2 py-1.5 text-right tabular-nums " +
                        (met.overCeilingAt[i] ? "font-bold text-red-700" : "text-neutral-700")
                      }
                    >
                      {(bytes / 1024 / 1024).toFixed(1)}
                      {met.overCeilingAt[i] ? " ✗" : ""}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right tabular-nums text-neutral-800">{mmss(met.longestSeconds)}</td>
                  <td
                    className={
                      "px-2 py-1.5 text-right tabular-nums " +
                      (met.bpp == null
                        ? "text-neutral-400"
                        : met.bpp >= ref
                          ? "font-semibold text-green-700"
                          : met.bpp >= ref * 0.6
                            ? "text-amber-700"
                            : "font-semibold text-red-700")
                    }
                  >
                    {met.bpp == null ? "—" : met.bpp.toFixed(4)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 max-w-3xl text-[11px] text-neutral-500">
        Sizes in MB, red ✗ means that length would be refused by the {Math.round(UPLOAD_CEILING_BYTES / 1024 / 1024)}MB
        upload ceiling. Detail/px is judged against the kata recording&apos;s own current density — note that{" "}
        <strong>4K at 4 Mbit/s scores below it</strong>: four times the bitrate spread over nine times the pixels is
        a downgrade, not an upgrade.
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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

  /** AWAITS the write before closing the editor and refreshing. The first
   * version fired the action and closed immediately, so the row snapped back
   * to read-only still showing the old numbers — which looked exactly like
   * the Edit button doing nothing. */
  async function submit(mode: "save" | "reset" | "apply" | "unapply") {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", spec.id);
    fd.set("mode", mode);
    if (mode === "save") {
      fd.set("resolution", resolution);
      fd.set("fps", String(fps));
      fd.set("video_mbps", String(videoMbps));
      fd.set("audio_kbps", String(spec.audioKbps));
    }
    const result = await saveRecordingSpec(fd);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
        <p className="text-sm font-bold text-neutral-800">
          {SPEC_LABEL[spec.id as SpecId]}
          {spec.applied ? (
            <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">
              ● LIVE — recorders use this
            </span>
          ) : (
            <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
              not applied — recorders use the code
            </span>
          )}
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
                  onClick={() => void submit("save")}
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
              onClick={() => void submit("reset")}
              title="Restore whatever the app's code currently does"
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-white disabled:opacity-40"
            >
              Use default
            </button>
            {/* The one control that changes real recordings. Kept visually
                separate from Save for that reason: saving is free, applying
                is not. */}
            <button
              type="button"
              disabled={pending || editing || isVoice}
              onClick={() => void submit(spec.applied ? "unapply" : "apply")}
              title={
                isVoice
                  ? "Voice testimonials have no video settings to apply"
                  : spec.applied
                    ? "Stop using this spec — recorders go back to the code default"
                    : "Every NEW take will be recorded at this setting from now on"
              }
              className={
                "rounded px-2.5 py-1 text-xs font-semibold disabled:opacity-40 " +
                (spec.applied
                  ? "border border-red-300 text-red-700 hover:bg-red-50"
                  : "bg-red-700 text-white hover:bg-red-600")
              }
            >
              {spec.applied ? "Stop using this" : "Apply to live recording"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">{error}</p>
      )}
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
