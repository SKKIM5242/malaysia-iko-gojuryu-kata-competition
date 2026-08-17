"use client";

import { useEffect, useState, type ReactNode } from "react";
import { checkMyTelegramConnected } from "@/app/actions/telegram-status";

/**
 * The blue "Connect Telegram" link / green "✅ connected" message shown in
 * 5 places across /account (Staff, Judge, Audience, School/Sensei,
 * Participant) -- each with its own connected-message wording, sharing one
 * mechanism. Pressing Start happens entirely inside the Telegram app,
 * outside this tab, so there's no way to know it happened without asking
 * again -- re-checks automatically whenever the tab regains focus or
 * visibility, so the button turns green on its own rather than needing a
 * manual page reload.
 */
export default function TelegramConnectStatus({
  initiallyConnected,
  connectUrl,
  connectedMessage,
  label,
  spacingClassName = "mt-3",
}: {
  initiallyConnected: boolean;
  connectUrl: string | null;
  connectedMessage: ReactNode;
  label: string;
  spacingClassName?: string;
}) {
  const [connected, setConnected] = useState(initiallyConnected);

  useEffect(() => {
    if (connected) return;
    let cancelled = false;
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      checkMyTelegramConnected().then((isConnected) => {
        if (!cancelled && isConnected) setConnected(true);
      });
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [connected]);

  if (connected) {
    return <p className={`${spacingClassName} text-sm font-semibold text-green-700`}>{connectedMessage}</p>;
  }
  if (!connectUrl) return null;
  return (
    <a
      href={connectUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${spacingClassName} inline-flex items-center gap-2 rounded-md border border-[#229ED9]/30 bg-[#229ED9]/5 px-4 py-2.5 text-sm font-semibold text-[#1c7fb5] hover:bg-[#229ED9]/10`}
    >
      {label}
    </a>
  );
}
