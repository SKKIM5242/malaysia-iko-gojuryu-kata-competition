"use client";

import { useState } from "react";

/**
 * Explains what converting a file actually does, on the screen where a
 * winner is being told to convert one.
 *
 * Collapsed by default: most people just need "save it as M4A and upload".
 * It is here for the ones who hesitate — the fear that converting will cut
 * their testimonial short, or speed their voice up, is a real reason people
 * refuse to do it and give up instead.
 */
export default function CompressionNote() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-white p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-bold text-neutral-700"
      >
        <span>🎧 Does converting my file lose part of my testimonial?</span>
        <span className="text-neutral-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-neutral-600">
          <p>
            <strong className="text-neutral-800">No. Nothing is cut off, and your voice is not sped up.</strong> A
            10-minute recording stays exactly 10 minutes, start to finish, at the pace you spoke.
          </p>

          <p>
            Converting to M4A, MP3 or AAC does not shorten the recording — it describes each moment of it in less
            detail. Think of it as telling the same story in fewer words: same story, same length, less detail.
            What gets dropped is chosen to be what an ear was never going to notice:
          </p>

          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Sounds hidden behind louder ones.</strong> When a loud sound and a quiet one land close
              together, you only ever heard the loud one — so the quiet one is not stored.
            </li>
            <li>
              <strong>Pitches above human hearing.</strong> Nothing there for a speaking voice anyway.
            </li>
            <li>
              <strong>Fine precision.</strong> What remains is stored a little less exactly.
            </li>
          </ul>

          <p>
            For a voice this is genuinely hard to hear. Speech is far easier to compress than music — a narrow
            range of pitches, long steady sounds — which is why the recorder in this page already uses the same
            approach and still sounds clean.
          </p>

          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
            <strong>One thing worth knowing:</strong> converting the <em>same</em> file over and over does add up.
            Each conversion can only see the previous result, treats its flaws as real sound, and adds its own. By
            the third or fourth round a voice starts to sound metallic or watery. Still nothing missing and still
            the right length — just muddier. <strong>Converting once is fine. Converting once is all you need.</strong>
          </p>

          <p>
            And converting back to WAV does not repair anything — it makes a large file of the same reduced audio.
            So work from your original recording, convert it once, and upload that.
          </p>
        </div>
      )}
    </div>
  );
}
