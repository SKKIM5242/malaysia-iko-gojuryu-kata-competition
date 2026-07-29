"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requestNewSubscription, type AccountActionState } from "@/app/actions/account";

const initial: AccountActionState = { ok: false };

/** Shown instead of the normal page content once Admin/Organizer's
 * sign-in quota (count and/or valid date range) for this account has run
 * out — see lib/sign-in-quota.ts. Requesting a new subscription takes them
 * to a real Stripe Checkout (priced off their current tier: USD 10 tier
 * renews at 10x, USD 100/USD 200 tiers renew at the same price) and falls
 * back to the manual organizer-confirms flow if Stripe isn't configured. */
export default function SubscriptionBlocked({
  title,
  reason,
  signOutForm,
}: {
  title: string;
  reason: string;
  signOutForm: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(requestNewSubscription, initial);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (state.ok && state.checkoutUrl) window.location.href = state.checkoutUrl;
    else if (state.ok) {
      setRequested(true);
      router.refresh();
    }
  }, [state, router]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
        <p className="font-semibold text-amber-900">{reason}</p>
        <p className="mt-1 text-sm text-amber-800">
          A new subscription is priced off your current tier — USD 10 tier renews at USD 100 (10x);
          USD 100 and USD 200 tiers renew at the same price. Once paid, it&apos;s valid for 3 months
          from today with 30 sign-ins available — whichever runs out first ends it, at which point
          you&apos;ll need to renew again or you may choose to sign in as audience instead.
        </p>
        {requested || (state.ok && !state.checkoutUrl) ? (
          <p className="mt-3 text-sm font-semibold text-green-700">
            Request submitted — the organizer will confirm your payment and renew your access shortly.
          </p>
        ) : (
          <form action={formAction} className="mt-3">
            {state.error && <p className="mb-2 text-xs font-semibold text-red-600">{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {pending ? "Redirecting to payment…" : "Request New Subscription"}
            </button>
          </form>
        )}
      </div>
      <div className="mt-4">{signOutForm}</div>
    </main>
  );
}
