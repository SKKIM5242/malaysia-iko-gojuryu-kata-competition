"use client";

import { useTransition } from "react";
import { reorderCategoryGroups } from "@/app/actions/admin";
import { useDragReorder } from "@/lib/useDragReorder";

/**
 * Makes a kata group's header a drag source via its small grip handle,
 * using pointer events (mouse AND touch) instead of native HTML5
 * draggable/dragstart/dragover — see lib/useDragReorder.ts for why. Drop
 * near another kata's top half inserts before it, near its bottom half
 * inserts after — a floating chip and a snapping insertion line track the
 * drag the whole way, both removed on release regardless of outcome.
 *
 * Requires the immediate reorderable ancestor (the kata group's own
 * <details>) to carry `data-drag-item={base}`, and a shared ancestor
 * (the list of kata groups) to carry `data-drag-list` — see
 * app/admin/competitions/page.tsx, app/page.tsx, and
 * app/kata-categories/page.tsx for where those are set.
 *
 * Only the tiny grip is draggable, so a plain click still toggles the
 * <details> open/closed as normal instead of starting a drag.
 */
export default function KataGroupDragZone({
  competitionId,
  base,
  returnTo,
  children,
}: {
  competitionId: string;
  base: string;
  returnTo: string;
  children: React.ReactNode;
}) {
  const [, startTransition] = useTransition();
  const { startDrag } = useDragReorder((sourceBase, targetBase, position) => {
    const fd = new FormData();
    fd.set("competition_id", competitionId);
    fd.set("source_base", sourceBase);
    fd.set("target_base", targetBase);
    fd.set("position", position);
    fd.set("return_to", returnTo);
    // Which family box the kata was dropped INTO. Read off the DOM at drop
    // time rather than tracked through the drag, because the only thing that
    // decides it is where the pointer finally landed. Empty when the drop
    // stayed in the kata's own family, in which case the action just
    // reorders and leaves the family alone.
    const targetEl = document.querySelector<HTMLElement>(
      `[data-drag-item="${CSS.escape(targetBase)}"]`,
    );
    const targetFamily = targetEl?.closest<HTMLElement>("[data-drag-family]")?.dataset.dragFamily ?? "";
    const sourceEl = document.querySelector<HTMLElement>(
      `[data-drag-item="${CSS.escape(sourceBase)}"]`,
    );
    const sourceFamily = sourceEl?.closest<HTMLElement>("[data-drag-family]")?.dataset.dragFamily ?? "";
    if (targetFamily && targetFamily !== sourceFamily) fd.set("target_family", targetFamily);
    startTransition(() => {
      reorderCategoryGroups(fd);
    });
  });

  return (
    // basis-full on small screens: the name, the family control and the
    // order box get a row to themselves, and the merge buttons wrap
    // underneath instead of crushing the name into a one-word-per-line
    // column ("Kata / Taikyoku / Tora / Guchi" stacked vertically). From sm
    // up it shares the row again but with a floor it cannot shrink past.
    <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 rounded sm:min-w-[22rem] sm:flex-1 sm:basis-auto">
      <span
        onPointerDown={(e) => startDrag(e, base, base)}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder this kata event"
        aria-label="Drag to reorder this kata event"
        style={{ touchAction: "none" }}
        className="shrink-0 cursor-grab select-none rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 active:cursor-grabbing"
      >
        ⠿
      </span>
      {children}
    </div>
  );
}
