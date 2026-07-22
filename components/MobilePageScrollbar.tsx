"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_THUMB_HEIGHT = 36;

/** Custom, always-visible, draggable vertical scrollbar pinned to the right
 * edge of the viewport, mobile layout only — phones hide the native page
 * scrollbar entirely (no visible indicator, and it can't be grabbed), so
 * there was no way to jump straight to an arbitrary point on a long page
 * without a lot of swiping. Sits between the sticky header and the fixed
 * footer. Desktop already has a normal, working scrollbar, so this renders
 * nothing there. */
export default function MobilePageScrollbar() {
  const [trackTop, setTrackTop] = useState(0);
  const [trackHeight, setTrackHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [maxScrollTop, setMaxScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const header = document.querySelector("header");
      const footer = document.querySelector<HTMLElement>("[data-mobile-footer]");
      const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
      const footerTop = footer ? footer.getBoundingClientRect().top : window.innerHeight;
      setTrackTop(Math.max(0, headerBottom));
      setTrackHeight(Math.max(0, footerTop - Math.max(0, headerBottom)));
      setScrollTop(window.scrollY);
      setViewportHeight(window.innerHeight);
      setMaxScrollTop(Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  const showThumb = maxScrollTop > 1 && trackHeight > MIN_THUMB_HEIGHT;
  const thumbHeight = showThumb
    ? Math.max(MIN_THUMB_HEIGHT, (viewportHeight / (maxScrollTop + viewportHeight)) * trackHeight)
    : trackHeight;
  const thumbTravel = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * thumbTravel : 0;

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startScrollTop: window.scrollY };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId || thumbTravel <= 0) return;
      const deltaY = e.clientY - drag.startY;
      const scale = maxScrollTop / thumbTravel;
      window.scrollTo(0, Math.max(0, Math.min(maxScrollTop, drag.startScrollTop + deltaY * scale)));
    },
    [maxScrollTop, thumbTravel],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  if (!showThumb) return null;

  return (
    <div
      aria-hidden
      className="fixed right-1 z-30 w-3 rounded-full bg-neutral-900/10 sm:hidden"
      style={{ top: trackTop, height: trackHeight }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="absolute inset-x-0 touch-none rounded-full bg-neutral-500/70 active:bg-neutral-600"
        style={{ height: thumbHeight, top: thumbTop }}
      />
    </div>
  );
}
