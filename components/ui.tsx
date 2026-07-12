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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Malaysia IKO Goju-ryu Karate-do crest"
            className="h-11 w-11 rounded-lg bg-white p-0.5"
          />
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-wide">MALAYSIA OPEN — IKO GOJU-RYU KARATE-DO</span>
            <span className="block text-xs text-neutral-400">Kata Competition — Goju-ryu Version Only</span>
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
        <p className="font-semibold text-neutral-700">
          Malaysia Open — IKO Goju-ryu Karate-do — Kata Competition — Goju-ryu Version Only
        </p>
        <p className="mt-1">Organiser: IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD</p>
        <p className="mt-1">
          <Link href="/announcements" className="underline underline-offset-2">Announcements</Link> ·{" "}
          <Link href="/participants" className="underline underline-offset-2">Participants</Link> ·{" "}
          <Link href="/register" className="underline underline-offset-2">Register participant</Link> ·{" "}
          <Link href="/register/school" className="underline underline-offset-2">Register school</Link> ·{" "}
          <Link href="/register/sensei" className="underline underline-offset-2">Register sensei</Link> ·{" "}
          <Link href="/register/bulk" className="underline underline-offset-2">Bulk registration</Link>
        </p>
      </div>
    </footer>
  );
}

/** Shown to registered users only (success screens, admin) — not on public pages. */
export function OrganiserContact() {
  return (
    <p className="mt-3 text-sm">
      Questions? Contact the organiser — Mobile / WhatsApp:{" "}
      <a href="https://wa.me/60124532831" className="font-semibold underline underline-offset-2">+60 12-453 2831</a>{" "}
      · Email:{" "}
      <a href="mailto:kimsiewkiew@gmail.com" className="font-semibold underline underline-offset-2">kimsiewkiew@gmail.com</a>
    </p>
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

export function formatUSD(n: number | null | undefined): string {
  if (n == null) return "TBA";
  return `USD ${Number(n).toFixed(2)}`;
}
