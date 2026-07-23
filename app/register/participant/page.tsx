import {
  getOpenCompetitions,
  getCategories,
  getSchools,
  getSenseis,
  isCompetitionOpen,
  schemaReady,
} from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader, formatDate, formatUSD } from "@/components/ui";
import RegisterForm from "@/components/RegisterForm";
import { paymentsEnabled } from "@/lib/payments";
import type { Category } from "@/lib/types";

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

  // Cheapest tier first — that's the required "tier 1" column on the form;
  // every other open tier is an optional extra a participant can pick up in
  // the same sitting instead of registering again later.
  const competitions = (await getOpenCompetitions())
    .filter(isCompetitionOpen)
    .sort((a, b) => Number(a.registration_fee_usd ?? 0) - Number(b.registration_fee_usd ?? 0));

  const [categoryLists, schools, senseis] = await Promise.all([
    Promise.all(competitions.map((c) => getCategories(c.id))),
    getSchools(),
    getSenseis(),
  ]);
  const categoriesByCompetition: Record<string, Category[]> = {};
  competitions.forEach((c, i) => {
    categoriesByCompetition[c.id] = categoryLists[i];
  });

  const supabase = await createClient();
  const categoryTakenByCompetition: Record<string, Record<string, number>> = {};
  const allCategoryIds = categoryLists.flat().map((c) => c.id);
  if (allCategoryIds.length > 0) {
    const { data: counts } = await supabase.rpc("category_paid_counts", { p_category_ids: allCategoryIds });
    const takenByCategory = new Map<string, number>();
    for (const row of (counts as Array<{ category_id: string; cnt: number }>) ?? []) {
      takenByCategory.set(row.category_id, row.cnt);
    }
    competitions.forEach((c, i) => {
      const taken: Record<string, number> = {};
      for (const cat of categoryLists[i]) taken[cat.id] = takenByCategory.get(cat.id) ?? 0;
      categoryTakenByCompetition[c.id] = taken;
    });
  }

  const tier1 = competitions[0] ?? null;
  const payOnline = paymentsEnabled() && competitions.some((c) => Number(c.registration_fee_usd ?? 0) > 0);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Participant Registration</h1>
        {competitions.length > 0 && (
          <p className="mt-1 text-sm text-neutral-500">
            {competitions.length > 1
              ? `${competitions.length} registration tiers open — register for any or all of them in one go below.`
              : `${tier1!.name} · ${formatDate(tier1!.event_date)} · Fee ${formatUSD(tier1!.registration_fee_usd)} per event`}
          </p>
        )}

        <div className="mt-8">
          {!tier1 ? (
            <EmptyState>There is no competition to register for right now.</EmptyState>
          ) : (
            <>
              <div className="mb-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p>
                  <strong>Note:</strong> Participants must 1) Register their own{" "}
                  <a href="/register/school" className="font-semibold underline underline-offset-2">School / Dojo</a>{" "}
                  and 2){" "}
                  <a href="/register/sensei" className="font-semibold underline underline-offset-2">Register your Sensei / Coach</a>{" "}
                  before registering themself here. The same applies to a Sensei registering on
                  behalf of their students, or use the{" "}
                  <a href="/register/bulk" className="font-semibold underline underline-offset-2">bulk registration table</a>{" "}
                  for multiple students. This is because your School and Sensei are required
                  fields, so each needs their own registration too. The minimum total cost — your
                  Participant fee (tier 1) plus your School's and Sensei's — is{" "}
                  <strong>{formatUSD(Number(tier1.registration_fee_usd ?? 0) * 3)}</strong>. Extra
                  kata events and extra tiers each add their own tier's fee per event.
                </p>
                <p>
                  <strong>Once payment is made, no refund will be given</strong> if a participant does
                  not attend or later decides not to participate.
                </p>
                <p>
                  After registration, please proceed to recording your kata with your phone camera for
                  the next step. You only get <strong>3 chances</strong> to delete and re-record your
                  kata. Each participant may register up to <strong>3 times per tier</strong> for any
                  qualifying kata categories in their registration list — <strong>each registration
                  covers only 1 kata category</strong>. You may log in again another time to record
                  your kata, and you may log in to this app an <strong>unlimited</strong> number of
                  times during a time frame of the competition tier.
                </p>
                <p>
                  Registration for tier 1 closes on{" "}
                  <strong>{formatDate(tier1.registration_deadline)}</strong> or when all slots
                  available are taken up — whichever comes first. Other tiers each have their own
                  deadline shown in their column below.
                </p>
              </div>
              <div className="mb-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                {payOnline ? (
                  <>
                    Fields marked * are required. Each tier has its own per-event fee — choose up to
                    3 events per tier below and the payment button updates to the combined total.
                    After filling the form you will be taken to a secure payment page; your
                    registration is confirmed automatically once payment succeeds.
                  </>
                ) : (
                  <>
                    Fields marked * are required. Each tier has its own per-event fee — choose up to
                    3 events per tier below. After submitting you will receive a reference ID per
                    event — transfer the combined fee and send your receipt to the organizer to
                    confirm your slot(s).
                  </>
                )}
              </div>
              <RegisterForm
                competitions={competitions}
                categoriesByCompetition={categoriesByCompetition}
                categoryTakenByCompetition={categoryTakenByCompetition}
                schools={schools}
                senseis={senseis}
                payOnline={payOnline}
              />
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
