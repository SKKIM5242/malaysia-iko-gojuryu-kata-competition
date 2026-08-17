"use client";

import { useState } from "react";
import { updateAppUrl } from "@/app/actions/vercel-env";

/** Edit/save/cancel for NEXT_PUBLIC_APP_URL -- not a secret, so unlike
 * TelegramSecretField this shows and pre-fills the current value in plain
 * text. Saving updates Vercel and triggers a real redeploy automatically
 * (see updateAppUrl); it deliberately does not also re-run "Update webhook
 * now" in the same click, since that button only makes sense once the new
 * deployment is actually live, which takes longer than one request can
 * wait for. No Delete button here -- an empty app URL breaks every
 * outbound email and certificate link, not just Telegram, so there's no
 * safe "clear it" action the way there is for the two secret fields. */
export default function TelegramAppUrlField({
  currentUrl,
  returnTo,
}: {
  currentUrl: string;
  returnTo: string;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Edit
      </button>
    );
  }

  return (
    <form action={updateAppUrl} className="mt-2 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="return_to" value={returnTo} />
      <input
        name="value"
        type="url"
        defaultValue={currentUrl}
        autoFocus
        required
        className="w-72 rounded border border-neutral-300 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Save &amp; redeploy
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Cancel
      </button>
    </form>
  );
}
