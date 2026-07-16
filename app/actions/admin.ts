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
import { accessMatrixToMarkdown } from "@/lib/access-matrix";

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

/** Customer Support has edit access to registrations/participants and can
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
    backTo(returnTo, { error: "Customer Support accounts cannot perform this action." });
  }
}

/** Only Admin/Organizer (and legacy "staff") may create or edit competitions
 * — Referee and Customer Support get category-level access but not this. */
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
 * auto-assign) are Super Admin only — Organizer, Customer Support, and
 * Referee can view the arena but not configure it. */
async function requireAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (role !== "admin") {
    backTo(returnTo, { error: "Only the Super Admin can configure judging." });
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
  const returnTo = "/admin/competitions";
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
  const returnTo = "/admin/competitions";
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
  const returnTo = "/admin/competitions";
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
  const returnTo = "/admin/competitions";
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

// ── Announcements ────────────────────────────────────────────────────────────

export async function saveAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/announcements";
  const values = {
    competition_id: String(formData.get("competition_id") ?? "") || null,
    title: String(formData.get("title") ?? "").trim(),
    body: String(formData.get("body") ?? "").trim() || null,
    published: formData.get("published") === "on",
  };
  if (!values.title) backTo(returnTo, { error: "Title is required." });
  const { supabase, actorId } = await getActor();
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
  const returnTo = "/admin/announcements";
  const { supabase, actorId } = await getActor();
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
  const returnTo = "/admin/announcements";
  const { supabase, actorId } = await getActor();

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
  const returnTo = "/admin/announcements";
  const { supabase, actorId } = await getActor();
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
  };
  if (!values.full_name || !values.ic_passport) {
    backTo(returnTo, { error: "Name and IC/passport are required." });
  }
  if (!values.date_of_birth || !values.gender || !values.karate_rank || values.judging_experience_count == null) {
    backTo(returnTo, { error: "Date of birth, gender, karate rank, and judging experience are required." });
  }
  if (!values.school || !values.email || !values.phone) {
    backTo(returnTo, { error: "School/organisation, email, and mobile phone are required." });
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

export async function createInvitationCode(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const providedCode = String(formData.get("code") ?? "").trim().toUpperCase();
  const note = String(formData.get("note") ?? "").trim() || null;
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  if (!["referee", "staff", "audience", "school", "any"].includes(role)) {
    backTo(returnTo, { error: "A valid role is required." });
  }
  // "Generate" buttons don't ask for a custom code — mint a short random one.
  const code = providedCode || `${role.toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase
    .from("invitation_codes")
    .insert({ code, role, note, max_uses: maxUsesRaw ? Number(maxUsesRaw) : null })
    .select("id")
    .single();
  if (error) backTo(returnTo, { error: "Could not create code — it may already exist." });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: data!.id, action: "invitation_code_created",
    new_value: { code, role }, actor_id: actorId,
  });
  backTo(returnTo, { ok: `Invitation code created: ${code}` });
}

export async function toggleInvitationCode(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const returnTo = "/admin/accounts";
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
  await requireAdmin(supabase, actorId, returnTo);
  const { error } = await supabase.rpc("assign_referee", { p_video: videoId, p_referee: refereeUserId });
  if (error) backTo(returnTo, { error: "Could not assign referee." });
  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: videoId,
    action: "referee_assigned", new_value: { referee_user_id: refereeUserId }, actor_id: actorId,
  });
  await notifyVideoAssignment(supabase, videoId, refereeUserId);
  backTo(returnTo, { ok: "Referee assigned." });
}

export async function unassignRefereeFromVideo(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/judging");
  const { supabase, actorId } = await getActor();
  await requireAdmin(supabase, actorId, returnTo);
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
  await requireAdmin(supabase, actorId, returnTo);
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
  await requireAdmin(supabase, actorId, returnTo);

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

  const { data: referees } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("role", "referee")
    .eq("approved", true);
  const refereeIds = (referees ?? []).map((r) => r.user_id as string);
  if (refereeIds.length === 0) backTo(returnTo, { error: "No approved referees available yet." });

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

export interface AdminVideoUploadState {
  ok: boolean;
  error?: string;
}

/**
 * Admin-only backup path: attaches a recording to a registration on the
 * participant's behalf (e.g. their live-camera submission failed, or they
 * sent the organiser a video another way) — the file itself is uploaded
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

// ── Organizer / Customer Support account creation ───────────────────────────

const ROLE_LABEL: Record<string, string> = {
  organizer: "Admin / Organizer",
  customer_support: "Customer Support",
};

/**
 * Directly creates a real login (auth user + approved profile) for an
 * Organizer or Customer Support account — no self-signup or invitation code
 * involved. Gated server-side on the CALLER's own role (never on anything
 * the client submits): only Super Admin may create Organizer accounts;
 * Super Admin or an existing Organizer may create Customer Support accounts.
 */
export async function createStaffAccount(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const returnTo = role === "organizer" ? "/admin/organizers" : "/admin/support";
  if (!["organizer", "customer_support"].includes(role)) {
    backTo(returnTo, { error: "Invalid role." });
  }
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!full_name || !email) {
    backTo(returnTo, { error: "Full name and email are required." });
  }
  const extra = {
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

  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (role === "organizer" && actorRole !== "admin") {
    backTo(returnTo, { error: "Only the Super Admin can create Admin / Organizer accounts." });
  }
  if (role === "customer_support" && !["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Super Admin or Admin / Organizer can create Customer Support accounts." });
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
      "Sign in and keep this password safe — there is currently no self-service password reset, contact the organiser if you need it changed.",
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
  if (role === "customer_support" && !["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    return { done: false, error: "Only Super Admin or Admin / Organizer can bulk-create Customer Support accounts." };
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
        "Sign in and keep this password safe — there is currently no self-service password reset, contact the organiser if you need it changed.",
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
