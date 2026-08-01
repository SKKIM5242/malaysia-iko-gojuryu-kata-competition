"use client";

import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement } from "react";

/**
 * The mobile footer bar is `position: fixed`, so a spacer div above it
 * reserves room for it in normal document flow -- but that spacer used a
 * guessed, hardcoded height (h-28/h-24/h-20) that doesn't actually match
 * how tall the footer's own text renders at every viewport width. Measured
 * on a real 375px-wide mobile viewport: the footer rendered 128px tall
 * while the spacer only reserved 112px, a 16px gap where the fixed footer
 * silently overlapped whatever page content sat just above it -- any
 * button landing in that strip visually looked normal but every tap on it
 * actually hit the footer's own (unclickable) background instead, exactly
 * the "button doesn't respond to touch" symptom reported on the Kata
 * recording page. Measures the footer's REAL rendered height via
 * ResizeObserver instead of guessing, so the spacer always matches exactly
 * -- self-correcting across every viewport width, font size, and orientation.
 */
export default function FooterHeightSync({
  children,
  fallbackClassName,
}: {
  /** A single element (the fixed footer bar) to attach the measuring ref to. */
  children: ReactElement<{ ref?: React.Ref<HTMLDivElement> }>;
  /** Guessed height classes used for the very first paint, before JS has
   * measured anything yet -- close enough to avoid a visible layout jump. */
  fallbackClassName: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Belt-and-suspenders alongside ResizeObserver — a phone rotating
    // between portrait/landscape is exactly the case this exists for, and
    // shouldn't depend on just one detection mechanism.
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden
        className={height == null ? fallbackClassName : undefined}
        style={height != null ? { height } : undefined}
      />
      {isValidElement(children) ? cloneElement(children, { ref }) : children}
    </>
  );
}
