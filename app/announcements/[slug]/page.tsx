import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnnouncement, schemaReady } from "@/lib/data";
import { SetupNotice, SiteFooter, SiteHeader, formatDate } from "@/components/ui";
import { Markdown } from "@/lib/markdown";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessMatrixRowsFromDb } from "@/lib/access-matrix";
import AccessMatrixTable from "@/components/AccessMatrixTable";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AnnouncementPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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

  // slug is the announcement id (optionally suffixed after a double dash)
  const id = slug.includes("--") ? slug.split("--").pop()! : slug;
  if (!UUID_RE.test(id)) notFound();
  const announcement = await getAnnouncement(id);
  if (!announcement || !announcement.published) notFound();

  // The Access Matrix announcement (see publishAccessMatrixAnnouncement in
  // app/actions/admin.ts) shows the same adjustable/filterable table as the
  // admin page instead of a static table baked into the body text — reading
  // the live access_matrix_rows table (service-role client, since this page
  // has no session) so it's never a stale snapshot.
  const isAccessMatrix = announcement.title.startsWith("Admin Panel Access Matrix");
  const matrixRows = isAccessMatrix
    ? accessMatrixRowsFromDb(
        (await createAdminClient().from("access_matrix_rows").select("*").order("position")).data,
      )
    : null;

  return (
    <>
      <SiteHeader />
      <main className={`mx-auto px-4 py-10 ${isAccessMatrix ? "max-w-5xl" : "max-w-3xl"}`}>
        <Link href="/announcements" className="text-sm text-red-700 underline underline-offset-2">
          ← All announcements
        </Link>
        <article className="mt-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <time className="text-xs uppercase tracking-wide text-neutral-400">
            {formatDate(announcement.created_at.slice(0, 10))}
          </time>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">{announcement.title}</h1>
          <div className="mt-5 text-neutral-700">
            {announcement.body ? <Markdown text={announcement.body} /> : <p className="text-neutral-400">No content.</p>}
          </div>
          {matrixRows && (
            <div className="mt-5">
              <AccessMatrixTable rows={matrixRows} />
            </div>
          )}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
