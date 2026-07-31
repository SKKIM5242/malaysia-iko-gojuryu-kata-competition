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

/** Fees for the community record types the organizer can add from the admin
 * panel. School/Sensei follow their chosen tier (see tierFeeUsd); Referee and
 * Audience are flat, matching what the public-facing copy already tells
 * people. Kept here rather than in app/actions/admin.ts because a
 * "use server" module may only export async functions. */
export const REFEREE_DEPOSIT_USD = 100;
export const AUDIENCE_FEE_USD = 10;
