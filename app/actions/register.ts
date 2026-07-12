"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import { resolveCategory } from "@/lib/division";
import type { Category } from "@/lib/types";

export interface RegisterState {
  ok: boolean;
  referenceId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const REQUIRED: Array<[string, string]> = [
  ["full_name", "Full name is required"],
  ["ic_passport", "IC / passport number is required"],
  ["date_of_birth", "Date of birth is required"],
  ["gender", "Gender is required"],
  ["belt_rank", "Belt rank is required"],
  ["email", "Email address is required"],
  ["phone", "Mobile phone is required"],
  ["home_address", "Home address is required"],
  ["home_country", "Home country is required"],
  ["city_town", "City / town is required"],
  ["school_id", "School is required"],
  ["kata_base", "Kata event is required"],
  ["sensei_id", "Coach / sensei is required"],
  ["bank_name", "Bank name is required"],
  ["bank_account_no", "Bank account number is required"],
  ["bank_account_name", "Bank account holder name is required"],
];

export async function submitRegistration(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const values: Record<string, string> = {};
  for (const [key] of REQUIRED) values[key] = String(formData.get(key) ?? "").trim();
  values.competition_id = String(formData.get("competition_id") ?? "").trim();
  values.payment_reference = String(formData.get("payment_reference") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  for (const [key, message] of REQUIRED) {
    if (!values[key]) fieldErrors[key] = message;
  }
  if (!values.competition_id) {
    return { ok: false, error: "No open competition to register for." };
  }
  if (values.date_of_birth && Number.isNaN(Date.parse(values.date_of_birth))) {
    fieldErrors.date_of_birth = "Enter a valid date of birth";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();

  // Deadline check (server-side; the form also hides itself when closed)
  const { data: competition, error: compErr } = await supabase
    .from("competitions")
    .select("id, name, status, event_date, registration_deadline, registration_fee_usd")
    .eq("id", values.competition_id)
    .maybeSingle();
  if (compErr || !competition) {
    return { ok: false, error: "Competition not found. Please refresh and try again." };
  }
  if (competition.status !== "open") {
    return { ok: false, error: "Registration is closed for this competition." };
  }
  if (
    competition.registration_deadline &&
    new Date(competition.registration_deadline + "T23:59:59") < new Date()
  ) {
    return { ok: false, error: "The registration deadline has passed." };
  }

  // Duplicate IC + competition check. Prefer the security-definer function
  // (works for anonymous visitors after the RLS lock-down); fall back to a
  // direct query under the v1 open policies where the function may not exist.
  const { data: dup, error: dupErr } = await supabase.rpc("ic_already_registered", {
    p_ic: values.ic_passport,
    p_competition: values.competition_id,
  });
  let isDuplicate = dup === true;
  if (dupErr) {
    const { data: existing } = await supabase
      .from("participants")
      .select("id, registrations!inner(id, competition_id)")
      .eq("ic_passport", values.ic_passport)
      .eq("registrations.competition_id", values.competition_id)
      .limit(1);
    isDuplicate = !!existing && existing.length > 0;
  }
  if (isDuplicate) {
    return {
      ok: false,
      error: "This IC / passport is already registered for this competition.",
      fieldErrors: { ic_passport: "Already registered for this competition" },
    };
  }

  // The registrant picks the kata; the belt (Color/Kyu vs Black Belt & Dan)
  // and age sub-categories are resolved from their belt rank + date of birth.
  const { data: catRows } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", values.competition_id)
    .order("sort_order");
  const resolved = resolveCategory(
    (catRows as Category[]) ?? [],
    values.kata_base,
    values.date_of_birth,
    values.belt_rank,
    competition.event_date,
  );
  if (!resolved.category) {
    return {
      ok: false,
      error: resolved.error ?? "No matching category for this kata / age / belt.",
      fieldErrors: { kata_base: resolved.error ?? "No matching category" },
    };
  }
  values.category_id = resolved.category.id;
  values.division = values.gender.toLowerCase() === "female" ? "Female" : "Male";

  // Latest belt/rank certificate: optional photo/scan, uploaded to private
  // storage before the registration is written (works for both the manual
  // flow and the pay-first flow, where only the path travels in the draft).
  const certificate = formData.get("certificate");
  values.certificate_path = "";
  if (certificate instanceof File && certificate.size > 0) {
    if (certificate.size > 10 * 1024 * 1024) {
      return {
        ok: false,
        error: "Certificate file is too large (max 10 MB).",
        fieldErrors: { certificate: "Max file size 10 MB" },
      };
    }
    const ext = (certificate.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("certificates")
      .upload(path, certificate, { contentType: certificate.type || "image/jpeg" });
    if (upErr) {
      return {
        ok: false,
        error: "Could not upload the certificate. Please try again or submit without it.",
        fieldErrors: { certificate: "Upload failed" },
      };
    }
    values.certificate_path = path;
  }
  values.rank_confirmation = values.certificate_path
    ? "certificate_uploaded"
    : "pending_confirmation";

  // ── Pay-before-submit: when the gateway is configured and the competition
  // has a fee, no registration row is written yet. The validated payload is
  // parked as a draft and the visitor is sent to Stripe Checkout; the webhook
  // or the success page finalises it as a paid registration.
  const fee = Number(competition.registration_fee_usd ?? 0);
  if (paymentsEnabled() && fee > 0) {
    const draftId = crypto.randomUUID();
    const { error: dErr } = await supabase.from("registration_drafts").insert({
      id: draftId,
      payload: values,
    });
    if (dErr) {
      return { ok: false, error: "Could not start the payment step. Please try again." };
    }

    const origin =
      (await headers()).get("origin") ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";
    let checkoutUrl: string | null = null;
    try {
      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: Math.round(fee * 100),
              product_data: {
                name: `Registration — ${competition.name}`,
                description: `Participant: ${values.full_name}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: { draft_id: draftId },
        success_url: `${origin}/register/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/register?cancelled=1`,
      });
      checkoutUrl = session.url;
    } catch {
      return {
        ok: false,
        error: "Payment gateway is unavailable right now. Please try again later.",
      };
    }
    if (!checkoutUrl) {
      return { ok: false, error: "Payment gateway did not return a checkout page. Please try again." };
    }
    redirect(checkoutUrl);
  }

  // ── Manual bank-transfer flow (gateway not configured or free entry) ──
  // Generate ids here — anonymous inserts can't SELECT their own rows back
  // under the locked-down RLS, so INSERT ... RETURNING would fail.
  const participantId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();

  const { error: pErr } = await supabase.from("participants").insert({
    id: participantId,
    full_name: values.full_name,
    ic_passport: values.ic_passport,
    date_of_birth: values.date_of_birth,
    gender: values.gender,
    belt_rank: values.belt_rank,
    email: values.email,
    phone: values.phone,
    home_address: values.home_address,
    home_country: values.home_country,
    city_town: values.city_town,
    certificate_path: values.certificate_path || null,
    rank_confirmation: values.rank_confirmation,
    school_id: values.school_id,
    sensei_id: values.sensei_id,
  });
  if (pErr) {
    return { ok: false, error: "Could not save participant. Please try again." };
  }

  const { error: bErr } = await supabase.from("participant_bank_details").insert({
    participant_id: participantId,
    bank_name: values.bank_name,
    bank_account_no: values.bank_account_no,
    bank_account_name: values.bank_account_name,
  });
  if (bErr) {
    await supabase.from("participants").delete().eq("id", participantId);
    return { ok: false, error: "Could not save bank details. Please try again." };
  }

  const { error: rErr } = await supabase.from("registrations").insert({
    id: registrationId,
    competition_id: values.competition_id,
    participant_id: participantId,
    category_id: values.category_id,
    division: values.division,
    payment_status: "pending",
    payment_reference: values.payment_reference || null,
  });
  if (rErr) {
    // roll back the orphan participant so a retry doesn't trip the duplicate check
    await supabase.from("participants").delete().eq("id", participantId);
    return { ok: false, error: "Could not save registration. Please try again." };
  }

  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: registrationId,
    action: "registration_submitted",
    new_value: {
      participant_id: participantId,
      category_id: values.category_id,
      payment_status: "pending",
    },
  });

  return {
    ok: true,
    referenceId: registrationId.slice(0, 8).toUpperCase(),
  };
}
