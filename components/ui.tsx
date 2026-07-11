import Link from "next/link";
import type { ReactNode } from "react";
import type { PaymentStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const styles: Record<PaymentStatus, string> = {
    paid: "bg-green-100 text-green-800 border-green-300",
    pending: "bg-amber-100 text-amber-800 border-amber-300",
    rejected: "bg-red-100 text-red-800 border-red-300",
  };
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[status] ?? styles.pending}`}
    >
      {status}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-neutral-500">
      {children}
    </div>
  );
}

export function ErrorState({ children }: { children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-700">
      {children ?? "Something went wrong loading this data. Please refresh the page."}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="text-xl font-bold tracking-tight text-neutral-900">{children}</h2>
      {action}
    </div>
  );
}

export function SetupNotice() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900">
      <p className="font-semibold">Database not initialised yet</p>
      <p className="mt-1 text-sm">
        The schema in <code className="rounded bg-amber-100 px-1">supabase/migrations/0001_init.sql</code>{" "}
        has not been applied to the Supabase project. Run it in the Supabase SQL editor, then refresh.
      </p>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-neutral-200 bg-neutral-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-700 font-bold">剛</span>
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-wide">MALAYSIA IKO GOJU-RYU</span>
            <span className="block text-xs text-neutral-400">Kata Competition</span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <Link href="/" className="rounded px-3 py-1.5 hover:bg-neutral-800">Home</Link>
          <Link href="/participants" className="rounded px-3 py-1.5 hover:bg-neutral-800">Participants</Link>
          <Link href="/announcements" className="rounded px-3 py-1.5 hover:bg-neutral-800">Announcements</Link>
          <Link
            href="/register"
            className="ml-1 rounded bg-red-700 px-4 py-1.5 font-semibold hover:bg-red-600"
          >
            Register
          </Link>
          <Link href="/admin" className="rounded px-3 py-1.5 text-neutral-400 hover:bg-neutral-800">
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-neutral-500">
        <p className="font-semibold text-neutral-700">Malaysia IKO Goju-ryu Kata Competition</p>
        <p className="mt-1">
          Official competition platform of the Malaysia IKO Goju-ryu community.{" "}
          <Link href="/announcements" className="underline underline-offset-2">Announcements</Link> ·{" "}
          <Link href="/participants" className="underline underline-offset-2">Participants</Link> ·{" "}
          <Link href="/register" className="underline underline-offset-2">Register</Link>
        </p>
      </div>
    </footer>
  );
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "TBA";
  try {
    return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-MY", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

export function formatMYR(n: number | null | undefined): string {
  if (n == null) return "TBA";
  return `RM ${Number(n).toFixed(2)}`;
}
