"use client";

import { useState } from "react";
import { reorderCategoryGroups } from "@/app/actions/admin";

const DRAG_MIME = "application/x-kata-group-base";

/**
 * Makes a kata group's header both a drag source (via the small grip handle)
 * and a drop target (the whole row) -- dropping one group onto another asks
 * the server to move the dragged group to sit where the drop target is,
 * pushing everything from there on down (or up) by one. Only the tiny grip
 * is `draggable`, so a plain click still toggles the <details> open/closed
 * as normal instead of starting a drag.
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
  const [dragOver, setDragOver] = useState(false);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData(DRAG_MIME, base);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  async function handleDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    setDragOver(false);
    const sourceBase = e.dataTransfer.getData(DRAG_MIME);
    if (!sourceBase || sourceBase === base) return;
    const fd = new FormData();
    fd.set("competition_id", competitionId);
    fd.set("source_base", sourceBase);
    fd.set("target_base", base);
    fd.set("return_to", returnTo);
    await reorderCategoryGroups(fd);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-1 items-center gap-2 rounded ${dragOver ? "bg-blue-50 ring-2 ring-blue-300" : ""}`}
    >
      <span
        draggable
        onDragStart={handleDragStart}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder this kata event"
        aria-label="Drag to reorder this kata event"
        className="shrink-0 cursor-grab select-none rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 active:cursor-grabbing"
      >
        ⠿
      </span>
      {children}
    </div>
  );
}
