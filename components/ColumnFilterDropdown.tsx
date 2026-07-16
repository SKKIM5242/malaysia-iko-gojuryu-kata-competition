"use client";

import { useEffect, useRef, useState } from "react";

/** Excel-style column filter: a button that opens a checklist of every
 * unique value in the column — tick which ones to show. An empty
 * selection means "no filter" (show everything). */
export default function ColumnFilterDropdown({
  values,
  selected,
  onChange,
}: {
  /** Every unique value present in this column, in first-seen order. */
  values: string[];
  /** Currently-ticked values; empty = no filter applied. */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const shown = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const active = selected.size > 0;

  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-1 rounded border px-1.5 py-1 text-xs font-normal ${
          active ? "border-red-600 bg-red-50 text-red-700" : "border-neutral-300 text-neutral-500 hover:bg-neutral-50"
        }`}
      >
        <span className="truncate">{active ? `${selected.size} selected` : "Filter…"}</span>
        <span className="shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search values…"
            className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-red-600 focus:outline-none"
          />
          <div className="mb-2 flex gap-2 text-xs">
            <button type="button" onClick={() => onChange(new Set(values))} className="text-red-700 underline underline-offset-2">
              Select all
            </button>
            <button type="button" onClick={() => onChange(new Set())} className="text-neutral-500 underline underline-offset-2">
              Clear
            </button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-1 py-1 text-xs text-neutral-400">No values</p>
            ) : (
              shown.map((v) => (
                <label key={v} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-50">
                  <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} className="accent-red-700" />
                  <span className="truncate">{v || "(blank)"}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
