"use client";

import { useState } from "react";
import { reorderSubcategories } from "@/app/actions/admin";

const DRAG_MIME = "application/x-subcategory-id";

/**
 * Same drag-to-reorder pattern as KataGroupDragZone, one level down: makes
 * one belt/age/gender row within a kata group both a drag source (grip
 * handle) and drop target (the whole row), asking the server to move the
 * dragged row to sit where the drop target is within that same group.
 */
export default function SubcategoryDragZone({
  categoryId,
  returnTo,
  children,
}: {
  categoryId: string;
  returnTo: string;
  children: React.ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData(DRAG_MIME, categoryId);
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
    const sourceId = e.dataTransfer.getData(DRAG_MIME);
    if (!sourceId || sourceId === categoryId) return;
    const fd = new FormData();
    fd.set("source_id", sourceId);
    fd.set("target_id", categoryId);
    fd.set("return_to", returnTo);
    await reorderSubcategories(fd);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-1 items-center justify-between gap-2 rounded ${dragOver ? "bg-blue-50 ring-2 ring-blue-300" : ""}`}
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          draggable
          onDragStart={handleDragStart}
          title="Drag to reorder this row within its kata event"
          aria-label="Drag to reorder this row within its kata event"
          className="cursor-grab select-none rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 active:cursor-grabbing"
        >
          ⠿
        </span>
      </span>
      {children}
    </div>
  );
}
