"use client";

import { useState } from "react";
import { SCRIPT_LENGTH_LABEL, scriptsForBand, type ScriptLengthBand } from "@/lib/testimonial-scripts";

/** Sample-script cue cards a Top-3 winner can browse before recording their
 * testimonial — talking points, not word-for-word text (see
 * lib/testimonial-scripts.ts). Self-contained button + modal so it can sit
 * anywhere a winner might want guidance before they've even opened the
 * recorder — e.g. next to a "give your testimonial to unlock this" notice
 * — not just inside TestimonialRecorder's own always-visible panel. */
export default function TestimonialSamplesButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [band, setBand] = useState<ScriptLengthBand | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const bands: ScriptLengthBand[] = ["3min", "5min", "10min"];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        }
      >
        📝 Testimonial Samples
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-neutral-800">📝 Testimonial samples</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-400 hover:text-neutral-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-neutral-600">
                Talking-point cue cards to practice with — pick a length:
              </p>
              <a
                href="/winner-testimonial-sample-scripts.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
              >
                ⬇ Download all 40 as PDF
              </a>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bands.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBand(band === b ? null : b)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    band === b ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-600"
                  }`}
                >
                  {SCRIPT_LENGTH_LABEL[b]}
                </button>
              ))}
            </div>
            {band && (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {scriptsForBand(band).map((script) => (
                  <li key={script.id} className="rounded border border-neutral-200">
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === script.id ? null : script.id)}
                      className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                    >
                      {script.title}
                      <span className="text-neutral-400">{openId === script.id ? "▲" : "▼"}</span>
                    </button>
                    {openId === script.id && (
                      <ol className="list-decimal space-y-1 px-6 pb-2 text-xs text-neutral-600">
                        {script.prompts.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
