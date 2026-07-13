"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { sendConfirmationEmail } from "@/lib/notify";

export interface DirectoryState {
  ok: boolean;
  error?: string;
  name?: string;
}

/** Public School / Dojo self-registration (anonymous insert allowed by RLS). */
export async function registerSchool(
  _prev: DirectoryState,
  formData: FormData,
): Promise<DirectoryState> {
  const name = String(formData.get("name") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const affiliation_code = String(formData.get("affiliation_code") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name) return { ok: false, error: "School / dojo name is required." };
  if (!email) return { ok: false, error: "Email address is required." };
  if (!phone) return { ok: false, error: "Mobile phone is required." };

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
    affiliation_code: affiliation_code || null,
    email,
    phone,
  });
  if (error) return { ok: false, error: "Could not register the school. Please try again." };

  await writeAudit(supabase, {
    table_name: "schools",
    record_id: id,
    action: "school_self_registered",
    new_value: { name, state, affiliation_code },
  });
  await sendConfirmationEmail({
    toEmail: email,
    recipientName: name,
    subject: `School / Dojo registered — ${name}`,
    telegramCategory: "school",
    bodyLines: [
      `"${name}" is now in the directory and can be selected on registration forms.`,
      "Next: register your Sensei / Coach, then register participants.",
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
  const school_id = String(formData.get("school_id") ?? "").trim();
  const registered_by = ["self", "student", "other"].includes(String(formData.get("registered_by")))
    ? String(formData.get("registered_by"))
    : "other";
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name) return { ok: false, error: "Sensei / coach name is required." };
  if (!school_id) return { ok: false, error: "Select the sensei's school / dojo." };
  if (!email) return { ok: false, error: "Email address is required." };
  if (!phone) return { ok: false, error: "Mobile phone is required." };

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

  const id = crypto.randomUUID();
  const { error } = await supabase.from("senseis").insert({
    id,
    name,
    rank: rank || null,
    school_id,
    registered_by,
    email,
    phone,
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
    ],
  });
  return { ok: true, name };
}
