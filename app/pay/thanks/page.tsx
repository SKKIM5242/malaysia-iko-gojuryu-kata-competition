import Link from "next/link";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import {
  finalizeAttemptPurchaseSession,
  finalizeBulkUploadBatchSession,
  finalizeDirectorySession,
  finalizeInvoiceSession,
} from "@/lib/finalize";
import { SiteFooter, SiteHeader, TelegramJoinButton } from "@/components/ui";
import { getTelegramLink } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payment" };

export default async function PayThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; cancelled?: string }>;
}) {
  const { session_id, cancelled } = await searchParams;
  let result = null;
  let kind: "directory" | "invoice" | "attempts" | "bulk" = "invoice";
  if (!cancelled && session_id && paymentsEnabled()) {
    // One thank-you page serves class invoices, School/Sensei tier fees,
    // extra re-record attempt purchases, and bulk registration batches — the
    // session's metadata says which finalizer applies.
    let metadata: Record<string, string> | null = null;
    try {
      metadata = (await getStripe().checkout.sessions.retrieve(session_id)).metadata ?? null;
    } catch {
      metadata = null;
    }
    kind = metadata?.school_id || metadata?.sensei_id
      ? "directory"
      : metadata?.attempt_purchase_id
        ? "attempts"
        : metadata?.bulk_batch_id
          ? "bulk"
          : "invoice";
    result =
      kind === "directory"
        ? await finalizeDirectorySession(session_id)
        : kind === "attempts"
          ? await finalizeAttemptPurchaseSession(session_id)
          : kind === "bulk"
            ? await finalizeBulkUploadBatchSession(session_id)
            : await finalizeInvoiceSession(session_id);
  }
  const isDirectory = kind === "directory";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        {result?.status === "paid" ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
            <p className="text-3xl">✅</p>
            <h1 className="mt-2 text-xl font-bold text-green-900">Payment Received — Thank You!</h1>
            <p className="mt-2 text-green-800">
              {kind === "attempts" ? (
                <>3 more re-record attempts have been added to your account. A Stripe receipt has been emailed to you.</>
              ) : kind === "bulk" ? (
                <>
                  Bulk registration batch{" "}
                  <span className="rounded bg-white px-2 py-0.5 font-mono font-bold">{result.referenceIds[0]}</span>{" "}
                  is paid — you can upload your participants now. A Stripe receipt and email confirmation have been sent to you.
                </>
              ) : (
                <>
                  {isDirectory ? "Registration" : "Invoice"}{" "}
                  <span className="rounded bg-white px-2 py-0.5 font-mono font-bold">{result.referenceIds[0]}</span>{" "}
                  is now marked paid. A Stripe receipt has been emailed to you.
                </>
              )}
            </p>
            {kind === "attempts" ? (
              <Link href="/kata-arena" className="mt-5 inline-block rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600">
                Back to Kata Arena
              </Link>
            ) : kind === "bulk" ? (
              <Link href="/register/bulk" className="mt-5 inline-block rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600">
                Back to Bulk Registration
              </Link>
            ) : (
              <div className="mx-auto max-w-md text-green-900">
                <TelegramJoinButton href={getTelegramLink(isDirectory ? "school" : "class")} />
              </div>
            )}
          </div>
        ) : result?.status === "unpaid" ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-8 text-center">
            <h1 className="text-xl font-bold text-amber-900">Payment Not Completed</h1>
            <p className="mt-2 text-sm text-amber-800">
              The payment was not completed. You can reopen the payment link the organizer sent you
              and try again.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-300 bg-neutral-100 p-8 text-center">
            <h1 className="text-xl font-bold text-neutral-700">
              {cancelled ? "Payment Canceled" : "Nothing To Show Here"}
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              {cancelled
                ? "No charge was made. Reopen the payment link when you are ready."
                : "This page confirms class fee payments made through the organizer's payment links."}
            </p>
            <Link href="/" className="mt-5 inline-block rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600">
              Back to homepage
            </Link>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
