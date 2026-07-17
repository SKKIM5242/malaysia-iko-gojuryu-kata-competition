import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register" };

const OPTIONS: Array<{
  n: number;
  title: string;
  desc: string;
  href: string;
  cta: string;
}> = [
  {
    n: 1,
    title: "School / Dojo",
    desc: "Register your school or dojo so senseis and participants can select it.",
    href: "/register/school",
    cta: "Register school / dojo",
  },
  {
    n: 2,
    title: "My Sensei / Coach",
    desc: "Students or club representatives register their sensei / coach.",
    href: "/register/sensei?by=student",
    cta: "Register my sensei",
  },
  {
    n: 3,
    title: "Sensei / Coach self-registration",
    desc: "Senseis and coaches register themselves.",
    href: "/register/sensei?by=self",
    cta: "Self-register as sensei",
  },
  {
    n: 4,
    title: "Referee / Judges",
    desc: "Register as a kata referee or judge. USD 100 deposit or USD 0 with an invitation code.",
    href: "/register/referee",
    cta: "Register as referee / judge",
  },
  {
    n: 5,
    title: "Audience / Onlooker / Visitor / Spectator",
    desc: "Sign in to watch the competition. USD 10, or USD 0 with an invitation code.",
    href: "/register/audience",
    cta: "Register as audience",
  },
  {
    n: 6,
    title: "Admin / Organizer / Customer Support",
    desc: "Apply to join the organising or support team. Reviewed by the organiser.",
    href: "/register/staff",
    cta: "Apply to the team",
  },
];

export default function RegisterHub() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Registration</h1>
        <p className="mt-1 text-sm text-neutral-500">Choose what you are registering.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:col-span-2">
            <strong>Note:</strong> Participants must 1) Register their own{" "}
            <Link href="/register/school" className="font-semibold underline underline-offset-2">School / Dojo</Link>{" "}
            and 2){" "}
            <Link href="/register/sensei" className="font-semibold underline underline-offset-2">Register your Sensei / Coach</Link>{" "}
            before registering themself here. The same applies to a Sensei registering on behalf of
            their students, or use the{" "}
            <Link href="/register/bulk" className="font-semibold underline underline-offset-2">bulk registration table</Link>{" "}
            for multiple students. This is because your School and Sensei are required fields, so
            each needs their own registration too — the minimum total cost is 3× your chosen
            tier's participant fee (your fee plus your School's and Sensei's), and up to 5× if you
            participate in 3 Kata events.
          </div>

          <div className="rounded-xl border-2 border-red-700 bg-white p-5 shadow-sm sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-neutral-900">Competition participant</p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Individual karateka registering to compete in a kata event.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/register/participant"
                  className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
                >
                  Register participant
                </Link>
                <Link
                  href="/register/bulk"
                  className="rounded-md border border-red-700 px-5 py-2.5 font-semibold text-red-700 hover:bg-red-50"
                >
                  Bulk registration (up to 10,000 pax)
                </Link>
              </div>
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              Bulk registration is for senseis / coaches: fill the on-screen table, or download the
              CSV template, fill it in Excel, and upload it back — up to 10,000 participants.
            </p>
          </div>

          {OPTIONS.map((o) => (
            <div key={o.n} className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div>
                <p className="font-bold text-neutral-900">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">
                    {o.n}
                  </span>
                  {o.title}
                </p>
                <p className="mt-1.5 text-sm text-neutral-500">{o.desc}</p>
              </div>
              <Link
                href={o.href}
                className="mt-4 inline-block w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
              >
                {o.cta}
              </Link>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
