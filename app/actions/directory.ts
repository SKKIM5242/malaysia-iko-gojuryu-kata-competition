"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { sendConfirmationEmail } from "@/lib/notify";

export interface DirectoryState {
  ok: boolean;
  error?: string;
  name?: string;
  fieldErrors?: Record<string, string>;
}

/** Public School / Dojo self-registration (anonymous insert allowed by RLS). */
export async function registerSchool(
  _prev: DirectoryState,
  formData: FormData,
): Promise<DirectoryState> {
  const name = String(formData.get("name") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const contact_title = String(formData.get("contact_title") ?? "").trim();
  const contact_name = String(formData.get("contact_name") ?? "").trim();
  const contact_karate_title = String(formData.get("contact_karate_title") ?? "").trim();
  const contact_rank = String(formData.get("contact_rank") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const home_address = String(formData.get("home_address") ?? "").trim();
  const city_town = String(formData.get("city_town") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const home_country = String(formData.get("home_country") ?? "").trim();
  if (!name) return { ok: false, error: "School / dojo name is required." };
  if (!contact_title || !["Mr.", "Ms."].includes(contact_title)) {
    return { ok: false, error: "Person in-charge's title is required." };
  }
  if (!contact_name) return { ok: false, error: "Person in-charge's name is required." };
  if (!contact_karate_title) return { ok: false, error: "Person in-charge's karate title is required." };
  if (!contact_rank) return { ok: false, error: "Person in-charge's rank in karate-do is required." };
  if (!email) return { ok: false, error: "Email address is required." };
  if (!phone) return { ok: false, error: "Mobile phone is required." };
  if (!home_address) return { ok: false, error: "Home address is required." };
  if (!city_town) return { ok: false, error: "City / Town is required." };
  if (!postcode) return { ok: false, error: "Postcode is required." };
  if (!home_country) return { ok: false, error: "Home country is required." };
  const gender = contact_title === "Mr." ? "male" : "female";

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("schools")
    .select("id")
    .ilike("name", name)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: "A school with this name is already registered." };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("schools").insert({
    id,
    name,
    state: state || null,
    contact_title,
    contact_name,
    contact_karate_title,
    contact_rank,
    gender,
    email,
    phone,
    home_address,
    city_town,
    postcode,
    home_country,
  });
  if (error) return { ok: false, error: "Could not register the school. Please try again." };

  await writeAudit(supabase, {
    table_name: "schools",
    record_id: id,
    action: "school_self_registered",
    new_value: { name, state, contact_title, contact_name, contact_karate_title, contact_rank },
  });
  await sendConfirmationEmail({
    toEmail: email,
    recipientName: name,
    subject: `School / Dojo registered — ${name}`,
    telegramCategory: "school",
    bodyLines: [
      `"${name}" is now in the directory and can be selected on registration forms.`,
      "Next: register your Sensei / Coach, then register participants.",
      "",
      "One more step: ask the organiser for a personal invitation code for this record, then " +
        "sign in via Kata Arena Log In. A USD 10 registration fee unlocks unlimited sign-in to " +
        "watch your own students' kata recordings and judge scores any time — 10 or more " +
        "participants qualifies you for a 10% share of their registration fees.",
    ],
  });
  return { ok: true, name };
}

/** Public Sensei / Coach self-registration (anonymous insert allowed by RLS). */
export async function registerSensei(
  _prev: DirectoryState,
  formData: FormData,
): Promise<DirectoryState> {
  const name = String(formData.get("name") ?? "").trim();
  const rank = String(formData.get("rank") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const school_id = String(formData.get("school_id") ?? "").trim();
  const registered_by = ["self", "student", "other"].includes(String(formData.get("registered_by")))
    ? String(formData.get("registered_by"))
    : "other";
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const home_address = String(formData.get("home_address") ?? "").trim();
  const city_town = String(formData.get("city_town") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const home_country = String(formData.get("home_country") ?? "").trim();
  if (!name) return { ok: false, error: "Sensei / coach name is required." };
  if (!rank) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { rank: "Latest rank is required" },
    };
  }
  if (!["male", "female"].includes(gender)) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { gender: "Sex is required" },
    };
  }
  if (!school_id) return { ok: false, error: "Select the sensei's school / dojo." };
  if (!email) return { ok: false, error: "Email address is required." };
  if (!phone) return { ok: false, error: "Mobile phone is required." };
  if (!home_address) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { home_address: "Home address is required" },
    };
  }
  if (!city_town) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { city_town: "City / Town is required" },
    };
  }
  if (!postcode) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { postcode: "Postcode is required" },
    };
  }
  if (!home_country) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { home_country: "Home country is required" },
    };
  }

  const certificate = formData.get("certificate");
  if (!(certificate instanceof File) || certificate.size === 0) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { certificate: "Latest rank certificate is required" },
    };
  }
  if (certificate.size > 10 * 1024 * 1024) {
    return {
      ok: false,
      error: "Certificate file is too large (max 10 MB).",
      fieldErrors: { certificate: "Max file size 10 MB" },
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("senseis")
    .select("id")
    .ilike("name", name)
    .eq("school_id", school_id)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: "This sensei is already registered for that school." };
  }

  const ext = (certificate.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const certificate_path = `sensei-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("certificates")
    .upload(certificate_path, certificate, { contentType: certificate.type || "image/jpeg" });
  if (upErr) return { ok: false, error: "Could not upload the certificate. Please try again." };

  const id = crypto.randomUUID();
  const { error } = await supabase.from("senseis").insert({
    id,
    name,
    rank,
    gender,
    school_id,
    registered_by,
    email,
    phone,
    certificate_path,
    home_address,
    city_town,
    postcode,
    home_country,
  });
  if (error) return { ok: false, error: "Could not register the sensei. Please try again." };

  await writeAudit(supabase, {
    table_name: "senseis",
    record_id: id,
    action: "sensei_self_registered",
    new_value: { name, rank, school_id },
  });
  await sendConfirmationEmail({
    toEmail: email,
    recipientName: name,
    subject: `Sensei / Coach registered — ${name}`,
    telegramCategory: "school",
    bodyLines: [
      `"${name}" is now in the directory.`,
      "Next: register participants or bulk-register your students.",
      "",
      "One more step: ask the organiser for a personal invitation code for this record, then " +
        "sign in via Kata Arena Log In. A USD 10 registration fee unlocks unlimited sign-in to " +
        "watch your own students' kata recordings and judge scores any time — 10 or more " +
        "participants qualifies you for a 10% share of their registration fees.",
    ],
  });
  return { ok: true, name };
}
