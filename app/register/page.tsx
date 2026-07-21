import Link from "next/link";
import { SiteFooter, SiteHeader, formatDate } from "@/components/ui";
import AccessComparisonTable from "@/components/AccessComparisonTable";
import { getOpenCompetitions, schemaReady } from "@/lib/data";
import { winnersRevealDateFor } from "@/lib/winners";
import type { Competition } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register" };

const TIER_FEE_NOTE =
  "Registering here is not free — the one-time registration fee follows the competition tier (USD 10 / USD 100 / USD 200 per tier), whether registering yourself or on someone's behalf. Payment is taken at registration.";

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
    desc: `Register your school or dojo so senseis and participants can select it. ${TIER_FEE_NOTE}`,
    href: "/register/school",
    cta: "Register school / dojo",
  },
  {
    n: 2,
    title: "My Sensei / Coach",
    desc: `Students or club representatives register their sensei / coach. ${TIER_FEE_NOTE} Senseis are also warmly encouraged to join as Participant Support — help fellow karateka while staying close to the action.`,
    href: "/register/sensei?by=student",
    cta: "Register my sensei",
  },
  {
    n: 3,
    title: "Sensei / Coach self-registration",
    desc: `Senseis and coaches register themselves. ${TIER_FEE_NOTE} Senseis holding 3rd Dan and above are encouraged to also register as Referee/Judge to earn extra commission, and every sensei is warmly encouraged to join as Participant Support too.`,
    href: "/register/sensei?by=self",
    cta: "Self-register as sensei",
  },
  {
    n: 4,
    title: "Referee / Judges",
    desc:
      "Register as a kata referee or judge. USD 100 deposit per competition tier. Referee/judge work starts after the event deadline: you have 2 weeks after the deadline to submit your scores — after the 2nd week, unscored recordings are re-assigned, and the re-assigned referee/judge gets 1 week. If a score is still missing, the organizer takes over in the 4th week, before the winner announcement date. Senseis holding 3rd Dan and above are encouraged to register as Referee/Judge.",
    href: "/register/referee",
    cta: "Register as referee / judge",
  },
  {
    n: 5,
    title: "Audience / Onlooker / Visitor / Spectator",
    desc:
      "Sign in to watch — USD 10 / USD 100 / USD 200 per competition tier, per sign-in. Don't stay idle for more than 25 minutes: after 30 idle minutes the site automatically signs you out. We encourage signing in once Winners are announced, so one sign-in shows you every recording AND the judges' scores. Signing in during the competition shows only what has been submitted so far, with no judge scores — judge scores become available only after Winners are finalized.",
    href: "/register/audience",
    cta: "Register as audience",
  },
  {
    n: 6,
    title: "Participant Support",
    desc:
      "Apply to join the Participant Support team. Reviewed by the organizer. Each country is allocated only 1 Participant Support slot, so secure yours early. Why does Participant Support get view access that Schools, Senseis, Participants, Audience, and Referees don't? Because they are the help desk: to answer a registrant's or referee's question, they must be able to see the same screens the person asking is looking at — payments, registrations, and judging status. They can look things up and mark payments, but they can't score, delete records, or change the competition setup. This is a voluntary role with no guaranteed return from the USD 10 tier, since its margin is low — but it's a training ground for the USD 100 / USD 200 tiers. The organizer will try to allocate 20% of the Audience group's revenue to reward the Participant Support team, based on the number and complexity of tasks handled outside their own school or students. Good performance earns priority offers for the next competition. On top of that, you earn a 10% cut of every Audience sign-in made under your recommendation — the Audience member enters your Participant Support short name or initial at sign-in (e.g. Amy / KSK).",
    href: "/register/staff",
    cta: "Apply to the team",
  },
];

function announceDateOf(c: Competition): Date | null {
  return winnersRevealDateFor(c.registration_deadline, c.winners_announce_date);
}

export default async function RegisterHub({
  searchParams,
}: {
  searchParams: Promise<{ competition?: string }>;
}) {
  const { competition: competitionId } = await searchParams;
  const tierSuffix = competitionId ? `?competition=${competitionId}` : "";
  const competitions = (await schemaReady()) ? await getOpenCompetitions() : [];
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
                  href={`/register/participant${tierSuffix}`}
                  className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
                >
                  Register participant
                </Link>
                <Link
                  href={`/register/bulk${tierSuffix}`}
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

        {competitions.length > 0 && (
          <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-neutral-900">Winners</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Winners for each competition are announced 30 days after its registration deadline,
              on the next working day (Monday–Friday) in Malaysia, at 00:00 Malaysia time — unless
              the organizer sets a special announcement date for that tier (shown below). The
              period from Event date to Registration deadline is the participants&apos;
              recording-submission timeline; referees start scoring only after the deadline.
            </p>
            <ul className="mt-3 space-y-2">
              {competitions
                .filter((c) => announceDateOf(c) != null)
                .map((c) => (
                  <li key={c.id} className="rounded-md border border-neutral-100 bg-neutral-50 px-4 py-2.5 text-sm">
                    <span className="font-semibold text-neutral-800">{c.name}</span>
                    <span className="block text-neutral-600">
                      Winners will be announced on{" "}
                      <strong>{formatDate(announceDateOf(c)!.toISOString().slice(0, 10))}</strong>, 00:00
                      Malaysia time.
                      {c.winners_announce_date && (
                        <span className="text-neutral-400"> (special date set by the organizer)</span>
                      )}
                    </span>
                    {c.audience_signin_date && (
                      <span className="block text-neutral-600">
                        Recommended public / audience sign-in date (or any date after):{" "}
                        <strong>
                          {formatDate(winnersRevealDateFor(null, c.audience_signin_date)!.toISOString().slice(0, 10))}
                        </strong>{" "}
                        — one sign-in then shows every recording and the judges&apos; scores.
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="mt-8">
          <AccessComparisonTable />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
