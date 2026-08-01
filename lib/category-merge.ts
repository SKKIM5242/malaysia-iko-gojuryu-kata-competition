import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "@/lib/types";

/**
 * Records enough about a merge action (Merge -> Mix, Merge age, Merge
 * family, Merge belt group, Merge with kata above/below) to fully reverse
 * it later: the exact rows of every category it's about to delete, and
 * exactly which registrations it's about to move and where they came from.
 * Call this AFTER computing the merge but BEFORE actually moving
 * registrations or deleting anything, so the snapshot is guaranteed to
 * match what's about to happen.
 */
export async function logCategoryMerge(
  supabase: SupabaseClient,
  params: {
    competitionId: string;
    mergeType: string;
    targetCategoryId: string;
    targetWasNew: boolean;
    sourceCategories: Category[];
    movedRegistrations: Array<{ registrationId: string; originalCategoryId: string }>;
    description: string;
    actorId: string | null;
  },
): Promise<void> {
  await supabase.from("category_merge_log").insert({
    competition_id: params.competitionId,
    merge_type: params.mergeType,
    target_category_id: params.targetCategoryId,
    target_was_new: params.targetWasNew,
    source_categories: params.sourceCategories,
    moved_registrations: params.movedRegistrations,
    description: params.description,
    created_by: params.actorId,
  });
}

/** Registration ids currently sitting in any of the given category ids,
 * paired with which of those categories each one is in — the shape
 * logCategoryMerge's movedRegistrations wants. Call this before moving
 * them, so "original" still means original. */
export async function snapshotRegistrationCategories(
  supabase: SupabaseClient,
  categoryIds: string[],
): Promise<Array<{ registrationId: string; originalCategoryId: string }>> {
  if (categoryIds.length === 0) return [];
  const { data } = await supabase
    .from("registrations")
    .select("id, category_id")
    .in("category_id", categoryIds);
  return ((data ?? []) as Array<{ id: string; category_id: string }>).map((r) => ({
    registrationId: r.id,
    originalCategoryId: r.category_id,
  }));
}

export interface UndoResult {
  ok: boolean;
  error?: string;
  description?: string;
}

/** How many not-yet-undone merges (or deletes) are currently sitting in
 * one competition's undo stack -- drives the "Undo last merge (N)" /
 * "Undo delete (N)" button labels, so admin/organizer/staff can see the
 * stack depth instead of guessing. Shared across every staff account,
 * since it's a straight count from the table, not per-browser state. */
export async function countActiveMerges(supabase: SupabaseClient, competitionId: string): Promise<number> {
  const { count } = await supabase
    .from("category_merge_log")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", competitionId)
    .is("undone_at", null);
  return count ?? 0;
}

export async function countActiveDeletes(supabase: SupabaseClient, competitionId: string): Promise<number> {
  const { count } = await supabase
    .from("category_delete_log")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", competitionId)
    .is("undone_at", null);
  return count ?? 0;
}

/**
 * Reverses the most recent not-yet-undone merge for one competition:
 * recreates every deleted category from its snapshot (same id, so nothing
 * else needs to change), moves each affected registration back to
 * wherever it originally was, deletes the merge's target category if this
 * merge is the one that created it fresh, and marks the log row undone.
 *
 * Only ever acts on the single latest entry — repeated calls step back one
 * merge further each time, like a normal undo stack, rather than needing
 * to pick a specific historical merge to reverse.
 */
export async function undoLastCategoryMerge(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<UndoResult> {
  const { data: entry } = await supabase
    .from("category_merge_log")
    .select("*")
    .eq("competition_id", competitionId)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Nothing to undo for this tier." };

  const sourceCategories = entry.source_categories as Category[];
  const movedRegistrations = entry.moved_registrations as Array<{
    registrationId: string;
    originalCategoryId: string;
  }>;

  if (sourceCategories.length > 0) {
    const { error: restoreErr } = await supabase.from("categories").insert(sourceCategories);
    if (restoreErr) return { ok: false, error: "Could not restore the merged categories." };
  }

  for (const move of movedRegistrations) {
    await supabase
      .from("registrations")
      .update({ category_id: move.originalCategoryId })
      .eq("id", move.registrationId);
  }

  if (entry.target_was_new) {
    // Safe to remove only if nothing else has landed in it since — a
    // later merge could in principle have fed more registrations into the
    // same target; leave it alone rather than risk deleting something
    // still in use.
    const { count } = await supabase
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("category_id", entry.target_category_id);
    if (!count) {
      await supabase.from("categories").delete().eq("id", entry.target_category_id);
    }
  }

  await supabase
    .from("category_merge_log")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", entry.id);

  return { ok: true, description: entry.description ?? undefined };
}

/** Snapshots a category row into category_delete_log right before it's
 * deleted -- call this immediately before the DELETE, using the row you
 * just fetched, so the snapshot always matches what's about to happen.
 * Deleting a category only ever succeeds while it has zero registrations
 * (categories.id has no ON DELETE clause on registrations.category_id, so
 * Postgres rejects the delete otherwise), so there's never anything to
 * move back on undo -- just the one row to recreate. */
export async function logCategoryDelete(
  supabase: SupabaseClient,
  params: { competitionId: string; category: Category; actorId: string | null },
): Promise<void> {
  await supabase.from("category_delete_log").insert({
    competition_id: params.competitionId,
    category: params.category,
    created_by: params.actorId,
  });
}

/** Reverses the most recent not-yet-undone category delete for one
 * competition -- same stack-like repeat-to-go-further-back model as
 * undoLastCategoryMerge above, kept as a separate table/stack since a
 * plain delete and a merge restore differently. */
export async function undoLastCategoryDelete(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<UndoResult> {
  const { data: entry } = await supabase
    .from("category_delete_log")
    .select("*")
    .eq("competition_id", competitionId)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Nothing to undo for this tier." };

  const category = entry.category as Category;
  const { error: restoreErr } = await supabase.from("categories").insert(category);
  if (restoreErr) return { ok: false, error: "Could not restore the deleted category." };

  await supabase
    .from("category_delete_log")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", entry.id);

  return { ok: true, description: `Restored "${category.name}".` };
}
