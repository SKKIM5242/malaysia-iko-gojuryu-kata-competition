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
import { createClient } from "@/lib/supabase/server";
import { EmptyState, NoTranslate, SetupNotice, SiteFooter, SiteHeader, formatDate, formatUSD } from "@/components/ui";
import RegisterForm from "@/components/RegisterForm";
import { paymentsEnabled } from "@/lib/payments";
import { groupByKata } from "@/lib/division";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register" };

export default async function RegisterPage({
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
        <main className="mx-auto max-w-3xl px-4 py-10"><SetupNotice /></main>
        <SiteFooter />
      </>
    );
  }

  const openCompetitions = await getOpenCompetitions();

  // No tier picked in the URL, and more than one tier exists — ask first.
  if (!competitionId && openCompetitions.length > 1) {
    const categoriesByTier = new Map(
      await Promise.all(openCompetitions.map(async (c) => [c.id, await getCategories(c.id)] as const)),
    );
    const allCategoryIds = [...categoriesByTier.values()].flat().map((cat) => cat.id);
    const categoryPaidCount = new Map<string, number>();
    if (allCategoryIds.length > 0) {
      const supabase = await createClient();
      const { data: counts } = await supabase.rpc("category_paid_counts", { p_category_ids: allCategoryIds });
      for (const row of (counts as Array<{ category_id: string; cnt: number }>) ?? []) {
        categoryPaidCount.set(row.category_id, row.cnt);
      }
    }

    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Choose your registration tier</h1>
          <p className="mt-1 mb-6 text-sm text-neutral-500">
            This event has more than one registration tier — pick one to continue. Expand a kata to
            see how many slots are left in each sub-category.
          </p>
          <div className="space-y-4">
            {openCompetitions.map((c) => (
              <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-neutral-900">{c.name}</p>
                    <p className="text-sm text-neutral-500">
                      {formatUSD(c.registration_fee_usd)} per event · deadline {formatDate(c.registration_deadline)}
                    </p>
                  </div>
                  <Link
                    href={`/register/participant?competition=${c.id}`}
                    className="shrink-0 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
                  >
                    Register — {formatUSD(c.registration_fee_usd)} per event
                  </Link>
                </div>
                {(categoriesByTier.get(c.id) ?? []).length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3">
                    {groupByKata(categoriesByTier.get(c.id) ?? []).map(([base, cats]) => (
                      <details key={base} className="rounded border border-neutral-100">
                        <summary className="cursor-pointer px-2 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
                          <NoTranslate>{base}</NoTranslate>{" "}
                          <span className="font-normal text-neutral-400">({cats.length} sub-categories)</span>
                        </summary>
                        <ul className="space-y-1 px-2 pb-2 pl-5">
                          {cats.map((cat) => {
                            const taken = categoryPaidCount.get(cat.id) ?? 0;
                            const left = cat.max_participants != null ? Math.max(0, cat.max_participants - taken) : null;
                            return (
                              <li key={cat.id} className="flex items-center justify-between gap-2 text-sm">
                                <span className="text-neutral-600">
                                  {cat.name.split(" — ").slice(1).join(" — ") || cat.name}
                                </span>
                                <span className={`shrink-0 text-xs ${left === 0 ? "font-semibold text-red-600" : "text-neutral-400"}`}>
                                  {cat.max_participants != null
                                    ? `${taken}/${cat.max_participants} taken (${left} left)`
                                    : `${taken} taken (no cap)`}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    ))}
                  </div>
                )}
              </div>
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
  const deadlinePassed =
    !!competition &&
    competition.registration_deadline != null &&
    new Date(competition.registration_deadline + "T23:59:59") < new Date();

  const [categories, schools, senseis] = competition
    ? await Promise.all([getCategories(competition.id), getSchools(), getSenseis()])
    : [[], [], []];

  const supabase = await createClient();
  const categoryTaken: Record<string, number> = {};
  if (categories.length > 0) {
    const { data: counts } = await supabase.rpc("category_paid_counts", {
      p_category_ids: categories.map((c) => c.id),
    });
    for (const row of (counts as Array<{ category_id: string; cnt: number }>) ?? []) {
      categoryTaken[row.category_id] = row.cnt;
    }
  }

  // Once this tier's overall capacity is used up, point participants at
  // the next tier up (by fee) instead of a dead end.
  let nextTier: (typeof openCompetitions)[number] | null = null;
  if (competition?.max_participants != null) {
    const { count } = await supabase
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("competition_id", competition.id)
      .eq("payment_status", "paid");
    if ((count ?? 0) >= competition.max_participants) {
      const sorted = [...openCompetitions].sort(
        (a, b) => Number(a.registration_fee_usd ?? 0) - Number(b.registration_fee_usd ?? 0),
      );
      const idx = sorted.findIndex((c) => c.id === competition.id);
      nextTier = idx >= 0 ? (sorted[idx + 1] ?? null) : null;
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Participant registration</h1>
        {competition && (
          <p className="mt-1 text-sm text-neutral-500">
            {competition.name} · {formatDate(competition.event_date)} · Fee {formatUSD(competition.registration_fee_usd)} per event
          </p>
        )}
        {openCompetitions.length > 1 && (
          <Link href="/register/participant" className="mt-1 inline-block text-xs text-red-700 underline underline-offset-2">
            ← Choose a different tier
          </Link>
        )}

        {nextTier && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>{competition!.name}&apos;s slots are all taken up.</strong> Please proceed to
            register for {nextTier.name} (Fee {formatUSD(nextTier.registration_fee_usd)} per event) instead.
            <Link
              href={`/register/participant?competition=${nextTier.id}`}
              className="ml-2 font-semibold underline underline-offset-2"
            >
              Register for {nextTier.name} →
            </Link>
          </div>
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
              <div className="mb-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p>
                  <strong>Note:</strong> participants must 1) register their own{" "}
                  <a href="/register/school" className="font-semibold underline underline-offset-2">School / Dojo</a>{" "}
                  and 2){" "}
                  <a href="/register/sensei" className="font-semibold underline underline-offset-2">register your Sensei / Coach</a>{" "}
                  before registering themself here. The same applies to a Sensei registering on
                  behalf of their students — or use the{" "}
                  <a href="/register/bulk" className="font-semibold underline underline-offset-2">bulk registration table</a>{" "}
                  for multiple students. Because your School and Sensei each need their own
                  registration too, the minimum total cost for this tier — your fee plus your
                  School's and Sensei's — is{" "}
                  <strong>{formatUSD(Number(competition.registration_fee_usd ?? 0) * 3)}</strong>.
                  Maximum is <strong>{formatUSD(Number(competition.registration_fee_usd ?? 0) * 5)}</strong>{" "}
                  if you participate in 3 Kata events.
                </p>
                <p>
                  <strong>Once payment is made, no refund will be given</strong> if a participant does
                  not attend or later decides not to participate.
                </p>
                <p>
                  After registration, please proceed to recording your kata with your phone camera for
                  the next step. You only get <strong>3 chances</strong> to delete and re-record your
                  kata. Each participant may register up to <strong>3 times</strong> for any qualifying
                  kata categories in their registration list — <strong>each registration covers only 1
                  kata category</strong>. You may log in again another time to record your kata, and
                  you may log in to this app an <strong>unlimited</strong> number of times during a
                  time frame of the competition tier.
                </p>
                <p>
                  Registration for this tier closes on{" "}
                  <strong>{formatDate(competition.registration_deadline)}</strong> or when all slots
                  available are taken up — whichever comes first.
                </p>
              </div>
              <div className="mb-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                {paymentsEnabled() && Number(competition.registration_fee_usd ?? 0) > 0 ? (
                  <>
                    Fields marked * are required. The fee is{" "}
                    <strong>{formatUSD(competition.registration_fee_usd)} per kata event</strong> —
                    choose up to 3 events below and the payment button updates to the total. After
                    filling the form you will be taken to a secure payment page; your registration
                    is confirmed automatically once payment succeeds. Deadline:{" "}
                    <strong>{formatDate(competition.registration_deadline)}</strong>.
                  </>
                ) : (
                  <>
                    Fields marked * are required. The fee is{" "}
                    <strong>{formatUSD(competition.registration_fee_usd)} per kata event</strong> —
                    choose up to 3 events below. After submitting you will receive a reference ID per
                    event — transfer the total fee and send your receipt to the organiser to confirm
                    your slot. Deadline: <strong>{formatDate(competition.registration_deadline)}</strong>.
                  </>
                )}
              </div>
              <RegisterForm
                competition={competition}
                categories={categories}
                categoryTaken={categoryTaken}
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
