import Link from "next/link";
import {
  getActiveCompetition,
  getCategories,
  getPublishedAnnouncements,
  schemaReady,
} from "@/lib/data";
import {
  EmptyState,
  SectionTitle,
  SetupNotice,
  SiteFooter,
  SiteHeader,
  formatDate,
  formatMYR,
} from "@/components/ui";
import { Markdown } from "@/lib/markdown";

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

  const competition = await getActiveCompetition();
  const [categories, announcements] = await Promise.all([
    competition ? getCategories(competition.id) : Promise.resolve([]),
    getPublishedAnnouncements(5),
  ]);

  const deadlinePassed =
    competition?.registration_deadline != null &&
    new Date(competition.registration_deadline + "T23:59:59") < new Date();
  const registrationOpen = competition?.status === "open" && !deadlinePassed;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        {!competition ? (
          <EmptyState>No competition has been published yet. Check back soon.</EmptyState>
        ) : (
          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="bg-neutral-950 px-6 py-8 text-white sm:px-10">
              <p className="text-xs font-semibold uppercase tracking-widest text-red-500">
                {competition.status === "open" ? "Registration open" : `Status: ${competition.status}`}
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl">{competition.name}</h1>
              {competition.description && (
                <p className="mt-3 max-w-3xl text-sm text-neutral-300 sm:text-base">{competition.description}</p>
              )}
            </div>
            <div className="grid gap-6 px-6 py-6 sm:grid-cols-2 sm:px-10 lg:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Event date</p>
                <p className="mt-1 font-semibold text-neutral-900">{formatDate(competition.event_date)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Venue</p>
                <p className="mt-1 font-semibold text-neutral-900">{competition.venue ?? "TBA"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Registration deadline</p>
                <p className="mt-1 font-semibold text-neutral-900">{formatDate(competition.registration_deadline)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Fee per participant</p>
                <p className="mt-1 font-semibold text-neutral-900">{formatMYR(competition.registration_fee_myr)}</p>
              </div>
            </div>
            <div className="border-t border-neutral-100 px-6 py-5 sm:px-10">
              {registrationOpen ? (
                <Link
                  href="/register"
                  className="inline-block rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white hover:bg-red-600"
                >
                  Register now
                </Link>
              ) : (
                <span className="inline-block rounded-md bg-neutral-200 px-6 py-2.5 font-semibold text-neutral-500">
                  Registration closed
                </span>
              )}
              <Link href="/participants" className="ml-4 text-sm font-medium text-red-700 underline underline-offset-2">
                View confirmed participants →
              </Link>
            </div>
          </section>
        )}

        {competition && (
          <section className="mt-12">
            <SectionTitle>Competition categories</SectionTitle>
            {categories.length === 0 ? (
              <EmptyState>Categories have not been published yet.</EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {categories.map((c) => (
                  <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                    <p className="font-semibold text-neutral-900">{c.name}</p>
                    <p className="mt-1 text-sm text-neutral-500">
                      {c.age_min != null && c.age_max != null ? `Ages ${c.age_min}–${c.age_max}` : "All ages"}
                      {c.belt_group ? ` · ${c.belt_group.toUpperCase()} belts` : ""}
                    </p>
                    <p className="text-sm capitalize text-neutral-500">{c.gender ?? "open"}</p>
                  </div>
                ))}
              </div>
            )}
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
