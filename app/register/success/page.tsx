import Link from "next/link";
import { redirect } from "next/navigation";
import { paymentsEnabled } from "@/lib/payments";
import { finalizeStripeSession } from "@/lib/finalize";
import { OrganiserContact, SiteFooter, SiteHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payment result" };

export default async function RegisterSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  if (!paymentsEnabled() || !session_id) redirect("/register");

  const result = await finalizeStripeSession(session_id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        {result.status === "paid" ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
            <p className="text-3xl">✅</p>
            <h1 className="mt-2 text-xl font-bold text-green-900">Payment successful — registration confirmed!</h1>
            <p className="mt-2 text-green-800">
              Your registration reference ID is{" "}
              <span className="rounded bg-white px-2 py-0.5 font-mono font-bold tracking-wider">
                {result.referenceId}
              </span>
            </p>
            <p className="mx-auto mt-3 max-w-md text-sm text-green-800">
              Your payment has been received and your slot is confirmed. Your name now appears on the{" "}
              <Link href="/participants" className="underline">participants list</Link>. A Stripe receipt
              has been sent to the email you entered at checkout.
            </p>
            <div className="mx-auto max-w-md text-green-900"><OrganiserContact /></div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/account"
                className="rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white hover:bg-red-600"
              >
                Start Recording
              </Link>
              <Link
                href="/"
                className="rounded-md border border-green-300 bg-white px-6 py-2.5 font-semibold text-green-800 hover:bg-green-50"
              >
                Sign in later for Recording
              </Link>
            </div>
            <p className="mx-auto mt-2 max-w-md text-xs text-green-700">
              Keep your reference ID <strong>{result.referenceId}</strong> and the IC/passport you
              registered with — you&apos;ll need both to link your account when you&apos;re ready to record.
            </p>
          </div>
        ) : result.status === "unpaid" ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-8 text-center">
            <h1 className="text-xl font-bold text-amber-900">Payment not completed</h1>
            <p className="mt-2 text-sm text-amber-800">
              Your payment was not completed, so no registration was submitted.
            </p>
            <Link
              href="/register"
              className="mt-5 inline-block rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
            >
              Try again
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-red-300 bg-red-50 p-8 text-center">
            <h1 className="text-xl font-bold text-red-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-red-800">{result.message}</p>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
