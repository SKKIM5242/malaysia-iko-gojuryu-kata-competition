"use client";

import { useState } from "react";
import { saveTelegramBotUsername, clearTelegramBotUsername } from "@/app/actions/admin";

/** Edit/save/cancel/delete for the bot's @username -- the one non-secret
 * piece of the "Bot record" box in components/TelegramBotGuide.tsx, stored
 * in telegram_bot_settings (see 0136_telegram_bot_settings.sql) instead of
 * a Vercel env var. Both "Bot link" and "Connect deep link" below it are
 * built from this same value, so there's one shared editor rather than two
 * -- editing it updates both at once. TELEGRAM_BOT_TOKEN and
 * TELEGRAM_WEBHOOK_SECRET aren't editable here or anywhere else in the
 * app: real secrets, Vercel-only, on purpose. */
export default function TelegramBotUsernameField({
  botUsername,
  returnTo,
}: {
  botUsername: string | null;
  returnTo: string;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {botUsername ? (
          <a
            href={`https://t.me/${botUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-semibold text-[#1c7fb5] underline"
          >
            {`https://t.me/${botUsername}`}
          </a>
        ) : (
          <span className="font-semibold text-red-600">
            Not set — every &quot;Connect Telegram&quot; button is hidden site-wide.
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <form action={saveTelegramBotUsername} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="return_to" value={returnTo} />
      <span className="text-xs text-neutral-500">https://t.me/</span>
      <input
        name="bot_username"
        defaultValue={botUsername ?? ""}
        placeholder="MalaysiaKataBot"
        autoFocus
        className="w-56 rounded border border-neutral-300 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Cancel
      </button>
      {botUsername && (
        <button
          formAction={clearTelegramBotUsername}
          className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      )}
    </form>
  );
}
