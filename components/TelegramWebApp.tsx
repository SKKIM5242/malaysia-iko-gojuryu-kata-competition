"use client";

import Script from "next/script";

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        BackButton: {
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
      };
    };
  }
}

/** Turns this site into a real Telegram Mini App when opened from inside
 * Telegram (via the bot's menu button) — a no-op everywhere else, since
 * window.Telegram only exists inside Telegram's own WebView. Expands to
 * full height, matches Telegram's chrome to the site's own black header/
 * footer color, and wires Telegram's native Back button to browser
 * history so navigating between pages feels native to Telegram instead
 * of like an embedded website. Mounted once in the root layout. */
export default function TelegramWebApp() {
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onLoad={() => {
        const tg = window.Telegram?.WebApp;
        if (!tg) return;
        tg.ready();
        tg.expand();
        try {
          tg.setHeaderColor("#0a0a0a");
          tg.setBackgroundColor("#0a0a0a");
        } catch {
          // Older Telegram clients may not support these calls yet.
        }
        tg.BackButton.onClick(() => window.history.back());
        tg.BackButton.show();
      }}
    />
  );
}
