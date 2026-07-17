"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { sendConfirmationEmail } from "@/lib/notify";

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
    ["postcode", "Postcode"],
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

  let paymentStatus: "pending" | "waived" = "pending";
  if (invitation_code) {
    const { data: redeemed } = await supabase.rpc("redeem_invitation_code", {
      p_code: invitation_code,
      p_role: "referee",
      p_email: values.email,
    });
    if (redeemed === true) paymentStatus = "waived";
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
    postcode: values.postcode,
    home_country: values.home_country,
    bank_name: values.bank_name,
    bank_account_no: values.bank_account_no,
    bank_account_name: values.bank_account_name,
    certificate_path,
    international_certificate_paths,
    invitation_code: invitation_code || null,
    payment_status: paymentStatus,
  });
  if (error) return { ok: false, error: "Could not save your registration. Please try again." };

  await writeAudit(supabase, {
    table_name: "referees",
    record_id: id,
    action: "referee_registered",
    new_value: { full_name: values.full_name, invitation_code: invitation_code || null },
  });
  const referenceId = id.slice(0, 8).toUpperCase();
  await sendConfirmationEmail({
    toEmail: values.email,
    recipientName: values.full_name,
    subject: "Referee / Judge registration received",
    referenceId,
    telegramCategory: "referee",
    bodyLines: [
      "This confirms your Referee / Judge registration.",
      paymentStatus === "waived"
        ? "Your invitation code waived the USD 100 deposit — you're all set."
        : "The organiser will review your registration and contact you about the USD 100 deposit (or confirm your invitation code). Remember: the USD 100 is a deposit for participants — for non-participants it will be forfeited.",
    ],
  });
  return { ok: true, referenceId };
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

  let paymentStatus: "pending" | "waived" = "pending";
  if (invitation_code) {
    const { data: redeemed } = await supabase.rpc("redeem_invitation_code", {
      p_code: invitation_code,
      p_role: "audience",
      p_email: values.email,
    });
    if (redeemed === true) paymentStatus = "waived";
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("audiences").insert({
    id,
    full_name: values.full_name,
    email: values.email,
    phone: phone || null,
    home_country: values.home_country,
    invitation_code: invitation_code || null,
    payment_status: paymentStatus,
  });
  if (error) return { ok: false, error: "Could not save your registration. Please try again." };

  await writeAudit(supabase, {
    table_name: "audiences",
    record_id: id,
    action: "audience_registered",
    new_value: { full_name: values.full_name },
  });
  const referenceId = id.slice(0, 8).toUpperCase();
  await sendConfirmationEmail({
    toEmail: values.email,
    recipientName: values.full_name,
    subject: "Audience / Spectator registration received",
    referenceId,
    telegramCategory: "audience",
    bodyLines: [
      "This confirms your Audience / Spectator registration.",
      paymentStatus === "waived"
        ? "Your invitation code waived the USD 10 fee — you're all set."
        : "The organiser will confirm your USD 10 sign-in (or your invitation code) and share viewing access details.",
    ],
  });
  return { ok: true, referenceId };
}

/** Admin / organizer / customer-support application (reviewed by the owner).
 * Mirrors the Referee/Judge application's fields, except latest rank and
 * certificate upload are optional here (no deposit/reward context for this
 * role) — Message / experience is kept as its own field. */
export async function applyStaff(
  _prev: CommunityState,
  formData: FormData,
): Promise<CommunityState> {
  const { values, fieldErrors } = req(formData, [
    ["full_name", "Full name"],
    ["ic_passport", "IC / passport"],
    ["date_of_birth", "Date of birth"],
    ["gender", "Gender"],
    ["email", "Email"],
    ["phone", "Mobile / WhatsApp"],
    ["home_address", "Home address"],
    ["city_town", "City / town"],
    ["postcode", "Postcode"],
    ["home_country", "Home country"],
    ["bank_name", "Bank name"],
    ["bank_account_no", "Bank account number"],
    ["bank_account_name", "Bank account holder name"],
    ["role_requested", "Role"],
    ["highest_education", "Highest Education Attended"],
    ["languages_count", "Number of languages"],
  ]);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const karate_rank = String(formData.get("karate_rank") ?? "").trim();
  const school = String(formData.get("school") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const invitation_code = String(formData.get("invitation_code") ?? "").trim();
  const languages = formData.getAll("languages").map((l) => String(l)).filter(Boolean);
  const support_tier_1_id = String(formData.get("support_tier_1_id") ?? "").trim() || null;
  const support_tier_2_id = String(formData.get("support_tier_2_id") ?? "").trim() || null;
  const support_tier_3_id = String(formData.get("support_tier_3_id") ?? "").trim() || null;

  const supabase = await createClient();

  // Latest rank certificate — optional here, unlike the Referee/Judge form.
  let certificate_path: string | null = null;
  const certificate = formData.get("certificate");
  if (certificate instanceof File && certificate.size > 0) {
    if (certificate.size > 10 * 1024 * 1024) {
      return { ok: false, error: "Certificate file is too large (max 10 MB)." };
    }
    const ext = (certificate.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `staff-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("certificates")
      .upload(path, certificate, { contentType: certificate.type || "image/jpeg" });
    if (upErr) return { ok: false, error: "Could not upload the certificate. Please try again." };
    certificate_path = path;
  }

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
    const path = `staff-intl-${crypto.randomUUID()}.${fExt}`;
    const { error: intlErr } = await supabase.storage
      .from("certificates")
      .upload(path, file, { contentType: file.type || "image/jpeg" });
    if (intlErr) return { ok: false, error: `Could not upload "${file.name}". Please try again.` };
    international_certificate_paths.push(path);
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("staff_applications").insert({
    id,
    full_name: values.full_name,
    ic_passport: values.ic_passport,
    date_of_birth: values.date_of_birth,
    gender: values.gender,
    karate_rank: karate_rank || null,
    school: school || null,
    email: values.email,
    phone: values.phone,
    home_address: values.home_address,
    city_town: values.city_town,
    postcode: values.postcode,
    home_country: values.home_country,
    bank_name: values.bank_name,
    bank_account_no: values.bank_account_no,
    bank_account_name: values.bank_account_name,
    certificate_path,
    international_certificate_paths,
    invitation_code: invitation_code || null,
    role_requested: values.role_requested,
    message: message || null,
    highest_education: values.highest_education,
    languages_count: Number(values.languages_count),
    languages,
    support_tier_1_id,
    support_tier_2_id,
    support_tier_3_id,
  });
  if (error) return { ok: false, error: "Could not submit your application. Please try again." };

  await writeAudit(supabase, {
    table_name: "staff_applications",
    record_id: id,
    action: "staff_application_submitted",
    new_value: { full_name: values.full_name, role_requested: values.role_requested },
  });
  const referenceId = id.slice(0, 8).toUpperCase();
  await sendConfirmationEmail({
    toEmail: values.email,
    recipientName: values.full_name,
    subject: "Admin / Organizer / Customer Support application received",
    referenceId,
    telegramCategory: "staff",
    bodyLines: [
      `This confirms your application to join as Admin / Organizer / Customer Support (requested role: ${values.role_requested}).`,
      "The organiser will review your application and contact you.",
    ],
  });
  return { ok: true, referenceId };
}
