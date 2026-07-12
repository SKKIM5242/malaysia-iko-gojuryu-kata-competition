import Link from "next/link";
import { getAllAnnouncements, getAllCompetitions } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import { saveAnnouncement, toggleAnnouncement, deleteAnnouncement, moveAnnouncement } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminAnnouncements({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Announcements" active="/admin/announcements">
        <SetupNotice />
      </AdminShell>
    );
  }

  const [announcements, competitions] = await Promise.all([
    getAllAnnouncements(),
    getAllCompetitions(),
  ]);
  const editing = params.edit ? announcements.find((a) => a.id === params.edit) : undefined;

  return (
    <AdminShell
      title="Announcements"
      active="/admin/announcements"
      flash={{ ok: params.ok, error: params.error }}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit announcement" : "New announcement"}</h2>
          <Card>
            <form action={saveAnnouncement} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="title" className={adminLabel}>Title *</label>
                <input id="title" name="title" required defaultValue={editing?.title ?? ""} className={adminInput} />
              </div>
              <div>
                <label htmlFor="competition_id" className={adminLabel}>Competition (optional)</label>
                <select id="competition_id" name="competition_id" defaultValue={editing?.competition_id ?? ""} className={adminInput}>
                  <option value="">— General —</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="body" className={adminLabel}>
                  Body <span className="font-normal text-neutral-400">(markdown: **bold**, lists, links)</span>
                </label>
                <textarea id="body" name="body" rows={8} defaultValue={editing?.body ?? ""} className={adminInput} />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={editing?.published ?? false}
                  className="h-4 w-4 rounded border-neutral-300 accent-red-700"
                />
                Published (visible on the public site)
              </label>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Create announcement"}</button>
                {editing && (
                  <Link href="/admin/announcements" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">All announcements</h2>
          {announcements.length === 0 ? (
            <EmptyState>No announcements yet — write one on the left.</EmptyState>
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
                          {a.published ? "Published" : "Draft"}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <form action={moveAnnouncement}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button aria-label="Move up" className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50">↑</button>
                      </form>
                      <form action={moveAnnouncement}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button aria-label="Move down" className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50">↓</button>
                      </form>
                      <Link
                        href={`/admin/announcements?edit=${a.id}`}
                        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                      >
                        Edit
                      </Link>
                      <form action={toggleAnnouncement}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="publish" value={a.published ? "false" : "true"} />
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
                        <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
