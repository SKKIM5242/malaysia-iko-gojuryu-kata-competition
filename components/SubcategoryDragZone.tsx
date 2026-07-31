"use client";

import { useTransition } from "react";
import { reorderSubcategories } from "@/app/actions/admin";
import { useDragReorder } from "@/lib/useDragReorder";

/**
 * Same pointer-events drag-to-reorder as KataGroupDragZone (see
 * lib/useDragReorder.ts), one level down: makes one belt/age/gender row
 * within a kata group draggable, asking the server to move it to sit
 * before or after wherever it's dropped, within that same kata group only.
 *
 * Requires the row's own <li> to carry `data-drag-item={categoryId}`, and
 * the kata group's <ul> to carry `data-drag-list`.
 */
export default function SubcategoryDragZone({
  categoryId,
  label,
  returnTo,
  children,
}: {
  categoryId: string;
  /** Row text shown on the floating chip while dragging — pass the row's
   * belt/age/gender label (the part of the category name after the kata),
   * not the raw category id. */
  label: string;
  returnTo: string;
  children: React.ReactNode;
}) {
  const [, startTransition] = useTransition();
  const { startDrag } = useDragReorder((sourceId, targetId, position) => {
    const fd = new FormData();
    fd.set("source_id", sourceId);
    fd.set("target_id", targetId);
    fd.set("position", position);
    fd.set("return_to", returnTo);
    startTransition(() => {
      reorderSubcategories(fd);
    });
  });

  return (
    <div className="flex flex-1 items-center gap-2 rounded">
      <span
        onPointerDown={(e) => startDrag(e, categoryId, label)}
        title="Drag to reorder this row within its kata event"
        aria-label="Drag to reorder this row within its kata event"
        style={{ touchAction: "none" }}
        className="shrink-0 cursor-grab select-none rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 active:cursor-grabbing"
      >
        ⠿
      </span>
      {/* justify-between belongs on just these two (name left, actions
          right) -- putting the grip in the same flex row as this would make
          justify-between spread all three children instead, so the name's
          starting position drifted depending on how much space that left. */}
      <div className="flex flex-1 items-center justify-between gap-2">{children}</div>
    </div>
  );
}
