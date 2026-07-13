"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const IDLE_MS = 30 * 60 * 1000;
const COUNTDOWN_SECONDS = 20;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

/** Signed-in users only: after 30 minutes with no activity, warns with a
 * 20-second countdown before auto sign-out. Only the Continue button — not
 * background activity — cancels the countdown, matching a standard
 * session-timeout pattern. */
export default function InactivityGuard() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    idleTimer.current = null;
    countdownTimer.current = null;
  }, []);

  const signOutNow = useCallback(async () => {
    clearTimers();
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/account");
    router.refresh();
  }, [clearTimers, router]);

  const startCountdown = useCallback(() => {
    setWarning(true);
    setSecondsLeft(COUNTDOWN_SECONDS);
    countdownTimer.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
          void signOutNow();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [signOutNow]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(startCountdown, IDLE_MS);
  }, [startCountdown]);

  const handleContinue = useCallback(() => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setWarning(false);
    resetIdleTimer();
  }, [resetIdleTimer]);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!signedIn) {
      clearTimers();
      setWarning(false);
      return;
    }
    resetIdleTimer();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetIdleTimer));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetIdleTimer));
      clearTimers();
    };
  }, [signedIn, resetIdleTimer, clearTimers]);

  if (!warning) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-xl">
        <p className="text-lg font-bold text-neutral-900">Still there?</p>
        <p className="mt-2 text-sm text-neutral-600">
          You&apos;ve been inactive for a while. For your security you&apos;ll be signed out in{" "}
          <span className="font-bold text-red-700">{secondsLeft}</span> second{secondsLeft === 1 ? "" : "s"}.
        </p>
        <button
          onClick={handleContinue}
          className="mt-4 w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
