import Stripe from "stripe";

/**
 * Online payment is active only when both the Stripe secret and the
 * service-role key are configured (the service role finalises paid
 * registrations past the anon RLS policies). Without them the form
 * falls back to the manual bank-transfer flow, so the site keeps
 * working while keys are being provisioned.
 */
export function paymentsEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripe;
}
