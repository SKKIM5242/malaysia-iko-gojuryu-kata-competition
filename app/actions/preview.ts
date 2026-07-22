"use server";

import { headers } from "next/headers";
import { getStripe, paymentsEnabled } from "@/lib/payments";

export interface SampleCheckoutState {
  done: boolean;
  error?: string;
  checkoutUrl?: string;
}

/** Creates a real, test-mode Stripe Checkout session for USD 1.00 purely so
 * Admin/Organizer can see exactly what a live Stripe payment page looks
 * like (same one participants reach for tier fees, extra recording
 * attempts, etc.) without needing to trigger a real registration flow.
 * Nothing in the app is marked paid from this — it's a standalone sample. */
export async function createSampleStripeCheckout(): Promise<SampleCheckoutState> {
  if (!paymentsEnabled()) {
    return { done: false, error: "Stripe isn't configured in this environment." };
  }
  const origin =
    (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 100,
            product_data: {
              name: "Sample Payment Preview (test mode)",
              description: "Admin preview only — not tied to any real registration or fee.",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/admin/bulk-registration-preview?sample=paid`,
      cancel_url: `${origin}/admin/bulk-registration-preview?sample=cancelled`,
    });
    if (!session.url) return { done: false, error: "Stripe did not return a checkout page." };
    return { done: true, checkoutUrl: session.url };
  } catch {
    return { done: false, error: "Could not create the sample checkout session." };
  }
}
