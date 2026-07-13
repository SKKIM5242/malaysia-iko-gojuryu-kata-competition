"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

export interface CommunityState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  referenceId?: string;
}

function req(formData: FormData, keys: Array<[string, string]>) {
  const values: Record<string, string> = {};
  const fieldErrors: Record<string, string> = {};
  for (const [key, label] of keys) {
    values[key] = String(formData.get(key) ?? "").trim();
    if (!values[key]) fieldErrors[key] = `${label} is required`;
  }
  return { values, fieldErrors };
}

/** Referee / judge registration — USD 100 deposit or USD 0 with invitation code. */
export async function registerReferee(
  _prev: CommunityState,
  formData: FormData,
): Promise<CommunityState> {
  const { values, fieldErrors } = req(formData, [
    ["full_name", "Full name"],
    ["ic_passport", "IC / passport"],
    ["date_of_birth", "Date of birth"],
    ["gender", "Gender"],
    ["karate_rank", "Karate rank"],
    ["judging_experience_count", "Number of times judging"],
    ["email", "Email"],
    ["phone", "Mobile / WhatsApp"],
    ["home_address", "Home address"],
    ["city_town", "City / town"],
    ["home_country", "Home country"],
    ["bank_name", "Bank name"],
    ["bank_account_no", "Bank account number"],
    ["bank_account_name", "Bank account holder name"],
  ]);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const judgingCount = Number(values.judging_experience_count);
  if (!Number.isInteger(judgingCount) || judgingCount < 0) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { judging_experience_count: "Enter a whole number (0 if none)" },
    };
  }
  const school = String(formData.get("school") ?? "").trim();
  const invitation_code = String(formData.get("invitation_code") ?? "").trim();

  const supabase = await createClient();

  // Latest rank certificate — required.
  const certificate = formData.get("certificate");
  if (!(certificate instanceof File) || certificate.size === 0) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { certificate: "Latest rank certificate is required" },
    };
  }
  if (certificate.size > 10 * 1024 * 1024) {
    return { ok: false, error: "Certificate file is too large (max 10 MB)." };
  }
  const ext = (certificate.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const certificate_path = `referee-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("certificates")
    .upload(certificate_path, certificate, { contentType: certificate.type || "image/jpeg" });
  if (upErr) return { ok: false, error: "Could not upload the certificate. Please try again." };

  // International certification records — optional, unlimited files.
  const internationalFiles = formData
    .getAll("international_certificates")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const international_certificate_paths: string[] = [];
  for (const file of internationalFiles) {
    if (file.size > 10 * 1024 * 1024) {
      return { ok: false, error: `"${file.name}" is too large (max 10 MB per file).` };
    }
    const fExt = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `referee-intl-${crypto.randomUUID()}.${fExt}`;
    const { error: intlErr } = await supabase.storage
      .from("certificates")
      .upload(path, file, { contentType: file.type || "image/jpeg" });
    if (intlErr) return { ok: false, error: `Could not upload "${file.name}". Please try again.` };
    international_certificate_paths.push(path);
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("referees").insert({
    id,
    full_name: values.full_name,
    ic_passport: values.ic_passport,
    date_of_birth: values.date_of_birth,
    gender: values.gender,
    karate_rank: values.karate_rank,
    judging_experience_count: judgingCount,
    school: school || null,
    email: values.email,
    phone: values.phone,
    home_address: values.home_address,
    city_town: values.city_town,
    home_country: values.home_country,
    bank_name: values.bank_name,
    bank_account_no: values.bank_account_no,
    bank_account_name: values.bank_account_name,
    certificate_path,
    international_certificate_paths,
    invitation_code: invitation_code || null,
    payment_status: "pending",
  });
  if (error) return { ok: false, error: "Could not save your registration. Please try again." };

  await writeAudit(supabase, {
    table_name: "referees",
    record_id: id,
    action: "referee_registered",
    new_value: { full_name: values.full_name, invitation_code: invitation_code || null },
  });
  return { ok: true, referenceId: id.slice(0, 8).toUpperCase() };
}

/** Audience / spectator sign-in — USD 10 or USD 0 with invitation code. */
export async function registerAudience(
  _prev: CommunityState,
  formData: FormData,
): Promise<CommunityState> {
  const { values, fieldErrors } = req(formData, [
    ["full_name", "Full name"],
    ["email", "Email"],
    ["home_country", "Home country"],
  ]);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const phone = String(formData.get("phone") ?? "").trim();
  const invitation_code = String(formData.get("invitation_code") ?? "").trim();

  const supabase = await createClient();
  const id = crypto.randomUUID();
  const { error } = await supabase.from("audiences").insert({
    id,
    full_name: values.full_name,
    email: values.email,
    phone: phone || null,
    home_country: values.home_country,
    invitation_code: invitation_code || null,
    payment_status: "pending",
  });
  if (error) return { ok: false, error: "Could not save your registration. Please try again." };

  await writeAudit(supabase, {
    table_name: "audiences",
    record_id: id,
    action: "audience_registered",
    new_value: { full_name: values.full_name },
  });
  return { ok: true, referenceId: id.slice(0, 8).toUpperCase() };
}

/** Admin / organizer / customer-support application (reviewed by the owner). */
export async function applyStaff(
  _prev: CommunityState,
  formData: FormData,
): Promise<CommunityState> {
  const { values, fieldErrors } = req(formData, [
    ["full_name", "Full name"],
    ["email", "Email"],
    ["phone", "Mobile / WhatsApp"],
    ["role_requested", "Role"],
  ]);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const message = String(formData.get("message") ?? "").trim();

  const supabase = await createClient();
  const id = crypto.randomUUID();
  const { error } = await supabase.from("staff_applications").insert({
    id,
    full_name: values.full_name,
    email: values.email,
    phone: values.phone,
    role_requested: values.role_requested,
    message: message || null,
  });
  if (error) return { ok: false, error: "Could not submit your application. Please try again." };

  await writeAudit(supabase, {
    table_name: "staff_applications",
    record_id: id,
    action: "staff_application_submitted",
    new_value: { full_name: values.full_name, role_requested: values.role_requested },
  });
  return { ok: true, referenceId: id.slice(0, 8).toUpperCase() };
}
