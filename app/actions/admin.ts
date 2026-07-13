"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { kataBaseOf } from "@/lib/division";
import type { PaymentStatus } from "@/lib/types";

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
  if (id) {
    const { data: before } = await supabase
      .from("announcements").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from("announcements").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update announcement." });
    await writeAudit(supabase, {
      table_name: "announcements", record_id: id, action: "announcement_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("announcements").insert(values).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create announcement." });
    await writeAudit(supabase, {
      table_name: "announcements", record_id: data!.id, action: "announcement_created",
      new_value: values, actor_id: actorId,
    });
  }
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: "Announcement saved." });
}

export async function toggleAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const publish = formData.get("publish") === "true";
  const returnTo = "/admin/announcements";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase
    .from("announcements").update({ published: publish }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not change publish state." });
  await writeAudit(supabase, {
    table_name: "announcements", record_id: id,
    action: publish ? "announcement_published" : "announcement_unpublished",
    new_value: { published: publish }, actor_id: actorId,
  });
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

// ── Schools ──────────────────────────────────────────────────────────────────

export async function saveSchool(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/schools";
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    state: String(formData.get("state") ?? "").trim() || null,
    affiliation_code: String(formData.get("affiliation_code") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
  };
  if (!values.name) backTo(returnTo, { error: "School name is required." });
  const { supabase, actorId } = await getActor();
  if (!id) {
    const { data: dup } = await supabase
      .from("schools").select("id").ilike("name", values.name).limit(1);
    if (dup && dup.length > 0) {
      backTo(returnTo, { error: "A school with this name already exists." });
    }
  }
  if (id) {
    const { error } = await supabase.from("schools").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update school." });
    await writeAudit(supabase, {
      table_name: "schools", record_id: id, action: "school_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase.from("schools").insert(values).select("id").single();
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
    rank: String(formData.get("rank") ?? "").trim() || null,
    school_id: String(formData.get("school_id") ?? "") || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
  };
  if (!values.name) backTo(returnTo, { error: "Sensei name is required." });
  const { supabase, actorId } = await getActor();

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "sensei", returnTo);

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
  const returnTo = "/admin/community";
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
  const returnTo = "/admin/community";
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
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: String(formData.get("bank_account_no") ?? "").trim() || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
  };
  if (!values.full_name || !values.ic_passport) {
    backTo(returnTo, { error: "Name and IC/passport are required." });
  }
  const { supabase, actorId } = await getActor();

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "referee", returnTo);

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
  const returnTo = "/admin/community";
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
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    school_id: String(formData.get("school_id") ?? "") || null,
    sensei_id: String(formData.get("sensei_id") ?? "") || null,
  };
  if (!values.full_name || !values.ic_passport) {
    backTo(returnTo, { error: "Name and IC/passport are required." });
  }
  const bank = {
    bank_name: String(formData.get("bank_name") ?? "").trim(),
    bank_account_no: String(formData.get("bank_account_no") ?? "").trim(),
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim(),
  };
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
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const role = String(formData.get("role") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();
  const returnTo = "/admin/accounts";
  if (!code || !["referee", "staff", "any"].includes(role)) {
    backTo(returnTo, { error: "Code and a valid role are required." });
  }
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
  backTo(returnTo, { ok: "Invitation code created." });
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

export async function assignRefereeToVideo(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = "/admin/accounts";
  if (!videoId || !refereeUserId) backTo(returnTo, { error: "Select a video and a referee." });
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.rpc("assign_referee", { p_video: videoId, p_referee: refereeUserId });
  if (error) backTo(returnTo, { error: "Could not assign referee." });
  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: videoId,
    action: "referee_assigned", new_value: { referee_user_id: refereeUserId }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Referee assigned." });
}

export async function unassignRefereeFromVideo(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = "/admin/accounts";
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.rpc("unassign_referee", { p_video: videoId, p_referee: refereeUserId });
  if (error) backTo(returnTo, { error: "Could not remove referee." });
  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: videoId,
    action: "referee_unassigned", new_value: { referee_user_id: refereeUserId }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Referee removed." });
}
