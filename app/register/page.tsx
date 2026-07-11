import {
  getActiveCompetition,
  getCategories,
  getSchools,
  getSenseis,
  schemaReady,
} from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader, formatDate, formatMYR } from "@/components/ui";
import RegisterForm from "@/components/RegisterForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register — Malaysia IKO Goju-ryu Kata Competition" };

export default async function RegisterPage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10"><SetupNotice /></main>
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
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Participant registration</h1>
        {competition && (
          <p className="mt-1 text-sm text-neutral-500">
            {competition.name} · {formatDate(competition.event_date)} · Fee {formatMYR(competition.registration_fee_myr)}
          </p>
        )}

        <div className="mt-8">
          {!competition ? (
            <EmptyState>There is no competition to register for right now.</EmptyState>
          ) : !open ? (
            <div className="rounded-lg border border-neutral-300 bg-neutral-100 p-8 text-center">
              <p className="text-lg font-bold text-neutral-700">Registration closed</p>
              <p className="mt-1 text-sm text-neutral-500">
                {deadlinePassed
                  ? `The registration deadline (${formatDate(competition.registration_deadline)}) has passed.`
                  : "This competition is not currently accepting registrations."}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                Fields marked * are required. After submitting you will receive a reference ID —
                transfer the fee of <strong>{formatMYR(competition.registration_fee_myr)}</strong> and send
                your receipt to the organiser to confirm your slot. Deadline:{" "}
                <strong>{formatDate(competition.registration_deadline)}</strong>.
              </div>
              <RegisterForm
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
