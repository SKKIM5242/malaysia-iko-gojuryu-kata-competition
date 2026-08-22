"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setKataPosition } from "@/app/actions/admin";

/**
 * The kata's position within its family, as a number you can type over.
 *
 * This exists because the drag handle kept not working — and even at its
 * best, dragging is the wrong tool here: on a phone two family boxes are
 * rarely on screen together, so moving a kata from Elementary to Kobudo
 * meant dragging into an edge and hoping the page scrolled. Typing "3" and
 * pressing Enter cannot half-work.
 *
 * The number is the position shown, always 1..n with no gaps, and every
 * kata in the family renumbers after a move — so what you read is what the
 * order actually is, not a stored value that drifted away from it.
 */
export default function KataOrderControl({
  competitionId,
  base,
  position,
  total,
  returnTo,
}: {
  competitionId: string;
  base: string;
  /** 1-based position within its family. */
  position: number;
  /** How many kata are in this family — the highest number that means
   * anything, and what the input is capped to. */
  total: number;
  returnTo: string;
}) {
  const [value, setValue] = useState(String(position));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function commit() {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 1) {
      setValue(String(position));
      return;
    }
    if (Math.round(next) === position) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("competition_id", competitionId);
    fd.set("kata_base", base);
    fd.set("position", String(Math.round(next)));
    const result = await setKataPosition(fd);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not move.");
      setValue(String(position));
      return;
    }
    router.refresh();
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      // Lives inside a <summary>: without this, any click here would toggle
      // the kata group open or closed underneath the control.
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <label className="text-[10px] font-semibold uppercase text-neutral-400" htmlFor={`ord-${competitionId}-${base}`}>
        No.
      </label>
      <input
        id={`ord-${competitionId}-${base}`}
        value={value}
        disabled={pending}
        inputMode="numeric"
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") setValue(String(position));
        }}
        title={`Position ${position} of ${total} in this family — type a new number and press Enter`}
        className={
          "w-10 rounded border px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums " +
          (pending ? "border-neutral-200 text-neutral-400" : "border-neutral-300 text-neutral-800")
        }
      />
      <span className="text-[10px] text-neutral-400">/ {total}</span>
      {error && <span className="text-[10px] font-semibold text-red-700">{error}</span>}
    </span>
  );
}
