import Link from "next/link";
import { getPublishedAnnouncements, schemaReady } from "@/lib/data";
import { EmptyState, SetupNotice, SiteFooter, SiteHeader, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Announcements — Malaysia IKO Goju-ryu Kata Competition" };

export default async function AnnouncementsPage() {
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

  const announcements = await getPublishedAnnouncements(50);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
        <div className="mt-6 space-y-4">
          {announcements.length === 0 ? (
            <EmptyState>No announcements yet.</EmptyState>
          ) : (
            announcements.map((a) => (
              <article key={a.id} className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-bold text-neutral-900">
                    <Link href={`/announcements/${a.id}`} className="hover:text-red-700">{a.title}</Link>
                  </h2>
                  <time className="text-xs text-neutral-400">{formatDate(a.created_at.slice(0, 10))}</time>
                </div>
                <Link
                  href={`/announcements/${a.id}`}
                  className="mt-2 inline-block text-sm font-medium text-red-700 underline underline-offset-2"
                >
                  Read →
                </Link>
              </article>
            ))
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
