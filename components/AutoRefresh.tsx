"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the page's server-rendered content on a timer, so figures that
 * change while someone is watching -- judges submitting scores, in the Kata
 * Arena's case -- appear without anyone having to reload.
 *
 * router.refresh() rather than a full reload: it re-runs the server tree and
 * swaps in the new markup while leaving client state alone, so an open
 * recording, an expanded kata group or a scroll position all survive the
 * update instead of being thrown away every interval.
 *
 * Only ticks while the tab is actually visible, and refreshes once
 * immediately on becoming visible again -- a phone in a pocket or a
 * background tab shouldn't be polling the database, and someone returning to
 * the page wants it current straight away rather than up to an interval
 * behind.
 */
export default function AutoRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
