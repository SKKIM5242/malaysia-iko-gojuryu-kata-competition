"use client";

import { useState } from "react";
import type { StorageObject } from "@/lib/storage-usage";

/**
 * Downloads every file in one bucket, one after another.
 *
 * Deliberately NOT a server-side zip. Zipping would mean streaming every
 * recording through the app server — hundreds of megabytes per click, on a
 * serverless function with a request timeout, to produce an archive nobody
 * can resume if it fails halfway. Sequential per-file downloads go straight
 * from Storage to the browser, can be watched, and a failure costs one file
 * rather than the whole set.
 *
 * The pause between files is not politeness: browsers throttle or silently
 * drop rapid programmatic downloads, and Chrome asks permission the first
 * time a site downloads more than one file. Allow it when prompted.
 */
export default function BucketDownloadButton({ bucket, files }: { bucket: string; files: StorageObject[] }) {
  const [progress, setProgress] = useState<number | null>(null);
  const mine = files.filter((f) => f.bucket === bucket);

  if (mine.length === 0) return null;

  async function run() {
    setProgress(0);
    for (let i = 0; i < mine.length; i++) {
      const o = mine[i];
      const q = new URLSearchParams({ bucket: o.bucket, path: o.path, download: "1" });
      const a = document.createElement("a");
      a.href = `/api/storage/file?${q.toString()}`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setProgress(i + 1);
      // Long enough that the browser treats each as its own download rather
      // than a burst it should block.
      await new Promise((r) => setTimeout(r, 900));
    }
    setTimeout(() => setProgress(null), 2500);
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={progress !== null}
      title={`Download all ${mine.length} file(s) in ${bucket}, one at a time`}
      className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
    >
      {progress === null ? `⬇ Download all ${mine.length}` : `Downloading ${progress}/${mine.length}…`}
    </button>
  );
}
