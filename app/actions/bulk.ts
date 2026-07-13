"use server";

import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { resolveCategory } from "@/lib/division";
import { parseCsv } from "@/lib/csv";
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

  const { data: catRows } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId)
    .order("sort_order");
  const categories = (catRows as Category[]) ?? [];

  const results: BulkRowResult[] = [];

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
      bank_account_no: row.bank_account_no.trim(),
      bank_account_name: row.bank_account_name.trim(),
    });
    const { error: rErr } = await supabase.from("registrations").insert({
      id: registrationId,
      competition_id: competitionId,
      participant_id: participantId,
      category_id: resolved.category.id,
      division: row.gender.toLowerCase() === "female" ? "Female" : "Male",
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
      new_value: { participant_id: participantId, category_id: resolved.category.id, sensei_id: senseiId },
    });
    results.push({ row: i + 1, name: label, ok: true, referenceId: registrationId.slice(0, 8).toUpperCase() });
  }

  return { done: true, results };
}

// ── CSV bulk upload (up to 10,000 participants) ─────────────────────────────

const CSV_COLUMNS = [
  "full_name", "ic_passport", "date_of_birth", "gender", "belt_rank",
  "rank_confirmation", "email", "phone", "home_address", "city_town",
  "home_country", "kata_event", "bank_name", "bank_account_no", "bank_account_name",
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

  const { data: catRows } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId)
    .order("sort_order");
  const categories = (catRows as Category[]) ?? [];

  const get = (r: string[], col: (typeof CSV_COLUMNS)[number]) =>
    (r[colIndex.get(col)!] ?? "").trim();

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
    const dob = get(r, "date_of_birth");
    if (Number.isNaN(Date.parse(dob))) {
      failures.push({ row: rowNo, name, error: "Invalid date of birth (use YYYY-MM-DD)" });
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
      bank: [get(r, "bank_name"), get(r, "bank_account_no"), get(r, "bank_account_name")],
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

  // Chunked batch inserts
  let registered = 0;
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
        payment_status: "pending",
      })),
    );
    if (rErr) {
      await supabase.from("participants").delete().in("id", withIds.map((v) => v.participantId));
      for (const v of chunk) failures.push({ row: v.row, name: v.full_name, error: "Could not save registration (batch failed)" });
      continue;
    }
    registered += chunk.length;
  }

  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: null,
    action: "bulk_csv_registration",
    new_value: { rows: dataRows.length, registered, failed: failures.length, sensei_id: senseiId },
  });

  failures.sort((a, b) => a.row - b.row);
  return {
    done: true,
    registered,
    failed: failures.length,
    failures: failures.slice(0, 50),
  };
}
