"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const MIN_THUMB_SIZE = 32;

/** Wraps a wide/tall table with custom scrollbar thumbs — horizontal ones
 * ABOVE and BELOW, and a vertical one on the RIGHT — all draggable with
 * mouse OR touch (Pointer Events), kept in sync with each other and with
 * the table's own scroll position. A plain native scrollbar can't be
 * dragged on a phone (touch scrolling only pans the content, and the
 * indicator itself auto-hides), and a table nested inside a scrolling page
 * is easy to miss as independently scrollable at all — these custom thumbs
 * fix both problems on every device. The content box also caps its own
 * height and scrolls vertically internally — required so `position: sticky`
 * on the header row and first column has this box (not the page) as its
 * scrolling ancestor, so they actually stick as the list scrolls. */
export default function DualScrollBox({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null);
  const dragRefV = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    const track = trackRef.current;
    if (!content || !track) return;
    const update = () => {
      setContentWidth(content.scrollWidth);
      setTrackWidth(track.clientWidth);
      setContentHeight(content.scrollHeight);
      setViewportHeight(content.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const onScroll = () => {
      setScrollLeft(content.scrollLeft);
      setScrollTop(content.scrollTop);
    };
    content.addEventListener("scroll", onScroll);
    return () => content.removeEventListener("scroll", onScroll);
  }, []);

  const maxScrollLeft = Math.max(0, contentWidth - trackWidth);
  const showThumb = maxScrollLeft > 1;
  const thumbWidth = showThumb ? Math.max(MIN_THUMB_SIZE, (trackWidth / contentWidth) * trackWidth) : trackWidth;
  const thumbTravel = Math.max(0, trackWidth - thumbWidth);
  const thumbLeft = maxScrollLeft > 0 ? (scrollLeft / maxScrollLeft) * thumbTravel : 0;

  const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
  const showVThumb = maxScrollTop > 1;
  const thumbHeight = showVThumb ? Math.max(MIN_THUMB_SIZE, (viewportHeight / contentHeight) * viewportHeight) : viewportHeight;
  const thumbTravelV = Math.max(0, viewportHeight - thumbHeight);
  const thumbTop = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * thumbTravelV : 0;

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: contentRef.current?.scrollLeft ?? 0,
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const content = contentRef.current;
      if (!drag || !content || drag.pointerId !== e.pointerId || thumbTravel <= 0) return;
      const deltaX = e.clientX - drag.startX;
      const scale = maxScrollLeft / thumbTravel;
      content.scrollLeft = Math.max(0, Math.min(maxScrollLeft, drag.startScrollLeft + deltaX * scale));
    },
    [maxScrollLeft, thumbTravel],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handlePointerDownV = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRefV.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startScrollTop: contentRef.current?.scrollTop ?? 0,
    };
  }, []);

  const handlePointerMoveV = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRefV.current;
      const content = contentRef.current;
      if (!drag || !content || drag.pointerId !== e.pointerId || thumbTravelV <= 0) return;
      const deltaY = e.clientY - drag.startY;
      const scale = maxScrollTop / thumbTravelV;
      content.scrollTop = Math.max(0, Math.min(maxScrollTop, drag.startScrollTop + deltaY * scale));
    },
    [maxScrollTop, thumbTravelV],
  );

  const handlePointerUpV = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRefV.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const thumb = (measure: boolean) => (
    <div ref={measure ? trackRef : undefined} className="relative h-4 touch-none rounded-full bg-neutral-200">
      {showThumb && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute top-0 h-full cursor-grab touch-none select-none rounded-full bg-neutral-400 active:cursor-grabbing active:bg-neutral-500"
          style={{ width: thumbWidth, left: thumbLeft }}
        />
      )}
    </div>
  );

  return (
    <div>
      {thumb(true)}
      <div className="mt-1 flex items-stretch gap-1">
        <div
          ref={contentRef}
          className="max-h-[70vh] min-w-0 flex-1 overflow-auto rounded-lg border border-neutral-200 bg-white shadow-sm"
        >
          {children}
        </div>
        {showVThumb && (
          <div className="relative w-4 shrink-0 touch-none rounded-full bg-neutral-200">
            <div
              onPointerDown={handlePointerDownV}
              onPointerMove={handlePointerMoveV}
              onPointerUp={handlePointerUpV}
              onPointerCancel={handlePointerUpV}
              className="absolute left-0 w-full cursor-grab touch-none select-none rounded-full bg-neutral-400 active:cursor-grabbing active:bg-neutral-500"
              style={{ height: thumbHeight, top: thumbTop }}
            />
          </div>
        )}
      </div>
      {showThumb && <div className="mt-1">{thumb(false)}</div>}
    </div>
  );
}
