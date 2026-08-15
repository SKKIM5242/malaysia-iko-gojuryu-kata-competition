import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import CertificateUploadField from "@/components/CertificateUploadField";
import FlashToast from "@/components/FlashToast";
import ClickAnchorCapture from "@/components/ClickAnchorCapture";
import { adminInput, adminLabel, adminBtn, adminBtnSecondary, Card } from "@/components/admin-styles";

const FULL_NAV: Array<[string, string]> = [
  ["Dashboard", "/admin"],
  ["Full Activity Log", "/admin/activity"],
  ["Registrations", "/admin/registrations"],
  ["Competitions", "/admin/competitions"],
  ["Announcements", "/admin/announcements"],
  ["Schools", "/admin/schools"],
  ["Senseis", "/admin/senseis"],
  ["Participants", "/admin/participants"],
  ["Judges", "/admin/referees"],
  ["Audience", "/admin/audience"],
  ["Organizers", "/admin/organizers"],
  ["Support", "/admin/support"],
  ["Judging", "/admin/judging"],
  ["Score Recordings", "/admin/scoring"],
  ["Recording Preview", "/admin/recording-preview"],
  ["Mobile Preview", "/admin/mobile-preview"],
  ["Bulk Registration", "/admin/bulk-registration-preview"],
  ["Kata Categories", "/kata-categories"],
  ["Kata Arena", "/kata-arena"],
  ["Participant Records", "/admin/records"],
  ["Winners", "/admin/winners"],
  ["Commissions", "/admin/commissions"],
  ["Certificates", "/admin/certificates"],
  ["Issue Reports", "/admin/issue-reports"],
  ["Telegram Links", "/admin/telegram"],
  ["Telegram DM", "/admin/telegram-dm"],
  ["Classes", "/admin/classes"],
  ["Content", "/admin/content"],
  ["Accounts", "/admin/accounts"],
  ["Email Verifications", "/admin/email-verifications"],
  ["Kata Arena Log In", "/account"],
];

/** Pages hidden from the nav per role: Accounts/Email Verifications are the
 * owner's alone; the Content studio is Admin & Organizer only. */
const ADMIN_ONLY_NAV = ["/admin/accounts", "/admin/email-verifications"];
const ADMIN_ORGANIZER_NAV = ["/admin/content", "/admin/scoring"];

export async function AdminShell({
  title,
  active,
  children,
  flash,
}: {
  title: string;
  active: string;
  children: ReactNode;
  flash?: { ok?: string; error?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const role = profile?.role ?? null;

  const nav = FULL_NAV.filter(([, href]) => {
    if (ADMIN_ONLY_NAV.includes(href)) return role === "admin";
    if (ADMIN_ORGANIZER_NAV.includes(href)) return ["admin", "organizer", "staff"].includes(role ?? "");
    return true;
  });
  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 lg:py-1.5">
          <Link href="/admin" className="flex items-center gap-2 font-bold lg:gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Malaysia IKO Goju-ryu Karate-do crest"
              className="h-8 w-8 rounded-md bg-white p-0.5 lg:h-6 lg:w-6"
            />
            Admin Panel
          </Link>
          <div className="flex items-center gap-3 text-sm lg:gap-2">
            <Link href="/" className="text-neutral-400 hover:text-white">← Public site</Link>
            <form action={signOut}>
              <button className="rounded border border-neutral-700 px-3 py-1 text-neutral-300 hover:bg-neutral-800 lg:px-2 lg:py-0.5">
                Log out
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-1 overflow-x-auto px-4 pb-2 text-sm lg:gap-x-0.5 lg:gap-y-0 lg:pb-1.5 lg:text-[15px] lg:leading-none">
          {nav.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={`rounded px-3 py-1.5 whitespace-nowrap lg:px-2 lg:py-0.5 ${
                active === href ? "bg-red-700 font-semibold" : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 lg:py-4">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <ClickAnchorCapture />
        <FlashToast ok={flash?.ok} error={flash?.error} />
        <div className="mt-6 lg:mt-3">{children}</div>
      </main>
    </div>
  );
}

export { adminInput, adminLabel, adminBtn, adminBtnSecondary, Card };

/** Upload-or-take-a-picture field for a latest rank certificate. Reused on
 * the Sensei, Participant, and Referee/Judge admin forms (Schools have no
 * rank, so they don't get this field). */
export function CertificateField({
  currentUrl,
  required,
}: {
  currentUrl?: string | null;
  /** Set on create-only forms where a certificate is mandatory (e.g.
   * Senseis) — never on edit, since re-uploading shouldn't be forced when
   * a certificate is already on file. */
  required?: boolean;
}) {
  const mustUpload = required && !currentUrl;
  return (
    <div>
      <label htmlFor="certificate" className={adminLabel}>
        Latest rank certificate{mustUpload ? " *" : ""}
      </label>
      <CertificateUploadField id="certificate" name="certificate" required={mustUpload} />
      <div className="mt-1 flex items-center gap-3">
        <p className="text-xs text-neutral-400">Leave blank to keep the existing certificate.</p>
        {currentUrl && (
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap text-xs font-semibold text-green-700 underline underline-offset-2"
          >
            View current
          </a>
        )}
      </div>
    </div>
  );
}
