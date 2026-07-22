"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestExtraAttempts, type AccountActionState } from "@/app/actions/account";

const initial: AccountActionState = { ok: false };

/** Shown once a participant has used all their free delete-and-re-record
 * chances — lets them buy 3 more for USD 10 via a real Stripe Checkout
 * session (falls back to the manual bank-transfer/admin-confirms flow if
 * Stripe isn't configured, same as every other payment in this app). */
export default function BuyExtraAttemptsButton({ hasPendingPurchase }: { hasPendingPurchase: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(requestExtraAttempts, initial);

  useEffect(() => {
    if (state.ok && state.checkoutUrl) window.location.href = state.checkoutUrl;
    else if (state.ok) router.refresh();
  }, [state, router]);

  if (hasPendingPurchase || (state.ok && !state.checkoutUrl)) {
    return (
      <p className="text-xs font-semibold text-amber-700">
        Payment pending — the organizer will confirm your USD 10 payment and add 3 more attempts.
      </p>
    );
  }

  return (
    <div>
      {state.error && <p className="mb-1 text-xs font-semibold text-red-600">{state.error}</p>}
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Redirecting to payment…" : "Buy 3 more attempts — USD 10"}
        </button>
      </form>
      <p className="mt-1 text-xs text-neutral-400">
        Takes you to a secure Stripe checkout — 3 more delete-and-re-record chances are added to your
        account the moment payment succeeds.
      </p>
    </div>
  );
}
