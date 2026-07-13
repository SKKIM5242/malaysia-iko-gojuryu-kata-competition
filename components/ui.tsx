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
            <span className="block text-sm font-bold tracking-wide">MALAYSIA OPEN KARATE-DO KATA COMPETITION</span>
            <span className="block text-sm font-bold tracking-wide">Goju-ryu or IKO Goju-ryu Version Only</span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <Link href="/" className="rounded px-3 py-1.5 hover:bg-neutral-800">Home</Link>
          <Link href="/participants" className="rounded px-3 py-1.5 hover:bg-neutral-800">Participants</Link>
          <Link href="/winners" className="rounded px-3 py-1.5 hover:bg-neutral-800">Winners</Link>
          <Link href="/announcements" className="rounded px-3 py-1.5 hover:bg-neutral-800">Announcements</Link>
          <Link
            href="/register"
            className="ml-1 rounded bg-red-700 px-4 py-1.5 font-semibold hover:bg-red-600"
          >
            Register
          </Link>
          <Link
            href="/account"
            className="ml-1 rounded border border-white/30 px-4 py-1.5 font-semibold hover:bg-neutral-800"
            title="Sign in to Kata Arena — watch/record your kata, judge as a referee, or manage your account"
          >
            Kata Arena Log In
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
          Malaysia Open Karate-do Kata Competition - Goju-ryu or IKO Goju-ryu Version Only.
          Specially for all Goju-ryu Karateka to compete globally without leaving their beloved
          Country.
        </p>
        <p className="mt-1">
          Organiser:{" "}
          <a
            href="https://www.mixo.io/site/iko-goju-ryu-karate-do-m-sdn-bhd-wt9nk"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2 hover:text-neutral-900"
          >
            IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD
          </a>
        </p>
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

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5 fill-current"} aria-hidden="true">
      <path d="M21.95 3.5 2.98 10.9c-1.29.51-1.28 1.22-.24 1.53l4.87 1.52 11.29-7.12c.53-.32 1.02-.15.62.2L10.6 15.1l-.36 5.02c.52 0 .74-.24 1.02-.52l2.44-2.37 5.07 3.74c.93.52 1.6.25 1.84-.86l3.33-15.7c.35-1.36-.5-1.98-1.99-1.4Z" />
    </svg>
  );
}

/** Community access after registering/paying. Shows a Join button for the
 * registrant's own category group once configured; falls back to phone/email
 * until then so the page never links anywhere broken. */
export function TelegramJoinButton({ href, label = "Join Telegram Group" }: { href: string | null; label?: string }) {
  if (!href) {
    return (
      <div className="mt-3">
        <p className="text-sm text-neutral-500">Telegram community group launching soon.</p>
        <OrganiserContact />
      </div>
    );
  }
  return (
    <div className="mt-4 text-center">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-[#229ED9] px-6 py-2.5 font-semibold text-white hover:bg-[#1e8fc4]"
      >
        <TelegramIcon />
        {label}
      </a>
      <p className="mx-auto mt-2 max-w-sm text-xs text-neutral-500">
        MY Open Kata Competition by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD — ask questions and get
        updates from the organiser.
      </p>
    </div>
  );
}

/** Full access: every category's Telegram group, for approved Referee/Judge
 * and Admin/Organizer/Staff accounts. */
export function TelegramFullAccessLinks({
  links,
}: {
  links: Array<{ category: string; label: string; url: string }>;
}) {
  if (links.length === 0) {
    return <p className="text-sm text-neutral-500">Telegram groups launching soon.</p>;
  }
  return (
    <div className="space-y-2">
      {links.map((l) => (
        <a
          key={l.category}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-[#229ED9]/30 bg-[#229ED9]/5 px-4 py-2.5 text-sm font-semibold text-[#1c7fb5] hover:bg-[#229ED9]/10"
        >
          <TelegramIcon className="h-4 w-4 shrink-0 fill-current" />
          {l.label}
        </a>
      ))}
    </div>
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
