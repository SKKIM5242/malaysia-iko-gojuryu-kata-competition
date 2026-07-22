"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { kataBaseOf } from "@/lib/division";
import { notifyRefereeAssignment, sendConfirmationEmail, notifyAnnouncementPublished } from "@/lib/notify";
import type { PaymentStatus } from "@/lib/types";
import { parseCsvWithHeader, type CsvUploadResult } from "@/lib/csv-bulk";
import { ACCESS_MATRIX, accessMatrixToMarkdown } from "@/lib/access-matrix";
import { DEFAULT_COMPARISON_ROWS } from "@/components/AccessComparisonTable";
import { DEFAULT_AUTO_ASSIGN_CRITERIA } from "@/lib/auto-assign-criteria";
import { formatUSD } from "@/components/ui";

/**
 * Admin server actions. Sprint 3 runs these under the v1 open RLS policies;
 * Sprint 4 gates /admin behind a session and the actions verify it.
 */

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, actorId: user?.id ?? null };
}

/** The caller's own role, read server-side from their session — never
 * trust a role value supplied by the client for permission checks. */
async function getActorRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
): Promise<string | null> {
  if (!actorId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role, approved")
    .eq("user_id", actorId)
    .maybeSingle();
  return data?.approved ? data.role : null;
}

/** Bulk CSV upload is restricted to Admin/Organizer only — returns an error
 * string to short-circuit a CsvUploadResult-returning action, or null when
 * the caller is allowed to proceed. */
async function bulkUploadRoleError(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
): Promise<string | null> {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer"].includes(role ?? "")) {
    return "Only Admin or Organizer accounts can bulk-upload records.";
  }
  return null;
}

/** Participant Support has edit access to registrations/participants and can
 * merge/edit/delete categories, but never delete registrations/participants
 * and never manages competitions — called at the top of every action that
 * should reject them specifically. */
async function blockCustomerSupport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (role === "customer_support") {
    backTo(returnTo, { error: "Participant Support accounts cannot perform this action." });
  }
}

/** Only Admin/Organizer (and legacy "staff") may create or edit competitions
 * — Referee and Participant Support get category-level access but not this. */
async function requireCompetitionManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can manage competitions." });
  }
}

/** Only Admin/Organizer (and legacy "staff") may create, edit, reorder, or
 * delete announcements/notes/messages — every other admin-panel role
 * (Referee/Judge, Participant Support) has read-only access to the Content
 * page's listing. */
async function requireContentManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can manage announcements." });
  }
}

/** Referee accounts can view registrations/participants but never change
 * payment status or delete anything — called at the top of the actions that
 * should reject them specifically. */
async function blockReferee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (role === "referee") {
    backTo(returnTo, { error: "Referee / Judge accounts cannot perform this action." });
  }
}

/** Judging Arena mutations (assign/unassign referees, set judges-required,
 * auto-assign) are Super Admin only — Organizer, Participant Support, and
 * Referee can view the arena but not configure it. */
async function requireJudgingManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "referee"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer or a Referee/Judge can configure judging." });
  }
}

function backTo(path: string, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

/** Uploads an optional "certificate" file field to the private bucket; returns
 * the new path, or null when no file was submitted (existing value untouched). */
async function uploadCertificateIfPresent(
  supabase: SupabaseClient,
  formData: FormData,
  prefix: string,
  returnTo: string,
): Promise<string | null> {
  const certificate = formData.get("certificate");
  if (!(certificate instanceof File) || certificate.size === 0) return null;
  if (certificate.size > 10 * 1024 * 1024) {
    backTo(returnTo, { error: "Certificate file is too large (max 10 MB)." });
  }
  const ext = (certificate.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const path = `${prefix}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("certificates")
    .upload(path, certificate, { contentType: certificate.type || "image/jpeg" });
  if (error) backTo(returnTo, { error: "Could not upload the certificate. Please try again." });
  return path;
}

// ── Registrations ────────────────────────────────────────────────────────────

export async function updatePaymentStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as PaymentStatus;
  const returnTo = String(formData.get("return_to") ?? "/admin/registrations");
  if (!id || !["pending", "paid", "rejected"].includes(status)) {
    backTo(returnTo, { error: "Invalid payment status update." });
  }
  const { supabase, actorId } = await getActor();
  await blockReferee(supabase, actorId, returnTo);

  const { data: before } = await supabase
    .from("registrations")
    .select("id, payment_status, payment_reference")
    .eq("id", id)
    .maybeSingle();
  if (!before) backTo(returnTo, { error: "Registration not found." });

  const { error } = await supabase
    .from("registrations")
    .update({ payment_status: status })
    .eq("id", id);
  if (error) backTo(returnTo, { error: "Update failed — please try again." });

  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: id,
    action: "payment_status_changed",
    old_value: { payment_status: before!.payment_status },
    new_value: { payment_status: status },
    actor_id: actorId,
  });

  revalidatePath("/participants");
  revalidatePath("/admin/registrations");
  backTo(returnTo, { ok: `Registration marked ${status}.` });
}

export async function deleteRegistration(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/registrations");
  const { supabase, actorId } = await getActor();
  await blockCustomerSupport(supabase, actorId, returnTo);
  await blockReferee(supabase, actorId, returnTo);
  const { data: before } = await supabase
    .from("registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("registrations").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Delete failed — the record may be referenced elsewhere." });
  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: id,
    action: "registration_deleted",
    old_value: before,
    actor_id: actorId,
  });
  revalidatePath("/participants");
  backTo(returnTo, { ok: "Registration deleted." });
}

// ── Competitions ─────────────────────────────────────────────────────────────

export async function saveCompetition(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    venue: String(formData.get("venue") ?? "").trim() || null,
    event_date: String(formData.get("event_date") ?? "") || null,
    registration_deadline: String(formData.get("registration_deadline") ?? "") || null,
    registration_fee_usd: formData.get("registration_fee_usd")
      ? Number(formData.get("registration_fee_usd"))
      : null,
    status: String(formData.get("status") ?? "draft"),
    description: String(formData.get("description") ?? "").trim() || null,
    winners_announce_date: String(formData.get("winners_announce_date") ?? "") || null,
    audience_signin_date: String(formData.get("audience_signin_date") ?? "") || null,
  };
  if (!values.name) backTo(returnTo, { error: "Competition name is required." });
  if (values.registration_fee_usd != null && Number.isNaN(values.registration_fee_usd)) {
    backTo(returnTo, { error: "Fee must be a number." });
  }

  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  if (id) {
    const { data: before } = await supabase
      .from("competitions").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from("competitions").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update competition." });
    await writeAudit(supabase, {
      table_name: "competitions", record_id: id, action: "competition_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("competitions").insert(values).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create competition." });
    await writeAudit(supabase, {
      table_name: "competitions", record_id: data!.id, action: "competition_created",
      new_value: values, actor_id: actorId,
    });
  }
  revalidatePath("/");
  backTo(returnTo, { ok: id ? "Competition updated." : "Competition created." });
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function saveCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const values = {
    competition_id: String(formData.get("competition_id") ?? "") || null,
    name: String(formData.get("name") ?? "").trim(),
    age_min: formData.get("age_min") ? Number(formData.get("age_min")) : null,
    age_max: formData.get("age_max") ? Number(formData.get("age_max")) : null,
    belt_group: String(formData.get("belt_group") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    max_participants: formData.get("max_participants") ? Number(formData.get("max_participants")) : null,
  };
  if (!values.name || !values.competition_id) {
    backTo(returnTo, { error: "Category name and competition are required." });
  }
  if (values.max_participants != null && Number.isNaN(values.max_participants)) {
    backTo(returnTo, { error: "Max participants must be a number." });
  }
  const { supabase, actorId } = await getActor();
  if (id) {
    const { error } = await supabase.from("categories").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update category." });
    await writeAudit(supabase, {
      table_name: "categories", record_id: id, action: "category_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase.from("categories").insert(values).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create category." });
    await writeAudit(supabase, {
      table_name: "categories", record_id: data!.id, action: "category_created",
      new_value: values, actor_id: actorId,
    });
  }
  revalidatePath("/");
  backTo(returnTo, { ok: "Category saved." });
}

export async function deleteCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — registrations reference this category." });
  await writeAudit(supabase, {
    table_name: "categories", record_id: id, action: "category_deleted", actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: "Category deleted." });
}

/**
 * Merges a Male or Female sub-category into a Mix (Male & Female) category
 * for the same kata + belt group + age bracket — creating the Mix category
 * on first use. Every registration currently in the Male and/or Female
 * sub-category for that slot is moved onto the Mix category; the Male/Female
 * rows are left in place (now empty) for the record.
 */
export async function mergeCategoryToMix(formData: FormData) {
  const categoryId = String(formData.get("category_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();

  const { data: source } = await supabase
    .from("categories")
    .select("*")
    .eq("id", categoryId)
    .maybeSingle();
  if (!source) backTo(returnTo, { error: "Category not found." });
  if (source!.gender === "mix") backTo(returnTo, { ok: "Already a Mix category." });

  const kataBase = kataBaseOf(source!.name);
  const beltLabel = source!.belt_group === "dan" ? "Black Belt & Dan Holders" : "Color/Kyu Belt";
  const mixName = `${kataBase} — ${beltLabel} — Age ${source!.age_min}–${source!.age_max} — Mix (Male & Female)`;

  const { data: siblingsRaw } = await supabase
    .from("categories")
    .select("id, name, gender")
    .eq("competition_id", source!.competition_id)
    .eq("belt_group", source!.belt_group)
    .eq("age_min", source!.age_min)
    .eq("age_max", source!.age_max)
    .in("gender", ["male", "female"]);
  const mergeIds = (siblingsRaw ?? [])
    .filter((s) => kataBaseOf(s.name) === kataBase)
    .map((s) => s.id);
  if (!mergeIds.includes(categoryId)) mergeIds.push(categoryId);

  let mixCategoryId: string;
  const { data: existingMix } = await supabase
    .from("categories")
    .select("id")
    .eq("competition_id", source!.competition_id)
    .eq("name", mixName)
    .maybeSingle();
  if (existingMix) {
    mixCategoryId = existingMix.id;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("categories")
      .insert({
        competition_id: source!.competition_id,
        name: mixName,
        age_min: source!.age_min,
        age_max: source!.age_max,
        belt_group: source!.belt_group,
        gender: "mix",
        sort_order: (source!.sort_order ?? 0) + 1,
        max_participants: null,
      })
      .select("id")
      .single();
    if (createErr || !created) backTo(returnTo, { error: "Could not create the Mix category." });
    mixCategoryId = created!.id;
    await writeAudit(supabase, {
      table_name: "categories", record_id: mixCategoryId, action: "category_created",
      new_value: { name: mixName, gender: "mix" }, actor_id: actorId,
    });
  }

  const { error: moveErr } = await supabase
    .from("registrations")
    .update({ category_id: mixCategoryId })
    .in("category_id", mergeIds);
  if (moveErr) backTo(returnTo, { error: "Could not move registrations into the Mix category." });

  await writeAudit(supabase, {
    table_name: "registrations", record_id: null, action: "registrations_merged_to_mix",
    new_value: { from_category_ids: mergeIds, to_category_id: mixCategoryId }, actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: `Merged into “${mixName}”.` });
}

/**
 * Merges a category with its ADJACENT age group in the same kata event,
 * belt division, and gender — the "merge before/after age group" button,
 * used when an age group has too few submissions (the organizer's policy:
 * events under 70 recordings get merged). The surviving category's age
 * range expands to cover both (its name's "Age lo–hi" part is rewritten),
 * the neighbor's registrations move over, and the emptied neighbor is
 * deleted. Repeatable, so 2 or 3 age groups can be combined.
 */
export async function mergeCategoryAgeGroup(formData: FormData) {
  const categoryId = String(formData.get("category_id") ?? "");
  const direction = formData.get("direction") === "before" ? "before" : "after";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();

  const { data: source } = await supabase
    .from("categories").select("*").eq("id", categoryId).maybeSingle();
  if (!source) backTo(returnTo, { error: "Category not found." });
  if (source!.age_min == null || source!.age_max == null) {
    backTo(returnTo, { error: "This category has no age range to merge." });
  }

  const kataBase = kataBaseOf(source!.name);
  const { data: siblingsRaw } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", source!.competition_id)
    .eq("belt_group", source!.belt_group)
    .eq("gender", source!.gender);
  const siblings = (siblingsRaw ?? []).filter(
    (s) => kataBaseOf(s.name) === kataBase && s.id !== categoryId && s.age_min != null && s.age_max != null,
  );
  const neighbor =
    direction === "before"
      ? siblings.filter((s) => s.age_max! < source!.age_min!).sort((a, b) => b.age_max! - a.age_max!)[0]
      : siblings.filter((s) => s.age_min! > source!.age_max!).sort((a, b) => a.age_min! - b.age_min!)[0];
  if (!neighbor) {
    backTo(returnTo, { error: `No ${direction === "before" ? "earlier" : "later"} age group left to merge with.` });
  }

  const newMin = Math.min(source!.age_min!, neighbor!.age_min!);
  const newMax = Math.max(source!.age_max!, neighbor!.age_max!);
  // Rewrite only the "Age lo–hi" part of the hierarchical name.
  const newName = source!.name.replace(/Age \d+–\d+/, `Age ${newMin}–${newMax}`);

  const { error: moveErr } = await supabase
    .from("registrations")
    .update({ category_id: categoryId })
    .eq("category_id", neighbor!.id);
  if (moveErr) backTo(returnTo, { error: "Could not move the neighbor age group's registrations." });

  const { error: renameErr } = await supabase
    .from("categories")
    .update({ age_min: newMin, age_max: newMax, name: newName })
    .eq("id", categoryId);
  if (renameErr) backTo(returnTo, { error: "Moved registrations, but could not widen the age range." });

  await supabase.from("categories").delete().eq("id", neighbor!.id);
  await writeAudit(supabase, {
    table_name: "categories", record_id: categoryId, action: "age_groups_merged",
    new_value: { absorbed_category: neighbor!.name, into: newName, direction }, actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: `Merged “${neighbor!.name}” into “${newName}”.` });
}

// ── Announcements ────────────────────────────────────────────────────────────

export async function saveAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const values = {
    competition_id: String(formData.get("competition_id") ?? "") || null,
    title: String(formData.get("title") ?? "").trim(),
    body: String(formData.get("body") ?? "").trim() || null,
    published: formData.get("published") === "on",
  };
  if (!values.title) backTo(returnTo, { error: "Title is required." });
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);
  let justPublished = false;
  if (id) {
    const { data: before } = await supabase
      .from("announcements").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from("announcements").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update announcement." });
    await writeAudit(supabase, {
      table_name: "announcements", record_id: id, action: "announcement_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
    justPublished = values.published && before?.published !== true;
  } else {
    const { data, error } = await supabase
      .from("announcements").insert(values).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create announcement." });
    await writeAudit(supabase, {
      table_name: "announcements", record_id: data!.id, action: "announcement_created",
      new_value: values, actor_id: actorId,
    });
    justPublished = values.published;
  }
  if (justPublished) await notifyAnnouncementPublished(values.title, values.body);
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: "Announcement saved." });
}

export async function toggleAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const publish = formData.get("publish") === "true";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);
  const { data: before } = await supabase
    .from("announcements").select("title, body, published").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("announcements").update({ published: publish }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not change publish state." });
  await writeAudit(supabase, {
    table_name: "announcements", record_id: id,
    action: publish ? "announcement_published" : "announcement_unpublished",
    new_value: { published: publish }, actor_id: actorId,
  });
  if (publish && before && before.published !== true) {
    await notifyAnnouncementPublished(before.title, before.body);
  }
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: publish ? "Announcement published." : "Announcement unpublished." });
}

export async function moveAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);

  const { data } = await supabase
    .from("announcements")
    .select("id, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  const list = data ?? [];
  const index = list.findIndex((a) => a.id === id);
  if (index === -1) backTo(returnTo, { error: "Announcement not found." });
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= list.length) {
    backTo(returnTo, { ok: "Already at the edge of the list." });
  }

  // Normalise sort_order to the current display order, then swap the two
  for (let i = 0; i < list.length; i++) {
    const target = i === index ? swapWith : i === swapWith ? index : i;
    if (list[i].sort_order !== target) {
      await supabase.from("announcements").update({ sort_order: target }).eq("id", list[i].id);
    }
  }
  await writeAudit(supabase, {
    table_name: "announcements", record_id: id,
    action: `announcement_moved_${direction}`, actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: "Order updated." });
}

export async function deleteAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);
  const { data: before } = await supabase
    .from("announcements").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete announcement." });
  await writeAudit(supabase, {
    table_name: "announcements", record_id: id, action: "announcement_deleted",
    old_value: before, actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: "Announcement deleted." });
}

/** Creates a new draft announcement pre-filled with the current Access
 * Matrix (see lib/access-matrix.ts), then sends the admin to Announcements
 * to review and publish it. Never auto-publishes — the admin should read it
 * over first. Call again (from the Accounts page) whenever access rules
 * change, to keep the published copy current. */
export async function publishAccessMatrixAnnouncement() {
  const returnTo = "/admin/accounts?tab=access";
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (actorRole !== "admin") {
    backTo(returnTo, { error: "Only the Super Admin can publish the Access Matrix." });
  }
  const generatedAt = new Date().toISOString().slice(0, 10);
  const values = {
    competition_id: null,
    title: `Admin Panel Access Matrix — updated ${generatedAt}`,
    body: accessMatrixToMarkdown(generatedAt),
    published: false,
  };
  const { data, error } = await supabase.from("announcements").insert(values).select("id").single();
  if (error) backTo(returnTo, { error: "Could not create the announcement." });
  await writeAudit(supabase, {
    table_name: "announcements", record_id: data!.id, action: "announcement_created",
    new_value: { title: values.title }, actor_id: actorId,
  });
  redirect(`/admin/announcements?edit=${data!.id}`);
}

// ── Schools ──────────────────────────────────────────────────────────────────

export async function saveSchool(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/schools";
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    state: String(formData.get("state") ?? "").trim() || null,
    contact_title: String(formData.get("contact_title") ?? "").trim() || null,
    contact_name: String(formData.get("contact_name") ?? "").trim() || null,
    contact_karate_title: String(formData.get("contact_karate_title") ?? "").trim() || null,
    contact_rank: String(formData.get("contact_rank") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: String(formData.get("bank_account_no") ?? "").trim() || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
  };
  if (!values.name) backTo(returnTo, { error: "School name is required." });
  if (!values.contact_title || !values.contact_name || !values.contact_karate_title || !values.contact_rank) {
    backTo(returnTo, { error: "Person in-charge's title, name, karate title, and rank are required." });
  }
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and home country are required." });
  }
  if (!values.email || !values.phone) {
    backTo(returnTo, { error: "Email address and mobile phone are required." });
  }
  if (!values.bank_name || !values.bank_account_no || !values.bank_account_name) {
    backTo(returnTo, { error: "Bank name, account number, and account holder name are required." });
  }
  const record = { ...values, gender: values.contact_title === "Mr." ? "male" : "female" };
  const { supabase, actorId } = await getActor();
  if (!id) {
    const { data: dup } = await supabase
      .from("schools").select("id").ilike("name", values.name).limit(1);
    if (dup && dup.length > 0) {
      backTo(returnTo, { error: "A school with this name already exists." });
    }
  }
  if (id) {
    const { error } = await supabase.from("schools").update(record).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update school." });
    await writeAudit(supabase, {
      table_name: "schools", record_id: id, action: "school_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase.from("schools").insert(record).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create school." });
    await writeAudit(supabase, {
      table_name: "schools", record_id: data!.id, action: "school_created",
      new_value: values, actor_id: actorId,
    });
  }
  backTo(returnTo, { ok: "School saved." });
}

export async function deleteSchool(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/schools";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("schools").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — senseis or participants reference this school." });
  await writeAudit(supabase, {
    table_name: "schools", record_id: id, action: "school_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "School deleted." });
}

// ── Senseis ──────────────────────────────────────────────────────────────────

export async function saveSensei(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/senseis";
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    ic_passport: String(formData.get("ic_passport") ?? "").trim() || null,
    date_of_birth: String(formData.get("date_of_birth") ?? "").trim() || null,
    rank: String(formData.get("rank") ?? "").trim() || null,
    gender: String(formData.get("gender") ?? "").trim() || null,
    school_id: String(formData.get("school_id") ?? "") || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: String(formData.get("bank_account_no") ?? "").trim() || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
  };
  if (!values.name) backTo(returnTo, { error: "Sensei name is required." });
  if (!values.ic_passport) backTo(returnTo, { error: "IC / Passport is required." });
  if (!values.date_of_birth) backTo(returnTo, { error: "Date of birth is required." });
  if (!values.rank) backTo(returnTo, { error: "Rank is required." });
  if (!values.gender || !["male", "female"].includes(values.gender)) {
    backTo(returnTo, { error: "Sex is required." });
  }
  if (!values.school_id) backTo(returnTo, { error: "School is required." });
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Personal home address, city/town, postcode, and home country are required." });
  }
  if (!values.email || !values.phone) {
    backTo(returnTo, { error: "Email address and mobile phone are required." });
  }
  if (!values.bank_name || !values.bank_account_no || !values.bank_account_name) {
    backTo(returnTo, { error: "Personal bank details (bank name, account number, and account holder name) are required." });
  }
  const { supabase, actorId } = await getActor();

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "sensei", returnTo);
  if (!id && !certificatePath) {
    backTo(returnTo, { error: "Latest rank certificate is required." });
  }

  if (!id) {
    // Guard against duplicate submissions (e.g. double-clicks)
    let dupQuery = supabase.from("senseis").select("id").ilike("name", values.name).limit(1);
    dupQuery = values.school_id
      ? dupQuery.eq("school_id", values.school_id)
      : dupQuery.is("school_id", null);
    const { data: dup } = await dupQuery;
    if (dup && dup.length > 0) {
      backTo(returnTo, { error: "A sensei with this name (and school) already exists." });
    }
  }
  if (id) {
    const { error } = await supabase
      .from("senseis")
      .update(certificatePath ? { ...values, certificate_path: certificatePath } : values)
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update sensei." });
    await writeAudit(supabase, {
      table_name: "senseis", record_id: id, action: "sensei_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("senseis")
      .insert({ ...values, certificate_path: certificatePath })
      .select("id").single();
    if (error) backTo(returnTo, { error: "Could not create sensei." });
    await writeAudit(supabase, {
      table_name: "senseis", record_id: data!.id, action: "sensei_created",
      new_value: values, actor_id: actorId,
    });
  }
  backTo(returnTo, { ok: "Sensei saved." });
}

export async function deleteSensei(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/senseis";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("senseis").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — participants reference this sensei." });
  await writeAudit(supabase, {
    table_name: "senseis", record_id: id, action: "sensei_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Sensei deleted." });
}

// ── Community (referees / audiences / staff applications) ───────────────────

export async function updateCommunityStatus(formData: FormData) {
  const table = String(formData.get("table") ?? "");
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/referees");
  const allowed: Record<string, Record<string, string[]>> = {
    referees: {
      payment_status: ["pending", "paid", "waived", "refunded", "forfeited"],
      status: ["pending", "approved", "rejected"],
    },
    audiences: { payment_status: ["pending", "paid", "waived"] },
    staff_applications: { status: ["pending", "approved", "rejected"] },
    schools: { payment_status: ["pending", "paid", "waived"] },
    senseis: { payment_status: ["pending", "paid", "waived"] },
  };
  if (!allowed[table]?.[field]?.includes(value) || !id) {
    backTo(returnTo, { error: "Invalid update." });
  }
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from(table).update({ [field]: value }).eq("id", id);
  if (error) backTo(returnTo, { error: "Update failed — please try again." });
  await writeAudit(supabase, {
    table_name: table, record_id: id, action: `${field}_changed`,
    new_value: { [field]: value }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Updated." });
}

/** Admin/Organizer/Participant Support/Referee directly adds an Audience /
 * Spectator (rather than the person self-registering) — e.g. someone paid
 * or was invited in person. An invitation code here waives the USD 10 fee
 * exactly like self-registration does. */
export async function createAudienceMember(formData: FormData) {
  const returnTo = "/admin/audience";
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const home_country = String(formData.get("home_country") ?? "").trim() || null;
  const invitation_code = String(formData.get("invitation_code") ?? "").trim() || null;
  const support_referral = String(formData.get("support_referral") ?? "").trim() || null;
  const referral_source = String(formData.get("referral_source") ?? "").trim() || null;
  if (!full_name || !email || !phone) {
    backTo(returnTo, { error: "Name, email, and mobile phone are required." });
  }
  const { supabase, actorId } = await getActor();

  let payment_status: "pending" | "waived" = "pending";
  if (invitation_code) {
    const { data: redeemed } = await supabase.rpc("redeem_invitation_code", {
      p_code: invitation_code,
      p_role: "audience",
      p_email: email,
    });
    if (redeemed === true) payment_status = "waived";
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("audiences").insert({
    id, full_name, email, phone, home_country, invitation_code, support_referral, referral_source, payment_status,
  });
  if (error) backTo(returnTo, { error: "Could not add audience member — please try again." });
  await writeAudit(supabase, {
    table_name: "audiences", record_id: id, action: "audience_added_by_admin",
    new_value: { full_name, email, invitation_code }, actor_id: actorId,
  });
  revalidatePath("/admin/audience");
  backTo(returnTo, { ok: `${full_name} added to Audience / Spectators.` });
}

export async function saveReferee(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/referees";
  const values = {
    full_name: String(formData.get("full_name") ?? "").trim(),
    ic_passport: String(formData.get("ic_passport") ?? "").trim(),
    date_of_birth: String(formData.get("date_of_birth") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    karate_rank: String(formData.get("karate_rank") ?? "").trim() || null,
    judging_experience_count: formData.get("judging_experience_count")
      ? Number(formData.get("judging_experience_count"))
      : null,
    school: String(formData.get("school") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: String(formData.get("bank_account_no") ?? "").trim() || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
  };
  if (!values.full_name || !values.ic_passport) {
    backTo(returnTo, { error: "Name and IC/passport are required." });
  }
  if (!values.date_of_birth || !values.gender || !values.karate_rank || values.judging_experience_count == null) {
    backTo(returnTo, { error: "Date of birth, gender, karate rank, and judging experience are required." });
  }
  if (!values.school || !values.email || !values.phone) {
    backTo(returnTo, { error: "School/organization, email, and mobile phone are required." });
  }
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and home country are required." });
  }
  if (!values.bank_name || !values.bank_account_no || !values.bank_account_name) {
    backTo(returnTo, { error: "Bank details are required." });
  }
  const { supabase, actorId } = await getActor();

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "referee", returnTo);
  if (!id && !certificatePath) {
    backTo(returnTo, { error: "Latest rank certificate is required." });
  }

  if (id) {
    const { data: before } = await supabase.from("referees").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase
      .from("referees")
      .update(certificatePath ? { ...values, certificate_path: certificatePath } : values)
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update referee." });
    await writeAudit(supabase, {
      table_name: "referees", record_id: id, action: "referee_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("referees")
      .insert({ ...values, certificate_path: certificatePath })
      .select("id").single();
    if (error) backTo(returnTo, { error: "Could not create referee." });
    await writeAudit(supabase, {
      table_name: "referees", record_id: data!.id, action: "referee_created_by_admin",
      new_value: values, actor_id: actorId,
    });
  }
  backTo(returnTo, { ok: "Referee saved." });
}

export async function deleteReferee(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/referees";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("referees").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete referee." });
  await writeAudit(supabase, {
    table_name: "referees", record_id: id, action: "referee_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Referee deleted." });
}

// ── Participants ─────────────────────────────────────────────────────────────

export async function saveParticipant(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/participants";
  const values = {
    full_name: String(formData.get("full_name") ?? "").trim(),
    ic_passport: String(formData.get("ic_passport") ?? "").trim(),
    date_of_birth: String(formData.get("date_of_birth") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    belt_rank: String(formData.get("belt_rank") ?? "").trim() || null,
    rank_confirmation: String(formData.get("rank_confirmation") ?? "") || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    school_id: String(formData.get("school_id") ?? "") || null,
    sensei_id: String(formData.get("sensei_id") ?? "") || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
  };
  if (!values.full_name || !values.ic_passport) {
    backTo(returnTo, { error: "Name and IC/passport are required." });
  }
  if (!values.date_of_birth || !values.gender || !values.belt_rank || !values.rank_confirmation) {
    backTo(returnTo, { error: "Date of birth, gender, belt rank, and rank confirmation are required." });
  }
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and home country are required." });
  }
  if (!values.email || !values.phone) {
    backTo(returnTo, { error: "Email address and mobile phone are required." });
  }
  if (!values.school_id || !values.sensei_id) {
    backTo(returnTo, { error: "School and sensei are required." });
  }
  const bank = {
    bank_name: String(formData.get("bank_name") ?? "").trim(),
    bank_account_no: String(formData.get("bank_account_no") ?? "").trim(),
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim(),
  };
  if (!bank.bank_name || !bank.bank_account_no || !bank.bank_account_name) {
    backTo(returnTo, { error: "Reward payout bank details are required." });
  }
  const { supabase, actorId } = await getActor();

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "participant", returnTo);

  let targetId = id;
  if (id) {
    const { data: before } = await supabase
      .from("participants").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase
      .from("participants")
      .update(certificatePath ? { ...values, certificate_path: certificatePath } : values)
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update participant." });
    await writeAudit(supabase, {
      table_name: "participants", record_id: id, action: "participant_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("participants")
      .insert({ ...values, certificate_path: certificatePath })
      .select("id").single();
    if (error) backTo(returnTo, { error: "Could not create participant." });
    targetId = data!.id;
    await writeAudit(supabase, {
      table_name: "participants", record_id: targetId, action: "participant_created",
      new_value: values, actor_id: actorId,
    });
  }

  // Upsert reward bank details when all three fields are provided
  if (targetId && bank.bank_name && bank.bank_account_no && bank.bank_account_name) {
    await supabase
      .from("participant_bank_details")
      .upsert({ participant_id: targetId, ...bank }, { onConflict: "participant_id" });
    await writeAudit(supabase, {
      table_name: "participant_bank_details", record_id: targetId,
      action: "bank_details_saved", actor_id: actorId,
    });
  }
  revalidatePath("/participants");
  backTo(returnTo, { ok: "Participant saved." });
}

export async function deleteParticipant(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/participants";
  const { supabase, actorId } = await getActor();
  await blockCustomerSupport(supabase, actorId, returnTo);
  await blockReferee(supabase, actorId, returnTo);
  const { error } = await supabase.from("participants").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — registrations reference this participant. Delete those first." });
  await writeAudit(supabase, {
    table_name: "participants", record_id: id, action: "participant_deleted", actor_id: actorId,
  });
  revalidatePath("/participants");
  backTo(returnTo, { ok: "Participant deleted." });
}

// ── Accounts (profiles, invitation codes, referee assignment) ──────────────

export async function setProfileApproval(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const approve = formData.get("approve") === "true";
  const returnTo = "/admin/accounts";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.rpc("approve_profile", { p_user: userId, p_approve: approve });
  if (error) backTo(returnTo, { error: "Could not update approval." });
  await writeAudit(supabase, {
    table_name: "profiles", record_id: userId,
    action: approve ? "account_approved" : "account_unapproved", actor_id: actorId,
  });
  backTo(returnTo, { ok: approve ? "Account approved." : "Approval revoked." });
}

const INVITATION_CODE_ROLES = ["referee", "staff", "audience", "school", "sensei", "participant", "organizer", "customer_support", "admin", "any"];

/** Every field is required except Note, per the organizer's explicit
 * instruction — including Code (no more auto-generation), Email, and Max
 * uses (no more "unlimited shared code" — every code is now a deliberate,
 * fully-specified grant). Returns the parsed values, or redirects back with
 * an error via backTo if anything required is missing/invalid. */
function requireInvitationCodeFields(formData: FormData, returnTo: string) {
  const role = String(formData.get("role") ?? "");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const note = String(formData.get("note") ?? "").trim() || null;
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const validFrom = String(formData.get("valid_from") ?? "").trim();
  const validUntil = String(formData.get("valid_until") ?? "").trim();
  const signInLimitRaw = String(formData.get("sign_in_limit") ?? "").trim();
  const competitionId = String(formData.get("competition_id") ?? "").trim();
  if (!INVITATION_CODE_ROLES.includes(role)) backTo(returnTo, { error: "A valid role is required." });
  if (!code) backTo(returnTo, { error: "Code is required." });
  if (!maxUsesRaw || Number(maxUsesRaw) < 1) backTo(returnTo, { error: "Max uses is required." });
  if (!email) backTo(returnTo, { error: "Email is required." });
  if (!validFrom) backTo(returnTo, { error: "Valid from is required." });
  if (!validUntil) backTo(returnTo, { error: "Valid until is required." });
  if (!signInLimitRaw || Number(signInLimitRaw) < 1) backTo(returnTo, { error: "Sign-in limit is required." });
  if (!competitionId) backTo(returnTo, { error: "Competition is required." });
  return {
    role, code, note, email,
    max_uses: Number(maxUsesRaw),
    valid_from: validFrom,
    valid_until: validUntil,
    sign_in_limit: Number(signInLimitRaw),
    competition_id: competitionId,
  };
}

export async function createInvitationCode(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  const fields = requireInvitationCodeFields(formData, returnTo);
  const { supabase, actorId } = await getActor();
  // Who generated it is read from the signer's own session, never typed in —
  // falls back to their account email when they haven't set a display name.
  const { data: myProfile } = actorId
    ? await supabase.from("profiles").select("full_name, email").eq("user_id", actorId).maybeSingle()
    : { data: null };
  const generated_by = myProfile?.full_name || myProfile?.email || null;
  const { data, error } = await supabase
    .from("invitation_codes")
    .insert({ ...fields, generated_by })
    .select("id")
    .single();
  if (error) backTo(returnTo, { error: `Could not create code: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: data!.id, action: "invitation_code_created",
    new_value: fields, actor_id: actorId,
  });
  backTo(returnTo, { ok: `Invitation code created: ${fields.code}` });
}

export async function updateInvitationCode(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  if (!id) backTo(returnTo, { error: "Invalid request." });
  const fields = requireInvitationCodeFields(formData, returnTo);
  const { supabase, actorId } = await getActor();
  const { data: before } = await supabase.from("invitation_codes").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("invitation_codes").update(fields).eq("id", id);
  if (error) backTo(returnTo, { error: `Could not update code: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: id, action: "invitation_code_updated",
    old_value: before, new_value: fields, actor_id: actorId,
  });
  backTo(returnTo, { ok: `Invitation code updated: ${fields.code}` });
}

const INVITATION_CODE_CSV_COLUMNS = [
  "code", "role", "email", "max_uses", "valid_from", "valid_until", "sign_in_limit", "competition_name", "note",
] as const;

export async function bulkUploadInvitationCodes(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), INVITATION_CODE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 1000) return { done: false, error: "Maximum 1000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const { data: myProfile } = actorId
    ? await supabase.from("profiles").select("full_name, email").eq("user_id", actorId).maybeSingle()
    : { data: null };
  const generated_by = myProfile?.full_name || myProfile?.email || null;

  const { data: competitions } = await supabase.from("competitions").select("id, name");
  const competitionIdByName = new Map((competitions ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const code = get(r, "code").toUpperCase() || `Row ${rowNo}`;
    const role = get(r, "role").toLowerCase();
    if (!get(r, "code")) { failures.push({ row: rowNo, name: code, error: "code is required" }); continue; }
    if (!INVITATION_CODE_ROLES.includes(role)) { failures.push({ row: rowNo, name: code, error: "role is not a valid role key" }); continue; }
    const email = get(r, "email").toLowerCase();
    const maxUses = Number(get(r, "max_uses"));
    const validFrom = get(r, "valid_from");
    const validUntil = get(r, "valid_until");
    const signInLimit = Number(get(r, "sign_in_limit"));
    const competitionId = competitionIdByName.get(get(r, "competition_name").trim().toLowerCase());
    if (!email || !maxUses || maxUses < 1 || !validFrom || !validUntil || !signInLimit || signInLimit < 1) {
      failures.push({ row: rowNo, name: code, error: "email, max_uses, valid_from, valid_until, and sign_in_limit are all required" });
      continue;
    }
    if (!competitionId) { failures.push({ row: rowNo, name: code, error: "competition_name does not match an existing competition" }); continue; }

    const record = {
      code, role, email, max_uses: maxUses, valid_from: validFrom, valid_until: validUntil,
      sign_in_limit: signInLimit, competition_id: competitionId,
      note: get(r, "note") || null, generated_by,
    };
    const { data, error } = await supabase.from("invitation_codes").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: code, error: error.message.includes("duplicate") ? "This code already exists" : "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "invitation_codes", record_id: data!.id, action: "invitation_code_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: null, action: "bulk_csv_invitation_codes",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

export async function deleteInvitationCode(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("invitation_codes").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete code." });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: id, action: "invitation_code_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Invitation code deleted." });
}

// ── Editable Access Matrix + Access Comparison tables ───────────────────────

async function requireAccessTableEditor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit the access tables." });
  }
}

/** One-click import of the code's built-in rows into the editable tables
 * (only fills a table that is still empty, so re-clicking is safe). */
export async function seedAccessTables(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);

  const { count: matrixCount } = await supabase
    .from("access_matrix_rows").select("id", { count: "exact", head: true });
  if (!matrixCount) {
    await supabase.from("access_matrix_rows").insert(
      ACCESS_MATRIX.map((r, i) => ({
        position: i + 1, resource: r.resource, note: r.note ?? null,
        admin: r.admin, organizer: r.organizer, customer_support: r.customerSupport, referee: r.referee,
      })),
    );
  }
  const { count: cmpCount } = await supabase
    .from("access_comparison_rows").select("id", { count: "exact", head: true });
  if (!cmpCount) {
    await supabase.from("access_comparison_rows").insert(
      DEFAULT_COMPARISON_ROWS.map((r, i) => ({
        position: i + 1, what: r.what,
        participant: r.cells[0], school: r.cells[1], sensei: r.cells[2], referee: r.cells[3],
        audience: r.cells[4], organizer: r.cells[5], support: r.cells[6],
      })),
    );
  }
  await writeAudit(supabase, {
    table_name: "access_matrix_rows", record_id: null, action: "access_tables_seeded", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Access tables imported — edit the rows below." });
}

export async function saveAccessMatrixRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    resource: String(formData.get("resource") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim() || null,
    admin: String(formData.get("admin") ?? "").trim(),
    organizer: String(formData.get("organizer") ?? "").trim(),
    customer_support: String(formData.get("customer_support") ?? "").trim(),
    referee: String(formData.get("referee") ?? "").trim(),
  };
  if (!values.resource) backTo(returnTo, { error: "Resource name is required." });
  const { error } = id
    ? await supabase.from("access_matrix_rows").update(values).eq("id", id)
    : await supabase.from("access_matrix_rows").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the Access Matrix row." });
  await writeAudit(supabase, {
    table_name: "access_matrix_rows", record_id: id || null,
    action: id ? "access_matrix_row_updated" : "access_matrix_row_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Access Matrix row saved." });
}

export async function deleteAccessMatrixRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("access_matrix_rows").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the row." });
  await writeAudit(supabase, {
    table_name: "access_matrix_rows", record_id: id, action: "access_matrix_row_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Access Matrix row deleted." });
}

export async function saveAccessComparisonRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    what: String(formData.get("what") ?? "").trim(),
    participant: String(formData.get("participant") ?? "").trim(),
    school: String(formData.get("school") ?? "").trim(),
    sensei: String(formData.get("sensei") ?? "").trim(),
    referee: String(formData.get("referee") ?? "").trim(),
    audience: String(formData.get("audience") ?? "").trim(),
    organizer: String(formData.get("organizer") ?? "").trim(),
    support: String(formData.get("support") ?? "").trim(),
  };
  if (!values.what) backTo(returnTo, { error: "The Access row name is required." });
  const { error } = id
    ? await supabase.from("access_comparison_rows").update(values).eq("id", id)
    : await supabase.from("access_comparison_rows").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the comparison row." });
  await writeAudit(supabase, {
    table_name: "access_comparison_rows", record_id: id || null,
    action: id ? "access_comparison_row_updated" : "access_comparison_row_created",
    new_value: values, actor_id: actorId,
  });
  revalidatePath("/register");
  backTo(returnTo, { ok: "Access Comparison row saved." });
}

export async function deleteAccessComparisonRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("access_comparison_rows").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the row." });
  await writeAudit(supabase, {
    table_name: "access_comparison_rows", record_id: id, action: "access_comparison_row_deleted", actor_id: actorId,
  });
  revalidatePath("/register");
  backTo(returnTo, { ok: "Access Comparison row deleted." });
}

// ── Participant Support tickets (per-resolved-ticket bounty) ────────────────

export async function saveSupportTicket(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/support";
  const question = String(formData.get("question") ?? "").trim();
  const telegram_group = String(formData.get("telegram_group") ?? "").trim() || null;
  const category = ["advance", "intermediate", "general"].includes(String(formData.get("category")))
    ? String(formData.get("category"))
    : "general";
  const status = formData.get("status") === "resolved" ? "resolved" : "open";
  const answered_by = String(formData.get("answered_by") ?? "").trim() || null;
  const answer = String(formData.get("answer") ?? "").trim() || null;
  const own_school = formData.get("own_school") === "on";
  if (!question) backTo(returnTo, { error: "The question text is required." });

  const { supabase, actorId } = await getActor();
  const values = {
    question, telegram_group, category, status, answered_by, answer, own_school,
    resolved_at: status === "resolved" ? new Date().toISOString() : null,
  };
  if (id) {
    const { error } = await supabase.from("support_tickets").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update the ticket." });
  } else {
    const { error } = await supabase.from("support_tickets").insert(values);
    if (error) backTo(returnTo, { error: "Could not create the ticket." });
  }
  await writeAudit(supabase, {
    table_name: "support_tickets", record_id: id || null,
    action: id ? "support_ticket_updated" : "support_ticket_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Ticket saved." });
}

export async function deleteSupportTicket(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can delete tickets." });
  }
  const { error } = await supabase.from("support_tickets").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the ticket." });
  await writeAudit(supabase, {
    table_name: "support_tickets", record_id: id, action: "support_ticket_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Ticket deleted." });
}

export async function toggleTicketComplaint(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const complaint = formData.get("complaint") === "true";
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can record complaints." });
  }
  const { error } = await supabase.from("support_tickets").update({ complaint }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not update the complaint flag." });
  await writeAudit(supabase, {
    table_name: "support_tickets", record_id: id,
    action: complaint ? "support_complaint_recorded" : "support_complaint_cleared", actor_id: actorId,
  });
  backTo(returnTo, { ok: complaint ? "Complaint recorded (-1 USD)." : "Complaint cleared." });
}

// ── Auto-assign Referee Terms & Conditions ──────────────────────────────────

export async function saveAutoAssignTerm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const position = Number(formData.get("position") ?? 0);
  const content = String(formData.get("content") ?? "").trim();
  const returnTo = "/admin/referees";
  if (!content) backTo(returnTo, { error: "The term's text is required." });
  if (!position || position < 1) backTo(returnTo, { error: "No. must be 1 or higher." });
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit the auto-assign terms." });
  }
  if (id) {
    const { data: before } = await supabase.from("auto_assign_terms").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase
      .from("auto_assign_terms")
      .update({ position, content, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update the term." });
    await writeAudit(supabase, {
      table_name: "auto_assign_terms", record_id: id, action: "auto_assign_term_updated",
      old_value: before, new_value: { position, content }, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("auto_assign_terms").insert({ position, content }).select("id").single();
    if (error) backTo(returnTo, { error: "Could not add the term." });
    await writeAudit(supabase, {
      table_name: "auto_assign_terms", record_id: data!.id, action: "auto_assign_term_created",
      new_value: { position, content }, actor_id: actorId,
    });
  }
  backTo(returnTo, { ok: "Auto-assign term saved." });
}

export async function deleteAutoAssignTerm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/referees";
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit the auto-assign terms." });
  }
  const { error } = await supabase.from("auto_assign_terms").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the term." });
  await writeAudit(supabase, {
    table_name: "auto_assign_terms", record_id: id, action: "auto_assign_term_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Auto-assign term deleted." });
}

const AUTO_ASSIGN_TERMS_CSV_COLUMNS = ["position", "content"] as const;

export async function bulkUploadAutoAssignTerms(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), AUTO_ASSIGN_TERMS_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 500) return { done: false, error: "Maximum 500 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const position = Number(get(r, "position"));
    const content = get(r, "content");
    const name = content.slice(0, 40) || `Row ${rowNo}`;
    if (!content || !position || position < 1) {
      failures.push({ row: rowNo, name, error: "position (1+) and content are both required" });
      continue;
    }
    const { data, error } = await supabase.from("auto_assign_terms").insert({ position, content }).select("id").single();
    if (error) { failures.push({ row: rowNo, name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "auto_assign_terms", record_id: data!.id, action: "auto_assign_term_created",
      new_value: { position, content }, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath("/admin/referees");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const RECORD_CODE_TABLES: Record<string, string> = { school: "schools", sensei: "senseis" };

/** Generates a personal, single-use invitation code for one already-saved
 * School/Sensei record, bound to that record's own email (only that email
 * can redeem it) — auto-recorded onto the record's own invitation_code
 * column so it stays visible without having to look it up separately. This
 * is additive to createInvitationCode's generic shared codes above, not a
 * replacement for them. */
export async function generateRecordInvitationCode(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin");
  const table = RECORD_CODE_TABLES[role];
  if (!table || !id) backTo(returnTo, { error: "Invalid request." });

  const { supabase, actorId } = await getActor();
  const { data: record } = await supabase.from(table).select("email").eq("id", id).maybeSingle();
  if (!record?.email) {
    backTo(returnTo, { error: "This record needs an email address before a code can be generated." });
  }

  const code = `${role.toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const { data: myProfile } = actorId
    ? await supabase.from("profiles").select("full_name, email").eq("user_id", actorId).maybeSingle()
    : { data: null };
  const generated_by = myProfile?.full_name || myProfile?.email || null;

  const { data: inserted, error } = await supabase
    .from("invitation_codes")
    .insert({
      code, role, email: record!.email, max_uses: 1, generated_by, for_record_id: id,
      note: `Personal code for ${role} record ${id.slice(0, 8).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (error) backTo(returnTo, { error: `Could not generate code: ${error.message}` });

  await supabase.from(table).update({ invitation_code: code }).eq("id", id);
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: inserted!.id, action: "invitation_code_created",
    new_value: { code, role, email: record!.email, for_table: table, for_id: id }, actor_id: actorId,
  });
  backTo(returnTo, { ok: `Invitation code generated: ${code}` });
}

export async function toggleInvitationCode(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("invitation_codes").update({ active }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not update code." });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: id,
    action: active ? "invitation_code_activated" : "invitation_code_deactivated", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Invitation code updated." });
}

/** Fetches what the notification needs and fires it off (best-effort — never
 * throws, so a notification hiccup can't undo a successful assignment). */
async function notifyVideoAssignment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  videoId: string,
  refereeUserId: string,
) {
  try {
    const [{ data: referee }, { data: video }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email, telegram_chat_id")
        .eq("user_id", refereeUserId)
        .maybeSingle(),
      supabase
        .from("kata_videos")
        .select("participant:participants(full_name), registration:registrations(category:categories(name))")
        .eq("id", videoId)
        .maybeSingle(),
    ]);
    const v = video as unknown as {
      participant: { full_name: string } | null;
      registration: { category: { name: string } | null } | null;
    } | null;
    await notifyRefereeAssignment({
      refereeEmail: referee?.email ?? null,
      refereeName: referee?.full_name ?? null,
      refereeTelegramChatId: referee?.telegram_chat_id ?? null,
      participantName: v?.participant?.full_name ?? "a participant",
      categoryName: v?.registration?.category?.name ?? null,
    });
  } catch {
    // Best-effort — assignment already succeeded regardless.
  }
}

export async function assignRefereeToVideo(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/judging");
  if (!videoId || !refereeUserId) backTo(returnTo, { error: "Select a video and a referee." });
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { error } = await supabase.rpc("assign_referee", { p_video: videoId, p_referee: refereeUserId });
  if (error) backTo(returnTo, { error: "Could not assign referee." });
  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: videoId,
    action: "referee_assigned", new_value: { referee_user_id: refereeUserId }, actor_id: actorId,
  });
  await notifyVideoAssignment(supabase, videoId, refereeUserId);
  backTo(returnTo, { ok: "Referee assigned." });
}

/** Manually re-sends the same assignment email/Telegram notification a
 * referee already got automatically when assigned — for when they missed
 * it the first time. Available to any admin-tier viewer (not just Super
 * Admin), unlike assign/unassign, since it's a read-only nudge. */
export async function resendRefereeNotification(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/judging");
  if (!videoId || !refereeUserId) backTo(returnTo, { error: "Missing video or referee." });
  const { supabase } = await getActor();
  await notifyVideoAssignment(supabase, videoId, refereeUserId);
  backTo(returnTo, { ok: "Notification sent." });
}

export async function unassignRefereeFromVideo(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/judging");
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { error } = await supabase.rpc("unassign_referee", { p_video: videoId, p_referee: refereeUserId });
  if (error) backTo(returnTo, { error: "Could not remove referee." });
  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: videoId,
    action: "referee_unassigned", new_value: { referee_user_id: refereeUserId }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Referee removed." });
}

export async function setJudgesRequired(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const judgesRequired = Number(formData.get("judges_required") ?? "");
  const returnTo = "/admin/judging";
  if (!competitionId || !Number.isInteger(judgesRequired) || judgesRequired < 1) {
    backTo(returnTo, { error: "Enter a whole number of judges (1 or more)." });
  }
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { error } = await supabase
    .from("competitions")
    .update({ judges_required: judgesRequired })
    .eq("id", competitionId);
  if (error) backTo(returnTo, { error: "Could not update judges required." });
  await writeAudit(supabase, {
    table_name: "competitions", record_id: competitionId,
    action: "judges_required_changed", new_value: { judges_required: judgesRequired }, actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Judges required updated." });
}

/**
 * Tops up every under-assigned recording in a competition to its
 * judges_required target, picking the least-loaded eligible referee each
 * time (random tie-break) so workload stays roughly even across the panel.
 * Existing assignments are left alone — this only fills gaps.
 */
export async function autoAssignReferees(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const returnTo = "/admin/judging";
  if (!competitionId) backTo(returnTo, { error: "Select a competition." });
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);

  const { data: competition } = await supabase
    .from("competitions")
    .select("id, judges_required")
    .eq("id", competitionId)
    .maybeSingle();
  if (!competition) backTo(returnTo, { error: "Competition not found." });
  const needed = competition!.judges_required ?? 3;

  const { data: regs } = await supabase.from("registrations").select("id").eq("competition_id", competitionId);
  const regIds = (regs ?? []).map((r) => r.id as string);
  const { data: videos } =
    regIds.length > 0
      ? await supabase.from("kata_videos").select("id").in("registration_id", regIds)
      : { data: [] as Array<{ id: string }> };
  const videoIds = (videos ?? []).map((v) => v.id as string);
  if (videoIds.length === 0) backTo(returnTo, { ok: "No recordings submitted yet for this competition." });

  // Eligible pool = the Referee page's directory (approved records) that
  // have a linked login — the same list the Referee Workload table shows —
  // so auto-assign and the workload view can never disagree about who is
  // assignable.
  const { data: referees } = await supabase
    .from("referees")
    .select("user_id")
    .eq("status", "approved")
    .not("user_id", "is", null);
  const refereeIds = [...new Set((referees ?? []).map((r) => r.user_id as string))];
  if (refereeIds.length === 0) {
    backTo(returnTo, { error: "No approved referees with a linked login yet — link accounts on the Referees page first." });
  }

  const { data: existing } = await supabase
    .from("referee_assignments")
    .select("video_id, referee_user_id")
    .in("video_id", videoIds);
  const assignedByVideo = new Map<string, Set<string>>();
  const loadByReferee = new Map<string, number>(refereeIds.map((id) => [id, 0]));
  for (const a of existing ?? []) {
    const set = assignedByVideo.get(a.video_id) ?? new Set<string>();
    set.add(a.referee_user_id);
    assignedByVideo.set(a.video_id, set);
    loadByReferee.set(a.referee_user_id, (loadByReferee.get(a.referee_user_id) ?? 0) + 1);
  }

  // Randomise video order so a shortage of referees doesn't systematically
  // starve whichever videos happen to sort last.
  const shuffledVideos = [...videoIds].sort(() => Math.random() - 0.5);
  const newAssignments: Array<{ videoId: string; refereeUserId: string }> = [];

  for (const videoId of shuffledVideos) {
    const already = assignedByVideo.get(videoId) ?? new Set<string>();
    let slotsLeft = needed - already.size;
    while (slotsLeft > 0) {
      const eligible = refereeIds.filter((id) => !already.has(id));
      if (eligible.length === 0) break;
      const minLoad = Math.min(...eligible.map((id) => loadByReferee.get(id) ?? 0));
      const candidates = eligible.filter((id) => (loadByReferee.get(id) ?? 0) === minLoad);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const { error } = await supabase.rpc("assign_referee", { p_video: videoId, p_referee: pick });
      if (!error) {
        already.add(pick);
        loadByReferee.set(pick, (loadByReferee.get(pick) ?? 0) + 1);
        newAssignments.push({ videoId, refereeUserId: pick });
      }
      slotsLeft--;
    }
    assignedByVideo.set(videoId, already);
  }

  await Promise.all(newAssignments.map((a) => notifyVideoAssignment(supabase, a.videoId, a.refereeUserId)));

  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: null, action: "referees_auto_assigned",
    new_value: { competition_id: competitionId, judges_required: needed, new_assignments: newAssignments.length },
    actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, {
    ok: newAssignments.length > 0
      ? `Auto-assigned ${newAssignments.length} referee slot${newAssignments.length === 1 ? "" : "s"}.`
      : "Every recording already has its full panel of judges.",
  });
}

export async function seedAutoAssignCriteria(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/judging";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { count } = await supabase.from("auto_assign_criteria").select("id", { count: "exact", head: true });
  if (!count) {
    await supabase.from("auto_assign_criteria").insert(
      DEFAULT_AUTO_ASSIGN_CRITERIA.map((r, i) => ({ position: i + 1, title: r.title, description: r.description })),
    );
  }
  await writeAudit(supabase, {
    table_name: "auto_assign_criteria", record_id: null, action: "auto_assign_criteria_seeded", actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Default criteria imported — edit the rows below." });
}

export async function saveAutoAssignCriterion(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/judging";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    title: String(formData.get("title") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
  };
  if (!values.title) backTo(returnTo, { error: "A title is required." });
  const { error } = id
    ? await supabase.from("auto_assign_criteria").update(values).eq("id", id)
    : await supabase.from("auto_assign_criteria").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the criterion." });
  await writeAudit(supabase, {
    table_name: "auto_assign_criteria", record_id: id || null,
    action: id ? "auto_assign_criterion_updated" : "auto_assign_criterion_created",
    new_value: values, actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Criterion saved." });
}

export async function deleteAutoAssignCriterion(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/judging";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("auto_assign_criteria").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the criterion." });
  await writeAudit(supabase, {
    table_name: "auto_assign_criteria", record_id: id, action: "auto_assign_criterion_deleted", actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Criterion deleted." });
}

export interface AdminVideoUploadState {
  ok: boolean;
  error?: string;
}

/**
 * Admin-only backup path: attaches a recording to a registration on the
 * participant's behalf (e.g. their live-camera submission failed, or they
 * sent the organizer a video another way) — the file itself is uploaded
 * client-side straight to the kata-videos bucket (see migration 0030's
 * admin storage policy) before this is called with just the resulting
 * path. Replaces any existing recording for that registration rather than
 * erroring, since "fix a broken submission" is the whole point.
 */
export async function adminAttachVideo(
  _prev: AdminVideoUploadState,
  formData: FormData,
): Promise<AdminVideoUploadState> {
  const registrationId = String(formData.get("registration_id") ?? "");
  const path = String(formData.get("path") ?? "");
  const mime = String(formData.get("mime") ?? "video/mp4");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (actorRole !== "admin") {
    return { ok: false, error: "Only the Super Admin can upload a recording on a participant's behalf." };
  }
  if (!registrationId || !path) return { ok: false, error: "Missing recording upload." };

  const { data: reg } = await supabase
    .from("registrations").select("id, participant_id").eq("id", registrationId).maybeSingle();
  if (!reg) return { ok: false, error: "Registration not found." };

  const { data: existing } = await supabase
    .from("kata_videos").select("id").eq("registration_id", registrationId).maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("kata_videos")
      .update({ storage_path: path, mime, status: "submitted" })
      .eq("id", existing.id);
    if (error) return { ok: false, error: "Could not replace the recording." };
    await writeAudit(supabase, {
      table_name: "kata_videos", record_id: existing.id, action: "kata_video_admin_replaced",
      new_value: { storage_path: path }, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("kata_videos")
      .insert({
        registration_id: registrationId,
        participant_id: reg.participant_id,
        user_id: actorId,
        storage_path: path,
        mime,
      })
      .select("id").single();
    if (error) return { ok: false, error: "Could not attach the recording." };
    await writeAudit(supabase, {
      table_name: "kata_videos", record_id: data!.id, action: "kata_video_admin_uploaded",
      new_value: { storage_path: path, registration_id: registrationId }, actor_id: actorId,
    });
  }
  revalidatePath("/admin/records");
  revalidatePath("/kata-arena");
  revalidatePath("/admin/judging");
  return { ok: true };
}

// ── Organizer / Participant Support account creation ───────────────────────────

const ROLE_LABEL: Record<string, string> = {
  organizer: "Admin / Organizer",
  customer_support: "Participant Support",
};

/**
 * Directly creates a real login (auth user + approved profile) for an
 * Organizer or Participant Support account — no self-signup or invitation code
 * involved. Gated server-side on the CALLER's own role (never on anything
 * the client submits): only Super Admin may create Organizer accounts;
 * Super Admin or an existing Organizer may create Participant Support accounts.
 */
export async function createStaffAccount(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const returnTo = role === "organizer" ? "/admin/organizers" : "/admin/support";
  if (!["organizer", "customer_support"].includes(role)) {
    backTo(returnTo, { error: "Invalid role." });
  }
  const full_name = String(formData.get("full_name") ?? "").trim();
  const short_name = String(formData.get("short_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!full_name || !email) {
    backTo(returnTo, { error: "Full name and email are required." });
  }
  if (role === "customer_support" && !short_name) {
    backTo(returnTo, { error: "My short name or initial is required." });
  }
  const extra = {
    short_name: short_name || null,
    ic_passport: String(formData.get("ic_passport") ?? "").trim() || null,
    date_of_birth: String(formData.get("date_of_birth") ?? "").trim() || null,
    gender: String(formData.get("gender") ?? "").trim() || null,
    belt_rank: String(formData.get("belt_rank") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    country: String(formData.get("country") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: String(formData.get("bank_account_no") ?? "").trim() || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
    highest_education: String(formData.get("highest_education") ?? "").trim() || null,
    languages_count: formData.get("languages_count") ? Number(formData.get("languages_count")) : null,
    languages: formData.getAll("languages").map((l) => String(l)).filter(Boolean),
    support_tier_1_id: String(formData.get("support_tier_1_id") ?? "").trim() || null,
    support_tier_2_id: String(formData.get("support_tier_2_id") ?? "").trim() || null,
    support_tier_3_id: String(formData.get("support_tier_3_id") ?? "").trim() || null,
  };
  if (!extra.ic_passport || !extra.date_of_birth || !extra.gender) {
    backTo(returnTo, { error: "IC / Passport, date of birth, and gender are required." });
  }
  if (!extra.home_address || !extra.city_town || !extra.postcode || !extra.country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and country are required." });
  }
  if (!extra.phone) {
    backTo(returnTo, { error: "Mobile phone is required." });
  }
  if (!extra.bank_name || !extra.bank_account_no || !extra.bank_account_name) {
    backTo(returnTo, { error: "Bank details are required." });
  }
  if (role === "customer_support" && (!extra.highest_education || extra.languages_count == null)) {
    backTo(returnTo, { error: "Highest Education Attended and number of languages are required." });
  }

  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (role === "organizer" && actorRole !== "admin") {
    backTo(returnTo, { error: "Only the Super Admin can create Admin / Organizer accounts." });
  }
  if (role === "customer_support" && !["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Super Admin or Admin / Organizer can create Participant Support accounts." });
  }

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "staff", returnTo);

  const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (error || !created.user) {
    backTo(returnTo, { error: "Could not create the account — the email may already be registered." });
  }
  // handle_new_user already inserted a profiles row with approved=false;
  // flip it here via the service-role client (never via client metadata).
  await admin
    .from("profiles")
    .update({ approved: true, ...extra, certificate_path: certificatePath })
    .eq("user_id", created!.user!.id);

  await writeAudit(supabase, {
    table_name: "profiles",
    record_id: created!.user!.id,
    action: "staff_account_created",
    new_value: { role, full_name, email, ...extra },
    actor_id: actorId,
  });

  await sendConfirmationEmail({
    toEmail: email,
    recipientName: full_name,
    subject: `Your ${ROLE_LABEL[role]} account is ready`,
    bodyLines: [
      `An account has been created for you as ${ROLE_LABEL[role]}.`,
      `Temporary password: ${tempPassword}`,
      "Sign in and keep this password safe — there is currently no self-service password reset, contact the organizer if you need it changed.",
    ],
  });

  revalidatePath(returnTo);
  backTo(returnTo, { ok: `${ROLE_LABEL[role]} account created for ${full_name} — login details emailed.` });
}

// ── CSV bulk upload — Schools / Senseis / Referees / Audience / Staff ───────
// Each mirrors the validation of its single-record "Add" action above, but
// processes many rows from one CSV file, row by row, collecting per-row
// failures instead of aborting the whole file on the first bad row.

const SCHOOL_CSV_COLUMNS = [
  "name", "state", "contact_title", "contact_name", "contact_karate_title", "contact_rank",
  "home_address", "city_town", "postcode", "home_country", "email", "phone",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadSchools(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), SCHOOL_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const name = get(r, "name") || `Row ${rowNo}`;
    const record = {
      name: get(r, "name"),
      state: get(r, "state") || null,
      contact_title: get(r, "contact_title") || null,
      contact_name: get(r, "contact_name") || null,
      contact_karate_title: get(r, "contact_karate_title") || null,
      contact_rank: get(r, "contact_rank") || null,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      postcode: get(r, "postcode") || null,
      home_country: get(r, "home_country") || null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      bank_name: get(r, "bank_name") || null,
      bank_account_no: get(r, "bank_account_no") || null,
      bank_account_name: get(r, "bank_account_name") || null,
    };
    if (!record.name) { failures.push({ row: rowNo, name, error: "School name is required" }); continue; }
    if (!record.contact_title || !record.contact_name || !record.contact_karate_title || !record.contact_rank) {
      failures.push({ row: rowNo, name, error: "Person in-charge's title, name, karate title, and rank are required" });
      continue;
    }
    if (!record.home_address || !record.city_town || !record.postcode || !record.home_country) {
      failures.push({ row: rowNo, name, error: "Home address, city/town, postcode, and home country are required" });
      continue;
    }
    if (!record.email || !record.phone) {
      failures.push({ row: rowNo, name, error: "Email address and mobile phone are required" });
      continue;
    }
    if (!record.bank_name || !record.bank_account_no || !record.bank_account_name) {
      failures.push({ row: rowNo, name, error: "Bank name, account number, and account holder name are required" });
      continue;
    }
    const { data: dup } = await supabase.from("schools").select("id").ilike("name", record.name).limit(1);
    if (dup && dup.length > 0) { failures.push({ row: rowNo, name, error: "A school with this name already exists" }); continue; }

    const { data, error } = await supabase
      .from("schools")
      .insert({ ...record, gender: record.contact_title === "Mr." ? "male" : "female" })
      .select("id").single();
    if (error) { failures.push({ row: rowNo, name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "schools", record_id: data!.id, action: "school_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "schools", record_id: null, action: "bulk_csv_schools",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath("/admin/schools");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const SENSEI_CSV_COLUMNS = [
  "name", "ic_passport", "date_of_birth", "rank", "gender", "school_name",
  "home_address", "city_town", "postcode", "home_country", "email", "phone",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadSenseis(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), SENSEI_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const { data: schools } = await supabase.from("schools").select("id, name");
  const schoolIdByName = new Map((schools ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const name = get(r, "name") || `Row ${rowNo}`;
    const schoolName = get(r, "school_name");
    let schoolId: string | null = null;
    if (schoolName) {
      schoolId = schoolIdByName.get(schoolName.trim().toLowerCase()) ?? null;
      if (!schoolId) { failures.push({ row: rowNo, name, error: `School "${schoolName}" not found` }); continue; }
    }
    const gender = get(r, "gender").toLowerCase();
    const record = {
      name: get(r, "name"),
      ic_passport: get(r, "ic_passport") || null,
      date_of_birth: get(r, "date_of_birth") || null,
      rank: get(r, "rank") || null,
      gender: gender || null,
      school_id: schoolId,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      postcode: get(r, "postcode") || null,
      home_country: get(r, "home_country") || null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      bank_name: get(r, "bank_name") || null,
      bank_account_no: get(r, "bank_account_no") || null,
      bank_account_name: get(r, "bank_account_name") || null,
    };
    if (!record.name) { failures.push({ row: rowNo, name, error: "Sensei name is required" }); continue; }
    if (!record.ic_passport) { failures.push({ row: rowNo, name, error: "IC / Passport is required" }); continue; }
    if (!record.date_of_birth) { failures.push({ row: rowNo, name, error: "Date of birth is required" }); continue; }
    if (!record.rank) { failures.push({ row: rowNo, name, error: "Rank is required" }); continue; }
    if (!gender || !["male", "female"].includes(gender)) { failures.push({ row: rowNo, name, error: "Gender must be male or female" }); continue; }
    if (!schoolId) { failures.push({ row: rowNo, name, error: "School is required" }); continue; }
    if (!record.home_address || !record.city_town || !record.postcode || !record.home_country) {
      failures.push({ row: rowNo, name, error: "Personal home address, city/town, postcode, and home country are required" });
      continue;
    }
    if (!record.email || !record.phone) {
      failures.push({ row: rowNo, name, error: "Email address and mobile phone are required" });
      continue;
    }
    if (!record.bank_name || !record.bank_account_no || !record.bank_account_name) {
      failures.push({ row: rowNo, name, error: "Personal bank details are required" });
      continue;
    }

    let dupQuery = supabase.from("senseis").select("id").ilike("name", record.name).limit(1);
    dupQuery = schoolId ? dupQuery.eq("school_id", schoolId) : dupQuery.is("school_id", null);
    const { data: dup } = await dupQuery;
    if (dup && dup.length > 0) { failures.push({ row: rowNo, name, error: "A sensei with this name (and school) already exists" }); continue; }

    const { data, error } = await supabase.from("senseis").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "senseis", record_id: data!.id, action: "sensei_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "senseis", record_id: null, action: "bulk_csv_senseis",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath("/admin/senseis");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const REFEREE_CSV_COLUMNS = [
  "full_name", "ic_passport", "date_of_birth", "gender", "karate_rank", "judging_experience_count",
  "school", "email", "phone", "home_address", "city_town", "home_country",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadReferees(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), REFEREE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const experienceRaw = get(r, "judging_experience_count");
    const record = {
      full_name: get(r, "full_name"),
      ic_passport: get(r, "ic_passport"),
      date_of_birth: get(r, "date_of_birth") || null,
      gender: get(r, "gender") || null,
      karate_rank: get(r, "karate_rank") || null,
      judging_experience_count: experienceRaw ? Number(experienceRaw) : null,
      school: get(r, "school") || null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      home_country: get(r, "home_country") || null,
      bank_name: get(r, "bank_name") || null,
      bank_account_no: get(r, "bank_account_no") || null,
      bank_account_name: get(r, "bank_account_name") || null,
    };
    if (!record.full_name || !record.ic_passport) {
      failures.push({ row: rowNo, name: full_name, error: "Name and IC/passport are required" });
      continue;
    }
    const { data, error } = await supabase.from("referees").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: full_name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "referees", record_id: data!.id, action: "referee_created_by_admin",
      new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "referees", record_id: null, action: "bulk_csv_referees",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath("/admin/referees");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const AUDIENCE_CSV_COLUMNS = ["full_name", "email", "phone", "home_country", "invitation_code", "payment_status"] as const;

export async function bulkUploadAudience(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), AUDIENCE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 5000) return { done: false, error: "Maximum 5000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const statusRaw = get(r, "payment_status").toLowerCase() || "pending";
    if (!["pending", "paid", "waived"].includes(statusRaw)) {
      failures.push({ row: rowNo, name: full_name, error: "payment_status must be pending, paid, or waived" });
      continue;
    }
    const record = {
      full_name: get(r, "full_name"),
      email: get(r, "email"),
      phone: get(r, "phone") || null,
      home_country: get(r, "home_country"),
      invitation_code: get(r, "invitation_code") || null,
      payment_status: statusRaw,
    };
    if (!record.full_name || !record.email || !record.home_country) {
      failures.push({ row: rowNo, name: full_name, error: "Full name, email, and home country are required" });
      continue;
    }
    const { data, error } = await supabase.from("audiences").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: full_name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "audiences", record_id: data!.id, action: "audience_created_by_admin",
      new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "audiences", record_id: null, action: "bulk_csv_audience",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath("/admin/audience");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const PARTICIPANT_CSV_COLUMNS = [
  "full_name", "ic_passport", "date_of_birth", "gender", "belt_rank", "rank_confirmation",
  "home_address", "city_town", "postcode", "home_country", "email", "phone",
  "school_name", "sensei_name", "invitation_code",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadParticipants(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), PARTICIPANT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const [{ data: schools }, { data: senseis }] = await Promise.all([
    supabase.from("schools").select("id, name"),
    supabase.from("senseis").select("id, name"),
  ]);
  const schoolIdByName = new Map((schools ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));
  const senseiIdByName = new Map((senseis ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const rankConfirmationRaw = get(r, "rank_confirmation").toLowerCase() || "pending_confirmation";
    if (!["sensei_confirmed", "pending_confirmation"].includes(rankConfirmationRaw)) {
      failures.push({ row: rowNo, name: full_name, error: "rank_confirmation must be sensei_confirmed or pending_confirmation (certificates can't be uploaded via CSV)" });
      continue;
    }
    const schoolId = schoolIdByName.get(get(r, "school_name").trim().toLowerCase());
    if (!schoolId) { failures.push({ row: rowNo, name: full_name, error: "school_name does not match an existing school" }); continue; }
    const senseiId = senseiIdByName.get(get(r, "sensei_name").trim().toLowerCase());
    if (!senseiId) { failures.push({ row: rowNo, name: full_name, error: "sensei_name does not match an existing sensei" }); continue; }

    const record = {
      full_name: get(r, "full_name"),
      ic_passport: get(r, "ic_passport"),
      date_of_birth: get(r, "date_of_birth") || null,
      gender: get(r, "gender") || null,
      belt_rank: get(r, "belt_rank") || null,
      rank_confirmation: rankConfirmationRaw,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      postcode: get(r, "postcode") || null,
      home_country: get(r, "home_country") || null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      school_id: schoolId,
      sensei_id: senseiId,
      invitation_code: get(r, "invitation_code") || null,
    };
    if (!record.full_name || !record.ic_passport) {
      failures.push({ row: rowNo, name: full_name, error: "Full name and IC/passport are required" });
      continue;
    }
    if (!record.date_of_birth || !record.gender || !record.belt_rank) {
      failures.push({ row: rowNo, name: full_name, error: "Date of birth, gender, and belt rank are required" });
      continue;
    }
    if (!record.home_address || !record.city_town || !record.postcode || !record.home_country) {
      failures.push({ row: rowNo, name: full_name, error: "Home address, city/town, postcode, and home country are required" });
      continue;
    }
    if (!record.email || !record.phone) {
      failures.push({ row: rowNo, name: full_name, error: "Email address and mobile phone are required" });
      continue;
    }
    const bank = {
      bank_name: get(r, "bank_name"),
      bank_account_no: get(r, "bank_account_no"),
      bank_account_name: get(r, "bank_account_name"),
    };
    if (!bank.bank_name || !bank.bank_account_no || !bank.bank_account_name) {
      failures.push({ row: rowNo, name: full_name, error: "Reward payout bank details are required" });
      continue;
    }

    const { data, error } = await supabase.from("participants").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: full_name, error: "Could not save" }); continue; }
    await supabase.from("participant_bank_details").upsert({ participant_id: data!.id, ...bank }, { onConflict: "participant_id" });
    await writeAudit(supabase, {
      table_name: "participants", record_id: data!.id, action: "participant_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "participants", record_id: null, action: "bulk_csv_participants",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath("/admin/participants");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const ANNOUNCEMENT_CSV_COLUMNS = ["title", "competition_name", "body", "published"] as const;

export async function bulkUploadAnnouncements(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), ANNOUNCEMENT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 500) return { done: false, error: "Maximum 500 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const { data: competitions } = await supabase.from("competitions").select("id, name");
  const competitionIdByName = new Map((competitions ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const title = get(r, "title") || `Row ${rowNo}`;
    if (!get(r, "title")) { failures.push({ row: rowNo, name: title, error: "Title is required" }); continue; }

    const competitionName = get(r, "competition_name").trim();
    let competitionId: string | null = null;
    if (competitionName) {
      competitionId = competitionIdByName.get(competitionName.toLowerCase()) ?? null;
      if (!competitionId) { failures.push({ row: rowNo, name: title, error: "competition_name does not match an existing competition" }); continue; }
    }

    const publishedRaw = get(r, "published").toLowerCase();
    const published = ["true", "yes", "1", "published"].includes(publishedRaw);

    const record = {
      competition_id: competitionId,
      title: get(r, "title"),
      body: get(r, "body") || null,
      published,
    };
    const { data, error } = await supabase.from("announcements").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: title, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "announcements", record_id: data!.id, action: "announcement_created", new_value: record, actor_id: actorId,
    });
    if (published) await notifyAnnouncementPublished(record.title, record.body);
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "announcements", record_id: null, action: "bulk_csv_announcements",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath("/admin/announcements");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const STAFF_CSV_COLUMNS = [
  "full_name", "email", "ic_passport", "date_of_birth", "gender", "belt_rank",
  "home_address", "city_town", "postcode", "country", "phone",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

/** Shared by bulkUploadOrganizers / bulkUploadSupport below — creates a real
 * login + emails a temporary password per row, same as createStaffAccount
 * above but looped over CSV rows. Capped far lower than the data-only bulk
 * uploads (200 rows) since every row is a real account + an email sent. */
async function bulkCreateStaffAccounts(formData: FormData, role: "organizer" | "customer_support"): Promise<CsvUploadResult> {
  const returnTo = role === "organizer" ? "/admin/organizers" : "/admin/support";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), STAFF_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 200) return { done: false, error: "Maximum 200 rows per upload — this creates a real login per row." };

  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (role === "organizer" && actorRole !== "admin") {
    return { done: false, error: "Only the Super Admin can bulk-create Admin / Organizer accounts." };
  }
  if (role === "customer_support" && !["admin", "organizer"].includes(actorRole ?? "")) {
    return { done: false, error: "Only Admin / Organizer can bulk-create Participant Support accounts." };
  }

  const admin = createAdminClient();
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const email = get(r, "email");
    const ic_passport = get(r, "ic_passport");
    const date_of_birth = get(r, "date_of_birth");
    const gender = get(r, "gender");
    const home_address = get(r, "home_address");
    const city_town = get(r, "city_town");
    const postcode = get(r, "postcode");
    const country = get(r, "country");
    const phone = get(r, "phone");
    const bank_name = get(r, "bank_name");
    const bank_account_no = get(r, "bank_account_no");
    const bank_account_name = get(r, "bank_account_name");
    if (!full_name || !email || !ic_passport || !date_of_birth || !gender) {
      failures.push({ row: rowNo, name: full_name, error: "Full name, email, IC/Passport, date of birth, and gender are required" });
      continue;
    }
    if (!home_address || !city_town || !postcode || !country || !phone) {
      failures.push({ row: rowNo, name: full_name, error: "Home address, city/town, postcode, country, and phone are required" });
      continue;
    }
    if (!bank_name || !bank_account_no || !bank_account_name) {
      failures.push({ row: rowNo, name: full_name, error: "Bank details are required" });
      continue;
    }
    const extra = {
      ic_passport,
      date_of_birth,
      gender,
      belt_rank: get(r, "belt_rank") || null,
      home_address,
      city_town,
      postcode,
      country,
      phone,
      bank_name,
      bank_account_no,
      bank_account_name,
    };
    const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name, role },
    });
    if (error || !created.user) {
      failures.push({ row: rowNo, name: full_name, error: "Could not create account — email may already be registered" });
      continue;
    }
    await admin.from("profiles").update({ approved: true, ...extra }).eq("user_id", created.user.id);
    await writeAudit(supabase, {
      table_name: "profiles", record_id: created.user.id, action: "staff_account_created",
      new_value: { role, full_name, email, ...extra }, actor_id: actorId,
    });
    await sendConfirmationEmail({
      toEmail: email,
      recipientName: full_name,
      subject: `Your ${ROLE_LABEL[role]} account is ready`,
      bodyLines: [
        `An account has been created for you as ${ROLE_LABEL[role]}.`,
        `Temporary password: ${tempPassword}`,
        "Sign in and keep this password safe — there is currently no self-service password reset, contact the organizer if you need it changed.",
      ],
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "profiles", record_id: null, action: "bulk_csv_staff_accounts",
    new_value: { role, rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

export async function bulkUploadOrganizers(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  return bulkCreateStaffAccounts(formData, "organizer");
}

export async function bulkUploadSupport(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  return bulkCreateStaffAccounts(formData, "customer_support");
}

// ── Commission payouts ───────────────────────────────────────────────────────

/** Marks a computed School/Sensei/Referee commission as paid or unpaid --
 * bookkeeping only, the commission amount itself is always recomputed live
 * from registration data (see lib/commissions.ts), never stored here. */
export async function setCommissionPayoutStatus(formData: FormData) {
  const recipientType = String(formData.get("recipient_type") ?? "");
  const recipientId = String(formData.get("recipient_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const returnTo = "/admin/commissions";
  if (!["school", "sensei", "referee"].includes(recipientType) || !recipientId || !["unpaid", "paid"].includes(status)) {
    backTo(returnTo, { error: "Invalid request." });
  }
  const { supabase, actorId } = await getActor();
  const { error } = await supabase
    .from("commission_payouts")
    .upsert(
      {
        recipient_type: recipientType, recipient_id: recipientId, status,
        paid_at: status === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "recipient_type,recipient_id" },
    );
  if (error) backTo(returnTo, { error: `Could not update payout status: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "commission_payouts", record_id: recipientId, action: "commission_payout_status_changed",
    new_value: { recipient_type: recipientType, status }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Payout status updated." });
}

export async function setWinnerPayoutStatus(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const returnTo = "/admin/commissions";
  if (!registrationId || !["unpaid", "paid"].includes(status)) {
    backTo(returnTo, { error: "Invalid request." });
  }
  const { supabase, actorId } = await getActor();
  const { error } = await supabase
    .from("winner_payouts")
    .upsert(
      {
        registration_id: registrationId, status,
        paid_at: status === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "registration_id" },
    );
  if (error) backTo(returnTo, { error: `Could not update payout status: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "winner_payouts", record_id: registrationId, action: "winner_payout_status_changed",
    new_value: { status }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Payout status updated." });
}

// ── Participant Support shift log ────────────────────────────────────────────

/** Manual clock-in — deliberately not tied to page-session timestamps,
 * since Participant Support also works via the Telegram assistant/community
 * groups where there's no page session to derive a sign-in time from. */
export async function clockIn(formData: FormData) {
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  if (!actorId) backTo(returnTo, { error: "Sign in first." });
  const { data: open } = await supabase
    .from("support_shifts")
    .select("id")
    .eq("user_id", actorId!)
    .is("clock_out_at", null)
    .maybeSingle();
  if (open) backTo(returnTo, { error: "You already have an open shift — clock out first." });
  const { error } = await supabase.from("support_shifts").insert({ user_id: actorId });
  if (error) backTo(returnTo, { error: "Could not clock in — please try again." });
  backTo(returnTo, { ok: "Clocked in." });
}

export async function clockOut(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const task_summary = String(formData.get("task_summary") ?? "").trim() || null;
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  if (!actorId || !id) backTo(returnTo, { error: "Invalid request." });
  const { error } = await supabase
    .from("support_shifts")
    .update({ clock_out_at: new Date().toISOString(), task_summary })
    .eq("id", id)
    .eq("user_id", actorId!);
  if (error) backTo(returnTo, { error: "Could not clock out — please try again." });
  backTo(returnTo, { ok: "Clocked out." });
}

// ── Referee <-> login manual link (fallback for mismatched emails) ─────────

/** referees.user_id is auto-linked by email at signup (migration 0040), but
 * a referee who signed up with a different email than their directory
 * record needs this manual override — admin types the email they actually
 * sign in with, and it's matched against profiles directly. */
export async function linkRefereeAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const loginEmail = String(formData.get("login_email") ?? "").trim();
  const returnTo = "/admin/referees";
  if (!id || !loginEmail) backTo(returnTo, { error: "Enter the email they sign in with." });
  const { supabase, actorId } = await getActor();
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("role", "referee")
    .ilike("email", loginEmail)
    .maybeSingle();
  if (!profile) backTo(returnTo, { error: `No Referee/Judge login found for ${loginEmail}.` });
  const { error } = await supabase.from("referees").update({ user_id: profile!.user_id }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not link the account — please try again." });
  await writeAudit(supabase, {
    table_name: "referees", record_id: id, action: "referee_account_linked",
    new_value: { user_id: profile!.user_id, login_email: loginEmail }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Account linked." });
}

// ── Extra re-record attempt purchases (USD 10 for 3 more) ───────────────────

/** Confirms a participant's USD 10 payment and adds 3 more
 * delete-and-re-record chances to their account. */
export async function markAttemptPurchasePaid(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  const { data: purchase } = await supabase
    .from("attempt_purchases")
    .select("id, user_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!purchase || purchase.status !== "pending") {
    backTo(returnTo, { error: "That request is no longer pending." });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("bonus_record_attempts, full_name, email")
    .eq("user_id", purchase!.user_id)
    .maybeSingle();
  const { error: err1 } = await supabase
    .from("profiles")
    .update({ bonus_record_attempts: (profile?.bonus_record_attempts ?? 0) + 3 })
    .eq("user_id", purchase!.user_id);
  const { error: err2 } = await supabase
    .from("attempt_purchases")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id);
  if (err1 || err2) backTo(returnTo, { error: "Could not confirm the purchase — please try again." });
  await writeAudit(supabase, {
    table_name: "attempt_purchases", record_id: id, action: "attempt_purchase_confirmed",
    new_value: { user_id: purchase!.user_id }, actor_id: actorId,
  });
  if (profile?.email) {
    await sendConfirmationEmail({
      toEmail: profile.email,
      recipientName: profile.full_name ?? "there",
      subject: "Your USD 10 payment is confirmed — 3 more attempts added",
      bodyLines: [
        "Your USD 10 payment for extra delete-and-re-record attempts has been confirmed.",
        "3 more chances have been added to your account — go back to My Account to continue recording.",
      ],
    });
  }
  backTo(returnTo, { ok: "Purchase confirmed — 3 attempts added." });
}

// ── Bulk-upload payment gate (Sensei pays before uploading participants) ────

/** Confirms a sensei's upfront bulk-registration payment — unlocks their
 * next CSV/table upload for up to the paid headcount (see
 * consume_bulk_upload_payment, called from app/actions/bulk.ts once the
 * upload actually succeeds). */
export async function markBulkUploadPaymentPaid(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  const { data: payment } = await supabase
    .from("bulk_upload_payments")
    .select("id, sensei_id, participant_count, amount_usd, status")
    .eq("id", id)
    .maybeSingle();
  if (!payment || payment.status !== "pending") {
    backTo(returnTo, { error: "That request is no longer pending." });
  }
  const { error } = await supabase
    .from("bulk_upload_payments")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id);
  if (error) backTo(returnTo, { error: "Could not confirm the payment — please try again." });
  await writeAudit(supabase, {
    table_name: "bulk_upload_payments", record_id: id, action: "bulk_upload_payment_confirmed",
    new_value: { sensei_id: payment!.sensei_id, participant_count: payment!.participant_count }, actor_id: actorId,
  });
  const { data: sensei } = await supabase
    .from("senseis")
    .select("name, email")
    .eq("id", payment!.sensei_id)
    .maybeSingle();
  if (sensei?.email) {
    await sendConfirmationEmail({
      toEmail: sensei.email,
      recipientName: sensei.name ?? "Sensei",
      subject: "Your bulk registration payment is confirmed — you can upload now",
      bodyLines: [
        `Your payment of ${formatUSD(Number(payment!.amount_usd))} for ${payment!.participant_count} participants is confirmed.`,
        "Go back to the Bulk registration page and upload your CSV or table using the same School and Sensei — no further payment needed for these participants.",
      ],
    });
  }
  backTo(returnTo, { ok: "Payment confirmed — sensei can now upload." });
}

// ── Registration slot status (Admin/Organizer/Referee) ──────────────────────

const SLOT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  unslotted: "Unslotted",
  forfeited: "Forfeited",
  given_up: "Given up",
};

/** Admin, Organizer, and Referee/Judge accounts can flag a registration as
 * unslotted, forfeited, or self-given-up (or reset it back to active) to
 * clean up the Participant Records list — e.g. after a missed recording
 * deadline. Delegates to the set_registration_slot_status() RPC so
 * referees get exactly this one capability without a general UPDATE grant
 * on registrations. */
export async function updateRegistrationSlotStatus(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const newStatus = String(formData.get("slot_status") ?? "");
  const note = String(formData.get("slot_status_note") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "/admin/records");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "referee"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin, Organizer, or Referee/Judge accounts can update slot status." });
  }
  if (!["active", "unslotted", "forfeited", "given_up"].includes(newStatus)) {
    backTo(returnTo, { error: "Invalid slot status." });
  }

  const { error } = await supabase.rpc("set_registration_slot_status", {
    reg_id: registrationId,
    new_status: newStatus,
    note: note || null,
  });
  if (error) backTo(returnTo, { error: "Could not update slot status — please try again." });
  await writeAudit(supabase, {
    table_name: "registrations", record_id: registrationId, action: "slot_status_updated",
    new_value: { status: newStatus, note }, actor_id: actorId,
  });
  backTo(returnTo, { ok: `Marked ${SLOT_STATUS_LABEL[newStatus] ?? newStatus}.` });
}

// ── Sign-in quota control (Admin/Organizer only) ────────────────────────────

/** Sets how many times a registrant may sign in, which competition tier
 * that allowance is tied to, and the date range it's valid for — read by
 * lib/sign-in-quota.ts on every protected-page load. Admin/Organizer only;
 * never touches admin/organizer/staff accounts themselves (see
 * record_sign_in()'s exemption in the same migration). */
export async function updateSignInControl(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin/Organizer can manage sign-in control." });
  }
  if (!userId) backTo(returnTo, { error: "This record has no linked login yet." });

  const limitRaw = String(formData.get("sign_in_limit") ?? "").trim();
  const competitionId = String(formData.get("sign_in_competition_id") ?? "").trim();
  const validFrom = String(formData.get("sign_in_valid_from") ?? "").trim();
  const validUntil = String(formData.get("sign_in_valid_until") ?? "").trim();
  const resetCount = formData.get("reset_count") === "on";

  const update: Record<string, unknown> = {
    sign_in_limit: limitRaw ? Number(limitRaw) : null,
    sign_in_competition_id: competitionId || null,
    sign_in_valid_from: validFrom || null,
    sign_in_valid_until: validUntil || null,
  };
  if (resetCount) update.sign_in_count = 0;

  const { error } = await supabase.from("profiles").update(update).eq("user_id", userId);
  if (error) backTo(returnTo, { error: "Could not update sign-in control — please try again." });
  await writeAudit(supabase, {
    table_name: "profiles", record_id: userId, action: "sign_in_control_updated",
    new_value: update, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Sign-in control updated." });
}

/** Marks a "New Subscription" request as fulfilled — the actual renewal
 * (limit/tier/date range) is set via updateSignInControl on that person's
 * own admin page; this just clears the request from the pending list. */
export async function markSubscriptionRenewalFulfilled(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase
    .from("subscription_renewals")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id);
  if (error) backTo(returnTo, { error: "Could not update the request — please try again." });
  await writeAudit(supabase, {
    table_name: "subscription_renewals", record_id: id, action: "subscription_renewal_fulfilled",
    actor_id: actorId,
  });
  backTo(returnTo, { ok: "Marked as fulfilled." });
}
