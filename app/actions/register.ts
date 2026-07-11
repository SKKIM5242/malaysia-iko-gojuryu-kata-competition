"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

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
  ["school_id", "School is required"],
  ["category_id", "Category is required"],
  ["sensei_id", "Coach / sensei is required"],
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
    .select("id, status, registration_deadline")
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
    school_id: values.school_id,
    sensei_id: values.sensei_id,
  });
  if (pErr) {
    return { ok: false, error: "Could not save participant. Please try again." };
  }

  const { error: rErr } = await supabase.from("registrations").insert({
    id: registrationId,
    competition_id: values.competition_id,
    participant_id: participantId,
    category_id: values.category_id,
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
