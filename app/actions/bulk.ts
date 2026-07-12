"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { computeDivision } from "@/lib/division";

export interface BulkRow {
  full_name: string;
  ic_passport: string;
  date_of_birth: string;
  gender: string;
  belt_rank: string;
  category_id: string;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
}

export interface BulkRowResult {
  row: number;
  name: string;
  ok: boolean;
  referenceId?: string;
  error?: string;
}

export interface BulkState {
  done: boolean;
  error?: string;
  results?: BulkRowResult[];
}

const ROW_REQUIRED: Array<[keyof BulkRow, string]> = [
  ["full_name", "full name"],
  ["ic_passport", "IC / passport"],
  ["date_of_birth", "date of birth"],
  ["gender", "gender"],
  ["belt_rank", "belt rank"],
  ["category_id", "category"],
  ["bank_name", "bank name"],
  ["bank_account_no", "bank account no."],
  ["bank_account_name", "bank account holder"],
];

export async function bulkRegister(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const competitionId = String(formData.get("competition_id") ?? "");
  const schoolId = String(formData.get("school_id") ?? "");
  const senseiId = String(formData.get("sensei_id") ?? "");
  let rows: BulkRow[];
  try {
    rows = JSON.parse(String(formData.get("rows_json") ?? "[]")) as BulkRow[];
  } catch {
    return { done: false, error: "Could not read the participant rows. Please try again." };
  }

  if (!competitionId) return { done: false, error: "No open competition to register for." };
  if (!schoolId || !senseiId) {
    return { done: false, error: "Select the school / dojo and sensei / coach at the top first." };
  }
  rows = rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
  if (rows.length === 0) return { done: false, error: "Add at least one participant row." };
  if (rows.length > 100) return { done: false, error: "Maximum 100 participants per bulk submission." };

  const supabase = await createClient();
  const { data: competition } = await supabase
    .from("competitions")
    .select("id, status, event_date, registration_deadline")
    .eq("id", competitionId)
    .maybeSingle();
  if (!competition || competition.status !== "open") {
    return { done: false, error: "Registration is closed for this competition." };
  }
  if (
    competition.registration_deadline &&
    new Date(competition.registration_deadline + "T23:59:59") < new Date()
  ) {
    return { done: false, error: "The registration deadline has passed." };
  }

  const results: BulkRowResult[] = [];
  const seenICs = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = row.full_name?.trim() || `Row ${i + 1}`;
    const missing = ROW_REQUIRED.filter(([k]) => !String(row[k] ?? "").trim()).map(([, l]) => l);
    if (missing.length > 0) {
      results.push({ row: i + 1, name: label, ok: false, error: `Missing: ${missing.join(", ")}` });
      continue;
    }
    const ic = row.ic_passport.trim();
    if (seenICs.has(ic)) {
      results.push({ row: i + 1, name: label, ok: false, error: "Duplicate IC within this list" });
      continue;
    }
    seenICs.add(ic);
    if (Number.isNaN(Date.parse(row.date_of_birth))) {
      results.push({ row: i + 1, name: label, ok: false, error: "Invalid date of birth" });
      continue;
    }

    const { data: dup } = await supabase.rpc("ic_already_registered", {
      p_ic: ic,
      p_competition: competitionId,
    });
    if (dup === true) {
      results.push({ row: i + 1, name: label, ok: false, error: "Already registered for this competition" });
      continue;
    }

    const participantId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();

    const { error: pErr } = await supabase.from("participants").insert({
      id: participantId,
      full_name: row.full_name.trim(),
      ic_passport: ic,
      date_of_birth: row.date_of_birth,
      gender: row.gender,
      belt_rank: row.belt_rank.trim(),
      school_id: schoolId,
      sensei_id: senseiId,
    });
    if (pErr) {
      results.push({ row: i + 1, name: label, ok: false, error: "Could not save participant" });
      continue;
    }
    await supabase.from("participant_bank_details").insert({
      participant_id: participantId,
      bank_name: row.bank_name.trim(),
      bank_account_no: row.bank_account_no.trim(),
      bank_account_name: row.bank_account_name.trim(),
    });
    const { error: rErr } = await supabase.from("registrations").insert({
      id: registrationId,
      competition_id: competitionId,
      participant_id: participantId,
      category_id: row.category_id,
      division: computeDivision(row.date_of_birth, row.belt_rank, row.gender, competition.event_date),
      payment_status: "pending",
    });
    if (rErr) {
      await supabase.from("participants").delete().eq("id", participantId);
      results.push({ row: i + 1, name: label, ok: false, error: "Could not save registration" });
      continue;
    }
    await writeAudit(supabase, {
      table_name: "registrations",
      record_id: registrationId,
      action: "bulk_registration_submitted",
      new_value: { participant_id: participantId, category_id: row.category_id, sensei_id: senseiId },
    });
    results.push({ row: i + 1, name: label, ok: true, referenceId: registrationId.slice(0, 8).toUpperCase() });
  }

  return { done: true, results };
}
