import Link from "next/link";
import {
  getOpenCompetitions,
  getCategories,
  getConfirmedRegistrations,
  getSchools,
  schemaReady,
} from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader, formatUSD } from "@/components/ui";
import { kataBases } from "@/lib/division";
import ParticipantsTable from "@/components/ParticipantsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ kata?: string; school?: string; tier?: string; page?: string }>;
}) {
  const params = await searchParams;
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
  if (openCompetitions.length === 0) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-10">
          <h1 className="mb-6 text-2xl font-bold">Confirmed Participants</h1>
          <EmptyState>No competition has been published yet.</EmptyState>
        </main>
        <SiteFooter />
      </>
    );
  }

  const selectedTier = params.tier && openCompetitions.some((c) => c.id === params.tier) ? params.tier : undefined;
  const competitionIds = selectedTier ? [selectedTier] : openCompetitions.map((c) => c.id);
  // Kata list is identical across tiers of the same championship — use the first tier's.
  const categories = await getCategories((selectedTier ?? openCompetitions[0].id));

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const [schools, { rows, total }] = await Promise.all([
    getSchools(),
    getConfirmedRegistrations(competitionIds, {
      kataBase: params.kata || undefined,
      schoolId: params.school || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const bases = kataBases(categories);

  const filterHref = (overrides: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { kata: params.kata, school: params.school, tier: params.tier, ...overrides };
    if (merged.kata) q.set("kata", merged.kata);
    if (merged.school) q.set("school", merged.school);
    if (merged.tier) q.set("tier", merged.tier);
    if (overrides.page) q.set("page", overrides.page);
    const s = q.toString();
    return `/participants${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Confirmed Participants</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {openCompetitions.length > 1 && !selectedTier
            ? "All registration tiers — participants whose payment has been confirmed by the organizer."
            : `${(openCompetitions.find((c) => c.id === selectedTier) ?? openCompetitions[0]).name} — participants whose payment has been confirmed by the organizer.`}
        </p>

        <form method="GET" action="/participants" className="mt-6 flex flex-wrap items-end gap-3">
          {openCompetitions.length > 1 && (
            <div className="w-full sm:w-auto">
              <label htmlFor="tier" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Registration tier
              </label>
              <select
                id="tier"
                name="tier"
                defaultValue={params.tier ?? ""}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm sm:w-56"
              >
                <option value="">All tiers</option>
                {openCompetitions.map((c) => (
                  <option key={c.id} value={c.id} className="whitespace-normal">{formatUSD(c.registration_fee_usd)} tier</option>
                ))}
              </select>
            </div>
          )}
          <div className="w-full sm:w-auto">
            <label htmlFor="kata" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Kata event
            </label>
            <select
              id="kata"
              name="kata"
              defaultValue={params.kata ?? ""}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm sm:w-56"
            >
              <option value="">All kata events</option>
              {bases.map((k) => (
                <option key={k} value={k} className="whitespace-normal">{k}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label htmlFor="school" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              School
            </label>
            <select
              id="school"
              name="school"
              defaultValue={params.school ?? ""}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm sm:w-56"
            >
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id} className="whitespace-normal">{s.name}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 sm:w-auto"
          >
            Filter
          </button>
          {(params.kata || params.school || params.tier) && (
            <Link href="/participants" className="py-2 text-sm text-red-700 underline underline-offset-2">
              Clear filters
            </Link>
          )}
        </form>

        <div className="mt-6">
          {rows.length === 0 ? (
            <EmptyState>No confirmed participants yet.</EmptyState>
          ) : (
            <ParticipantsTable
              rows={rows.map((r, i) => ({
                id: r.id,
                no: (page - 1) * PAGE_SIZE + i + 1,
                name: r.participant?.full_name ?? "—",
                tier: r.competition?.name ?? null,
                categoryName: r.category?.name ?? null,
                division: r.division,
                belt: r.participant?.belt_rank ?? null,
                school: r.participant?.school?.name ?? null,
                sensei: r.participant?.sensei?.name ?? null,
              }))}
            />
          )}
        </div>

        {totalPages > 1 && (
          <nav className="mt-6 flex items-center gap-2 text-sm">
            {page > 1 && (
              <Link href={filterHref({ page: String(page - 1) })} className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100">
                ← Previous
              </Link>
            )}
            <span className="px-2 text-neutral-500">Page {page} of {totalPages}</span>
            {page < totalPages && (
              <Link href={filterHref({ page: String(page + 1) })} className="rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100">
                Next →
              </Link>
            )}
          </nav>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
