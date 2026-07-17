"use client";

import { useActionState, useEffect, useState } from "react";
import { requestNewSubscription, type AccountActionState } from "@/app/actions/account";
import { OrganiserContact } from "@/components/ui";

const initial: AccountActionState = { ok: false };

/** Shown instead of the normal page content once Admin/Organizer's
 * sign-in quota (count and/or valid date range) for this account has run
 * out — see lib/sign-in-quota.ts. Lets them request a new subscription;
 * the organiser fulfils it by updating their Sign-in Control fields on
 * the relevant admin page. */
export default function SubscriptionBlocked({
  title,
  reason,
  signOutForm,
}: {
  title: string;
  reason: string;
  signOutForm: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(requestNewSubscription, initial);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (state.ok) setRequested(true);
  }, [state]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
        <p className="font-semibold text-amber-900">{reason}</p>
        <p className="mt-1 text-sm text-amber-800">
          Request a new subscription below and the organiser will renew your sign-in access.
        </p>
        {requested || state.ok ? (
          <p className="mt-3 text-sm font-semibold text-green-700">
            Request submitted — the organiser will renew your access shortly.
          </p>
        ) : (
          <form action={formAction} className="mt-3">
            {state.error && <p className="mb-2 text-xs font-semibold text-red-600">{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {pending ? "Requesting…" : "Request New Subscription"}
            </button>
          </form>
        )}
        <div className="mt-3 text-amber-900"><OrganiserContact /></div>
      </div>
      <div className="mt-4">{signOutForm}</div>
    </main>
  );
}
