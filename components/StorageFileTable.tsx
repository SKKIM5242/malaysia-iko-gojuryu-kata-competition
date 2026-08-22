"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteStorageObject } from "@/app/actions/admin";
import { formatBytes, type StorageObject } from "@/lib/storage-usage";

const PAGE = 100;

function fileHref(o: StorageObject, download: boolean): string {
  const q = new URLSearchParams({ bucket: o.bucket, path: o.path });
  if (download) q.set("download", "1");
  return `/api/storage/file?${q.toString()}`;
}

/**
 * Every stored file, newest-largest first, with the person it belongs to and
 * what it is.
 *
 * Replaces the old "20 largest" sample. That was useful for spotting what
 * was eating space and useless for everything else — finding one
 * competitor's recording, checking what an orphan actually is, removing a
 * bad file. Search covers the participant name, the kind, the bucket and the
 * path at once, so any of those is a way in.
 *
 * View and Download go through /api/storage/file rather than pre-signed
 * URLs baked into the page: a listing of a few thousand recordings would
 * otherwise sign a few thousand URLs on every render, nearly all unused, and
 * every one of them would be a live link to an unreleased recording sitting
 * in the HTML.
 */
export default function StorageFileTable({
  files,
  canDelete,
}: {
  files: StorageObject[];
  /** Admin/Organizer. The server re-checks, and additionally refuses any
   * file a live database row still points at. */
  canDelete: boolean;
}) {
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const buckets = useMemo(() => [...new Set(files.map((f) => f.bucket))].sort(), [files]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (bucket && f.bucket !== bucket) return false;
      if (!q) return true;
      return (
        f.path.toLowerCase().includes(q) ||
        f.kind.toLowerCase().includes(q) ||
        f.bucket.toLowerCase().includes(q) ||
        (f.participantName ?? "").toLowerCase().includes(q)
      );
    });
  }, [files, query, bucket]);

  async function remove(o: StorageObject) {
    setBusy(o.bucket + "/" + o.path);
    setError(null);
    const fd = new FormData();
    fd.set("bucket", o.bucket);
    fd.set("path", o.path);
    const result = await deleteStorageObject(fd);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "Could not delete.");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">
          All files{" "}
          <span className="font-normal normal-case text-neutral-400">
            ({filtered.length.toLocaleString()}
            {filtered.length !== files.length ? ` of ${files.length.toLocaleString()}` : ""})
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={bucket}
            onChange={(e) => {
              setBucket(e.target.value);
              setShown(PAGE);
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-700"
          >
            <option value="">All buckets</option>
            {buckets.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Search name, type, path…"
            className="w-56 rounded-md border border-neutral-300 px-2 py-1 text-xs"
          />
        </div>
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Participant</th>
              <th className="px-3 py-2">Recording type</th>
              <th className="px-3 py-2">Bucket</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2 text-right">Size</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.slice(0, shown).map((o) => {
              const key = o.bucket + "/" + o.path;
              return (
                <tr key={key} className={busy === key ? "opacity-50" : ""}>
                  <td className="px-3 py-2 font-semibold text-neutral-800">
                    {o.participantName ?? <span className="font-normal text-neutral-300">— unclaimed</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-600">{o.kind}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-500">{o.bucket}</td>
                  <td className="px-3 py-2 break-all font-mono text-[11px] text-neutral-400">{o.path}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">
                    {formatBytes(o.bytes)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <a
                        href={fileHref(o, false)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                      >
                        👁 View
                      </a>
                      <a
                        href={fileHref(o, true)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                      >
                        ⬇ Download
                      </a>
                      {canDelete && (
                        <button
                          type="button"
                          disabled={busy === key}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Permanently delete this file?\n\n${o.bucket}/${o.path}\n${o.kind}` +
                                  (o.participantName ? ` — ${o.participantName}` : "") +
                                  `\n\nThis cannot be undone.`,
                              )
                            ) {
                              void remove(o);
                            }
                          }}
                          className="rounded border border-red-300 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
                        >
                          🗑 Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-neutral-400">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {shown < filtered.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          Show {Math.min(PAGE, filtered.length - shown)} more ({filtered.length - shown} left)
        </button>
      )}

      <p className="mt-2 max-w-3xl text-[11px] text-neutral-500">
        <strong>&quot;— unclaimed&quot;</strong> means no database row points at the file. That is what a leftover from
        deleted test data looks like, and it is the safest thing to remove. Delete refuses any file a live
        submission or testimonial still references, so a recording someone cannot re-perform is protected even from
        a mis-click.
      </p>
    </section>
  );
}
