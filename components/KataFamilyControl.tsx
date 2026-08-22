"use client";

import { useState, useTransition } from "react";
import { setKataFamily } from "@/app/actions/admin";
import { KATA_FAMILIES, type KataFamily } from "@/lib/kata-families";

/**
 * Moves one kata into another family, as an explicit Edit → pick → Save
 * rather than only by dragging.
 *
 * Dragging works, but it is the wrong only-option here: on a phone the
 * family boxes rarely fit on one screen at the same time, so dragging from
 * Elementary to Kobudo means dragging into an edge and hoping the page
 * scrolls. This is also the only way to see, in words, which family a kata
 * is currently filed under and whether that is the built-in answer or an
 * override someone chose.
 *
 * Delete does NOT delete the kata — it clears the override, so the kata
 * falls back to the canonical family from lib/kata-families.ts. Labelled
 * "Reset" for exactly that reason: a button called Delete beside a kata
 * name reads like it removes the kata and its categories.
 */
export default function KataFamilyControl({
  competitionId,
  base,
  currentFamily,
  isOverridden,
  returnTo,
}: {
  competitionId: string;
  base: string;
  /** What the kata is filed under right now, override or canonical. */
  currentFamily: string;
  /** True when that answer comes from an override rather than the built-in
   * map — worth showing, so an organizer can tell their own change from the
   * default. */
  isOverridden: boolean;
  returnTo: string;
}) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<KataFamily | "">(
    (KATA_FAMILIES as readonly string[]).includes(currentFamily) ? (currentFamily as KataFamily) : "",
  );
  const [pending, startTransition] = useTransition();

  function submit(family: string) {
    const fd = new FormData();
    fd.set("competition_id", competitionId);
    fd.set("kata_base", base);
    fd.set("family", family);
    fd.set("return_to", returnTo);
    startTransition(() => {
      setKataFamily(fd);
    });
  }

  if (!editing) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
            (isOverridden ? "bg-amber-100 text-amber-900" : "bg-neutral-100 text-neutral-500")
          }
          title={isOverridden ? "Moved here by an organizer" : "Default family for this kata"}
        >
          {currentFamily}
          {isOverridden ? " ✎" : ""}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setEditing(true);
          }}
          className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <span
      className="flex shrink-0 flex-wrap items-center gap-1"
      // The whole control sits inside a <summary>, where any click would
      // otherwise toggle the group open/closed underneath the form.
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <select
        value={choice}
        disabled={pending}
        onChange={(e) => setChoice(e.target.value as KataFamily)}
        className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-neutral-800"
      >
        {KATA_FAMILIES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || !choice}
        onClick={() => submit(choice)}
        className="rounded bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setEditing(false)}
        className="rounded border border-neutral-300 px-2 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
      >
        Cancel
      </button>
      {isOverridden && (
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("")}
          title="Clear the override — this kata goes back to its built-in family. The kata itself is not deleted."
          className="rounded border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Reset
        </button>
      )}
    </span>
  );
}
