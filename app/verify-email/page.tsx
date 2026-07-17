import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ui";
import { verifyEmailToken } from "@/app/actions/email-verification";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token
    ? await verifyEmailToken(token)
    : { ok: false, message: "Missing verification link." };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-4xl">{result.ok ? "✅" : "⚠️"}</p>
        <h1 className="mt-3 text-xl font-bold">
          {result.ok ? "Email verified" : "Verification failed"}
        </h1>
        <p className="mt-2 text-sm text-neutral-600">{result.message}</p>
        <Link
          href="/account"
          className="mt-6 inline-block rounded-md bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600"
        >
          {result.ok ? "Sign in" : "Back to My Account"}
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
