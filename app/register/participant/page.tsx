import {
  getActiveCompetition,
  getCategories,
  getSchools,
  getSenseis,
  schemaReady,
} from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader, formatDate, formatUSD } from "@/components/ui";
import RegisterForm from "@/components/RegisterForm";
import { paymentsEnabled } from "@/lib/payments";
import { kataBases } from "@/lib/division";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register" };

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
            {competition.name} · {formatDate(competition.event_date)} · Fee {formatUSD(competition.registration_fee_usd)}
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
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <strong>Note:</strong> participants must 1) select a registered{" "}
                <a href="/register/school" className="font-semibold underline underline-offset-2">School / Dojo</a>{" "}
                and 2){" "}
                <a href="/register/sensei" className="font-semibold underline underline-offset-2">register your Sensei / Coach</a>{" "}
                before registering yourself here. The same applies to a Sensei registering on behalf
                of their students — use the{" "}
                <a href="/register/bulk" className="font-semibold underline underline-offset-2">bulk registration table</a>{" "}
                for multiple students.
                <br className="hidden sm:block" />
                After registration, proceed to recording your kata with your phone camera for the
                next step. You only get <strong>3 chances</strong> to delete and re-record your kata.
                Each participant may register for a <strong>maximum of 3 kata categories</strong>.
              </div>
              <div className="mb-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                {paymentsEnabled() && Number(competition.registration_fee_usd ?? 0) > 0 ? (
                  <>
                    Fields marked * are required. After filling the form you will be taken to a
                    secure payment page for the fee of{" "}
                    <strong>{formatUSD(competition.registration_fee_usd)}</strong> — your registration
                    is confirmed automatically once payment succeeds. Deadline:{" "}
                    <strong>{formatDate(competition.registration_deadline)}</strong>.
                  </>
                ) : (
                  <>
                    Fields marked * are required. After submitting you will receive a reference ID —
                    transfer the fee of <strong>{formatUSD(competition.registration_fee_usd)}</strong> and send
                    your receipt to the organiser to confirm your slot. Deadline:{" "}
                    <strong>{formatDate(competition.registration_deadline)}</strong>.
                  </>
                )}
              </div>
              <RegisterForm
                competition={competition}
                kataBases={kataBases(categories)}
                schools={schools}
                senseis={senseis}
                payOnline={paymentsEnabled() && Number(competition.registration_fee_usd ?? 0) > 0}
              />
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
