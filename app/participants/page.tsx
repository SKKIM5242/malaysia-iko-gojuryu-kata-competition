import Link from "next/link";
import {
  getActiveCompetition,
  getCategories,
  getConfirmedRegistrations,
  getSchools,
  schemaReady,
} from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; school?: string; page?: string }>;
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

  const competition = await getActiveCompetition();
  if (!competition) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-10">
          <h1 className="mb-6 text-2xl font-bold">Confirmed participants</h1>
          <EmptyState>No competition has been published yet.</EmptyState>
        </main>
        <SiteFooter />
      </>
    );
  }

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const [categories, schools, { rows, total }] = await Promise.all([
    getCategories(competition.id),
    getSchools(),
    getConfirmedRegistrations(competition.id, {
      categoryId: params.category || undefined,
      schoolId: params.school || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterHref = (overrides: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { category: params.category, school: params.school, ...overrides };
    if (merged.category) q.set("category", merged.category);
    if (merged.school) q.set("school", merged.school);
    if (overrides.page) q.set("page", overrides.page);
    const s = q.toString();
    return `/participants${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Confirmed participants</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {competition.name} — participants whose payment has been confirmed by the organiser.
        </p>

        <form method="GET" action="/participants" className="mt-6 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="category" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Category
            </label>
            <select
              id="category"
              name="category"
              defaultValue={params.category ?? ""}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="school" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              School
            </label>
            <select
              id="school"
              name="school"
              defaultValue={params.school ?? ""}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Filter
          </button>
          {(params.category || params.school) && (
            <Link href="/participants" className="py-2 text-sm text-red-700 underline underline-offset-2">
              Clear filters
            </Link>
          )}
        </form>

        <div className="mt-6">
          {rows.length === 0 ? (
            <EmptyState>No confirmed participants yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Division</th>
                    <th className="px-4 py-3">Belt</th>
                    <th className="px-4 py-3">School</th>
                    <th className="px-4 py-3">Sensei</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 text-neutral-400">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-4 py-3 font-medium text-neutral-900">{r.participant?.full_name ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-4 py-3" title={r.category?.name ?? undefined}>
                        {r.category?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">{r.division ?? "—"}</td>
                      <td className="px-4 py-3">{r.participant?.belt_rank ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-4 py-3" title={r.participant?.school?.name ?? undefined}>
                        {r.participant?.school?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">{r.participant?.sensei?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
