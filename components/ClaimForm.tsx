"use client";

import { useActionState } from "react";
import { claimRegistration, type AccountActionState } from "@/app/actions/account";

const initial: AccountActionState = { ok: false };

export default function ClaimForm() {
  const [state, formAction, pending] = useActionState(claimRegistration, initial);
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold">Link your paid registration</h2>
      <p className="text-sm text-neutral-500">
        Enter the <strong>reference ID</strong> you received when you registered (8 characters) and
        the <strong>IC / passport number</strong> you registered with. Only paid registrations can
        record a kata.
      </p>
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="reference" className="mb-1 block text-sm font-medium text-neutral-700">Reference ID *</label>
          <input
            id="reference"
            name="reference"
            required
            maxLength={8}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm uppercase"
            placeholder="e.g. 4C8A3B21"
          />
        </div>
        <div>
          <label htmlFor="ic_passport" className="mb-1 block text-sm font-medium text-neutral-700">IC / Passport *</label>
          <input id="ic_passport" name="ic_passport" required className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
      >
        {pending ? "Verifying…" : "Link registration"}
      </button>
    </form>
  );
}
