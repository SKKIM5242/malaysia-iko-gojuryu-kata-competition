"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Wraps a wide table with a second horizontal scrollbar ABOVE it (synced
 * to the real one below), so you don't have to scroll all the way down
 * first to scroll sideways on a long list. */
export default function DualScrollBox({ children }: { children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const syncing = useRef<"top" | "bottom" | null>(null);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const update = () => setContentWidth(el.scrollWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  });

  function handleTopScroll(e: React.UIEvent<HTMLDivElement>) {
    if (syncing.current === "bottom") { syncing.current = null; return; }
    syncing.current = "top";
    if (bottomRef.current) bottomRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }
  function handleBottomScroll(e: React.UIEvent<HTMLDivElement>) {
    if (syncing.current === "top") { syncing.current = null; return; }
    syncing.current = "bottom";
    if (topRef.current) topRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  return (
    <div>
      <div ref={topRef} onScroll={handleTopScroll} className="overflow-x-auto overflow-y-hidden" style={{ height: 14 }}>
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      <div ref={bottomRef} onScroll={handleBottomScroll} className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        {children}
      </div>
    </div>
  );
}
