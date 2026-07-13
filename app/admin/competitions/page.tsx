import Link from "next/link";
import { getAllCompetitions } from "@/lib/admin-data";
import { getCategories, schemaReady } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { saveCompetition, saveCategory, deleteCategory, mergeCategoryToMix } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate, formatUSD } from "@/components/ui";
import { groupByKata } from "@/lib/division";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminCompetitions({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; editcat?: string; ok?: string; error?: string }>;
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
  const editingCategory = params.editcat
    ? allCategories.find((c) => c.id === params.editcat)
    : undefined;
  const editing = params.edit
    ? competitions.find((c) => c.id === params.edit)
    : editingCategory
      ? competitions.find((c) => c.id === editingCategory.competition_id)
      : undefined;

  return (
    <AdminShell
      title="Competitions"
      active="/admin/competitions"
      flash={{ ok: params.ok, error: params.error }}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit competition" : "Create competition"}</h2>
          <Card>
            <form action={saveCompetition} className="space-y-4">
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
                  <input id="event_date" name="event_date" type="date" defaultValue={editing?.event_date ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="registration_deadline" className={adminLabel}>Registration deadline</label>
                  <input id="registration_deadline" name="registration_deadline" type="date" defaultValue={editing?.registration_deadline ?? ""} className={adminInput} />
                </div>
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

          {editing && (
            <div className="mt-6">
              <h2 className="mb-3 text-lg font-bold">
                {editingCategory ? `Edit category “${editingCategory.name}”` : `Add category to “${editing.name}”`}
              </h2>
              <Card>
                <form action={saveCategory} className="space-y-4">
                  <input type="hidden" name="competition_id" value={editing.id} />
                  {editingCategory && <input type="hidden" name="id" value={editingCategory.id} />}
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
                      <select id="belt_group" name="belt_group" defaultValue={editingCategory?.belt_group ?? ""} className={adminInput}>
                        <option value="">Any</option>
                        <option value="open">Open (divisions auto-split Kyu/Dan)</option>
                        <option value="kyu">Kyu</option>
                        <option value="dan">Dan</option>
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
                    {editingCategory && (
                      <Link href={`/admin/competitions?edit=${editing.id}`} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                        Cancel
                      </Link>
                    )}
                  </div>
                </form>
              </Card>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">All competitions</h2>
          {competitions.length === 0 ? (
            <EmptyState>No competitions yet — create one on the left.</EmptyState>
          ) : (
            <div className="space-y-4">
              {competitions.map((c) => (
                <Card key={c.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-neutral-900">{c.name}</p>
                      <p className="mt-0.5 text-sm text-neutral-500">
                        {formatDate(c.event_date)} · {c.venue ?? "Venue TBA"} · {formatUSD(c.registration_fee_usd)}
                      </p>
                      <p className="mt-0.5 text-xs uppercase tracking-wide">
                        <span className={c.status === "open" ? "text-green-600 font-semibold" : "text-neutral-400"}>
                          {c.status}
                        </span>
                        {" · deadline "}{formatDate(c.registration_deadline)}
                      </p>
                    </div>
                    <Link
                      href={`/admin/competitions?edit=${c.id}`}
                      className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                  </div>
                  <div className="mt-3 border-t border-neutral-100 pt-3">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Categories</p>
                    {(categoriesByCompetition.get(c.id) ?? []).length === 0 ? (
                      <p className="text-sm text-neutral-400">None yet — edit this competition to add categories.</p>
                    ) : (
                      <div className="space-y-2">
                        {groupByKata(categoriesByCompetition.get(c.id) ?? []).map(([base, cats]) => (
                          <details key={base} className="rounded border border-neutral-100">
                            <summary className="cursor-pointer px-2 py-1.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
                              {base} <span className="font-normal text-neutral-400">({cats.length} sub-categories)</span>
                            </summary>
                            <ul className="space-y-1 px-2 pb-2 pl-5">
                              {cats.map((cat) => {
                                const taken = categoryPaidCount.get(cat.id) ?? 0;
                                const left = cat.max_participants != null ? Math.max(0, cat.max_participants - taken) : null;
                                return (
                                  <li key={cat.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className="text-neutral-600">
                                      {cat.name.split(" — ").slice(1).join(" — ") || cat.name}
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
                                          <form action={mergeCategoryToMix}>
                                            <input type="hidden" name="category_id" value={cat.id} />
                                            <button
                                              className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50"
                                              title="Move this category's (and its Male/Female sibling's) registrations into a shared Mix (Male & Female) category"
                                            >
                                              Merge → Mix
                                            </button>
                                          </form>
                                        )}
                                        <Link
                                          href={`/admin/competitions?editcat=${cat.id}`}
                                          className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50"
                                        >
                                          Edit
                                        </Link>
                                        <form action={deleteCategory}>
                                          <input type="hidden" name="id" value={cat.id} />
                                          <button className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">
                                            Delete
                                          </button>
                                        </form>
                                      </span>
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        ))}
                      </div>
                    )}
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
