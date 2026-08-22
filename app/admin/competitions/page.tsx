import Link from "next/link";
import { getAllCompetitions } from "@/lib/admin-data";
import { getCategories, schemaReady } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { saveCompetition, saveCategory } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, NoTranslate, SetupNotice, formatDate, formatUSD } from "@/components/ui";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import KataGroupDragZone from "@/components/KataGroupDragZone";
import SubcategoryDragZone from "@/components/SubcategoryDragZone";
import ScrollToAnchor from "@/components/ScrollToAnchor";
import CategoryActionButton from "@/components/CategoryActionButton";
import { AddKataForm, RenameKataControl } from "@/components/KataAdminControls";
import DateField from "@/components/DateField";
import { kataBaseOf } from "@/lib/division";
import { groupByFamily, adjacentKataOf, familyOfGroup, isKataFamily } from "@/lib/kata-families";
import KataFamilyControl from "@/components/KataFamilyControl";
import {
  WATERMARK_FONT_OPTIONS, WATERMARK_DIRECTION_OPTIONS,
  DEFAULT_WATERMARK_TEXT, DEFAULT_WATERMARK_FONT_FAMILY, DEFAULT_WATERMARK_COLOR,
} from "@/lib/watermark";
import { getSiteAppearance } from "@/lib/site-appearance-server";
import SiteAppearanceForm from "@/components/SiteAppearanceForm";
import { getRecordingAppearance } from "@/lib/recording-appearance-server";
import RecordingAppearanceForm from "@/components/RecordingAppearanceForm";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminCompetitions({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string; editcat?: string; addcat?: string; ok?: string; error?: string;
    /** Which competition's panel, and which kata group within it, to keep
     * expanded after a category action (save/delete/merge) redirects back
     * here — without these, every such action landed back at the bare page
     * top with both accordion levels collapsed. */
    opencomp?: string; openkata?: string;
  }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Competitions" active="/admin/competitions">
        <SetupNotice />
      </AdminShell>
    );
  }

  const competitions = await getAllCompetitions();
  const categoriesByCompetition = new Map<string, Category[]>();
  for (const c of competitions) {
    categoriesByCompetition.set(c.id, await getCategories(c.id));
  }
  const supabaseAdmin = await createClient();
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser();
  const { data: myProfile } = user
    ? await supabaseAdmin.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  // Admin/Organizer/Referee/Participant Support can all merge-to-Mix and
  // edit/delete categories here; only Admin/Organizer (and legacy "staff")
  // may create or edit the competition itself.
  const canManageCompetition = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");
  const allCategories = [...categoriesByCompetition.values()].flat();
  const categoryPaidCount = new Map<string, number>();
  if (allCategories.length > 0) {
    const { data: counts } = await supabaseAdmin.rpc("category_paid_counts", {
      p_category_ids: allCategories.map((c) => c.id),
    });
    for (const row of (counts as Array<{ category_id: string; cnt: number }>) ?? []) {
      categoryPaidCount.set(row.category_id, row.cnt);
    }
  }
  // How many not-yet-undone merges/deletes are on each competition's undo
  // stack — drives the "Undo last merge (N)" / "Undo delete (N)" button
  // labels next to "+ Add category", visible to every admin/organizer/
  // staff account (not just whoever clicked), since it's a straight count
  // from these tables. Ordered newest-first so the first row seen per
  // competition_id is both the one Undo would act on next AND, since every
  // row for that competition gets counted as the loop continues, the
  // running total of everything still on the stack.
  const mergeStatsByCompetition = new Map<string, { count: number; description: string | null }>();
  const deleteStatsByCompetition = new Map<string, { count: number; description: string | null }>();
  if (canManageCompetition) {
    const [{ data: mergeLogRows }, { data: deleteLogRows }] = await Promise.all([
      supabaseAdmin
        .from("category_merge_log")
        .select("competition_id, description, created_at")
        .is("undone_at", null)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("category_delete_log")
        .select("competition_id, category, created_at")
        .is("undone_at", null)
        .order("created_at", { ascending: false }),
    ]);
    for (const row of (mergeLogRows as Array<{ competition_id: string; description: string | null }>) ?? []) {
      const existing = mergeStatsByCompetition.get(row.competition_id);
      if (existing) existing.count += 1;
      else mergeStatsByCompetition.set(row.competition_id, { count: 1, description: row.description });
    }
    for (const row of (deleteLogRows as Array<{ competition_id: string; category: { name?: string } | null }>) ?? []) {
      const existing = deleteStatsByCompetition.get(row.competition_id);
      if (existing) existing.count += 1;
      else {
        deleteStatsByCompetition.set(row.competition_id, {
          count: 1,
          description: row.category?.name ? `Restore "${row.category.name}"` : null,
        });
      }
    }
  }
  const editingCategory = params.editcat
    ? allCategories.find((c) => c.id === params.editcat)
    : undefined;
  const addingToCompetition = params.addcat
    ? competitions.find((c) => c.id === params.addcat)
    : undefined;
  const categoryModalCompetition = editingCategory
    ? competitions.find((c) => c.id === editingCategory.competition_id)
    : addingToCompetition;
  const editingCategoryBase = editingCategory ? kataBaseOf(editingCategory.name) : null;

  /** Builds a return_to that reopens the right competition panel (and, when
   * given, the right kata-group sub-panel within it) instead of landing back
   * at the bare top of the page. */
  function categoryReturnTo(competitionId: string, base?: string | null): string {
    return `/admin/competitions?opencomp=${competitionId}${base ? `&openkata=${encodeURIComponent(base)}` : ""}`;
  }
  function competitionAnchorId(competitionId: string): string {
    return `comp-${competitionId}`;
  }
  function kataGroupAnchorId(competitionId: string, base: string): string {
    return `kata-${competitionId}-${encodeURIComponent(base)}`;
  }
  // Reopening the right panel via opencomp/openkata isn't enough on its own
  // -- the redirect from a category action still lands the browser scrolled
  // to the very top of the page, same as any other navigation. This tells
  // ScrollToAnchor which element to bring back into view once mounted.
  const scrollAnchorId = params.opencomp
    ? params.openkata
      ? kataGroupAnchorId(params.opencomp, params.openkata)
      : competitionAnchorId(params.opencomp)
    : null;

  const categoryModalCloseHref = (() => {
    const base = params.edit ? `/admin/competitions?edit=${params.edit}` : "/admin/competitions";
    if (!categoryModalCompetition) return base;
    const sep = base.includes("?") ? "&" : "?";
    const kataParam = editingCategoryBase ? `&openkata=${encodeURIComponent(editingCategoryBase)}` : "";
    return `${base}${sep}opencomp=${categoryModalCompetition.id}${kataParam}`;
  })();
  const editing = params.edit ? competitions.find((c) => c.id === params.edit) : undefined;
  const { settings: siteAppearance, logoUrl: siteLogoUrl } = await getSiteAppearance();
  const { settings: recordingAppearance, logoUrl: recordingLogoUrl } = await getRecordingAppearance();

  return (
    <AdminShell
      title="Competitions"
      active="/admin/competitions"
      flash={{ ok: params.ok, error: params.error }}
    >
      {/* key forces a fresh mount (and a fresh scroll-into-view) even when a
          merge/edit/delete redirect lands back on the same anchor as before
          -- otherwise React sees an unchanged anchorId and skips the effect,
          leaving the page at Next's default scroll-to-top after the action. */}
      <ScrollToAnchor key={`${scrollAnchorId ?? ""}-${params.ok ?? ""}-${params.error ?? ""}`} anchorId={scrollAnchorId} />
      <div className="space-y-8">
        {canManageCompetition && (
          <div>
            <h2 className="mb-3 text-lg font-bold">{editing ? "Edit Competition" : "Create Competition"}</h2>
            <Card>
              <form key={editing?.id ?? "create"} action={saveCompetition} className="space-y-4">
                {editing && <input type="hidden" name="id" value={editing.id} />}
                <div>
                  <label htmlFor="name" className={adminLabel}>Name *</label>
                  <input id="name" name="name" required defaultValue={editing?.name ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="venue" className={adminLabel}>Venue</label>
                  <input id="venue" name="venue" defaultValue={editing?.venue ?? ""} className={adminInput} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="event_date" className={adminLabel}>Event date</label>
                    <DateField id="event_date" name="event_date" required={false} defaultValueISO={editing?.event_date ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="registration_deadline" className={adminLabel}>Registration deadline</label>
                    <DateField id="registration_deadline" name="registration_deadline" required={false} defaultValueISO={editing?.registration_deadline ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="winners_announce_date" className={adminLabel}>
                      Winners announce date{" "}
                      <span className="font-normal text-neutral-400">(blank = deadline + 30 days rule)</span>
                    </label>
                    <DateField id="winners_announce_date" name="winners_announce_date" required={false} defaultValueISO={editing?.winners_announce_date ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="audience_signin_date" className={adminLabel}>
                      Audience recommended sign-in date
                    </label>
                    <DateField id="audience_signin_date" name="audience_signin_date" required={false} defaultValueISO={editing?.audience_signin_date ?? ""} className={adminInput} />
                  </div>
                  <p className="text-xs text-neutral-400 sm:col-span-2">
                    Event date → Registration deadline is the participants&apos; recording-submission
                    timeline; referees start scoring only after the deadline. Setting a Winners
                    announce date makes this tier &quot;special&quot; — it overrides the default
                    &quot;deadline + 30 days, next Malaysia working day&quot; rule everywhere
                    (Winners page, audience score reveal, and the registration page).
                  </p>
                  <div>
                    <label htmlFor="registration_fee_usd" className={adminLabel}>Fee (USD)</label>
                    <input id="registration_fee_usd" name="registration_fee_usd" type="number" step="0.01" min="0" defaultValue={editing?.registration_fee_usd ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="status" className={adminLabel}>Status</label>
                    <select id="status" name="status" defaultValue={editing?.status ?? "draft"} className={adminInput}>
                      <option value="draft">Draft</option>
                      <option value="open">Open (registration live)</option>
                      <option value="closed">Closed</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="description" className={adminLabel}>Description</label>
                  <textarea id="description" name="description" rows={3} defaultValue={editing?.description ?? ""} className={adminInput} />
                </div>

                {/* Participant sign-in window for this tier. Every account whose
                    quota is auto-managed and that resolves to this tier inherits
                    these two dates (see recompute_sign_in_quota). */}
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                    Participant sign-in validity for this tier
                  </p>
                  <div className="mt-2 grid gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="default_sign_in_valid_from" className={adminLabel}>Sign-in valid from</label>
                      <DateField
                        id="default_sign_in_valid_from"
                        name="default_sign_in_valid_from"
                        required={false}
                        defaultValueISO={editing?.default_sign_in_valid_from ?? ""}
                        className={adminInput}
                      />
                      <label htmlFor="sign_in_from_follows_event_date" className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500">
                        <input
                          id="sign_in_from_follows_event_date"
                          name="sign_in_from_follows_event_date"
                          type="checkbox"
                          defaultChecked={editing ? !!editing.sign_in_from_follows_event_date : true}
                        />
                        Keep synced to Event date (overwrites whatever&apos;s typed above on every save)
                      </label>
                    </div>
                    <div>
                      <label htmlFor="default_sign_in_valid_until" className={adminLabel}>Sign-in valid until</label>
                      <DateField
                        id="default_sign_in_valid_until"
                        name="default_sign_in_valid_until"
                        required={false}
                        defaultValueISO={editing?.default_sign_in_valid_until ?? ""}
                        className={adminInput}
                      />
                    </div>
                    <div>
                      <label className={adminLabel}>Sign-ins allowed</label>
                      <p className={`${adminInput} bg-white text-neutral-500`}>250 (Participant)</p>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">
                    A participant on this tier may sign in <strong>250</strong> times, within the window
                    above — whichever runs out first. The 250 comes from the Participant role default
                    (Accounts → Access Matrix), not from this tier, so it is shown here read-only.
                    Leave the dates blank to fall back to the event date and the &quot;winners announce
                    + 30 days&quot; rule.
                  </p>
                </div>

                {/* Burned into every recorded video for this tier (see
                    components/KataRecorder.tsx's drawWatermark) -- every
                    field left blank/default falls back to the app's
                    original hardcoded wording/size/font/color, so an
                    untouched tier looks exactly as it always has. */}
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                    Recording watermark footer for this tier
                  </p>
                  <div className="mt-2 space-y-4">
                    <div>
                      <label htmlFor="watermark_text" className={adminLabel}>
                        Wording <span className="font-normal text-neutral-400">(blank = &quot;{DEFAULT_WATERMARK_TEXT}&quot;)</span>
                      </label>
                      <input
                        id="watermark_text"
                        name="watermark_text"
                        defaultValue={editing?.watermark_text ?? ""}
                        placeholder={DEFAULT_WATERMARK_TEXT}
                        className={adminInput}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div>
                        <label htmlFor="watermark_font_size_px" className={adminLabel}>
                          Font size (px) <span className="font-normal text-neutral-400">(blank = auto)</span>
                        </label>
                        <input
                          id="watermark_font_size_px"
                          name="watermark_font_size_px"
                          type="number"
                          min="6"
                          step="1"
                          defaultValue={editing?.watermark_font_size_px ?? ""}
                          placeholder="Auto"
                          className={adminInput}
                        />
                      </div>
                      <div>
                        <label htmlFor="watermark_font_family" className={adminLabel}>Font type/style</label>
                        <select
                          id="watermark_font_family"
                          name="watermark_font_family"
                          defaultValue={editing?.watermark_font_family ?? DEFAULT_WATERMARK_FONT_FAMILY}
                          className={adminInput}
                        >
                          {WATERMARK_FONT_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="watermark_color" className={adminLabel}>Color</label>
                        <input
                          id="watermark_color"
                          name="watermark_color"
                          type="color"
                          defaultValue={editing?.watermark_color ?? DEFAULT_WATERMARK_COLOR}
                          className={`${adminInput} h-[38px] p-1`}
                        />
                      </div>
                      <div className="flex items-end pb-2">
                        <label htmlFor="watermark_bold" className="flex items-center gap-2 text-sm text-neutral-700">
                          <input
                            id="watermark_bold"
                            name="watermark_bold"
                            type="checkbox"
                            value="true"
                            defaultChecked={editing?.watermark_bold ?? false}
                            className="h-4 w-4 rounded border-neutral-300"
                          />
                          Boldness
                        </label>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="watermark_direction" className={adminLabel}>Direction of font</label>
                      <select
                        id="watermark_direction"
                        name="watermark_direction"
                        defaultValue={editing?.watermark_direction ?? "ltr"}
                        className={adminInput}
                      >
                        {WATERMARK_DIRECTION_OPTIONS.map((d) => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button type="submit" className={adminBtn}>
                    {editing ? "Save changes" : "Create competition"}
                  </button>
                  {editing && (
                    <Link href="/admin/competitions" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                      Cancel
                    </Link>
                  )}
                </div>
              </form>
            </Card>
          </div>
        )}

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">All Competitions</h2>
            {allCategories.length > 0 && (
              <DownloadCsvButton
                filename="categories"
                rows={allCategories.map((cat) => ({
                  Competition: competitions.find((c) => c.id === cat.competition_id)?.name ?? "",
                  Category: cat.name,
                  "Belt Group": cat.belt_group ?? "",
                  Gender: cat.gender ?? "",
                  "Age Min": String(cat.age_min ?? ""),
                  "Age Max": String(cat.age_max ?? ""),
                  Taken: String(categoryPaidCount.get(cat.id) ?? 0),
                  Cap: cat.max_participants != null ? String(cat.max_participants) : "",
                }))}
              />
            )}
          </div>
          {competitions.length === 0 ? (
            <EmptyState>No competitions yet — create one above.</EmptyState>
          ) : (
            <div className="space-y-4">
              {/* Tiers listed cheapest first (USD 10 → 100 → 200), newly
                  created ones after, each in its own drop-down/up panel. */}
              {[...competitions]
                .sort(
                  (a, b) =>
                    (a.registration_fee_usd ?? 0) - (b.registration_fee_usd ?? 0) ||
                    a.created_at.localeCompare(b.created_at),
                )
                .map((c) => (
                <details
                  key={c.id}
                  id={competitionAnchorId(c.id)}
                  className="rounded-lg border border-neutral-200 bg-white shadow-sm"
                  open={editing?.id === c.id || categoryModalCompetition?.id === c.id || params.opencomp === c.id}
                >
                  <summary className="flex cursor-pointer items-start justify-between gap-2 px-4 py-3 hover:bg-neutral-50">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-neutral-900">
                        <span className="mr-1 inline-block align-middle text-[2em] leading-none">▾</span>
                        {c.name}
                      </p>
                      <p className="mt-0.5 text-sm text-neutral-500">
                        {formatDate(c.event_date)} · {c.venue ?? "Venue TBA"} · {formatUSD(c.registration_fee_usd)}
                      </p>
                      <p className="mt-0.5 text-xs uppercase tracking-wide">
                        <span className={c.status === "open" ? "text-green-600 font-semibold" : "text-neutral-400"}>
                          {c.status}
                        </span>
                        {" · deadline "}{formatDate(c.registration_deadline)}
                        {c.winners_announce_date && ` · winners ${formatDate(c.winners_announce_date)}`}
                      </p>
                      <p className="mt-0.5 text-[11px] normal-case text-neutral-400">
                        Event date → deadline is the participant recording-submission timeline;
                        referees start scoring after the deadline.
                      </p>
                    </div>
                    {canManageCompetition && (
                      <Link
                        href={`/admin/competitions?edit=${c.id}`}
                        className="shrink-0 rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                      >
                        Edit
                      </Link>
                    )}
                  </summary>
                  <div className="border-t border-neutral-100 px-4 pb-4 pt-3">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Categories</p>
                      {canManageCompetition && (
                        <span className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/competitions?addcat=${c.id}`}
                            scroll={false}
                            className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                          >
                            + Add category
                          </Link>
                          <AddKataForm competitionId={c.id} returnTo={categoryReturnTo(c.id)} />
                          <CategoryActionButton
                            actionName="undoMerge"
                            fields={{ competition_id: c.id, return_to: categoryReturnTo(c.id) }}
                            className={
                              (mergeStatsByCompetition.get(c.id)?.count ?? 0) > 0
                                ? "rounded border border-orange-300 px-2 py-0.5 text-xs font-semibold text-orange-700 hover:bg-orange-50"
                                : "rounded border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-400 hover:bg-neutral-50"
                            }
                            title={
                              mergeStatsByCompetition.get(c.id)?.description ??
                              "No merge has been done for this tier yet — nothing to undo."
                            }
                            confirmMessage={
                              (mergeStatsByCompetition.get(c.id)?.count ?? 0) > 0
                                ? `Undo the most recent merge for this tier?\n\n${mergeStatsByCompetition.get(c.id)?.description ?? ""}\n\nThis restores the categories it combined and moves registrations back to where they were. Click again afterward to step back one merge further, if more than one was done.`
                                : undefined
                            }
                          >
                            ↺ Undo last merge ({mergeStatsByCompetition.get(c.id)?.count ?? 0})
                          </CategoryActionButton>
                          <CategoryActionButton
                            actionName="undoDelete"
                            fields={{ competition_id: c.id, return_to: categoryReturnTo(c.id) }}
                            className={
                              (deleteStatsByCompetition.get(c.id)?.count ?? 0) > 0
                                ? "rounded border border-orange-300 px-2 py-0.5 text-xs font-semibold text-orange-700 hover:bg-orange-50"
                                : "rounded border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-400 hover:bg-neutral-50"
                            }
                            title={
                              deleteStatsByCompetition.get(c.id)?.description ??
                              "No category has been deleted for this tier yet — nothing to undo."
                            }
                            confirmMessage={
                              (deleteStatsByCompetition.get(c.id)?.count ?? 0) > 0
                                ? `Undo the most recent category delete for this tier?\n\n${deleteStatsByCompetition.get(c.id)?.description ?? ""}\n\nThis recreates the deleted category. Click again afterward to step back one delete further, if more than one was done.`
                                : undefined
                            }
                          >
                            ↺ Undo delete ({deleteStatsByCompetition.get(c.id)?.count ?? 0})
                          </CategoryActionButton>
                        </span>
                      )}
                    </div>
                    {(categoriesByCompetition.get(c.id) ?? []).length === 0 ? (
                      <p className="text-sm text-neutral-400">None yet — click &quot;+ Add category&quot; above to add one.</p>
                    ) : (
                      <div className="space-y-4" data-drag-list={`kata-groups-${c.id}`}>
                        {groupByFamily(categoriesByCompetition.get(c.id) ?? []).map(([family, kataGroups]) => {
                          const totalCats = kataGroups.reduce((sum, [, cats]) => sum + cats.length, 0);
                          const alreadyMerged =
                            kataGroups.length === 1 &&
                            kataGroups[0][1].length === 1 &&
                            kataGroups[0][0] === `${family} Kata — Combined (All Kata, Belts, Ages & Genders)`;
                          return (
                            <div key={family}>
                              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{family} Kata</p>
                                {canManageCompetition && !alreadyMerged && (
                                  <CategoryActionButton
                                    actionName="mergeFamily"
                                    fields={{ competition_id: c.id, family, return_to: categoryReturnTo(c.id) }}
                                    className="rounded border border-sky-300 px-2 py-0.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                                    title={`Combine every ${family} Kata sub-category — any kata, belt, age, or gender within this group — into one category`}
                                    confirmMessage={`Merge all ${totalCats} ${family} Kata categories (every kata, belt, age, and gender in this group) into ONE combined category for this tier?\n\nExisting registrations move over automatically — no resubmission needed. This also means new registrants can no longer be placed into a specific ${family} kata/belt/age slot afterward, the same as the existing Merge → Mix and Merge age buttons. Best done once registration for this tier is effectively closed.`}
                                  >
                                    Merge all {family} Kata ({totalCats}) → one category
                                  </CategoryActionButton>
                                )}
                              </div>
                              <div className="space-y-2" data-drag-family={family}>
                                {kataGroups.map(([base, cats]) => {
                          const kyuCats = cats.filter((cat) => cat.belt_group === "kyu");
                          const danCats = cats.filter((cat) => cat.belt_group === "dan");
                          const kyuMerged = kyuCats.length === 1 && kyuCats[0].name === `${base} — Color/Kyu Belt — Combined (All Ages & Genders)`;
                          const danMerged = danCats.length === 1 && danCats[0].name === `${base} — Black Belt & Dan Holders — Combined (All Ages & Genders)`;
                          const neighborAbove = adjacentKataOf(base, "above");
                          const neighborBelow = adjacentKataOf(base, "below");
                          // Any slot taken anywhere in this kata blocks deleting the
                          // whole thing, per the organizer's rule. The server enforces
                          // the same check against ALL registrations (not just paid
                          // ones) and is the authority; this only decides whether to
                          // offer the button at all.
                          const kataTaken = cats.reduce((n, cat) => n + (categoryPaidCount.get(cat.id) ?? 0), 0);
                          return (
                          <details
                            key={base}
                            id={kataGroupAnchorId(c.id, base)}
                            data-drag-item={base}
                            className="group rounded border border-neutral-100"
                            open={params.openkata === base || cats.some((cat) => cat.id === params.editcat)}
                          >
                            <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm font-semibold text-neutral-800 [&::-webkit-details-marker]:hidden marker:hidden hover:bg-neutral-50">
                              <span className="inline-block shrink-0 text-neutral-400 transition-transform group-open:rotate-90">
                                ▶
                              </span>
                              {canManageCompetition ? (
                                <KataGroupDragZone competitionId={c.id} base={base} returnTo={categoryReturnTo(c.id, base)}>
                                  <span className="min-w-0 flex-1">
                                    <NoTranslate>{base}</NoTranslate>{" "}
                                    <span className="font-normal text-neutral-400">({cats.length} sub-categories)</span>
                                  </span>
                                  <KataFamilyControl
                                    competitionId={c.id}
                                    base={base}
                                    currentFamily={familyOfGroup(base, cats)}
                                    isOverridden={cats.some((cat) => isKataFamily(cat.kata_family))}
                                    returnTo={categoryReturnTo(c.id, base)}
                                  />
                                </KataGroupDragZone>
                              ) : (
                                <span>
                                  <NoTranslate>{base}</NoTranslate>{" "}
                                  <span className="font-normal text-neutral-400">({cats.length} sub-categories)</span>
                                </span>
                              )}
                              {canManageCompetition && (
                                <span className="ml-auto flex flex-wrap gap-1">
                                  <RenameKataControl competitionId={c.id} base={base} returnTo={categoryReturnTo(c.id, base)} />
                                  {kataTaken > 0 ? (
                                    <span
                                      className="cursor-not-allowed rounded border border-neutral-200 px-2 py-0.5 text-xs font-normal text-neutral-400"
                                      title={`Can't delete — ${kataTaken} slot${kataTaken === 1 ? "" : "s"} already taken in this kata. Merge it instead.`}
                                    >
                                      Delete
                                    </span>
                                  ) : (
                                    <CategoryActionButton
                                      actionName="deleteKata"
                                      fields={{ competition_id: c.id, kata_base: base, return_to: categoryReturnTo(c.id) }}
                                      className="rounded border border-red-300 px-2 py-0.5 text-xs font-normal text-red-700 hover:bg-red-50"
                                      title={`Delete “${base}” and all ${cats.length} of its sub-categories`}
                                      confirmMessage={`Delete “${base}” and ALL ${cats.length} of its sub-categories?\n\nOnly possible because no slots are taken. Undo is available next to “+ Add category”.`}
                                    >
                                      Delete
                                    </CategoryActionButton>
                                  )}
                                  {neighborAbove && (
                                    <CategoryActionButton
                                      actionName="mergeAdjacentKata"
                                      fields={{ competition_id: c.id, kata_base: base, direction: "above", return_to: categoryReturnTo(c.id) }}
                                      className="rounded border border-fuchsia-300 px-2 py-0.5 text-xs font-normal text-fuchsia-700 hover:bg-fuchsia-50"
                                      title={`Combine every sub-category of "${base}" with every sub-category of "${neighborAbove}" (the kata immediately above it) into one`}
                                      confirmMessage={`Merge ALL of "${base}" with ALL of "${neighborAbove}" (every belt, age, and gender in both) into ONE combined category?\n\nExisting registrations move over automatically — no resubmission needed. Undo is available next to "+ Add category" if this isn't what you meant.`}
                                    >
                                      ↑ Merge with kata above
                                    </CategoryActionButton>
                                  )}
                                  {neighborBelow && (
                                    <CategoryActionButton
                                      actionName="mergeAdjacentKata"
                                      fields={{ competition_id: c.id, kata_base: base, direction: "below", return_to: categoryReturnTo(c.id) }}
                                      className="rounded border border-fuchsia-300 px-2 py-0.5 text-xs font-normal text-fuchsia-700 hover:bg-fuchsia-50"
                                      title={`Combine every sub-category of "${base}" with every sub-category of "${neighborBelow}" (the kata immediately below it) into one`}
                                      confirmMessage={`Merge ALL of "${base}" with ALL of "${neighborBelow}" (every belt, age, and gender in both) into ONE combined category?\n\nExisting registrations move over automatically — no resubmission needed. Undo is available next to "+ Add category" if this isn't what you meant.`}
                                    >
                                      Merge with kata below ↓
                                    </CategoryActionButton>
                                  )}
                                  {kyuCats.length > 1 && !kyuMerged && (
                                    <CategoryActionButton
                                      actionName="mergeBeltGroup"
                                      fields={{ competition_id: c.id, kata_base: base, belt_group: "kyu", return_to: categoryReturnTo(c.id, base) }}
                                      className="rounded border border-teal-300 px-2 py-0.5 text-xs font-normal text-teal-700 hover:bg-teal-50"
                                      title={`Combine every Color/Kyu Belt sub-category (any age or gender) for ${base} into one`}
                                      confirmMessage={`Merge all ${kyuCats.length} Color/Kyu Belt categories for "${base}" (every age and gender) into ONE combined category?\n\nExisting registrations move over automatically.`}
                                    >
                                      Merge Color/Kyu Belt ({kyuCats.length})
                                    </CategoryActionButton>
                                  )}
                                  {danCats.length > 1 && !danMerged && (
                                    <CategoryActionButton
                                      actionName="mergeBeltGroup"
                                      fields={{ competition_id: c.id, kata_base: base, belt_group: "dan", return_to: categoryReturnTo(c.id, base) }}
                                      className="rounded border border-indigo-300 px-2 py-0.5 text-xs font-normal text-indigo-700 hover:bg-indigo-50"
                                      title={`Combine every Black Belt & Dan Holders sub-category (any age or gender) for ${base} into one`}
                                      confirmMessage={`Merge all ${danCats.length} Black Belt & Dan Holders categories for "${base}" (every age and gender) into ONE combined category?\n\nExisting registrations move over automatically.`}
                                    >
                                      Merge Black Belt & Dan ({danCats.length})
                                    </CategoryActionButton>
                                  )}
                                </span>
                              )}
                            </summary>
                            <ul className="space-y-1 px-2 pb-2 pl-5" data-drag-list={`kata-subcats-${base}`}>
                              {cats.map((cat) => {
                                const taken = categoryPaidCount.get(cat.id) ?? 0;
                                const left = cat.max_participants != null ? Math.max(0, cat.max_participants - taken) : null;
                                const subLabel = cat.name.split(" — ").slice(1).join(" — ") || cat.name;
                                const rowContent = (
                                  <>
                                    <span className="text-neutral-600">
                                      {subLabel}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-3">
                                      <span
                                        className={`text-xs whitespace-nowrap ${
                                          left === 0 ? "font-semibold text-red-600" : "text-neutral-400"
                                        }`}
                                      >
                                        {cat.max_participants != null
                                          ? `${taken}/${cat.max_participants} taken (${left} left)`
                                          : `${taken} taken (no cap)`}
                                      </span>
                                      <span className="flex gap-1">
                                        {(cat.gender === "male" || cat.gender === "female") && (
                                          <CategoryActionButton
                                            actionName="mergeToMix"
                                            fields={{ category_id: cat.id, return_to: categoryReturnTo(c.id, base) }}
                                            className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50"
                                            title="Move this category's (and its Male/Female sibling's) registrations into a shared Mix (Male & Female) category"
                                          >
                                            Merge → Mix
                                          </CategoryActionButton>
                                        )}
                                        <CategoryActionButton
                                          actionName="mergeAgeGroup"
                                          fields={{ category_id: cat.id, direction: "before", return_to: categoryReturnTo(c.id, base) }}
                                          className="rounded border border-purple-300 px-2 py-0.5 text-xs text-purple-700 hover:bg-purple-50"
                                          title="Merge with the earlier age group (same kata, belt, and gender) — the age range widens to cover both; repeat to combine 2 or 3 age groups"
                                        >
                                          ⇤ Merge age
                                        </CategoryActionButton>
                                        <CategoryActionButton
                                          actionName="mergeAgeGroup"
                                          fields={{ category_id: cat.id, direction: "after", return_to: categoryReturnTo(c.id, base) }}
                                          className="rounded border border-purple-300 px-2 py-0.5 text-xs text-purple-700 hover:bg-purple-50"
                                          title="Merge with the later age group (same kata, belt, and gender) — the age range widens to cover both; repeat to combine 2 or 3 age groups"
                                        >
                                          Merge age ⇥
                                        </CategoryActionButton>
                                        <Link
                                          href={`/admin/competitions?editcat=${cat.id}`}
                                          scroll={false}
                                          className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50"
                                        >
                                          Edit
                                        </Link>
                                        <CategoryActionButton
                                          actionName="delete"
                                          fields={{ id: cat.id, return_to: categoryReturnTo(c.id, base) }}
                                          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                                        >
                                          Delete
                                        </CategoryActionButton>
                                      </span>
                                    </span>
                                  </>
                                );
                                return (
                                  <li key={cat.id} data-drag-item={cat.id} className="flex items-center gap-2 text-sm">
                                    {canManageCompetition ? (
                                      <SubcategoryDragZone categoryId={cat.id} label={subLabel} returnTo={categoryReturnTo(c.id, base)}>
                                        {rowContent}
                                      </SubcategoryDragZone>
                                    ) : (
                                      <div className="flex flex-1 items-center justify-between gap-2">{rowContent}</div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-neutral-400">
                      Policy: any event with fewer than 100 recording submissions may have its
                      categories or divisions merged with others — use Merge → Mix for gender and
                      ⇤/⇥ Merge age to combine 2 or 3 age groups within the same event, for all 3
                      competition tiers.
                    </p>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>

      {categoryModalCompetition && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10 sm:pt-16">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold">
                {editingCategory ? `Edit Category “${editingCategory.name}”` : `Add Category To “${categoryModalCompetition.name}”`}
              </h2>
              <Link
                href={categoryModalCloseHref}
                scroll={false}
                aria-label="Close"
                className="shrink-0 rounded p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                ✕
              </Link>
            </div>
            <form action={saveCategory} className="space-y-4">
              <input type="hidden" name="competition_id" value={categoryModalCompetition.id} />
              {editingCategory && <input type="hidden" name="id" value={editingCategory.id} />}
              <input
                type="hidden"
                name="return_to"
                value={categoryReturnTo(categoryModalCompetition.id, editingCategoryBase)}
              />
              <div>
                <label htmlFor="cat_name" className={adminLabel}>Category name *</label>
                <input id="cat_name" name="name" required defaultValue={editingCategory?.name ?? ""} className={adminInput} placeholder="e.g. Kata Saifa" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="age_min" className={adminLabel}>Min age</label>
                  <input id="age_min" name="age_min" type="number" min="0" defaultValue={editingCategory?.age_min ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="age_max" className={adminLabel}>Max age</label>
                  <input id="age_max" name="age_max" type="number" min="0" defaultValue={editingCategory?.age_max ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="belt_group" className={adminLabel}>Belt group</label>
                  <select id="belt_group" name="belt_group" defaultValue={editingCategory?.belt_group || "open"} className={adminInput}>
                    <option value="open">Open (Merge of Color/Kyu Belt & Black Belt & Dan Holder)</option>
                    <option value="kyu">Color/Kyu Belt</option>
                    <option value="dan">Black Belt & Dan Holders</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cat_gender" className={adminLabel}>Gender</label>
                  <select id="cat_gender" name="gender" defaultValue={editingCategory?.gender ?? "male"} className={adminInput}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="mix">Mix (Male & Female)</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cat_max_participants" className={adminLabel}>
                    Max participants <span className="font-normal text-neutral-400">(blank = no cap)</span>
                  </label>
                  <input
                    id="cat_max_participants"
                    name="max_participants"
                    type="number"
                    step="1"
                    min="1"
                    defaultValue={editingCategory?.max_participants ?? ""}
                    className={adminInput}
                    placeholder="e.g. 20"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>
                  {editingCategory ? "Save category" : "Add category"}
                </button>
                <Link
                  href={categoryModalCloseHref}
                  scroll={false}
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  Cancel
                </Link>
              </div>
            </form>
          </div>
        </div>
      )}
      {canManageCompetition && (
        <div className="mt-10 border-t border-neutral-200 pt-8">
          <h2 className="mb-1 text-lg font-bold">Site Appearance</h2>
          <p className="mb-3 max-w-3xl text-sm text-neutral-500">
            Controls the public site&apos;s logo, header title/subtitle, main menu, and footer —
            text and style — on every page. Saving here updates the whole site immediately.
          </p>
          <SiteAppearanceForm settings={siteAppearance} logoUrl={siteLogoUrl} />
        </div>
      )}
      {canManageCompetition && (
        <div className="mt-10 border-t border-neutral-200 pt-8">
          <h2 className="mb-1 text-lg font-bold">Recording Appearance</h2>
          <p className="mb-3 max-w-3xl text-sm text-neutral-500">
            Controls the banner logo, banner line 1 and line 2, and the footer watermark on the
            recording screens — what a winner sees framing the camera while recording a video
            testimonial. Separate from Site Appearance so a change to the website&apos;s own header
            never silently changes what appears around a competitor&apos;s recording.
          </p>
          <RecordingAppearanceForm settings={recordingAppearance} logoUrl={recordingLogoUrl} />
        </div>
      )}
    </AdminShell>
  );
}
