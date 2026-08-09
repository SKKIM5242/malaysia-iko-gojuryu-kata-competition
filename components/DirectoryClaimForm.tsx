"use client";

import { useActionState } from "react";
import { claimSchool, claimSensei, type AccountActionState } from "@/app/actions/account";

const initial: AccountActionState = { ok: false };

const COPY = {
  school: {
    heading: "Link Your School / Dojo Record",
    verb: "school",
    action: claimSchool,
    buttonLabel: "Link school",
  },
  sensei: {
    heading: "Link Your Sensei Record",
    verb: "sensei",
    action: claimSensei,
    buttonLabel: "Link sensei",
  },
} as const;

/** Same reference-ID + IC/Passport pattern as ClaimForm.tsx, for School and
 * Sensei accounts instead of participants — shown on /account when a
 * signed-in School/Sensei role isn't linked to a directory record yet. */
export default function DirectoryClaimForm({ kind }: { kind: "school" | "sensei" }) {
  const { heading, verb, action, buttonLabel } = COPY[kind];
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold">{heading}</h2>
      <p className="text-sm text-neutral-500">
        Enter the <strong>reference ID</strong> shown for your {verb} in the confirmation email or the
        organizer&apos;s directory (8 characters) and the <strong>IC / Passport No.</strong> given at
        registration. Only paid records can be linked.
      </p>
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${kind}_reference`} className="mb-1 block text-sm font-medium text-neutral-700">
            Reference ID *
          </label>
          <input
            id={`${kind}_reference`}
            name="reference"
            required
            maxLength={9}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm uppercase"
            placeholder="e.g. 4C8A 3B21"
          />
        </div>
        <div>
          <label htmlFor={`${kind}_ic_passport`} className="mb-1 block text-sm font-medium text-neutral-700">
            IC / Passport *
          </label>
          <input
            id={`${kind}_ic_passport`}
            name="ic_passport"
            required
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
      >
        {pending ? "Verifying…" : buttonLabel}
      </button>
    </form>
  );
}
