import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { SetupNotice } from "@/components/ui";
import { UPLOAD_CEILING_BYTES, KATA_MAX_SECONDS, recordingBitrates } from "@/lib/media-recording";
import {
  getStorageUsage,
  effectiveFileLimit,
  formatBytes,
  PLAN_QUOTAS,
} from "@/lib/storage-usage";

export const dynamic = "force-dynamic";

const STAFF_ROLES = ["admin", "organizer", "staff"];

/** What one recording of each kind costs, straight from the same helper the
 * recorders use — so this page can never quote a figure the app has since
 * moved away from. */
function perRecordingEstimates() {
  const kata = recordingBitrates(KATA_MAX_SECONDS);
  const testimonial = recordingBitrates(10 * 60);
  const bytesFor = (b: { videoBitsPerSecond: number; audioBitsPerSecond: number }, seconds: number) =>
    ((b.videoBitsPerSecond + b.audioBitsPerSecond) * seconds) / 8;
  return [
    { label: "Kata recording, typical (2:00)", bytes: bytesFor(kata, 120) },
    { label: `Kata recording, full length (${KATA_MAX_SECONDS / 60}:00)`, bytes: bytesFor(kata, KATA_MAX_SECONDS) },
    { label: "Video testimonial, minimum (3:00)", bytes: bytesFor(testimonial, 180) },
    { label: "Video testimonial, full length (10:00)", bytes: bytesFor(testimonial, 600) },
  ];
}

function Bar({ used, total, tone }: { used: number; total: number; tone: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function AdminStorage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Storage" active="/admin/storage">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role, approved").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const canView = Boolean(myProfile?.approved) && STAFF_ROLES.includes((myProfile?.role as string) ?? "");
  if (!canView) {
    return (
      <AdminShell title="Storage" active="/admin/storage">
        <p className="text-sm text-neutral-500">You don&apos;t have access to this page.</p>
      </AdminShell>
    );
  }

  const usage = await getStorageUsage();
  const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace("https://", "").split(".")[0];
  const estimates = perRecordingEstimates();

  return (
    <AdminShell title="Storage" active="/admin/storage">
      <p className="mb-4 max-w-3xl text-sm text-neutral-600">
        Live figures for this environment&apos;s Supabase project
        {projectRef ? (
          <>
            {" "}
            (<code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">{projectRef}</code>)
          </>
        ) : null}
        . Counted by listing every object in every bucket — Storage has no total-size endpoint — so these are
        actual stored bytes, not an estimate.
      </p>

      {usage.errors.length > 0 && (
        <div className="mb-4 rounded-md border-2 border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-900">Totals below are incomplete</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
            {usage.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Headline ---- */}
      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Total stored</h2>
          <p className="text-2xl font-black text-neutral-900">{formatBytes(usage.totalBytes)}</p>
        </div>
        <p className="mb-3 text-xs text-neutral-500">
          across {usage.totalFiles.toLocaleString()} files in {usage.buckets.length} buckets
        </p>
        <div className="space-y-3">
          {PLAN_QUOTAS.map((q) => {
            const pct = (usage.totalBytes / q.bytes) * 100;
            const tone = pct >= 90 ? "bg-red-600" : pct >= 70 ? "bg-amber-500" : "bg-green-600";
            return (
              <div key={q.plan}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-neutral-700">
                    If this project is on the <strong>{q.plan}</strong> plan ({formatBytes(q.bytes)} included)
                  </span>
                  <span className={pct >= 90 ? "font-bold text-red-700" : "text-neutral-500"}>
                    {pct.toFixed(1)}% used · {formatBytes(Math.max(0, q.bytes - usage.totalBytes))} left
                  </span>
                </div>
                <Bar used={usage.totalBytes} total={q.bytes} tone={tone} />
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-neutral-400">
          Supabase does not expose the current plan through the normal API key, so both rows are shown — read the
          one that matches this project&apos;s billing. Storage is only one line on the bill; egress (every time a
          judge plays a recording back) is metered separately.
        </p>
      </section>

      {/* ---- Per bucket ---- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">By bucket</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">Bucket</th>
                <th className="px-3 py-2 text-right">Files</th>
                <th className="px-3 py-2 text-right">Stored</th>
                <th className="px-3 py-2 text-right">Share</th>
                <th className="px-3 py-2">Visibility</th>
                <th className="px-3 py-2">Max per file</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {usage.buckets.map((b) => {
                const share = usage.totalBytes > 0 ? (b.bytes / usage.totalBytes) * 100 : 0;
                const eff = effectiveFileLimit(b);
                const capped = b.fileSizeLimit != null && b.fileSizeLimit > UPLOAD_CEILING_BYTES;
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-semibold text-neutral-800">{b.id}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{b.files.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">
                      {formatBytes(b.bytes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{share.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-xs">
                      {b.isPublic ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">Public</span>
                      ) : (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-600">Private</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600">
                      {formatBytes(eff)}
                      {capped && (
                        <span className="ml-1 text-neutral-400" title="This bucket's own setting is larger, but the project-wide ceiling wins">
                          (bucket says {formatBytes(b.fileSizeLimit as number)})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 max-w-3xl text-[11px] text-neutral-500">
          <strong>Max per file</strong> is the smaller of the bucket&apos;s own setting and the project-wide upload
          ceiling of {formatBytes(UPLOAD_CEILING_BYTES)}. Where a bucket advertises more, the project ceiling still
          wins — that mismatch is what produced &quot;object exceeded the maximum allowed size&quot; on uploads that
          looked well within the bucket&apos;s stated limit.
        </p>
      </section>

      {/* ---- What one recording costs ---- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">What one recording costs</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-neutral-100">
              {estimates.map((e) => (
                <tr key={e.label}>
                  <td className="px-3 py-2 text-neutral-700">{e.label}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">
                    {formatBytes(e.bytes)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-neutral-500">
                    {Math.floor((1024 ** 3) / e.bytes).toLocaleString()} per GB
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 max-w-3xl text-[11px] text-neutral-500">
          Read straight from the recorders&apos; own bitrate settings, so these move automatically if the recording
          quality is ever changed.
        </p>
      </section>

      {/* ---- Largest objects ---- */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">20 largest files</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">Bucket</th>
                <th className="px-3 py-2">Path</th>
                <th className="px-3 py-2 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {usage.largest.map((o) => (
                <tr key={`${o.bucket}/${o.path}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs font-semibold text-neutral-700">{o.bucket}</td>
                  <td className="px-3 py-2 break-all font-mono text-[11px] text-neutral-500">{o.path}</td>
                  <td
                    className={
                      "px-3 py-2 text-right font-semibold tabular-nums " +
                      (o.bytes > UPLOAD_CEILING_BYTES ? "text-red-700" : "text-neutral-900")
                    }
                  >
                    {formatBytes(o.bytes)}
                  </td>
                </tr>
              ))}
              {usage.largest.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-sm text-neutral-400">
                    Nothing stored yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 max-w-3xl text-[11px] text-neutral-500">
          Anything in red is larger than the current upload ceiling — it predates the ceiling or the current
          recording settings, and is the first place to look when freeing space.
        </p>
      </section>
    </AdminShell>
  );
}
