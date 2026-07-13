import Link from "next/link";
import {
  getCompetitionById,
  getOpenCompetitions,
  getCategories,
  getSchools,
  getSenseis,
  isCompetitionOpen,
  schemaReady,
} from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader, formatDate, formatUSD } from "@/components/ui";
import BulkRegisterForm from "@/components/BulkRegisterForm";
import CsvBulkForm from "@/components/CsvBulkForm";
import { kataBases } from "@/lib/division";

export const dynamic = "force-dynamic";
// CSV uploads with thousands of rows need more than the default 10s
export const maxDuration = 60;

export const metadata = { title: "Bulk registration (Sensei / Coach)" };

export default async function BulkRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ competition?: string }>;
}) {
  const { competition: competitionId } = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-10"><SetupNotice /></main>
        <SiteFooter />
      </>
    );
  }

  const openCompetitions = await getOpenCompetitions();

  if (!competitionId && openCompetitions.length > 1) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Choose a registration tier</h1>
          <p className="mt-1 mb-6 text-sm text-neutral-500">
            This event has more than one registration tier — pick one to bulk-register your students.
          </p>
          <div className="space-y-3">
            {openCompetitions.map((c) => (
              <Link
                key={c.id}
                href={`/register/bulk?competition=${c.id}`}
                className="block rounded-lg border border-neutral-200 bg-white p-4 shadow-sm hover:border-red-300"
              >
                <p className="font-bold text-neutral-900">{c.name}</p>
                <p className="text-sm text-neutral-500">
                  {formatUSD(c.registration_fee_usd)} · deadline {formatDate(c.registration_deadline)}
                </p>
              </Link>
            ))}
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const competition = competitionId
    ? await getCompetitionById(competitionId)
    : openCompetitions[0] ?? null;
  const open = competition ? isCompetitionOpen(competition) : false;

  const [categories, schools, senseis] = competition
    ? await Promise.all([getCategories(competition.id), getSchools(), getSenseis()])
    : [[], [], []];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Bulk registration — Sensei / Coach</h1>
        {competition && (
          <p className="mt-1 text-sm text-neutral-500">
            {competition.name} · {formatDate(competition.event_date)} · Fee{" "}
            {formatUSD(competition.registration_fee_usd)} per participant
          </p>
        )}
        {openCompetitions.length > 1 && (
          <Link href="/register/bulk" className="mt-1 inline-block text-xs text-red-700 underline underline-offset-2">
            ← Choose a different tier
          </Link>
        )}
        <div className="mt-8">
          {!competition ? (
            <EmptyState>There is no competition to register for right now.</EmptyState>
          ) : !open ? (
            <EmptyState>Registration is closed for this competition.</EmptyState>
          ) : (
            <>
              <section className="mb-10 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold">Option A — Excel / CSV upload (up to 10,000 pax)</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  1. <a href="/bulk-registration-template.csv" download className="font-semibold text-red-700 underline underline-offset-2">
                    Download the CSV template
                  </a>{" "}
                  (opens in Excel). 2. Fill one row per participant — keep the header row and use
                  dates as YYYY-MM-DD; kata_event must match one of the kata event names. 3. Save
                  as CSV and upload it below.
                </p>
                <div className="mt-4">
                  <CsvBulkForm competition={competition} schools={schools} senseis={senseis} />
                </div>
              </section>

              <section>
                <h2 className="text-lg font-bold">Option B — fill the table on screen</h2>
                <div className="mt-2 mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                  Fill one row per participant — like a spreadsheet. Your{" "}
                  <a href="/register/school" className="font-semibold underline underline-offset-2">School / Dojo</a>{" "}
                  and{" "}
                  <a href="/register/sensei" className="font-semibold underline underline-offset-2">Sensei / Coach</a>{" "}
                  must already be registered — select them once at the top; they apply to every row.
                  All fields marked * are required, including each participant&apos;s bank details
                  for prize payouts. Each student may register for a{" "}
                  <strong>maximum of 3 kata categories</strong> — add one row per kata.
                </div>
                <BulkRegisterForm
                  competition={competition}
                  kataBases={kataBases(categories)}
                  schools={schools}
                  senseis={senseis}
                />
              </section>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
