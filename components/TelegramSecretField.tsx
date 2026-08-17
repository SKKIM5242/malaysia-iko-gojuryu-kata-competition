"use client";

import { useState } from "react";
import { updateTelegramSecret, clearTelegramSecret } from "@/app/actions/vercel-env";

/** Edit/save/cancel/delete for a real secret (TELEGRAM_BOT_TOKEN or
 * TELEGRAM_WEBHOOK_SECRET) -- deliberately write-only, the same way Vercel's
 * own "Sensitive" env var tier already works: this never displays or
 * pre-fills the current value, only accepts a replacement. Saving calls
 * Vercel's API directly (see app/actions/vercel-env.ts) and updates
 * whichever environment (Production or Preview) this page is currently
 * running in -- it does not take effect until the next deployment. */
export default function TelegramSecretField({
  varKey,
  label,
  isSet,
  returnTo,
}: {
  varKey: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET";
  label: string;
  isSet: boolean;
  returnTo: string;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-semibold ${isSet ? "text-green-700" : "text-red-600"}`}>
          {isSet ? "✅ Set" : "❌ Not set"}
        </span>
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
    <form action={updateTelegramSecret} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="key" value={varKey} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input
        name="value"
        type="password"
        placeholder={`Paste new ${label}…`}
        autoComplete="off"
        autoFocus
        required
        className="w-64 rounded border border-neutral-300 px-2 py-1 text-xs"
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
      {isSet && (
        <button
          formAction={clearTelegramSecret}
          className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
      )}
    </form>
  );
}
