import Link from "next/link";
import {
  getOpenCompetitions,
  getCategories,
  getPublishedAnnouncements,
  isCompetitionOpen,
  schemaReady,
} from "@/lib/data";
import {
  EmptyState,
  NoTranslate,
  SectionTitle,
  SetupNotice,
  SiteFooter,
  SiteHeader,
  formatDate,
  formatUSD,
  protectKataNames,
} from "@/components/ui";
import { Markdown } from "@/lib/markdown";
import { groupByKata, kataBases } from "@/lib/division";
import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-10">
          <SetupNotice />
        </main>
        <SiteFooter />
      </>
    );
  }

  const [competitions, announcements] = await Promise.all([
    getOpenCompetitions(),
    getPublishedAnnouncements(5),
  ]);
  const categoriesByCompetition = new Map<string, Category[]>();
  for (const c of competitions) {
    categoriesByCompetition.set(c.id, await getCategories(c.id));
  }
  const tierCap = (cats: Category[]): number | null =>
    cats.find((c) => c.gender === "male" && c.max_participants != null)?.max_participants ?? null;

  const allCategoryIds = [...categoriesByCompetition.values()].flat().map((c) => c.id);
  const categoryTaken = new Map<string, number>();
  if (allCategoryIds.length > 0) {
    const supabase = await createClient();
    const { data: counts } = await supabase.rpc("category_paid_counts", { p_category_ids: allCategoryIds });
    for (const row of (counts as Array<{ category_id: string; cnt: number }>) ?? []) {
      categoryTaken.set(row.category_id, row.cnt);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        {competitions.length === 0 ? (
          <EmptyState>No competition has been published yet. Check back soon.</EmptyState>
        ) : (
          <section>
            <SectionTitle>
              {competitions.length > 1 ? "Choose your registration tier" : "Competition"}
            </SectionTitle>
            <div className={`grid gap-6 ${competitions.length > 1 ? "md:grid-cols-3" : ""}`}>
              {competitions.map((competition) => {
                const open = isCompetitionOpen(competition);
                return (
                  <div
                    key={competition.id}
                    className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
                  >
                    <div className="bg-neutral-950 px-6 py-6 text-white">
                      <p className="text-xs font-semibold uppercase tracking-widest text-red-500">
                        {open ? "Registration open" : "Closed"}
                      </p>
                      <h2 className="mt-2 text-xl font-bold tracking-tight">{competition.name}</h2>
                      <p className="mt-2 text-2xl font-bold text-red-400">
                        {formatUSD(competition.registration_fee_usd)}
                      </p>
                    </div>
                    <div className="space-y-3 px-6 py-5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Event date</span>
                        <span className="font-semibold text-neutral-900">{formatDate(competition.event_date)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Deadline</span>
                        <span className="font-semibold text-neutral-900">{formatDate(competition.registration_deadline)}</span>
                      </div>
                    </div>
                    <div className="border-t border-neutral-100 px-6 py-4">
                      {open ? (
                        <Link
                          href={`/register/participant?competition=${competition.id}`}
                          className="block rounded-md bg-red-700 px-4 py-2.5 text-center font-semibold text-white hover:bg-red-600"
                        >
                          Register — {formatUSD(competition.registration_fee_usd)}
                        </Link>
                      ) : (
                        <span className="block rounded-md bg-neutral-200 px-4 py-2.5 text-center font-semibold text-neutral-500">
                          Registration closed
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Link href="/participants" className="mt-4 inline-block text-sm font-medium text-red-700 underline underline-offset-2">
              View confirmed participants →
            </Link>
            {competitions[0]?.description && (
              <p className="mt-6 max-w-3xl whitespace-pre-line text-sm text-neutral-600">
                {protectKataNames(
                  competitions[0].description,
                  kataBases(categoriesByCompetition.get(competitions[0].id) ?? [])
                )}
              </p>
            )}
          </section>
        )}

        {competitions.length > 0 && (
          <section className="mt-12 space-y-10">
            <SectionTitle>Kata events</SectionTitle>
            {competitions.map((competition) => {
              const cats = categoriesByCompetition.get(competition.id) ?? [];
              const cap = tierCap(cats);
              return (
                <div key={competition.id}>
                  {competitions.length > 1 && (
                    <h3 className="mb-2 text-base font-bold text-neutral-900">{competition.name}</h3>
                  )}
                  {cats.length === 0 ? (
                    <EmptyState>Categories have not been published yet.</EmptyState>
                  ) : (
                    <>
                      <p className="mb-4 text-sm text-neutral-500">
                        Every kata event is divided into <strong>Male</strong>, <strong>Female</strong> or{" "}
                        <strong>Mix (Male &amp; Female)</strong> sub-categories, then{" "}
                        <strong>Color/Kyu Belt</strong> and <strong>Black Belt &amp; Dan Holders</strong>{" "}
                        sub-sub-categories, each with age groups <strong>4–14</strong>, <strong>15–40</strong>,{" "}
                        <strong>41–65</strong> and <strong>66–99</strong>. Your sub-category is assigned
                        automatically when you register. The same kata list applies to every registration tier.
                        {" "}Male and Female sub-categories are listed for the initial registration stage
                        {cap != null && (
                          <>
                            {" "}— once the registration deadline is reached, any Male or Female sub-category
                            with fewer than <strong>{cap}</strong> participants is merged into a{" "}
                            <strong>Mix (Male &amp; Female)</strong> category.
                          </>
                        )}
                      </p>
                      <div className="space-y-2">
                        {groupByKata(cats).map(([base, subCats]) => (
                          <details key={base} className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
                              <NoTranslate>{base}</NoTranslate>{" "}
                              <span className="font-normal text-neutral-400">({subCats.length} sub-categories)</span>
                            </summary>
                            <ul className="space-y-1 px-4 pb-3">
                              {subCats.map((cat) => {
                                const taken = categoryTaken.get(cat.id) ?? 0;
                                const left = cat.max_participants != null ? Math.max(0, cat.max_participants - taken) : null;
                                return (
                                  <li key={cat.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className="text-neutral-600">
                                      {cat.name.split(" — ").slice(1).join(" — ") || cat.name}
                                    </span>
                                    <span className={`shrink-0 text-xs whitespace-nowrap ${left === 0 ? "font-semibold text-red-600" : "text-neutral-400"}`}>
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
                    </>
                  )}
                </div>
              );
            })}
          </section>
        )}

        <section className="mt-12">
          <SectionTitle
            action={
              <Link href="/announcements" className="text-sm font-medium text-red-700 underline underline-offset-2">
                All announcements →
              </Link>
            }
          >
            Latest announcements
          </SectionTitle>
          {announcements.length === 0 ? (
            <EmptyState>No announcements yet.</EmptyState>
          ) : (
            <div className="space-y-4">
              {announcements.map((a) => (
                <article key={a.id} className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-bold text-neutral-900">
                      <Link href={`/announcements/${a.id}`} className="hover:text-red-700">
                        {a.title}
                      </Link>
                    </h3>
                    <time className="text-xs text-neutral-400">{formatDate(a.created_at.slice(0, 10))}</time>
                  </div>
                  {a.body && (
                    <div className="mt-2 line-clamp-2 text-sm text-neutral-600">
                      <Markdown text={a.body.length > 220 ? a.body.slice(0, 220) + "…" : a.body} />
                    </div>
                  )}
                  <Link
                    href={`/announcements/${a.id}`}
                    className="mt-2 inline-block text-sm font-medium text-red-700 underline underline-offset-2"
                  >
                    Read more →
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
