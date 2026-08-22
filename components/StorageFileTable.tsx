"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteStorageObject } from "@/app/actions/admin";
import { formatBytes, type StorageObject } from "@/lib/storage-usage";

const PAGE = 100;

/** Shown in the Participant filter for a file no database row claims.
 *
 * Needs its own sentinel because "" already means "no filter". Deliberately
 * a loud token rather than something subtle like a leading space: the first
 * attempt used " unclaimed", the space did not survive into the rendered
 * option value, the browser silently rejected the assignment and reset the
 * select to "" -- so the filter appeared to do nothing at all. No real
 * participant name can collide with this. */
const UNCLAIMED = "__UNCLAIMED__";

type SortKey = "participant" | "kind" | "bucket" | "path" | "bytes";
type SortDir = "asc" | "desc";

function fileHref(o: StorageObject, download: boolean): string {
  const q = new URLSearchParams({ bucket: o.bucket, path: o.path });
  if (download) q.set("download", "1");
  return `/api/storage/file?${q.toString()}`;
}

/** A header cell that both sorts and filters. The label sorts on click; the
 * control underneath filters. Keeping them in one cell is what makes this
 * read as "this column", rather than a row of anonymous boxes above a table
 * whose alignment you have to count across. */
function HeadCell({
  label,
  sortKey,
  sort,
  onSort,
  children,
  align = "left",
}: {
  label: string;
  sortKey?: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  const active = sortKey && sort.key === sortKey;
  return (
    <th className={`px-3 py-2 align-top ${align === "right" ? "text-right" : ""}`}>
      {sortKey ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={
            "flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide hover:text-neutral-700 " +
            (active ? "text-neutral-800" : "text-neutral-500") +
            (align === "right" ? " ml-auto" : "")
          }
          title={`Sort by ${label}`}
        >
          {label}
          <span className={active ? "" : "text-neutral-300"}>
            {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      ) : (
        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</span>
      )}
      {children && <div className="mt-1 font-normal normal-case">{children}</div>}
    </th>
  );
}

const selectCls =
  "w-full max-w-[11rem] rounded border border-neutral-300 bg-white px-1 py-0.5 text-[11px] font-normal text-neutral-700";
const inputCls = "w-full max-w-[11rem] rounded border border-neutral-300 px-1 py-0.5 text-[11px] font-normal";

/**
 * Every stored file, with the person it belongs to and what it is.
 *
 * Each column filters and sorts from its own header. The value lists are
 * built from the WHOLE set, not from what is currently showing — otherwise
 * narrowing by bucket would quietly empty the Participant list of everyone
 * you had just filtered away, and there would be no way back to them.
 *
 * View and Download go through /api/storage/file rather than pre-signed URLs
 * baked into the page: a listing of a few thousand recordings would sign a
 * few thousand URLs on every render, nearly all unused, and would put a live
 * link to every unreleased recording into the page's HTML.
 */
export default function StorageFileTable({
  files,
  canDelete,
}: {
  files: StorageObject[];
  /** Admin/Organizer. The server re-checks, and additionally refuses any file
   * a live database row still points at. */
  canDelete: boolean;
}) {
  const [participant, setParticipant] = useState("");
  const [kind, setKind] = useState("");
  const [bucket, setBucket] = useState("");
  const [path, setPath] = useState("");
  const [minMb, setMinMb] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "bytes", dir: "desc" });
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const participants = useMemo(
    () => [...new Set(files.map((f) => f.participantName).filter((n): n is string => !!n))].sort(),
    [files],
  );
  const kinds = useMemo(() => [...new Set(files.map((f) => f.kind))].sort(), [files]);
  const buckets = useMemo(() => [...new Set(files.map((f) => f.bucket))].sort(), [files]);
  const hasUnclaimed = useMemo(() => files.some((f) => !f.participantName), [files]);

  const activeFilters = [participant, kind, bucket, path.trim(), minMb.trim()].filter(Boolean).length;

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setShown(PAGE);
    };
  }

  function clearAll() {
    setParticipant("");
    setKind("");
    setBucket("");
    setPath("");
    setMinMb("");
    setShown(PAGE);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "bytes" ? "desc" : "asc" }));
  }

  const filtered = useMemo(() => {
    const q = path.trim().toLowerCase();
    const min = Number(minMb) > 0 ? Number(minMb) * 1024 * 1024 : 0;
    const rows = files.filter((f) => {
      if (participant === UNCLAIMED ? !!f.participantName : participant && f.participantName !== participant) {
        return false;
      }
      if (kind && f.kind !== kind) return false;
      if (bucket && f.bucket !== bucket) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      if (min && f.bytes < min) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === "bytes") return (a.bytes - b.bytes) * dir;
      const av =
        sort.key === "participant" ? (a.participantName ?? "") : sort.key === "kind" ? a.kind : sort.key === "bucket" ? a.bucket : a.path;
      const bv =
        sort.key === "participant" ? (b.participantName ?? "") : sort.key === "kind" ? b.kind : sort.key === "bucket" ? b.bucket : b.path;
      return av.localeCompare(bv) * dir;
    });
  }, [files, participant, kind, bucket, path, minMb, sort]);

  const filteredBytes = useMemo(() => filtered.reduce((s, f) => s + f.bytes, 0), [filtered]);

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
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">
          All files{" "}
          <span className="font-normal normal-case text-neutral-400">
            ({filtered.length.toLocaleString()}
            {filtered.length !== files.length ? ` of ${files.length.toLocaleString()}` : ""} · {formatBytes(filteredBytes)})
          </span>
        </h2>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            ✕ Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <HeadCell label="Participant" sortKey="participant" sort={sort} onSort={toggleSort}>
                <select value={participant} onChange={(e) => reset(setParticipant)(e.target.value)} className={selectCls}>
                  <option value="">All ({participants.length})</option>
                  {hasUnclaimed && <option value={UNCLAIMED}>— unclaimed</option>}
                  {participants.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </HeadCell>

              <HeadCell label="Recording type" sortKey="kind" sort={sort} onSort={toggleSort}>
                <select value={kind} onChange={(e) => reset(setKind)(e.target.value)} className={selectCls}>
                  <option value="">All ({kinds.length})</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </HeadCell>

              <HeadCell label="Bucket" sortKey="bucket" sort={sort} onSort={toggleSort}>
                <select value={bucket} onChange={(e) => reset(setBucket)(e.target.value)} className={selectCls}>
                  <option value="">All ({buckets.length})</option>
                  {buckets.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </HeadCell>

              <HeadCell label="File" sortKey="path" sort={sort} onSort={toggleSort}>
                <input
                  value={path}
                  onChange={(e) => reset(setPath)(e.target.value)}
                  placeholder="contains…"
                  className={inputCls}
                />
              </HeadCell>

              <HeadCell label="Size" sortKey="bytes" sort={sort} onSort={toggleSort} align="right">
                <input
                  value={minMb}
                  onChange={(e) => reset(setMinMb)(e.target.value)}
                  inputMode="decimal"
                  placeholder="min MB"
                  className={`${inputCls} text-right`}
                />
              </HeadCell>

              <HeadCell label="Actions" sort={sort} onSort={toggleSort} />
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
                  Nothing matches these filters.
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
        Click a column heading to sort, use the box under it to filter. The count and total size in the heading
        follow the filters, so narrowing to one participant or one bucket also tells you what they are costing.{" "}
        <strong>&quot;— unclaimed&quot;</strong> means no database row points at the file — what a leftover from
        deleted test data looks like, and the only kind that is safe to remove. Delete refuses any file a live
        submission or testimonial still references.
      </p>
    </section>
  );
}
