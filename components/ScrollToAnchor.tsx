"use client";

import { useEffect } from "react";

/**
 * A server action's redirect() always lands the browser scrolled to the
 * top of the new page -- fine for most admin pages, but on a long list
 * (e.g. Competitions' Kata Category list) that left the admin scrolled
 * away from whatever they'd just clicked Merge/Edit/Delete on, even though
 * the right panel was already reopened server-side. Scrolls the named
 * element back into view once, on mount, instead.
 */
export default function ScrollToAnchor({ anchorId }: { anchorId: string | null }) {
  useEffect(() => {
    if (!anchorId) return;
    const el = document.getElementById(anchorId);
    el?.scrollIntoView({ block: "center" });
  }, [anchorId]);
  return null;
}
