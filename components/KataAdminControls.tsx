"use client";

import { useState, useTransition } from "react";
import { addKata, renameKata } from "@/app/actions/admin";

/** Both controls import their Server Action at module level rather than
 * taking it as a prop — same reason CategoryActionButton does: this page
 * renders hundreds of kata rows, and a per-instance serialized action
 * reference is what previously added tens of seconds to the render. */

const INPUT =
  "rounded border border-neutral-300 px-2 py-0.5 text-xs font-normal text-neutral-800 focus:border-neutral-500 focus:outline-none";

/** Creates a whole kata (all 16 sub-categories) in one go. Sits beside
 * "+ Add category", which still adds a single row for the rare hand-built
 * case. */
export function AddKataForm({ competitionId, returnTo }: { competitionId: string; returnTo: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [max, setMax] = useState("200");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-emerald-300 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
      >
        + Add kata
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New kata name"
        className={INPUT + " w-56"}
      />
      <input
        value={max}
        onChange={(e) => setMax(e.target.value)}
        inputMode="numeric"
        title="Max participants per sub-category"
        className={INPUT + " w-16"}
      />
      <button
        type="button"
        disabled={pending || !name.trim()}
        onClick={() =>
          startTransition(() => {
            const fd = new FormData();
            fd.set("competition_id", competitionId);
            fd.set("kata_base", name.trim());
            fd.set("max_participants", max);
            fd.set("return_to", returnTo);
            void addKata(fd);
          })
        }
        className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setName("");
        }}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Cancel
      </button>
      <span className="text-[11px] text-neutral-500">Creates all 16 sub-categories (2 belts × 4 ages × 2 genders).</span>
    </span>
  );
}

/** Inline rename for one kata, applied across every sub-category under it.
 * Lives inside a <summary>, so every click is stopped from bubbling —
 * otherwise typing in the box would collapse the group it belongs to. */
export function RenameKataControl({
  competitionId,
  base,
  returnTo,
}: {
  competitionId: string;
  base: string;
  returnTo: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(base);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setName(base);
          setEditing(true);
        }}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-normal text-neutral-600 hover:bg-neutral-50"
        title={`Rename “${base}” across all of its sub-categories`}
      >
        ✏️ Edit
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={INPUT + " w-56"}
      />
      <button
        type="button"
        disabled={pending || !name.trim()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          startTransition(() => {
            const fd = new FormData();
            fd.set("competition_id", competitionId);
            fd.set("kata_base", base);
            fd.set("new_name", name.trim());
            fd.set("return_to", returnTo);
            void renameKata(fd);
          });
        }}
        className="rounded bg-neutral-900 px-2 py-0.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setName(base);
          setEditing(false);
        }}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Cancel
      </button>
    </span>
  );
}
