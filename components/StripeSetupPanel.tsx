"use client";

import { useState, useTransition } from "react";
import { testStripeConnection, type StripeConnectionResult } from "@/app/actions/admin";

/**
 * Stripe status + setup guide on the Commissions page — deliberately not a
 * form to type keys into. A Stripe secret key can move money and read
 * every customer's payment details, so it stays in Vercel's environment
 * variables (the current, correct setup) rather than this app's own
 * database, where a future bug elsewhere could expose it in a way an env
 * var never can. This panel only shows derived, non-secret status (is one
 * configured, test or live) and lets you confirm the configured key
 * actually authenticates, via testStripeConnection in app/actions/admin.ts
 * — which never returns or logs the key itself.
 */
export default function StripeSetupPanel({
  secretKeyConfigured,
  secretKeyMode,
  webhookSecretConfigured,
  webhookUrl,
}: {
  secretKeyConfigured: boolean;
  secretKeyMode: "test" | "live" | null;
  webhookSecretConfigured: boolean;
  webhookUrl: string;
}) {
  const [result, setResult] = useState<StripeConnectionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <h2 id="stripe-setup" className="mt-10 mb-2 scroll-mt-4 text-lg font-bold text-neutral-900">Stripe Setup</h2>
      <p className="mb-4 max-w-3xl text-sm text-neutral-500">
        Keys stay in Vercel&apos;s environment variables, not in this app&apos;s database — a secret key can move
        money and read every customer&apos;s payment details, so it never gets typed into or stored by this app
        itself. This panel just shows whether one&apos;s configured and lets you confirm it actually works.
      </p>
      <div className="max-w-2xl space-y-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-neutral-700">Secret key:</span>
          {secretKeyConfigured ? (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                secretKeyMode === "live" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
              }`}
            >
              {secretKeyMode === "live" ? "🔴 LIVE mode" : secretKeyMode === "test" ? "🟡 TEST mode" : "Configured (unrecognized format)"}
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-500">Not configured</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-neutral-700">Webhook secret:</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              webhookSecretConfigured ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-500"
            }`}
          >
            {webhookSecretConfigured ? "Configured" : "Not configured"}
          </span>
        </div>
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await testStripeConnection()))}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-60"
          >
            {pending ? "Testing…" : "Test connection"}
          </button>
          {result && (
            <p className={`mt-2 text-xs font-semibold ${result.ok ? "text-green-700" : "text-red-700"}`}>
              {result.ok ? "✅" : "❌"} {result.message}
            </p>
          )}
        </div>
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
          <p className="font-semibold text-neutral-700">To set or update the live keys:</p>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-4">
            <li>
              Get your live keys from Stripe Dashboard → Developers → API keys (toggle &quot;View live data&quot; on
              first — otherwise it shows test keys).
            </li>
            <li>
              In Vercel: your project → Settings → Environment Variables, set{" "}
              <code className="rounded bg-white px-1 py-0.5">STRIPE_SECRET_KEY</code> to the{" "}
              <code className="rounded bg-white px-1 py-0.5">sk_live_…</code> key.
            </li>
            <li>
              In Stripe Dashboard → Developers → Webhooks, add an endpoint at{" "}
              <code className="break-all rounded bg-white px-1 py-0.5">{webhookUrl}</code> listening for{" "}
              <code className="rounded bg-white px-1 py-0.5">checkout.session.completed</code>, then copy its
              signing secret into <code className="rounded bg-white px-1 py-0.5">STRIPE_WEBHOOK_SECRET</code> in
              Vercel.
            </li>
            <li>Redeploy (a normal git push triggers this) so the new values take effect, then use &quot;Test connection&quot; above to confirm.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
