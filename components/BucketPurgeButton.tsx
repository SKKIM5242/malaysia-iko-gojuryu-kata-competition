"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteStorageObjects } from "@/app/actions/admin";

/**
 * Empties one storage bucket. Admin only, and gated behind typing the
 * bucket's own name.
 *
 * The confirmation is deliberately a typed name rather than an "Are you
 * sure?" — this is the one action on the page with no undo, and competition
 * recordings cannot be re-made once a competition has finished. The server
 * additionally refuses any bucket whose rows are still referenced, so a
 * mis-click on the wrong bucket fails safe rather than destroying live
 * submissions.
 */
export default function BucketPurgeButton({ bucket, files }: { bucket: string; files: number }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (files === 0) return <span className="text-[11px] text-neutral-300">empty</span>;

  async function run() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("bucket", bucket);
    fd.set("confirm", typed);
    const result = await deleteStorageObjects(fd);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not delete.");
      return;
    }
    setOpen(false);
    setTyped("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-red-300 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
      >
        Delete all {files}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={bucket}
        disabled={pending}
        className="w-36 rounded border border-red-300 px-1.5 py-0.5 text-[11px]"
        aria-label={`Type ${bucket} to confirm`}
      />
      <button
        type="button"
        disabled={pending || typed !== bucket}
        onClick={() => void run()}
        className="rounded bg-red-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-600 disabled:opacity-40"
      >
        {pending ? "Deleting…" : "Delete permanently"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setTyped("");
          setError(null);
        }}
        className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Cancel
      </button>
      {error && <span className="block w-full text-[11px] font-semibold text-red-700">{error}</span>}
    </span>
  );
}
