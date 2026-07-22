"use client";

import { useActionState, useEffect } from "react";
import { createSampleStripeCheckout, type SampleCheckoutState } from "@/app/actions/preview";

const initial: SampleCheckoutState = { done: false };

/** Opens a real, test-mode Stripe Checkout session in a new tab — the
 * exact same payment page participants reach for tier fees, extra
 * recording attempts, etc., but for a nominal USD 1.00 sample that isn't
 * tied to any registration. Lets Admin/Organizer see what Stripe looks
 * like without touching real data. */
export default function SampleStripeCheckoutButton({ disabled }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(createSampleStripeCheckout, initial);

  useEffect(() => {
    if (state.checkoutUrl) window.open(state.checkoutUrl, "_blank", "noopener,noreferrer");
  }, [state]);

  if (disabled) {
    return (
      <p className="text-xs text-neutral-400">
        View access only — Admin/Organizer can open a real sample Stripe checkout page here.
      </p>
    );
  }

  return (
    <form action={formAction}>
      {state.error && <p className="mb-1 text-xs font-semibold text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
      >
        {pending ? "Creating sample checkout…" : "Open sample Stripe checkout page (test mode) ↗"}
      </button>
    </form>
  );
}
