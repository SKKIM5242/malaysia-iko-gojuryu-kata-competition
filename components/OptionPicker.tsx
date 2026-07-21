"use client";

import { useState } from "react";

/** A `<select>` replacement for option lists with long text (kata names
 * that run a full sentence) — a native dropdown can't wrap that text and
 * sizes its popup to the longest option, which can force the page wider
 * than the window. This opens a wide, centered modal instead (same pattern
 * as ReasonPicker) so every option wraps onto as many lines as it needs. */
export default function OptionPicker({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <label className="flex flex-col gap-0.5 text-xs font-semibold text-neutral-500">
      {label}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex max-w-[14rem] items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-left text-sm font-normal text-neutral-800 hover:bg-neutral-50"
      >
        <span className="truncate">{value || allLabel}</span>
        <span className="shrink-0 text-neutral-400">▾</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 text-left shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">Select {label}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-400 hover:text-neutral-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm font-normal hover:bg-neutral-50 ${
                  value === "" ? "bg-red-50 font-semibold text-red-700" : "text-neutral-700"
                }`}
              >
                {allLabel}
              </button>
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                  className={`block w-full rounded-md px-3 py-2 text-left text-sm font-normal hover:bg-neutral-50 ${
                    value === o ? "bg-red-50 font-semibold text-red-700" : "text-neutral-700"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </label>
  );
}
