import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="text-6xl font-black text-neutral-300">404</p>
        <h1 className="mt-3 text-xl font-bold">Page Not Found</h1>
        <p className="mt-2 text-neutral-500">The page you are looking for doesn&apos;t exist or has been moved.</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
        >
          Back to homepage
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
