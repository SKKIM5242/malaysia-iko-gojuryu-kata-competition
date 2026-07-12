import {
  getActiveCompetition,
  getCategories,
  getSchools,
  getSenseis,
  schemaReady,
} from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader, formatDate, formatUSD } from "@/components/ui";
import BulkRegisterForm from "@/components/BulkRegisterForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bulk registration (Sensei / Coach)" };

export default async function BulkRegisterPage() {
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

  const competition = await getActiveCompetition();
  const deadlinePassed =
    competition?.registration_deadline != null &&
    new Date(competition.registration_deadline + "T23:59:59") < new Date();
  const open = competition?.status === "open" && !deadlinePassed;

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
        <div className="mt-8">
          {!competition ? (
            <EmptyState>There is no competition to register for right now.</EmptyState>
          ) : !open ? (
            <EmptyState>Registration is closed for this competition.</EmptyState>
          ) : (
            <>
              <div className="mb-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                Fill one row per participant — like a spreadsheet. Select your school / dojo and
                sensei / coach once at the top; they apply to every row. All fields marked * are
                required, including each participant&apos;s bank details for prize payouts.
              </div>
              <BulkRegisterForm
                competition={competition}
                categories={categories}
                schools={schools}
                senseis={senseis}
              />
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
