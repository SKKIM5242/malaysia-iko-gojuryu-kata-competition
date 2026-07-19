import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllAnnouncements, getAllCompetitions } from "@/lib/admin-data";
import {
  saveAnnouncement, toggleAnnouncement, deleteAnnouncement, saveCompetition,
  seedAccessTables, saveAccessMatrixRow, deleteAccessMatrixRow,
  saveAccessComparisonRow, deleteAccessComparisonRow,
} from "@/app/actions/admin";
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

  const [announcements, competitions, { data: matrixRows }, { data: comparisonRows }] = await Promise.all([
    getAllAnnouncements(),
    getAllCompetitions(),
    supabase.from("access_matrix_rows").select("*").order("position"),
    supabase.from("access_comparison_rows").select("*").order("position"),
  ]);
  const editing = params.edit ? announcements.find((a) => a.id === params.edit) : undefined;

  // Suggested access levels — the "drop-down choices" available in every
  // cell of the two editable access tables (free text also allowed).
  const ACCESS_CHOICES = [
    "Full control", "Full", "View only", "View", "Yes", "No", "Blocked", "None", "—",
    "All recordings", "Own students only", "Assigned recordings", "Every judge's score",
    "Round status + total only", "Only after Winners are finalized", "Unlimited",
    "Unlimited once approved", "Unlimited once fee paid", "By application",
    "Paid per sign-in, per competition tier (USD 10 / 100 / 200)",
  ];
  const cellInput = "w-full rounded-md border border-neutral-300 px-2 py-1 text-xs";

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

      <datalist id="access_choices">
        {ACCESS_CHOICES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="mt-10 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Access Matrix (Editable)</h2>
            <p className="text-sm text-neutral-500">
              Add, edit, or delete resources and each role&apos;s access — every cell offers a
              drop-down of common choices, and free text is also allowed. Shown on Accounts →
              Access Matrix.
            </p>
          </div>
          {(matrixRows ?? []).length === 0 && (
            <form action={seedAccessTables}>
              <input type="hidden" name="return_to" value={RETURN_TO} />
              <button className={adminBtn}>Import current defaults</button>
            </form>
          )}
        </div>
        <Card>
          <form action={saveAccessMatrixRow} className="grid gap-2 sm:grid-cols-7">
            <input type="hidden" name="return_to" value={RETURN_TO} />
            <input name="position" type="number" min="1" placeholder="No." className={cellInput} />
            <input name="resource" required placeholder="Resource *" className={`${cellInput} sm:col-span-2`} />
            <input name="admin" list="access_choices" placeholder="Admin" className={cellInput} />
            <input name="organizer" list="access_choices" placeholder="Organizer" className={cellInput} />
            <input name="customer_support" list="access_choices" placeholder="Participant Support" className={cellInput} />
            <input name="referee" list="access_choices" placeholder="Referee" className={cellInput} />
            <input name="note" placeholder="Note (optional)" className={`${cellInput} sm:col-span-6`} />
            <button className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700">
              Add row
            </button>
          </form>
        </Card>
        {(matrixRows ?? []).map((r) => (
          <Card key={r.id}>
            <form action={saveAccessMatrixRow} className="grid items-center gap-2 sm:grid-cols-7">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="return_to" value={RETURN_TO} />
              <input name="position" type="number" min="1" defaultValue={r.position} className={cellInput} />
              <input name="resource" required defaultValue={r.resource} className={`${cellInput} sm:col-span-2 font-semibold`} />
              <input name="admin" list="access_choices" defaultValue={r.admin} className={cellInput} />
              <input name="organizer" list="access_choices" defaultValue={r.organizer} className={cellInput} />
              <input name="customer_support" list="access_choices" defaultValue={r.customer_support} className={cellInput} />
              <input name="referee" list="access_choices" defaultValue={r.referee} className={cellInput} />
              <input name="note" defaultValue={r.note ?? ""} placeholder="Note" className={`${cellInput} sm:col-span-6`} />
              <span className="flex gap-1.5">
                <button className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                  Save
                </button>
                <button
                  formAction={deleteAccessMatrixRow}
                  className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </span>
            </form>
          </Card>
        ))}
        {(matrixRows ?? []).length === 0 && (
          <EmptyState>Table is empty — the built-in defaults are shown until you import or add rows.</EmptyState>
        )}
      </div>

      <div className="mt-10 space-y-4">
        <h2 className="text-lg font-bold">&quot;What Your Payment Unlocks&quot; — Access Comparison (Editable)</h2>
        <p className="text-sm text-neutral-500">
          These rows render on the public Registration page. Columns: Participant · School ·
          Sensei · Referee · Audience · Organizer · Participant Support.
        </p>
        <Card>
          <form action={saveAccessComparisonRow} className="grid gap-2 sm:grid-cols-9">
            <input type="hidden" name="return_to" value={RETURN_TO} />
            <input name="position" type="number" min="1" placeholder="No." className={cellInput} />
            <input name="what" required placeholder="Access row *" className={cellInput} />
            <input name="participant" list="access_choices" placeholder="Participant" className={cellInput} />
            <input name="school" list="access_choices" placeholder="School" className={cellInput} />
            <input name="sensei" list="access_choices" placeholder="Sensei" className={cellInput} />
            <input name="referee" list="access_choices" placeholder="Referee" className={cellInput} />
            <input name="audience" list="access_choices" placeholder="Audience" className={cellInput} />
            <input name="organizer" list="access_choices" placeholder="Organizer" className={cellInput} />
            <span className="flex gap-1.5">
              <input name="support" list="access_choices" placeholder="P. Support" className={cellInput} />
              <button className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700">
                Add
              </button>
            </span>
          </form>
        </Card>
        {(comparisonRows ?? []).map((r) => (
          <Card key={r.id}>
            <form action={saveAccessComparisonRow} className="grid items-center gap-2 sm:grid-cols-9">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="return_to" value={RETURN_TO} />
              <input name="position" type="number" min="1" defaultValue={r.position} className={cellInput} />
              <input name="what" required defaultValue={r.what} className={`${cellInput} font-semibold`} />
              <input name="participant" list="access_choices" defaultValue={r.participant} className={cellInput} />
              <input name="school" list="access_choices" defaultValue={r.school} className={cellInput} />
              <input name="sensei" list="access_choices" defaultValue={r.sensei} className={cellInput} />
              <input name="referee" list="access_choices" defaultValue={r.referee} className={cellInput} />
              <input name="audience" list="access_choices" defaultValue={r.audience} className={cellInput} />
              <input name="organizer" list="access_choices" defaultValue={r.organizer} className={cellInput} />
              <span className="flex gap-1.5">
                <input name="support" list="access_choices" defaultValue={r.support} className={cellInput} />
                <button className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                  Save
                </button>
                <button
                  formAction={deleteAccessComparisonRow}
                  className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </span>
            </form>
          </Card>
        ))}
      </div>
    </AdminShell>
  );
}
