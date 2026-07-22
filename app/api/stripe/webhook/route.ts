import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import {
  finalizeAttemptPurchaseSession,
  finalizeDirectorySession,
  finalizeInvoiceSession,
  finalizeStripeSession,
} from "@/lib/finalize";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!paymentsEnabled()) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  if (secret && signature) {
    try {
      event = await getStripe().webhooks.constructEventAsync(body, signature, secret);
    } catch {
      return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    }
  } else if (secret) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  } else {
    // No webhook secret configured — accept but re-verify against the Stripe
    // API: finalize() retrieves the session server-side, so a forged event id
    // can't mint a paid registration.
    try {
      event = JSON.parse(body) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.invoice_id) {
      await finalizeInvoiceSession(session.id);
    } else if (session.metadata?.school_id || session.metadata?.sensei_id) {
      await finalizeDirectorySession(session.id);
    } else if (session.metadata?.attempt_purchase_id) {
      await finalizeAttemptPurchaseSession(session.id);
    } else {
      await finalizeStripeSession(session.id);
    }
  }

  return NextResponse.json({ received: true });
}
