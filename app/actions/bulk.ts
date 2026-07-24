"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { resolveCategory, ageAt } from "@/lib/division";
import { parseCsv } from "@/lib/csv";
import { parseDDMMYYYY } from "@/lib/csv-bulk";
import { normalizeIban } from "@/lib/bank";
import { sendConfirmationEmail, sendConfirmationEmailBatch, type ConfirmationEmailInput } from "@/lib/notify";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import { formatUSD } from "@/components/ui";
import type { Category } from "@/lib/types";

export interface BulkRow {
  full_name: string;
  ic_passport: string;
  date_of_birth: string;
  gender: string;
  belt_rank: string;
  rank_confirmation: string;
  email: string;
  phone: string;
  home_address: string;
  city_town: string;
  home_country: string;
  kata_base: string;
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
  ["rank_confirmation", "rank confirmation"],
  ["email", "email"],
  ["phone", "mobile phone"],
  ["home_address", "home address"],
  ["city_town", "city/town"],
  ["home_country", "home country"],
  ["kata_base", "kata event"],
  ["bank_name", "bank name"],
  ["bank_account_no", "International Bank Account No. (IBAN)"],
  ["bank_account_name", "bank account holder"],
];

export interface BulkTierState {
  competitionId: string;
  competitionName: string;
  status: "pending" | "paid";
  paymentId: string;
  amountUsd: number;
  participants: number;
  events: number;
}

export interface BulkBatchState {
  done: boolean;
  error?: string;
  batchId?: string;
  totalAmountUsd?: number;
  tiers?: BulkTierState[];
}

interface ExistingBulkRow {
  id: string;
  batch_id: string | null;
  competition_id: string;
  participant_count: number;
  declared_participants: number;
  amount_usd: number;
  status: "pending" | "paid" | "consumed";
}

/** One popup enquiry covers all 3 competition tiers at once: for each
 * tier the Sensei intends to use, they give a participant headcount AND a
 * total event count (fee scales by events — same up-to-3-per-participant
 * rule as individual registration — so 5 participants each taking 2
 * events pay for 10 events). Creates one bulk_upload_payments row per
 * tier entered, sharing a batch_id, and returns one combined bill; the
 * organizer confirms the whole batch at once via markBulkUploadBatchPaid.
 * Re-submitting the same (or smaller) numbers reuses the existing batch
 * instead of billing twice. */
export async function requestBulkUploadBatch(
  _prev: BulkBatchState,
  formData: FormData,
): Promise<BulkBatchState> {
  const schoolId = String(formData.get("school_id") ?? "");
  const senseiId = String(formData.get("sensei_id") ?? "");
  if (!schoolId || !senseiId) {
    return { done: false, error: "Select the school / dojo and sensei / coach first." };
  }

  const tierInputs = [1, 2, 3]
    .map((n) => ({
      competitionId: String(formData.get(`competition_${n}_id`) ?? ""),
      participants: Number(formData.get(`participants_${n}`) ?? 0),
      events: Number(formData.get(`events_${n}`) ?? 0),
    }))
    .filter((t) => t.competitionId && (t.participants > 0 || t.events > 0));

  if (tierInputs.length === 0) {
    return { done: false, error: "Enter a participant count and total event count for at least one tier." };
  }
  for (const t of tierInputs) {
    if (!Number.isInteger(t.participants) || t.participants < 1) {
      return { done: false, error: "Each tier's participant count must be a whole number of at least 1." };
    }
    if (!Number.isInteger(t.events) || t.events < t.participants) {
      return {
        done: false,
        error: "Each tier's total events must be at least its participant count — every participant takes at least 1 event.",
      };
    }
  }

  const supabase = await createClient();
  const competitionIds = tierInputs.map((t) => t.competitionId);
  const { data: competitions } = await supabase
    .from("competitions")
    .select("id, name, registration_fee_usd")
    .in("id", competitionIds);
  const compById = new Map((competitions ?? []).map((c) => [c.id as string, c]));
  if (compById.size !== new Set(competitionIds).size) {
    return { done: false, error: "One of the selected competitions was not found." };
  }

  // Reuse an already-requested batch with matching (or greater) numbers for
  // every one of its tiers — same dedupe courtesy as before, just extended
  // to a whole batch instead of a single tier.
  const { data: existingRows } = await supabase
    .from("bulk_upload_payments")
    .select("id, batch_id, competition_id, participant_count, declared_participants, amount_usd, status")
    .eq("school_id", schoolId)
    .eq("sensei_id", senseiId)
    .not("batch_id", "is", null);
  const byBatch = new Map<string, ExistingBulkRow[]>();
  for (const row of (existingRows ?? []) as ExistingBulkRow[]) {
    const list = byBatch.get(row.batch_id!) ?? [];
    list.push(row);
    byBatch.set(row.batch_id!, list);
  }
  for (const [batchId, rows] of byBatch) {
    if (rows.length !== tierInputs.length) continue;
    const allMatch = tierInputs.every((t) =>
      rows.some(
        (r) =>
          r.competition_id === t.competitionId &&
          r.declared_participants >= t.participants &&
          r.participant_count >= t.events,
      ),
    );
    if (!allMatch) continue;
    const allPaid = rows.every((r) => r.status === "paid" || r.status === "consumed");
    const allPending = rows.every((r) => r.status === "pending");
    if (!allPaid && !allPending) continue;
    return {
      done: true,
      batchId,
      totalAmountUsd: rows.reduce((sum, r) => sum + Number(r.amount_usd), 0),
      tiers: rows.map((r) => ({
        competitionId: r.competition_id,
        competitionName: compById.get(r.competition_id)?.name ?? "",
        status: allPaid ? "paid" : "pending",
        paymentId: r.id,
        amountUsd: Number(r.amount_usd),
        participants: r.declared_participants,
        events: r.participant_count,
      })),
    };
  }

  const batchId = crypto.randomUUID();
  const created: BulkTierState[] = [];
  for (const t of tierInputs) {
    const comp = compById.get(t.competitionId)!;
    const amountUsd = t.events * Number(comp.registration_fee_usd ?? 0);
    const { data: row, error } = await supabase
      .from("bulk_upload_payments")
      .insert({
        batch_id: batchId,
        competition_id: t.competitionId,
        school_id: schoolId,
        sensei_id: senseiId,
        participant_count: t.events,
        declared_participants: t.participants,
        amount_usd: amountUsd,
      })
      .select("id")
      .single();
    if (error || !row) return { done: false, error: "Could not create the payment request. Please try again." };
    created.push({
      competitionId: t.competitionId,
      competitionName: comp.name,
      status: "pending",
      paymentId: row.id,
      amountUsd,
      participants: t.participants,
      events: t.events,
    });
  }

  const totalAmountUsd = created.reduce((sum, t) => sum + t.amountUsd, 0);

  const { data: senseiRow } = await supabase.from("senseis").select("name, email").eq("id", senseiId).maybeSingle();
  if (senseiRow?.email) {
    await sendConfirmationEmail({
      toEmail: senseiRow.email,
      recipientName: senseiRow.name ?? "Sensei",
      subject: `Bulk registration quotation — batch ${batchId.slice(0, 8).toUpperCase()}`,
      bodyLines: [
        "Here is your quotation for bulk registration:",
        ...created.map(
          (t) => `${t.competitionName}: ${t.participants} participant${t.participants === 1 ? "" : "s"}, ${t.events} event${t.events === 1 ? "" : "s"} — ${formatUSD(t.amountUsd)}`,
        ),
        `Combined total due: ${formatUSD(totalAmountUsd)}.`,
        `Batch reference: ${batchId.slice(0, 8).toUpperCase()}.`,
        "Pay online via the Bulk Registration page — the upload unlocks the moment payment succeeds.",
        "Note: this batch reference is only for payment/upload tracking. Each participant gets their own individual Reference ID once uploaded — that is what they use with their IC/passport to sign in and record their kata.",
      ],
    });
  }

  return {
    done: true,
    batchId,
    totalAmountUsd,
    tiers: created,
  };
}

export interface BulkCheckoutState {
  ok: boolean;
  error?: string;
  checkoutUrl?: string;
}

/** Creates a Stripe Checkout session for a pending bulk-registration
 * batch's combined total, tagged with the batch id so
 * finalizeBulkUploadBatchSession (via the webhook or the /pay/thanks page)
 * can mark every tier in the batch paid at once. Falls back to an error
 * telling the sensei to contact the organizer if Stripe isn't configured —
 * same manual-confirmation safety net as every other payment here. */
export async function createBulkUploadCheckout(
  _prev: BulkCheckoutState,
  formData: FormData,
): Promise<BulkCheckoutState> {
  const batchId = String(formData.get("batch_id") ?? "");
  if (!batchId) return { ok: false, error: "Missing batch reference — please submit the enquiry again." };

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("bulk_upload_payments")
    .select("id, amount_usd, status")
    .eq("batch_id", batchId);
  if (!rows || rows.length === 0) {
    return { ok: false, error: "Batch not found — please submit the enquiry again." };
  }
  if (rows.some((r) => r.status !== "pending")) {
    return { ok: false, error: "This batch is no longer awaiting payment — refresh the page." };
  }
  if (!paymentsEnabled()) {
    return { ok: false, error: "Online payment isn't available right now — contact the organizer to arrange payment." };
  }

  const totalAmountUsd = rows.reduce((sum, r) => sum + Number(r.amount_usd), 0);
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(totalAmountUsd * 100),
            product_data: {
              name: `Bulk registration — ${rows.length} competition tier${rows.length === 1 ? "" : "s"}`,
              description: `Batch reference ${batchId.slice(0, 8).toUpperCase()}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: { bulk_batch_id: batchId },
      success_url: `${origin}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/register/bulk?cancelled=1`,
    });
    if (session.url) return { ok: true, checkoutUrl: session.url };
    return { ok: false, error: "Could not start checkout — please try again." };
  } catch {
    return { ok: false, error: "Could not start checkout — please try again." };
  }
}

/** How many of this school+sensei's participants already registered for
 * this competition are NOT in `incomingIcs` — i.e. distinct headcount
 * already spent, so a new upload only needs to cover the gap between that
 * and the tier's declared_participants cap. */
async function countExistingParticipantIcs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  schoolId: string,
  senseiId: string,
  competitionId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("participants")
    .select("ic_passport, registrations!inner(competition_id)")
    .eq("school_id", schoolId)
    .eq("sensei_id", senseiId)
    .eq("registrations.competition_id", competitionId);
  return new Set((data ?? []).map((p) => p.ic_passport as string));
}

/** Rejects an upload if it would push this tier's distinct participant
 * headcount past what was declared (and paid for) in the enquiry popup —
 * independent of the separate event-count cap already enforced via
 * consume_bulk_upload_payment. A participant re-appearing across rows (a
 * 2nd/3rd event) or already registered from an earlier upload doesn't
 * count twice. */
async function enforceHeadcountCap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  schoolId: string,
  senseiId: string,
  competitionId: string,
  declaredParticipants: number,
  incomingIcs: string[],
): Promise<string | null> {
  const existingIcs = await countExistingParticipantIcs(supabase, schoolId, senseiId, competitionId);
  const newIcs = new Set(incomingIcs.filter((ic) => !existingIcs.has(ic)));
  const totalAfter = existingIcs.size + newIcs.size;
  if (totalAfter > declaredParticipants) {
    return `This upload would bring this tier's total participants to ${totalAfter}, exceeding the ${declaredParticipants} you declared and paid for. Reduce the number of new participants, or request a higher headcount first.`;
  }
  return null;
}

/** Sends the sensei one summary email with every participant's Reference
 * ID after a successful paid batch — each participant also gets their own
 * confirmation separately, same as single registration. */
async function sendSenseiSummaryEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  senseiId: string,
  competitionName: string,
  entries: Array<{ name: string; referenceId: string }>,
) {
  if (entries.length === 0) return;
  const { data: sensei } = await supabase.from("senseis").select("name, email").eq("id", senseiId).maybeSingle();
  if (!sensei?.email) return;
  await sendConfirmationEmail({
    toEmail: sensei.email,
    recipientName: sensei.name ?? "Sensei",
    subject: `Bulk registration confirmed — ${entries.length} participants — ${competitionName}`,
    bodyLines: [
      `Your paid bulk registration for ${competitionName} is complete. Each participant's Reference ID:`,
      ...entries.map((e) => `${e.name}: ${e.referenceId}`),
      "",
      "Please share each participant's Reference ID with them — they'll need it (with their IC/passport) to sign in and record their kata.",
    ],
  });
}

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
    .select("id, name, status, event_date, registration_deadline")
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

  // Never trust a client-supplied payment id — look up (and later consume)
  // a matching paid, sufficient-balance payment server-side.
  const { data: payment } = await supabase
    .from("bulk_upload_payments")
    .select("id, participant_count, declared_participants")
    .eq("competition_id", competitionId)
    .eq("school_id", schoolId)
    .eq("sensei_id", senseiId)
    .eq("status", "paid")
    .gte("participant_count", rows.length)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!payment) {
    return {
      done: false,
      error: "Pay for this batch first — request and pay for your bulk registration above, then come back here.",
    };
  }
  const headcountError = await enforceHeadcountCap(
    supabase, schoolId, senseiId, competitionId, payment.declared_participants,
    rows.map((r) => r.ic_passport.trim()),
  );
  if (headcountError) return { done: false, error: headcountError };

  const { data: catRows } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId)
    .order("sort_order");
  const categories = (catRows as Category[]) ?? [];

  const results: BulkRowResult[] = [];
  const confirmationEmails: ConfirmationEmailInput[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = row.full_name?.trim() || `Row ${i + 1}`;
    const missing = ROW_REQUIRED.filter(([k]) => !String(row[k] ?? "").trim()).map(([, l]) => l);
    if (missing.length > 0) {
      results.push({ row: i + 1, name: label, ok: false, error: `Missing: ${missing.join(", ")}` });
      continue;
    }
    const ic = row.ic_passport.trim();
    if (Number.isNaN(Date.parse(row.date_of_birth))) {
      results.push({ row: i + 1, name: label, ok: false, error: "Invalid date of birth" });
      continue;
    }

    // A student may compete in at most 3 kata events, and never the same
    // kata twice. Checked live against the DB, so rows for the same student
    // earlier in this same sheet already count (they're inserted first).
    const { data: alreadyHasKata } = await supabase.rpc("ic_has_kata", {
      p_ic: ic,
      p_competition: competitionId,
      p_kata_base: row.kata_base,
    });
    if (alreadyHasKata === true) {
      results.push({ row: i + 1, name: label, ok: false, error: "Already registered for this kata" });
      continue;
    }
    const { data: kataCount } = await supabase.rpc("ic_registration_count", {
      p_ic: ic,
      p_competition: competitionId,
    });
    if (typeof kataCount === "number" && kataCount >= 3) {
      results.push({ row: i + 1, name: label, ok: false, error: "Maximum Kata allow to compete is 3 only" });
      continue;
    }

    const resolved = resolveCategory(
      categories,
      row.kata_base,
      row.date_of_birth,
      row.belt_rank,
      row.gender,
      competition.event_date,
    );
    if (!resolved.category) {
      results.push({ row: i + 1, name: label, ok: false, error: resolved.error ?? "No matching category" });
      continue;
    }
    if (resolved.category.max_participants != null) {
      const { data: categoryPaid } = await supabase.rpc("category_paid_count", {
        p_category: resolved.category.id,
      });
      if (typeof categoryPaid === "number" && categoryPaid >= resolved.category.max_participants) {
        results.push({ row: i + 1, name: label, ok: false, error: "This sub-category is full" });
        continue;
      }
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
      rank_confirmation:
        row.rank_confirmation === "sensei_confirmed" ? "sensei_confirmed" : "pending_confirmation",
      email: row.email.trim(),
      phone: row.phone.trim(),
      home_address: row.home_address.trim(),
      city_town: row.city_town.trim(),
      home_country: row.home_country.trim(),
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
      bank_account_no: normalizeIban(row.bank_account_no),
      bank_account_name: row.bank_account_name.trim(),
    });
    const { error: rErr } = await supabase.from("registrations").insert({
      id: registrationId,
      competition_id: competitionId,
      participant_id: participantId,
      category_id: resolved.category.id,
      division: row.gender.toLowerCase() === "female" ? "Female" : "Male",
      // Already paid upfront via the bulk-upload payment gate — unlike
      // single registration, there's no separate per-participant payment
      // step for the organizer to confirm later.
      payment_status: "paid",
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
      new_value: { participant_id: participantId, category_id: resolved.category.id, sensei_id: senseiId },
    });
    const referenceId = registrationId.slice(0, 8).toUpperCase();
    results.push({ row: i + 1, name: label, ok: true, referenceId });
    confirmationEmails.push({
      toEmail: row.email.trim(),
      recipientName: row.full_name.trim(),
      subject: `Registration confirmed — ${competition.name}`,
      referenceId,
      telegramCategory: "participant",
      bodyLines: [
        `This confirms your registration for ${competition.name} (${row.kata_base}), submitted via bulk registration.`,
        "Your registration fee has already been paid by your school/sensei — no further payment is needed from you.",
      ],
    });
  }

  await sendConfirmationEmailBatch(confirmationEmails);
  await supabase.rpc("consume_bulk_upload_payment", { p_id: payment.id, p_rows_uploaded: results.filter((r) => r.ok).length });
  await sendSenseiSummaryEmail(
    supabase,
    senseiId,
    competition.name,
    results.filter((r): r is BulkRowResult & { referenceId: string } => r.ok && !!r.referenceId).map((r) => ({ name: r.name, referenceId: r.referenceId })),
  );

  return { done: true, results };
}

// ── CSV bulk upload (up to 10,000 participants) ─────────────────────────────

const CSV_COLUMNS = [
  "full_name", "ic_passport", "date_of_birth", "age", "gender", "belt_rank",
  "rank_confirmation", "email", "phone", "home_address", "city_town",
  "home_country", "dojo_name", "sensei_name", "competition_tier", "kata_event",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export interface CsvBulkState {
  done: boolean;
  error?: string;
  registered?: number;
  failed?: number;
  failures?: Array<{ row: number; name: string; error: string }>;
}

const CHUNK = 250;
const MAX_ROWS = 10000;

export async function bulkRegisterCsv(_prev: CsvBulkState, formData: FormData): Promise<CsvBulkState> {
  const competitionId = String(formData.get("competition_id") ?? "");
  const schoolId = String(formData.get("school_id") ?? "");
  const senseiId = String(formData.get("sensei_id") ?? "");
  const file = formData.get("csv_file");
  if (!competitionId) return { done: false, error: "No open competition to register for." };
  if (!schoolId || !senseiId) {
    return { done: false, error: "Select the school / dojo and sensei / coach first." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { done: false, error: "Choose a CSV file to upload." };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { done: false, error: "CSV file too large (max 8 MB)." };
  }

  const rows = parseCsv(await file.text());
  if (rows.length < 2) return { done: false, error: "The CSV has no data rows." };

  // Header mapping (case/space tolerant)
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s/-]+/g, "_"));
  const colIndex = new Map<string, number>();
  for (const col of CSV_COLUMNS) {
    const idx = header.indexOf(col === "kata_event" ? "kata_event" : col);
    colIndex.set(col, idx);
  }
  const missingCols = CSV_COLUMNS.filter((c) => (colIndex.get(c) ?? -1) === -1);
  if (missingCols.length > 0) {
    return {
      done: false,
      error: `CSV is missing columns: ${missingCols.join(", ")}. Download the template and keep its header row.`,
    };
  }

  const dataRows = rows.slice(1).filter((r) => r.some((v) => v.trim() !== ""));
  if (dataRows.length > MAX_ROWS) {
    return { done: false, error: `Too many rows (${dataRows.length}). Maximum ${MAX_ROWS} participants per upload.` };
  }

  const supabase = await createClient();
  const { data: competition } = await supabase
    .from("competitions")
    .select("id, name, status, event_date, registration_deadline")
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

  // Never trust a client-supplied payment id — look up (and later consume)
  // a matching paid, sufficient-balance payment server-side.
  const { data: payment } = await supabase
    .from("bulk_upload_payments")
    .select("id, participant_count, declared_participants")
    .eq("competition_id", competitionId)
    .eq("school_id", schoolId)
    .eq("sensei_id", senseiId)
    .eq("status", "paid")
    .gte("participant_count", dataRows.length)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!payment) {
    return {
      done: false,
      error: "Pay for this batch first — request and pay for your bulk registration above, then come back here.",
    };
  }

  const { data: catRows } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId)
    .order("sort_order");
  const categories = (catRows as Category[]) ?? [];

  const [{ data: schoolRow }, { data: senseiRow }] = await Promise.all([
    supabase.from("schools").select("name").eq("id", schoolId).maybeSingle(),
    supabase.from("senseis").select("name").eq("id", senseiId).maybeSingle(),
  ]);

  const get = (r: string[], col: (typeof CSV_COLUMNS)[number]) =>
    (r[colIndex.get(col)!] ?? "").trim();

  // One upload = one competition tier — check every row agrees before doing
  // any per-row work, so a mixed-tier file fails fast with one clear
  // message instead of a confusing pile of per-row errors.
  const tiersInFile = [...new Set(dataRows.map((r) => get(r, "competition_tier")).filter(Boolean))];
  if (tiersInFile.length > 1) {
    return {
      done: false,
      error: `This file has more than one Competition Tier (${tiersInFile.join(", ")}) — upload one tier at a time. Split the rows into separate files, one per tier, and upload each separately.`,
    };
  }

  // Validate all rows first
  type Valid = {
    row: number; full_name: string; ic: string; dob: string; gender: string;
    belt: string; rankConf: string; email: string; phone: string;
    address: string; city: string; country: string;
    categoryId: string; categoryMax: number | null; kataBase: string; bank: [string, string, string];
  };
  const failures: Array<{ row: number; name: string; error: string }> = [];
  const valid: Valid[] = [];
  const seenKataPerIc = new Map<string, Set<string>>();

  dataRows.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const name = get(r, "full_name") || `Row ${rowNo}`;
    const missing = CSV_COLUMNS.filter((c) => !get(r, c));
    if (missing.length > 0) {
      failures.push({ row: rowNo, name, error: `Missing: ${missing.join(", ")}` });
      return;
    }
    const ic = get(r, "ic_passport");
    const kataBase = get(r, "kata_event");
    const existingKataSet = seenKataPerIc.get(ic) ?? new Set<string>();
    if (existingKataSet.has(kataBase)) {
      failures.push({ row: rowNo, name, error: "Duplicate kata for this IC within the file" });
      return;
    }
    const dob = parseDDMMYYYY(get(r, "date_of_birth"));
    if (!dob) {
      failures.push({ row: rowNo, name, error: "Invalid date of birth (use DD/MM/YYYY)" });
      return;
    }
    const ageInput = Number(get(r, "age"));
    const computedAge = ageAt(dob, competition.event_date);
    if (!Number.isFinite(ageInput) || Math.abs(ageInput - computedAge) > 1) {
      failures.push({ row: rowNo, name, error: `Age (${get(r, "age")}) doesn't match date of birth — expected around ${computedAge}` });
      return;
    }
    if (schoolRow?.name && get(r, "dojo_name").toLowerCase() !== schoolRow.name.toLowerCase()) {
      failures.push({ row: rowNo, name, error: `Dojo_name ("${get(r, "dojo_name")}") doesn't match the selected School / Dojo ("${schoolRow.name}")` });
      return;
    }
    if (senseiRow?.name && get(r, "sensei_name").toLowerCase() !== senseiRow.name.toLowerCase()) {
      failures.push({ row: rowNo, name, error: `sensei_name ("${get(r, "sensei_name")}") doesn't match the selected Sensei / Coach ("${senseiRow.name}")` });
      return;
    }
    const gender = get(r, "gender").toLowerCase();
    if (!["male", "female"].includes(gender)) {
      failures.push({ row: rowNo, name, error: "Gender must be male or female" });
      return;
    }
    const resolved = resolveCategory(categories, kataBase, dob, get(r, "belt_rank"), gender, competition.event_date);
    if (!resolved.category) {
      failures.push({ row: rowNo, name, error: resolved.error ?? `Unknown kata event "${kataBase}"` });
      return;
    }
    existingKataSet.add(kataBase);
    seenKataPerIc.set(ic, existingKataSet);
    valid.push({
      row: rowNo,
      full_name: get(r, "full_name"),
      ic,
      dob,
      gender,
      belt: get(r, "belt_rank"),
      rankConf: /confirm/i.test(get(r, "rank_confirmation")) && !/pending/i.test(get(r, "rank_confirmation"))
        ? "sensei_confirmed"
        : "pending_confirmation",
      email: get(r, "email"),
      phone: get(r, "phone"),
      address: get(r, "home_address"),
      city: get(r, "city_town"),
      country: get(r, "home_country"),
      categoryId: resolved.category.id,
      categoryMax: resolved.category.max_participants,
      kataBase,
      bank: [get(r, "bank_name"), normalizeIban(get(r, "bank_account_no")), get(r, "bank_account_name")],
    });
  });

  // A student may compete in at most 3 kata events, never the same kata
  // twice. Batched: one summary call for every IC in the file, then a single
  // pass applying the cap in row order (earlier rows for the same IC win).
  const uniqueIcs = [...new Set(valid.map((v) => v.ic))];
  const existingByIc = new Map<string, { count: number; katas: Set<string> }>();
  for (let i = 0; i < uniqueIcs.length; i += 2000) {
    const { data: summary } = await supabase.rpc("ic_registration_summary", {
      p_ics: uniqueIcs.slice(i, i + 2000),
      p_competition: competitionId,
    });
    for (const row of (summary as unknown as Array<{ ic: string; cnt: number; kata_bases: string[] | null }>) ?? []) {
      existingByIc.set(row.ic, { count: row.cnt, katas: new Set(row.kata_bases ?? []) });
    }
  }

  // Sub-categories can have their own (tighter) cap than the competition —
  // batch-fetch current paid counts, then track remaining room in-memory as
  // rows are accepted (DB writes happen later, in chunks).
  const cappedCategoryIds = [...new Set(valid.filter((v) => v.categoryMax != null).map((v) => v.categoryId))];
  const categoryTaken = new Map<string, number>();
  for (let i = 0; i < cappedCategoryIds.length; i += 2000) {
    const { data: counts } = await supabase.rpc("category_paid_counts", {
      p_category_ids: cappedCategoryIds.slice(i, i + 2000),
    });
    for (const row of (counts as Array<{ category_id: string; cnt: number }>) ?? []) {
      categoryTaken.set(row.category_id, row.cnt);
    }
  }

  const toInsert = valid.filter((v) => {
    const state = existingByIc.get(v.ic) ?? { count: 0, katas: new Set<string>() };
    if (state.katas.has(v.kataBase)) {
      failures.push({ row: v.row, name: v.full_name, error: "Already registered for this kata" });
      return false;
    }
    if (state.count >= 3) {
      failures.push({ row: v.row, name: v.full_name, error: "Maximum Kata allow to compete is 3 only" });
      return false;
    }
    if (v.categoryMax != null) {
      const taken = categoryTaken.get(v.categoryId) ?? 0;
      if (taken >= v.categoryMax) {
        failures.push({ row: v.row, name: v.full_name, error: "This sub-category is full" });
        return false;
      }
      categoryTaken.set(v.categoryId, taken + 1);
    }
    state.count++;
    state.katas.add(v.kataBase);
    existingByIc.set(v.ic, state);
    return true;
  });

  const headcountError = await enforceHeadcountCap(
    supabase, schoolId, senseiId, competitionId, payment.declared_participants,
    toInsert.map((v) => v.ic),
  );
  if (headcountError) return { done: false, error: headcountError };

  // Chunked batch inserts
  let registered = 0;
  const senseiSummaryEntries: Array<{ name: string; referenceId: string }> = [];
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const withIds = chunk.map((v) => ({
      ...v,
      participantId: crypto.randomUUID(),
      registrationId: crypto.randomUUID(),
    }));

    const { error: pErr } = await supabase.from("participants").insert(
      withIds.map((v) => ({
        id: v.participantId,
        full_name: v.full_name,
        ic_passport: v.ic,
        date_of_birth: v.dob,
        gender: v.gender,
        belt_rank: v.belt,
        rank_confirmation: v.rankConf,
        email: v.email,
        phone: v.phone,
        home_address: v.address,
        city_town: v.city,
        home_country: v.country,
        school_id: schoolId,
        sensei_id: senseiId,
      })),
    );
    if (pErr) {
      for (const v of chunk) failures.push({ row: v.row, name: v.full_name, error: "Could not save (batch failed)" });
      continue;
    }
    await supabase.from("participant_bank_details").insert(
      withIds.map((v) => ({
        participant_id: v.participantId,
        bank_name: v.bank[0],
        bank_account_no: v.bank[1],
        bank_account_name: v.bank[2],
      })),
    );
    const { error: rErr } = await supabase.from("registrations").insert(
      withIds.map((v) => ({
        id: v.registrationId,
        competition_id: competitionId,
        participant_id: v.participantId,
        category_id: v.categoryId,
        division: v.gender === "female" ? "Female" : "Male",
        // Already paid upfront via the bulk-upload payment gate.
        payment_status: "paid",
      })),
    );
    if (rErr) {
      await supabase.from("participants").delete().in("id", withIds.map((v) => v.participantId));
      for (const v of chunk) failures.push({ row: v.row, name: v.full_name, error: "Could not save registration (batch failed)" });
      continue;
    }
    registered += chunk.length;

    await sendConfirmationEmailBatch(
      withIds.map((v) => ({
        toEmail: v.email,
        recipientName: v.full_name,
        subject: `Registration confirmed — ${competition.name}`,
        referenceId: v.registrationId.slice(0, 8).toUpperCase(),
        telegramCategory: "participant" as const,
        bodyLines: [
          `This confirms your registration for ${competition.name} (${v.kataBase}), submitted via CSV bulk upload.`,
          "Your registration fee has already been paid by your school/sensei — no further payment is needed from you.",
        ],
      })),
    );
    for (const v of withIds) {
      senseiSummaryEntries.push({ name: v.full_name, referenceId: v.registrationId.slice(0, 8).toUpperCase() });
    }
  }

  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: null,
    action: "bulk_csv_registration",
    new_value: { rows: dataRows.length, registered, failed: failures.length, sensei_id: senseiId },
  });
  await supabase.rpc("consume_bulk_upload_payment", { p_id: payment.id, p_rows_uploaded: registered });
  await sendSenseiSummaryEmail(supabase, senseiId, competition.name, senseiSummaryEntries);

  failures.sort((a, b) => a.row - b.row);
  return {
    done: true,
    registered,
    failed: failures.length,
    failures: failures.slice(0, 50),
  };
}
