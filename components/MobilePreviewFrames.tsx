"use client";

import { useState } from "react";

const PAGES: Array<{ label: string; path: string }> = [
  { label: "Home / Registration tiers", path: "/" },
  { label: "Confirmed Participants", path: "/participants" },
  { label: "Winners (recording + Full View + judge scores)", path: "/winners" },
  { label: "Kata Arena", path: "/kata-arena" },
  { label: "Announcements", path: "/announcements" },
  { label: "Register hub", path: "/register" },
];

const PORTRAIT = { width: 375, height: 812 };
const LANDSCAPE = { width: 812, height: 375 };

function DeviceFrame({ label, width, height, path }: { label: string; width: number; height: number; path: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label} — {width}×{height}
      </p>
      <div
        className="overflow-hidden rounded-2xl border-4 border-neutral-800 bg-white shadow-lg"
        style={{ width, height }}
      >
        <iframe
          src={path}
          title={`${label} preview`}
          width={width}
          height={height}
          className="block border-0"
        />
      </div>
    </div>
  );
}

/** Two live device frames (an <iframe> at the exact device pixel size, so
 * the embedded page's own responsive CSS renders exactly as it would on a
 * real phone) — Portrait and Landscape, side by side, both loading the
 * same picked page. View-only: nothing here is a simulation, it's the
 * real site, just framed at phone dimensions for Admin/Organizer/Support
 * to check how a page looks without needing an actual phone. */
export default function MobilePreviewFrames() {
  const [path, setPath] = useState(PAGES[0].path);

  return (
    <div>
      <div className="mb-4">
        <label htmlFor="preview_page" className="mb-1 block text-sm font-medium text-neutral-700">
          Page to preview
        </label>
        <select
          id="preview_page"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="w-full max-w-md rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm sm:w-auto"
        >
          {PAGES.map((p) => (
            <option key={p.path} value={p.path}>{p.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-400">
          To see the recording &quot;Full View&quot; button in landscape, pick Winners or Kata
          Arena, then scroll to a scored recording in the landscape frame and click it.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-6 overflow-x-auto pb-4">
        <DeviceFrame label="Portrait" width={PORTRAIT.width} height={PORTRAIT.height} path={path} />
        <DeviceFrame label="Landscape" width={LANDSCAPE.width} height={LANDSCAPE.height} path={path} />
      </div>
    </div>
  );
}
