import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllAnnouncements, getAllCompetitions } from "@/lib/admin-data";
import {
  saveAnnouncement, toggleAnnouncement, deleteAnnouncement, saveCompetition,
  seedAccessTables, saveAccessMatrixRow, deleteAccessMatrixRow,
  saveAccessComparisonRow, deleteAccessComparisonRow,
  saveSignInRoleDefault, deleteSignInRoleDefault,
  bulkUploadAccessMatrixRows, bulkUploadSignInRoleDefaults, bulkUploadAccessComparisonRows,
  saveNotificationReferenceRow, deleteNotificationReferenceRow, bulkUploadNotificationReferenceRows,
  saveTelegramLinkReferenceRow, deleteTelegramLinkReferenceRow, bulkUploadTelegramLinkReferenceRows,
} from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import { Markdown } from "@/lib/markdown";
import { shortTierName } from "@/lib/invitation-codes";
import { PROFILE_ROLE_KEYS, PROFILE_ROLE_KEY_LABELS } from "@/lib/reference-data";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import DateField from "@/components/DateField";

export const dynamic = "force-dynamic";

const RETURN_TO = "/admin/content";

const cellInput = "w-full rounded-md border border-neutral-300 px-2 py-1 text-xs";

/** Picks the Sign-in Access Matrix row's join key onto `profiles.role`.
 *
 * A select, not a text box, because this used to be the same free-text field
 * as the display label: renaming the labels detached every row from its
 * accounts and silently dropped all nine roles to the hardcoded 250-sign-in
 * fallback, Admin and Organizer included. See migration 0093. */
function RoleKeySelect({ form, value = "", disabled = false }: { form: string; value?: string; disabled?: boolean }) {
  return (
    <select
      form={form}
      name="role_key"
      defaultValue={value}
      disabled={disabled}
      className={cellInput}
      title="Which account role this row governs. Blank = a display-only row that governs no account."
    >
      <option value="">— display only (governs no account)</option>
      {PROFILE_ROLE_KEYS.map((k) => (
        <option key={k} value={k}>
          {PROFILE_ROLE_KEY_LABELS[k]} ({k})
        </option>
      ))}
    </select>
  );
}

/** One place for Admin/Organizer to publish everything readers see:
 * announcements, notes/messages (same mechanism — a note stays a draft, a
 * message is published), and new competition tiers, plus every editable
 * reference table. Participant Support and Judge can view all of
 * it — every other admin-panel role is turned away. */
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
  const role = myProfile?.role ?? null;
  const canManage = ["admin", "organizer", "staff"].includes(role ?? "");
  const canView = canManage || ["customer_support", "referee"].includes(role ?? "");
  if (!canView) {
    return (
      <AdminShell title="Content" active="/admin/content">
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You don&apos;t have access to this page.
        </p>
      </AdminShell>
    );
  }

  const [
    announcements, competitions, { data: matrixRows }, { data: comparisonRows }, { data: signInDefaults },
    { data: notificationRows }, { data: telegramLinkRows },
  ] = await Promise.all([
    getAllAnnouncements(),
    getAllCompetitions(),
    supabase.from("access_matrix_rows").select("*").order("position"),
    supabase.from("access_comparison_rows").select("*").order("position"),
    supabase.from("sign_in_role_defaults").select("*").order("sort_order"),
    supabase.from("notification_reference_rows").select("*").order("position"),
    supabase.from("telegram_link_reference_rows").select("*").order("position"),
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

  return (
    <AdminShell title="Content" active="/admin/content" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-6 text-sm text-neutral-500">
        {canManage ? (
          <>
            Create and manage announcements, notes, and messages, and add new competition tiers —
            all in one place, plus every editable reference table below.
          </>
        ) : (
          <>
            <strong>View only.</strong> Admin and Organizer manage announcements, competition
            tiers, and every reference table below — Participant Support and Judge can
            see all of it here but can&apos;t add, edit, or delete anything.
          </>
        )}
      </p>

      <div className={canManage ? "grid gap-8 lg:grid-cols-2" : ""}>
        {canManage && (
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
                      <option key={c.id} value={c.id}>{shortTierName(c.name)}</option>
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
                    <DateField id="tier_event_date" name="event_date" required={false} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="tier_deadline" className={adminLabel}>Registration deadline</label>
                    <DateField id="tier_deadline" name="registration_deadline" required={false} className={adminInput} />
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
        )}

        <div>
          <h2 className="mb-3 text-lg font-bold">All Announcements, Notes &amp; Messages</h2>
          {announcements.length === 0 ? (
            <EmptyState>{canManage ? "Nothing yet — create your first one on the left." : "Nothing yet."}</EmptyState>
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
                    {canManage && (
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
                    )}
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

      <details className="mt-10 rounded-lg border border-neutral-200 bg-white" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold">Access Matrix {canManage ? "(Editable)" : "(View Only)"}</h2>
            <p className="text-sm font-normal text-neutral-500">
              {canManage
                ? "Add, edit, or delete resources and each role's access — every cell offers a drop-down of common choices, and free text is also allowed."
                : "What each role can actually do, page by page."}{" "}
              Shown on Accounts → Access Matrix.
            </p>
          </div>
          <span className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-50">
            ✕ Close
          </span>
        </summary>
        <div className="space-y-3 border-t border-neutral-100 p-4">
          {canManage && (matrixRows ?? []).length === 0 && (
            <form action={seedAccessTables}>
              <input type="hidden" name="return_to" value={RETURN_TO} />
              <button className={adminBtn}>Import current defaults</button>
            </form>
          )}
          {/* Each row's edit/delete controls live in a standalone form, keyed
              by id and referenced via the `form` attribute on every input —
              lets the row render as ordinary FilterableTable cells (so it
              gets filtering, column resize/wrap, and the scroll sliders for
              free) while still submitting together as one row. */}
          {canManage && (
            <>
              {(matrixRows ?? []).map((r) => (
                <form key={r.id} id={`matrix-${r.id}`} action={saveAccessMatrixRow}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="return_to" value={RETURN_TO} />
                </form>
              ))}
              <form id="matrix-new" action={saveAccessMatrixRow}>
                <input type="hidden" name="return_to" value={RETURN_TO} />
              </form>
              <button form="matrix-new" type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700">
                + Add row (fill below, then Save on the new row)
              </button>
            </>
          )}
          <FilterableTable
            rowKey="id"
            downloadName="access-matrix"
            stickyColumns={2}
            firstColumnWidth={56}
            columns={[
              { key: "position", label: "No.", width: 56 },
              { key: "resource", label: "Resource", width: 200, wrap: true },
              { key: "admin", label: "Admin", width: 160, wrap: true },
              { key: "organizer", label: "Organizer", width: 160, wrap: true },
              { key: "customer_support", label: "Participant Support", width: 160, wrap: true },
              { key: "referee", label: "Judge", width: 160, wrap: true },
              { key: "note", label: "Note", width: 220, wrap: true },
              { key: "actions", label: "Actions", width: 150 },
            ]}
            csvColumns={[
              { key: "position_csv", label: "No." },
              { key: "resource_csv", label: "Resource" },
              { key: "admin_csv", label: "Admin" },
              { key: "organizer_csv", label: "Organizer" },
              { key: "customer_support_csv", label: "Participant Support" },
              { key: "referee_csv", label: "Judge" },
              { key: "note_csv", label: "Note" },
            ]}
            rows={[
              ...(canManage
                ? [
                    {
                      id: "matrix-new-row",
                      position: <input form="matrix-new" name="position" type="number" min="1" placeholder="No." className={cellInput} />,
                      resource: <input form="matrix-new" name="resource" required placeholder="Resource *" className={cellInput} />,
                      admin: <input form="matrix-new" name="admin" list="access_choices" placeholder="Admin" className={cellInput} />,
                      organizer: <input form="matrix-new" name="organizer" list="access_choices" placeholder="Organizer" className={cellInput} />,
                      customer_support: <input form="matrix-new" name="customer_support" list="access_choices" placeholder="P. Support" className={cellInput} />,
                      referee: <input form="matrix-new" name="referee" list="access_choices" placeholder="Judge" className={cellInput} />,
                      note: <input form="matrix-new" name="note" placeholder="Note" className={cellInput} />,
                      actions: <span className="text-xs text-neutral-400">New row — Save above</span>,
                      position_csv: "", resource_csv: "", admin_csv: "", organizer_csv: "", customer_support_csv: "", referee_csv: "", note_csv: "",
                    },
                  ]
                : []),
              ...(matrixRows ?? []).map((r) => ({
                id: r.id as string,
                position: (
                  <input form={`matrix-${r.id}`} name="position" type="number" min="1" defaultValue={r.position} disabled={!canManage} className={cellInput} />
                ),
                resource: (
                  <input form={`matrix-${r.id}`} name="resource" required defaultValue={r.resource} disabled={!canManage} className={`${cellInput} font-semibold`} />
                ),
                admin: <input form={`matrix-${r.id}`} name="admin" list="access_choices" defaultValue={r.admin} disabled={!canManage} className={cellInput} />,
                organizer: <input form={`matrix-${r.id}`} name="organizer" list="access_choices" defaultValue={r.organizer} disabled={!canManage} className={cellInput} />,
                customer_support: (
                  <input form={`matrix-${r.id}`} name="customer_support" list="access_choices" defaultValue={r.customer_support} disabled={!canManage} className={cellInput} />
                ),
                referee: <input form={`matrix-${r.id}`} name="referee" list="access_choices" defaultValue={r.referee} disabled={!canManage} className={cellInput} />,
                note: <input form={`matrix-${r.id}`} name="note" defaultValue={r.note ?? ""} placeholder="Note" disabled={!canManage} className={cellInput} />,
                actions: canManage ? (
                  <span className="flex gap-1.5">
                    <button form={`matrix-${r.id}`} type="submit" className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                      Save
                    </button>
                    <button
                      form={`matrix-${r.id}`}
                      formAction={deleteAccessMatrixRow}
                      className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-neutral-300">—</span>
                ),
                position_csv: String(r.position ?? ""),
                resource_csv: r.resource as string,
                admin_csv: (r.admin as string) ?? "",
                organizer_csv: (r.organizer as string) ?? "",
                customer_support_csv: (r.customer_support as string) ?? "",
                referee_csv: (r.referee as string) ?? "",
                note_csv: (r.note as string) ?? "",
              })),
            ]}
          />
          {canManage && (
            <CsvUploadForm
              action={bulkUploadAccessMatrixRows}
              templateHref="/access-matrix-template.csv"
              entityLabel="access matrix row"
            />
          )}
          {(matrixRows ?? []).length === 0 && (
            <EmptyState>
              {canManage ? "Table is empty — the built-in defaults are shown until you import or add rows." : "Table is empty."}
            </EmptyState>
          )}
        </div>
      </details>

      <details className="mt-6 rounded-lg border border-neutral-200 bg-white" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold">Sign-in Access Matrix {canManage ? "(Editable)" : "(View Only)"}</h2>
            <p className="text-sm font-normal text-neutral-500">
              Each role&apos;s default sign-in cap, and whether its valid window follows a
              competition tier&apos;s default dates — read by every new account and by
              recompute_sign_in_quota whenever a new role/tier link appears for it. Never touches
              an account that already has a custom invitation-code value or a manual Sign-in
              Control override. Shown read-only on the Account page for everyone.
            </p>
            <p className="mt-2 text-sm font-normal text-neutral-500">
              A multi-role account gets the <strong>sum</strong>{" "}
              of its roles&apos; allowances
              (Judge + Participant = 1,000 + 250 = 1,250), and a window spanning every
              tier it holds — earliest start to latest end. The count and the window are
              enforced <strong>concurrently</strong>: whichever is reached first ends access. One
              unlimited role makes the whole account unlimited.
            </p>
            <p className="mt-2 text-sm font-normal text-amber-800">
              <strong>Role (label)</strong> is display text — rename it freely.{" "}
              <strong>Matches account role</strong>{" "}
              is what actually connects the row to real accounts, so a row set to
              &ldquo;display only&rdquo; governs nobody and that role falls back to 250 sign-ins.
            </p>
          </div>
          <span className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-50">
            ✕ Close
          </span>
        </summary>
        <div className="space-y-3 border-t border-neutral-100 p-4">
          {canManage && (
            <>
              {(signInDefaults ?? []).map((r) => (
                <form key={r.id} id={`signin-${r.id}`} action={saveSignInRoleDefault}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="return_to" value={RETURN_TO} />
                  <input type="hidden" name="sort_order" value={r.sort_order} />
                </form>
              ))}
              <form id="signin-new" action={saveSignInRoleDefault}>
                <input type="hidden" name="return_to" value={RETURN_TO} />
              </form>
              <button form="signin-new" type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700">
                + Add row (fill below, then Save on the new row)
              </button>
            </>
          )}
          <FilterableTable
            rowKey="id"
            downloadName="sign-in-access-matrix"
            stickyColumns={1}
            columns={[
              { key: "role", label: "Role (label)", width: 150 },
              { key: "role_key", label: "Matches account role", width: 175 },
              { key: "default_sign_in_limit", label: "Default sign-ins", width: 140 },
              { key: "tier_tied", label: "Tier-tied?", width: 90 },
              { key: "valid_from", label: "Valid From", width: 130 },
              { key: "valid_until", label: "Valid Until", width: 130 },
              { key: "notes", label: "Notes", width: 260, wrap: true },
              { key: "actions", label: "Actions", width: 150 },
            ]}
            csvColumns={[
              { key: "role_csv", label: "Role" },
              { key: "role_key_csv", label: "Matches account role" },
              { key: "default_sign_in_limit_csv", label: "Default sign-ins" },
              { key: "tier_tied_csv", label: "Tier-tied?" },
              { key: "valid_from_csv", label: "Valid from" },
              { key: "valid_until_csv", label: "Valid until" },
              { key: "notes_csv", label: "Notes" },
            ]}
            rows={[
              ...(canManage
                ? [
                    {
                      id: "signin-new-row",
                      role: <input form="signin-new" name="role" required placeholder="Display label *" className={cellInput} />,
                      role_key: <RoleKeySelect form="signin-new" />,
                      default_sign_in_limit: (
                        <input form="signin-new" name="default_sign_in_limit" type="number" min="0" placeholder="blank = unlimited" className={cellInput} />
                      ),
                      tier_tied: (
                        <label className="flex items-center justify-center gap-1 text-xs text-neutral-600">
                          <input form="signin-new" type="checkbox" name="tier_tied" className="h-3.5 w-3.5" /> Tier-tied
                        </label>
                      ),
                      valid_from: (
                        <DateField form="signin-new" name="valid_from" required={false} className={cellInput} title="Valid from (optional override)" />
                      ),
                      valid_until: (
                        <DateField form="signin-new" name="valid_until" required={false} className={cellInput} title="Valid until (optional override)" />
                      ),
                      notes: <input form="signin-new" name="notes" placeholder="Note (optional)" className={cellInput} />,
                      actions: <span className="text-xs text-neutral-400">New row — Save above</span>,
                      role_csv: "", role_key_csv: "", default_sign_in_limit_csv: "", tier_tied_csv: "", valid_from_csv: "", valid_until_csv: "", notes_csv: "",
                    },
                  ]
                : []),
              ...(signInDefaults ?? []).map((r) => ({
                id: r.id as string,
                role: <input form={`signin-${r.id}`} name="role" required defaultValue={r.role} disabled={!canManage} className={`${cellInput} font-semibold`} />,
                role_key: <RoleKeySelect form={`signin-${r.id}`} value={(r.role_key as string | null) ?? ""} disabled={!canManage} />,
                default_sign_in_limit: (
                  <input
                    form={`signin-${r.id}`}
                    name="default_sign_in_limit"
                    type="number"
                    min="0"
                    defaultValue={r.default_sign_in_limit ?? ""}
                    placeholder="blank = unlimited"
                    disabled={!canManage}
                    className={cellInput}
                  />
                ),
                tier_tied: (
                  <label className="flex items-center justify-center gap-1 text-xs text-neutral-600">
                    <input form={`signin-${r.id}`} type="checkbox" name="tier_tied" defaultChecked={r.tier_tied} disabled={!canManage} className="h-3.5 w-3.5" /> Tier-tied
                  </label>
                ),
                valid_from: (
                  <DateField
                    form={`signin-${r.id}`}
                    name="valid_from"
                    required={false}
                    defaultValueISO={r.valid_from ?? ""}
                    disabled={!canManage}
                    className={cellInput}
                    title="Optional override — when set, wins over the dynamic tier-derived window"
                  />
                ),
                valid_until: (
                  <DateField
                    form={`signin-${r.id}`}
                    name="valid_until"
                    required={false}
                    defaultValueISO={r.valid_until ?? ""}
                    disabled={!canManage}
                    className={cellInput}
                    title="Optional override — when set, wins over the dynamic tier-derived window"
                  />
                ),
                notes: <input form={`signin-${r.id}`} name="notes" defaultValue={r.notes ?? ""} placeholder="Note" disabled={!canManage} className={cellInput} />,
                actions: canManage ? (
                  <span className="flex gap-1.5">
                    <button form={`signin-${r.id}`} type="submit" className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                      Save
                    </button>
                    <button
                      form={`signin-${r.id}`}
                      formAction={deleteSignInRoleDefault}
                      className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                      title="Deleting falls back to the built-in 250 default for this role"
                    >
                      Delete
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-neutral-300">—</span>
                ),
                role_csv: r.role as string,
                role_key_csv: ((r.role_key as string | null) ?? "") || "— display only",
                default_sign_in_limit_csv: r.default_sign_in_limit == null ? "Unlimited" : String(r.default_sign_in_limit),
                tier_tied_csv: r.tier_tied ? "Yes" : "No",
                valid_from_csv: r.valid_from ? formatDate(r.valid_from as string) : "",
                valid_until_csv: r.valid_until ? formatDate(r.valid_until as string) : "",
                notes_csv: (r.notes as string) ?? "",
              })),
            ]}
          />
          {canManage && (
            <CsvUploadForm
              action={bulkUploadSignInRoleDefaults}
              templateHref="/sign-in-role-defaults-template.csv"
              entityLabel="role default"
              note="Dates use DD/MM/YYYY format. Re-uploading updates existing roles instead of duplicating them."
            />
          )}
          {(signInDefaults ?? []).length === 0 && (
            <EmptyState>Table is empty — every role falls back to the built-in 250 default until you add rows.</EmptyState>
          )}
        </div>
      </details>

      <div className="mt-10 space-y-3">
        <h2 className="text-lg font-bold">&quot;What Your Payment Unlocks&quot; — Access Comparison {canManage ? "(Editable)" : "(View Only)"}</h2>
        <p className="text-sm text-neutral-500">
          These rows render on the public Registration page. Columns: Participant · School ·
          Sensei · Judge · Audience · Organizer · Participant Support.
        </p>
        {canManage && (
          <>
            {(comparisonRows ?? []).map((r) => (
              <form key={r.id} id={`comparison-${r.id}`} action={saveAccessComparisonRow}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="return_to" value={RETURN_TO} />
              </form>
            ))}
            <form id="comparison-new" action={saveAccessComparisonRow}>
              <input type="hidden" name="return_to" value={RETURN_TO} />
            </form>
            <button form="comparison-new" type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700">
              + Add row (fill below, then Save on the new row)
            </button>
          </>
        )}
        <FilterableTable
          rowKey="id"
          downloadName="access-comparison"
          stickyColumns={2}
          firstColumnWidth={56}
          columns={[
            { key: "position", label: "No.", width: 56 },
            { key: "what", label: "Access row", width: 200, wrap: true },
            { key: "participant", label: "Participant", width: 140, wrap: true },
            { key: "school", label: "School", width: 140, wrap: true },
            { key: "sensei", label: "Sensei", width: 140, wrap: true },
            { key: "referee", label: "Judge", width: 140, wrap: true },
            { key: "audience", label: "Audience", width: 140, wrap: true },
            { key: "organizer", label: "Organizer", width: 140, wrap: true },
            { key: "support", label: "P. Support", width: 140, wrap: true },
            { key: "actions", label: "Actions", width: 150 },
          ]}
          csvColumns={[
            { key: "position_csv", label: "No." },
            { key: "what_csv", label: "Access row" },
            { key: "participant_csv", label: "Participant" },
            { key: "school_csv", label: "School" },
            { key: "sensei_csv", label: "Sensei" },
            { key: "referee_csv", label: "Judge" },
            { key: "audience_csv", label: "Audience" },
            { key: "organizer_csv", label: "Organizer" },
            { key: "support_csv", label: "P. Support" },
          ]}
          rows={[
            ...(canManage
              ? [
                  {
                    id: "comparison-new-row",
                    position: <input form="comparison-new" name="position" type="number" min="1" placeholder="No." className={cellInput} />,
                    what: <input form="comparison-new" name="what" required placeholder="Access row *" className={cellInput} />,
                    participant: <input form="comparison-new" name="participant" list="access_choices" placeholder="Participant" className={cellInput} />,
                    school: <input form="comparison-new" name="school" list="access_choices" placeholder="School" className={cellInput} />,
                    sensei: <input form="comparison-new" name="sensei" list="access_choices" placeholder="Sensei" className={cellInput} />,
                    referee: <input form="comparison-new" name="referee" list="access_choices" placeholder="Judge" className={cellInput} />,
                    audience: <input form="comparison-new" name="audience" list="access_choices" placeholder="Audience" className={cellInput} />,
                    organizer: <input form="comparison-new" name="organizer" list="access_choices" placeholder="Organizer" className={cellInput} />,
                    support: <input form="comparison-new" name="support" list="access_choices" placeholder="P. Support" className={cellInput} />,
                    actions: <span className="text-xs text-neutral-400">New row — Save above</span>,
                    position_csv: "", what_csv: "", participant_csv: "", school_csv: "", sensei_csv: "", referee_csv: "", audience_csv: "", organizer_csv: "", support_csv: "",
                  },
                ]
              : []),
            ...(comparisonRows ?? []).map((r) => ({
              id: r.id as string,
              position: <input form={`comparison-${r.id}`} name="position" type="number" min="1" defaultValue={r.position} disabled={!canManage} className={cellInput} />,
              what: <input form={`comparison-${r.id}`} name="what" required defaultValue={r.what} disabled={!canManage} className={`${cellInput} font-semibold`} />,
              participant: <input form={`comparison-${r.id}`} name="participant" list="access_choices" defaultValue={r.participant} disabled={!canManage} className={cellInput} />,
              school: <input form={`comparison-${r.id}`} name="school" list="access_choices" defaultValue={r.school} disabled={!canManage} className={cellInput} />,
              sensei: <input form={`comparison-${r.id}`} name="sensei" list="access_choices" defaultValue={r.sensei} disabled={!canManage} className={cellInput} />,
              referee: <input form={`comparison-${r.id}`} name="referee" list="access_choices" defaultValue={r.referee} disabled={!canManage} className={cellInput} />,
              audience: <input form={`comparison-${r.id}`} name="audience" list="access_choices" defaultValue={r.audience} disabled={!canManage} className={cellInput} />,
              organizer: <input form={`comparison-${r.id}`} name="organizer" list="access_choices" defaultValue={r.organizer} disabled={!canManage} className={cellInput} />,
              support: <input form={`comparison-${r.id}`} name="support" list="access_choices" defaultValue={r.support} disabled={!canManage} className={cellInput} />,
              actions: canManage ? (
                <span className="flex gap-1.5">
                  <button form={`comparison-${r.id}`} type="submit" className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                    Save
                  </button>
                  <button
                    form={`comparison-${r.id}`}
                    formAction={deleteAccessComparisonRow}
                    className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </span>
              ) : (
                <span className="text-xs text-neutral-300">—</span>
              ),
              position_csv: String(r.position ?? ""),
              what_csv: r.what as string,
              participant_csv: (r.participant as string) ?? "",
              school_csv: (r.school as string) ?? "",
              sensei_csv: (r.sensei as string) ?? "",
              referee_csv: (r.referee as string) ?? "",
              audience_csv: (r.audience as string) ?? "",
              organizer_csv: (r.organizer as string) ?? "",
              support_csv: (r.support as string) ?? "",
            })),
          ]}
        />
        {canManage && (
          <CsvUploadForm
            action={bulkUploadAccessComparisonRows}
            templateHref="/access-comparison-template.csv"
            entityLabel="access comparison row"
          />
        )}
      </div>

      <div className="mt-10 space-y-3">
        <h2 className="text-lg font-bold">Notification Reference {canManage ? "(Editable)" : "(View Only)"}</h2>
        <p className="text-sm text-neutral-500">
          Every button across the app, and whether clicking it sends an email, a Telegram DM, or a
          &quot;join Telegram group&quot; link — kept here because a button&apos;s name alone often
          doesn&apos;t say which of these actually fire.
        </p>
        {canManage && (
          <>
            {(notificationRows ?? []).map((r) => (
              <form key={r.id} id={`notif-ref-${r.id}`} action={saveNotificationReferenceRow}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="return_to" value={RETURN_TO} />
              </form>
            ))}
            <form id="notif-ref-new" action={saveNotificationReferenceRow}>
              <input type="hidden" name="return_to" value={RETURN_TO} />
            </form>
            <button form="notif-ref-new" type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700">
              + Add row (fill below, then Save on the new row)
            </button>
          </>
        )}
        <FilterableTable
          rowKey="id"
          downloadName="notification-reference"
          stickyColumns={2}
          firstColumnWidth={56}
          columns={[
            { key: "position", label: "No.", width: 56 },
            { key: "page", label: "Page", width: 220, wrap: true },
            { key: "button_label", label: "Button", width: 220, wrap: true },
            { key: "sends_email", label: "Sends Email?", width: 160, wrap: true },
            { key: "sends_telegram_dm", label: "Sends Telegram DM?", width: 160, wrap: true },
            { key: "telegram_group_link", label: "Join Group Link?", width: 200, wrap: true },
            { key: "notes", label: "Notes", width: 280, wrap: true },
            { key: "actions", label: "Actions", width: 150 },
          ]}
          csvColumns={[
            { key: "position_csv", label: "No." },
            { key: "page_csv", label: "Page" },
            { key: "button_label_csv", label: "Button" },
            { key: "sends_email_csv", label: "Sends Email?" },
            { key: "sends_telegram_dm_csv", label: "Sends Telegram DM?" },
            { key: "telegram_group_link_csv", label: "Join Group Link?" },
            { key: "notes_csv", label: "Notes" },
          ]}
          rows={[
            ...(canManage
              ? [
                  {
                    id: "notif-ref-new-row",
                    position: <input form="notif-ref-new" name="position" type="number" min="1" placeholder="No." className={cellInput} />,
                    page: <input form="notif-ref-new" name="page" required placeholder="Page *" className={cellInput} />,
                    button_label: <input form="notif-ref-new" name="button_label" required placeholder="Button *" className={cellInput} />,
                    sends_email: <input form="notif-ref-new" name="sends_email" placeholder="Yes / No / ..." className={cellInput} />,
                    sends_telegram_dm: <input form="notif-ref-new" name="sends_telegram_dm" placeholder="Yes / No / ..." className={cellInput} />,
                    telegram_group_link: <input form="notif-ref-new" name="telegram_group_link" placeholder="Yes / No / ..." className={cellInput} />,
                    notes: <input form="notif-ref-new" name="notes" placeholder="Note (optional)" className={cellInput} />,
                    actions: <span className="text-xs text-neutral-400">New row — Save above</span>,
                    position_csv: "", page_csv: "", button_label_csv: "", sends_email_csv: "", sends_telegram_dm_csv: "", telegram_group_link_csv: "", notes_csv: "",
                  },
                ]
              : []),
            ...(notificationRows ?? []).map((r) => ({
              id: r.id as string,
              position: <input form={`notif-ref-${r.id}`} name="position" type="number" min="1" defaultValue={r.position} disabled={!canManage} className={cellInput} />,
              page: <input form={`notif-ref-${r.id}`} name="page" required defaultValue={r.page} disabled={!canManage} className={`${cellInput} font-semibold`} />,
              button_label: <input form={`notif-ref-${r.id}`} name="button_label" required defaultValue={r.button_label} disabled={!canManage} className={cellInput} />,
              sends_email: <input form={`notif-ref-${r.id}`} name="sends_email" defaultValue={r.sends_email} disabled={!canManage} className={cellInput} />,
              sends_telegram_dm: <input form={`notif-ref-${r.id}`} name="sends_telegram_dm" defaultValue={r.sends_telegram_dm} disabled={!canManage} className={cellInput} />,
              telegram_group_link: <input form={`notif-ref-${r.id}`} name="telegram_group_link" defaultValue={r.telegram_group_link} disabled={!canManage} className={cellInput} />,
              notes: <input form={`notif-ref-${r.id}`} name="notes" defaultValue={r.notes ?? ""} placeholder="Note" disabled={!canManage} className={cellInput} />,
              actions: canManage ? (
                <span className="flex gap-1.5">
                  <button form={`notif-ref-${r.id}`} type="submit" className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                    Save
                  </button>
                  <button
                    form={`notif-ref-${r.id}`}
                    formAction={deleteNotificationReferenceRow}
                    className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </span>
              ) : (
                <span className="text-xs text-neutral-300">—</span>
              ),
              position_csv: String(r.position ?? ""),
              page_csv: r.page as string,
              button_label_csv: r.button_label as string,
              sends_email_csv: (r.sends_email as string) ?? "",
              sends_telegram_dm_csv: (r.sends_telegram_dm as string) ?? "",
              telegram_group_link_csv: (r.telegram_group_link as string) ?? "",
              notes_csv: (r.notes as string) ?? "",
            })),
          ]}
        />
        {canManage && (
          <CsvUploadForm
            action={bulkUploadNotificationReferenceRows}
            templateHref="/notification-reference-template.csv"
            entityLabel="notification reference row"
          />
        )}
      </div>

      <div className="mt-10 space-y-3">
        <h2 className="text-lg font-bold">Telegram Link Reference {canManage ? "(Editable)" : "(View Only)"}</h2>
        <p className="text-sm text-neutral-500">
          Which roles can ever end up Telegram-linked (able to receive a DM), how they get linked,
          and which roles have no way to link at all today — a DM attempt to an unlinked role is
          always a silent no-op, never an error.
        </p>
        {canManage && (
          <>
            {(telegramLinkRows ?? []).map((r) => (
              <form key={r.id} id={`tg-link-${r.id}`} action={saveTelegramLinkReferenceRow}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="return_to" value={RETURN_TO} />
              </form>
            ))}
            <form id="tg-link-new" action={saveTelegramLinkReferenceRow}>
              <input type="hidden" name="return_to" value={RETURN_TO} />
            </form>
            <button form="tg-link-new" type="submit" className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700">
              + Add row (fill below, then Save on the new row)
            </button>
          </>
        )}
        <FilterableTable
          rowKey="id"
          downloadName="telegram-link-reference"
          stickyColumns={2}
          firstColumnWidth={56}
          columns={[
            { key: "position", label: "No.", width: 56 },
            { key: "role", label: "Role", width: 220, wrap: true },
            { key: "can_be_linked", label: "Can Be Telegram-Linked?", width: 220, wrap: true },
            { key: "how_to_link", label: "How To Link", width: 280, wrap: true },
            { key: "notes", label: "Notes", width: 300, wrap: true },
            { key: "actions", label: "Actions", width: 150 },
          ]}
          csvColumns={[
            { key: "position_csv", label: "No." },
            { key: "role_csv", label: "Role" },
            { key: "can_be_linked_csv", label: "Can Be Telegram-Linked?" },
            { key: "how_to_link_csv", label: "How To Link" },
            { key: "notes_csv", label: "Notes" },
          ]}
          rows={[
            ...(canManage
              ? [
                  {
                    id: "tg-link-new-row",
                    position: <input form="tg-link-new" name="position" type="number" min="1" placeholder="No." className={cellInput} />,
                    role: <input form="tg-link-new" name="role" required placeholder="Role *" className={cellInput} />,
                    can_be_linked: <input form="tg-link-new" name="can_be_linked" placeholder="Yes / No / ..." className={cellInput} />,
                    how_to_link: <input form="tg-link-new" name="how_to_link" placeholder="How (optional)" className={cellInput} />,
                    notes: <input form="tg-link-new" name="notes" placeholder="Note (optional)" className={cellInput} />,
                    actions: <span className="text-xs text-neutral-400">New row — Save above</span>,
                    position_csv: "", role_csv: "", can_be_linked_csv: "", how_to_link_csv: "", notes_csv: "",
                  },
                ]
              : []),
            ...(telegramLinkRows ?? []).map((r) => ({
              id: r.id as string,
              position: <input form={`tg-link-${r.id}`} name="position" type="number" min="1" defaultValue={r.position} disabled={!canManage} className={cellInput} />,
              role: <input form={`tg-link-${r.id}`} name="role" required defaultValue={r.role} disabled={!canManage} className={`${cellInput} font-semibold`} />,
              can_be_linked: <input form={`tg-link-${r.id}`} name="can_be_linked" defaultValue={r.can_be_linked} disabled={!canManage} className={cellInput} />,
              how_to_link: <input form={`tg-link-${r.id}`} name="how_to_link" defaultValue={r.how_to_link} disabled={!canManage} className={cellInput} />,
              notes: <input form={`tg-link-${r.id}`} name="notes" defaultValue={r.notes ?? ""} placeholder="Note" disabled={!canManage} className={cellInput} />,
              actions: canManage ? (
                <span className="flex gap-1.5">
                  <button form={`tg-link-${r.id}`} type="submit" className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                    Save
                  </button>
                  <button
                    form={`tg-link-${r.id}`}
                    formAction={deleteTelegramLinkReferenceRow}
                    className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </span>
              ) : (
                <span className="text-xs text-neutral-300">—</span>
              ),
              position_csv: String(r.position ?? ""),
              role_csv: r.role as string,
              can_be_linked_csv: (r.can_be_linked as string) ?? "",
              how_to_link_csv: (r.how_to_link as string) ?? "",
              notes_csv: (r.notes as string) ?? "",
            })),
          ]}
        />
        {canManage && (
          <CsvUploadForm
            action={bulkUploadTelegramLinkReferenceRows}
            templateHref="/telegram-link-reference-template.csv"
            entityLabel="telegram link reference row"
          />
        )}
      </div>
    </AdminShell>
  );
}
