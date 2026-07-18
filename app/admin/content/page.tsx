import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllAnnouncements, getAllCompetitions } from "@/lib/admin-data";
import { saveAnnouncement, toggleAnnouncement, deleteAnnouncement, saveCompetition } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import { Markdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

const RETURN_TO = "/admin/content";

/** One place for Admin/Organizer to publish everything readers see:
 * announcements, notes/messages (same mechanism — a note stays a draft, a
 * message is published), and new competition tiers. Other admin-panel
 * roles are turned away — this page is Admin & Organizer only. */
export default async function AdminContent({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Content" active="/admin/content">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  if (!["admin", "organizer", "staff"].includes(myProfile?.role ?? "")) {
    return (
      <AdminShell title="Content" active="/admin/content">
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This page is for Admin and Organizer accounts only.
        </p>
      </AdminShell>
    );
  }

  const [announcements, competitions] = await Promise.all([getAllAnnouncements(), getAllCompetitions()]);
  const editing = params.edit ? announcements.find((a) => a.id === params.edit) : undefined;

  return (
    <AdminShell title="Content" active="/admin/content" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-6 text-sm text-neutral-500">
        Create and manage announcements, notes, and messages, and add new competition tiers — all
        in one place. Admin &amp; Organizer only.
      </p>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">
            {editing ? "Edit Announcement / Note / Message" : "New Announcement / Note / Message"}
          </h2>
          <Card>
            <form action={saveAnnouncement} className="space-y-4">
              <input type="hidden" name="return_to" value={RETURN_TO} />
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="content_title" className={adminLabel}>Title *</label>
                <input id="content_title" name="title" required defaultValue={editing?.title ?? ""} className={adminInput} />
              </div>
              <div>
                <label htmlFor="content_competition" className={adminLabel}>Competition (optional)</label>
                <select
                  id="content_competition"
                  name="competition_id"
                  defaultValue={editing?.competition_id ?? ""}
                  className={adminInput}
                >
                  <option value="">— General —</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="content_body" className={adminLabel}>
                  Body <span className="font-normal text-neutral-400">(markdown: **bold**, lists, links)</span>
                </label>
                <textarea id="content_body" name="body" rows={6} defaultValue={editing?.body ?? ""} className={adminInput} />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={editing?.published ?? false}
                  className="h-4 w-4 rounded border-neutral-300 accent-red-700"
                />
                Publish as a public message (unchecked = internal note / draft)
              </label>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Create"}</button>
                {editing && (
                  <Link
                    href={RETURN_TO}
                    className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
                  >
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>

          <h2 className="mt-8 mb-3 text-lg font-bold">Add Competition Tier</h2>
          <Card>
            <form action={saveCompetition} className="space-y-4">
              <input type="hidden" name="return_to" value={RETURN_TO} />
              <div>
                <label htmlFor="tier_name" className={adminLabel}>Name *</label>
                <input id="tier_name" name="name" required className={adminInput} placeholder="e.g. Malaysia Open … — USD 50 Tier" />
              </div>
              <div>
                <label htmlFor="tier_venue" className={adminLabel}>Venue</label>
                <input id="tier_venue" name="venue" className={adminInput} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tier_event_date" className={adminLabel}>Event date</label>
                  <input id="tier_event_date" name="event_date" type="date" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="tier_deadline" className={adminLabel}>Registration deadline</label>
                  <input id="tier_deadline" name="registration_deadline" type="date" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="tier_fee" className={adminLabel}>Fee (USD)</label>
                  <input id="tier_fee" name="registration_fee_usd" type="number" step="0.01" min="0" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="tier_status" className={adminLabel}>Status</label>
                  <select id="tier_status" name="status" defaultValue="draft" className={adminInput}>
                    <option value="draft">Draft</option>
                    <option value="open">Open (registration live)</option>
                    <option value="closed">Closed</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="tier_description" className={adminLabel}>Description</label>
                <textarea id="tier_description" name="description" rows={3} className={adminInput} />
              </div>
              <button type="submit" className={adminBtn}>Create competition tier</button>
              <p className="text-xs text-neutral-400">
                Categories for the new tier are added on the{" "}
                <Link href="/admin/competitions" className="font-semibold text-red-700 underline underline-offset-2">
                  Competitions
                </Link>{" "}
                page (Edit → Add Category).
              </p>
            </form>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">All Announcements, Notes &amp; Messages</h2>
          {announcements.length === 0 ? (
            <EmptyState>Nothing yet — create your first one on the left.</EmptyState>
          ) : (
            <div className="space-y-3">
              {announcements.map((a) => (
                <Card key={a.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-neutral-900">{a.title}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {formatDate(a.created_at.slice(0, 10))} ·{" "}
                        <span className={a.published ? "font-semibold text-green-600" : "text-amber-600"}>
                          {a.published ? "Published message" : "Internal note / draft"}
                        </span>
                        {a.competition_id
                          ? ` · ${competitions.find((c) => c.id === a.competition_id)?.name ?? ""}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Link
                        href={`${RETURN_TO}?edit=${a.id}`}
                        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                      >
                        Edit
                      </Link>
                      <form action={toggleAnnouncement}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="publish" value={a.published ? "false" : "true"} />
                        <input type="hidden" name="return_to" value={RETURN_TO} />
                        <button
                          className={`rounded px-2.5 py-1 text-xs font-semibold text-white ${
                            a.published ? "bg-amber-600 hover:bg-amber-500" : "bg-green-600 hover:bg-green-500"
                          }`}
                        >
                          {a.published ? "Unpublish" : "Publish"}
                        </button>
                      </form>
                      <form action={deleteAnnouncement}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="return_to" value={RETURN_TO} />
                        <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                  {a.body && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-neutral-500 hover:text-neutral-700">
                        Preview rendered body
                      </summary>
                      <div className="mt-2 border-t border-neutral-100 pt-2 text-sm">
                        <Markdown text={a.body} />
                      </div>
                    </details>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
