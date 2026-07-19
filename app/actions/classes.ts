"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import { parseCsvWithHeader, type CsvUploadResult } from "@/lib/csv-bulk";
import { sendConfirmationEmail } from "@/lib/notify";
import { getTelegramLink } from "@/lib/telegram";
import type { ClassEnrollment, ClassInvoice, FeePlan } from "@/lib/types";

/** Dojo class billing actions — admin only (RLS: authenticated). */

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, actorId: user?.id ?? null };
}

function backTo(tab: string, params: Record<string, string>) {
  const q = new URLSearchParams({ tab, ...params }).toString();
  redirect(`/admin/classes?${q}`);
}

// ── Students ─────────────────────────────────────────────────────────────────

export async function saveStudent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const values = {
    full_name: String(formData.get("full_name") ?? "").trim(),
    ic_passport: String(formData.get("ic_passport") ?? "").trim() || null,
    date_of_birth: String(formData.get("date_of_birth") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    category: formData.get("category") === "adult" ? "adult" : "student",
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    join_date: String(formData.get("join_date") ?? "") || null,
    status: formData.get("status") === "inactive" ? "inactive" : "active",
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  if (!values.full_name) backTo("students", { error: "Student name is required." });
  const { supabase, actorId } = await getActor();
  if (id) {
    const { error } = await supabase.from("students").update(values).eq("id", id);
    if (error) backTo("students", { error: "Could not update student." });
    await writeAudit(supabase, {
      table_name: "students", record_id: id, action: "student_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase.from("students").insert(values).select("id").single();
    if (error) backTo("students", { error: "Could not create student." });
    await writeAudit(supabase, {
      table_name: "students", record_id: data!.id, action: "student_created",
      new_value: values, actor_id: actorId,
    });
  }
  backTo("students", { ok: "Student saved." });
}

export async function deleteStudent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("students").delete().eq("id", id);
  if (error) backTo("students", { error: "Could not delete student." });
  await writeAudit(supabase, {
    table_name: "students", record_id: id, action: "student_deleted", actor_id: actorId,
  });
  backTo("students", { ok: "Student deleted (their enrollments and invoices were removed)." });
}

const STUDENT_CSV_COLUMNS = [
  "full_name", "ic_passport", "date_of_birth", "gender", "category",
  "email", "phone", "home_address", "city_town", "home_country", "join_date", "notes",
] as const;

export async function bulkUploadStudents(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), STUDENT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const { data: myProfile } = actorId
    ? await supabase.from("profiles").select("role").eq("user_id", actorId).maybeSingle()
    : { data: null };
  if (!["admin", "organizer"].includes(myProfile?.role ?? "")) {
    return { done: false, error: "Only Admin or Organizer accounts can bulk-upload records." };
  }

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    if (!get(r, "full_name")) { failures.push({ row: rowNo, name: full_name, error: "Full name is required" }); continue; }
    const record = {
      full_name: get(r, "full_name"),
      ic_passport: get(r, "ic_passport") || null,
      date_of_birth: get(r, "date_of_birth") || null,
      gender: get(r, "gender") || null,
      category: get(r, "category").toLowerCase() === "adult" ? "adult" : "student",
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      home_country: get(r, "home_country") || null,
      join_date: get(r, "join_date") || null,
      status: "active",
      notes: get(r, "notes") || null,
    };
    const { data, error } = await supabase.from("students").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: full_name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "students", record_id: data!.id, action: "student_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "students", record_id: null, action: "bulk_csv_students",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

// ── Fee plans ────────────────────────────────────────────────────────────────

/** Fee plans are referenced (not cascaded) by class_enrollments/class_invoices,
 * so a plan with any history can't be hard-deleted — mark it inactive instead
 * (the existing soft-delete via the "Active" checkbox on the plan form). */
export async function deleteFeePlan(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { supabase, actorId } = await getActor();
  const [{ count: enrollCount }, { count: invoiceCount }] = await Promise.all([
    supabase.from("class_enrollments").select("id", { count: "exact", head: true }).eq("fee_plan_id", id),
    supabase.from("class_invoices").select("id", { count: "exact", head: true }).eq("fee_plan_id", id),
  ]);
  if ((enrollCount ?? 0) > 0 || (invoiceCount ?? 0) > 0) {
    backTo("plans", {
      error: `Cannot delete — ${enrollCount ?? 0} enrollment(s) and ${invoiceCount ?? 0} invoice(s) reference this plan. Untick "Active" on the plan instead to retire it.`,
    });
  }
  const { error } = await supabase.from("fee_plans").delete().eq("id", id);
  if (error) backTo("plans", { error: "Could not delete fee plan." });
  await writeAudit(supabase, {
    table_name: "fee_plans", record_id: id, action: "fee_plan_deleted", actor_id: actorId,
  });
  backTo("plans", { ok: "Fee plan deleted." });
}

const FEE_PLAN_KINDS = ["membership_yearly", "training_monthly", "grading", "hourly_charge", "service_charge"];
const BILLING_INTERVALS = [
  "yearly", "monthly", "bimonthly", "quarterly",
  "daily", "transaction", "occurrence", "request", "order", "service",
];

export async function saveFeePlan(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const amountRaw = String(formData.get("amount_myr") ?? "").trim();
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    kind: FEE_PLAN_KINDS.includes(String(formData.get("kind")))
      ? String(formData.get("kind"))
      : "training_monthly",
    amount_myr: amountRaw ? Number(amountRaw) : null,
    currency: String(formData.get("currency") ?? "").trim() || "MYR",
    billing_interval: BILLING_INTERVALS.includes(String(formData.get("billing_interval")))
      ? String(formData.get("billing_interval"))
      : "monthly",
    audience: ["student", "adult", "all"].includes(String(formData.get("audience")))
      ? String(formData.get("audience"))
      : "all",
    applies_to: formData.getAll("applies_to").map((v) => String(v)).filter(Boolean),
    active: formData.get("active") === "on",
  };
  if (!values.name) backTo("plans", { error: "Plan name is required." });
  if (amountRaw && Number.isNaN(values.amount_myr)) backTo("plans", { error: "Amount must be a number." });
  const { supabase, actorId } = await getActor();
  if (id) {
    const { error } = await supabase.from("fee_plans").update(values).eq("id", id);
    if (error) backTo("plans", { error: "Could not update fee plan." });
    await writeAudit(supabase, {
      table_name: "fee_plans", record_id: id, action: "fee_plan_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase.from("fee_plans").insert(values).select("id").single();
    if (error) backTo("plans", { error: "Could not create fee plan." });
    await writeAudit(supabase, {
      table_name: "fee_plans", record_id: data!.id, action: "fee_plan_created",
      new_value: values, actor_id: actorId,
    });
  }
  backTo("plans", { ok: "Fee plan saved." });
}

// ── Enrollments ──────────────────────────────────────────────────────────────

export async function enrollStudent(formData: FormData) {
  const student_id = String(formData.get("student_id") ?? "");
  const fee_plan_id = String(formData.get("fee_plan_id") ?? "");
  const start_date = String(formData.get("start_date") ?? "") || new Date().toISOString().slice(0, 10);
  if (!student_id || !fee_plan_id) backTo("enrollments", { error: "Pick a student and a fee plan." });
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase
    .from("class_enrollments")
    .insert({ student_id, fee_plan_id, start_date, next_billing_date: start_date })
    .select("id")
    .single();
  if (error) backTo("enrollments", { error: "Could not enroll — is the student already on this plan?" });
  await writeAudit(supabase, {
    table_name: "class_enrollments", record_id: data!.id, action: "enrollment_created",
    new_value: { student_id, fee_plan_id, start_date }, actor_id: actorId,
  });
  backTo("enrollments", { ok: "Enrolled. Invoices start from the chosen start date." });
}

export async function updateEnrollmentStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["active", "paused", "cancelled"].includes(status)) backTo("enrollments", { error: "Invalid status." });
  const { supabase, actorId } = await getActor();
  const { error } = await supabase.from("class_enrollments").update({ status }).eq("id", id);
  if (error) backTo("enrollments", { error: "Could not update enrollment." });
  await writeAudit(supabase, {
    table_name: "class_enrollments", record_id: id, action: `enrollment_${status}`, actor_id: actorId,
  });
  backTo("enrollments", { ok: `Enrollment ${status}.` });
}

// ── Invoices ─────────────────────────────────────────────────────────────────

function advance(date: string, interval: FeePlan["billing_interval"]): string {
  const d = new Date(date + "T00:00:00");
  if (interval === "daily") {
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  // Per-transaction/occurrence/request/order/service plans aren't billed on
  // a calendar cadence — generateDueInvoices() below only advances a plan's
  // next_billing_date, so it barely matters what this returns for those;
  // they're expected to be billed via Manual Invoice instead.
  const months = interval === "yearly" ? 12 : interval === "quarterly" ? 3 : interval === "bimonthly" ? 2 : 1;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Creates one invoice for every active enrollment whose next_billing_date is
 * due, then advances that date by the plan's interval. Plans without a fixed
 * amount (e.g. grading) are skipped — bill those with a manual invoice.
 */
export async function generateDueInvoices() {
  const { supabase, actorId } = await getActor();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("class_enrollments")
    .select("*, fee_plan:fee_plans(*), student:students(id, full_name, status)")
    .eq("status", "active")
    .lte("next_billing_date", today);
  const due = ((data as unknown as ClassEnrollment[]) ?? []).filter(
    (e) => (e.student as { status?: string } | null)?.status !== "inactive",
  );

  let created = 0;
  let skippedNoAmount = 0;
  for (const e of due) {
    const plan = e.fee_plan as FeePlan | null;
    if (!plan) continue;
    if (plan.amount_myr == null) {
      skippedNoAmount++;
      continue;
    }
    const periodStart = e.next_billing_date;
    const periodEnd = advance(periodStart, plan.billing_interval);
    const dueDate = advance(today, "monthly").slice(0, 10);
    const { error } = await supabase.from("class_invoices").insert({
      student_id: e.student_id,
      fee_plan_id: e.fee_plan_id,
      description: `${plan.name} (${periodStart} → ${periodEnd})`,
      amount_myr: plan.amount_myr,
      currency: plan.currency || "MYR",
      period_start: periodStart,
      period_end: periodEnd,
      due_date: dueDate,
    });
    if (!error) {
      created++;
      await supabase
        .from("class_enrollments")
        .update({ next_billing_date: periodEnd })
        .eq("id", e.id);
    }
  }
  await writeAudit(supabase, {
    table_name: "class_invoices", record_id: null, action: "invoices_generated",
    new_value: { created, skippedNoAmount }, actor_id: actorId,
  });
  backTo("invoices", {
    ok: `${created} invoice(s) generated.${skippedNoAmount ? ` ${skippedNoAmount} skipped (plan has no fixed amount — bill those manually).` : ""}`,
  });
}

export async function createManualInvoice(formData: FormData) {
  const student_id = String(formData.get("student_id") ?? "");
  const fee_plan_id = String(formData.get("fee_plan_id") ?? "") || null;
  const description = String(formData.get("description") ?? "").trim();
  const amount = Number(formData.get("amount_myr"));
  const currency = String(formData.get("currency") ?? "").trim() || "MYR";
  const due_date = String(formData.get("due_date") ?? "") || null;
  if (!student_id || !description) backTo("invoices", { error: "Student and description are required." });
  if (!amount || Number.isNaN(amount) || amount <= 0) backTo("invoices", { error: "Enter a valid amount." });
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase
    .from("class_invoices")
    .insert({ student_id, fee_plan_id, description, amount_myr: amount, currency, due_date })
    .select("id")
    .single();
  if (error) backTo("invoices", { error: "Could not create invoice." });
  await writeAudit(supabase, {
    table_name: "class_invoices", record_id: data!.id, action: "invoice_created_manual",
    new_value: { student_id, description, amount }, actor_id: actorId,
  });
  backTo("invoices", { ok: "Invoice created." });
}

/**
 * Creates a Stripe Checkout link (MYR) for an unpaid class invoice. The
 * owner sends the link to the payer (e.g. via WhatsApp); the webhook or
 * thank-you page marks the invoice paid automatically on success.
 */
export async function generateInvoicePaymentLink(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!paymentsEnabled()) {
    backTo("invoices", { error: "Online payment is not configured yet." });
  }
  const { supabase, actorId } = await getActor();
  const { data } = await supabase
    .from("class_invoices")
    .select("*, student:students(id, full_name)")
    .eq("id", id)
    .maybeSingle();
  const invoice = data as unknown as ClassInvoice | null;
  if (!invoice) backTo("invoices", { error: "Invoice not found." });
  if (invoice!.status !== "unpaid") backTo("invoices", { error: "Only unpaid invoices can be charged." });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: (invoice!.currency || "MYR").toLowerCase(),
            unit_amount: Math.round(Number(invoice!.amount_myr) * 100),
            product_data: {
              name: invoice!.description,
              description: `Payer: ${invoice!.student?.full_name ?? "student"} — IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: { invoice_id: invoice!.id },
      success_url: `${appUrl}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pay/thanks?cancelled=1`,
    });
    await supabase.from("class_invoices").update({ checkout_url: session.url }).eq("id", id);
    await writeAudit(supabase, {
      table_name: "class_invoices", record_id: id, action: "invoice_payment_link_created",
      new_value: { stripe_session: session.id }, actor_id: actorId,
    });
  } catch {
    backTo("invoices", { error: "Stripe did not return a payment link. Please try again." });
  }
  backTo("invoices", { ok: "Payment link created — click “Payment link” on the invoice to open or copy it." });
}

/**
 * Emails one invoice to the student's own email address, including its
 * Stripe payment link (if one exists yet) and the Dojo Class Students
 * Telegram group link — individual students don't have a bot-linked chat
 * ID, so Telegram delivery here means "here's the group to watch for it",
 * same as every other confirmation email in the app.
 */
export async function emailInvoice(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { supabase, actorId } = await getActor();
  const { data } = await supabase
    .from("class_invoices")
    .select("*, student:students(id, full_name, email)")
    .eq("id", id)
    .maybeSingle();
  const invoice = data as unknown as ClassInvoice | null;
  if (!invoice) backTo("invoices", { error: "Invoice not found." });
  if (!invoice!.student?.email) backTo("invoices", { error: "This student has no email address on file." });

  await sendConfirmationEmail({
    toEmail: invoice!.student!.email,
    recipientName: invoice!.student!.full_name,
    subject: `Invoice: ${invoice!.description}`,
    bodyLines: [
      `${invoice!.description} — ${invoice!.currency || "MYR"} ${Number(invoice!.amount_myr).toFixed(2)}`,
      invoice!.due_date ? `Due date: ${invoice!.due_date}` : "",
      invoice!.checkout_url
        ? `Pay online: ${invoice!.checkout_url}`
        : "Please contact the dojo to arrange payment.",
    ].filter(Boolean),
    telegramCategory: "class",
  });
  await writeAudit(supabase, {
    table_name: "class_invoices", record_id: id, action: "invoice_emailed",
    new_value: { to: invoice!.student!.email }, actor_id: actorId,
  });
  const telegramUrl = getTelegramLink("class");
  backTo("invoices", {
    ok: telegramUrl
      ? "Invoice emailed. Dojo Class Students Telegram group is also linked in that email."
      : "Invoice emailed.",
  });
}

/**
 * Bulk-sends every unpaid invoice's payment link by email — generating one
 * first (via Stripe) for any unpaid invoice that doesn't have one yet.
 * Skips invoices whose student has no email on file; reports both counts.
 */
export async function emailAllUnpaidPaymentLinks() {
  const { supabase, actorId } = await getActor();
  if (!paymentsEnabled()) backTo("invoices", { error: "Online payment is not configured yet." });

  const { data } = await supabase
    .from("class_invoices")
    .select("*, student:students(id, full_name, email)")
    .eq("status", "unpaid");
  const unpaid = (data as unknown as ClassInvoice[]) ?? [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let sent = 0;
  let skippedNoEmail = 0;

  for (const invoice of unpaid) {
    if (!invoice.student?.email) { skippedNoEmail++; continue; }

    let checkoutUrl = invoice.checkout_url;
    if (!checkoutUrl) {
      try {
        const session = await getStripe().checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: (invoice.currency || "MYR").toLowerCase(),
                unit_amount: Math.round(Number(invoice.amount_myr) * 100),
                product_data: {
                  name: invoice.description,
                  description: `Payer: ${invoice.student.full_name} — IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD`,
                },
              },
              quantity: 1,
            },
          ],
          metadata: { invoice_id: invoice.id },
          success_url: `${appUrl}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appUrl}/pay/thanks?cancelled=1`,
        });
        checkoutUrl = session.url;
        await supabase.from("class_invoices").update({ checkout_url: checkoutUrl }).eq("id", invoice.id);
      } catch {
        continue;
      }
    }

    await sendConfirmationEmail({
      toEmail: invoice.student.email,
      recipientName: invoice.student.full_name,
      subject: `Payment link: ${invoice.description}`,
      bodyLines: [
        `${invoice.description} — ${invoice.currency || "MYR"} ${Number(invoice.amount_myr).toFixed(2)}`,
        invoice.due_date ? `Due date: ${invoice.due_date}` : "",
        `Pay online: ${checkoutUrl}`,
      ].filter(Boolean),
      telegramCategory: "class",
    });
    sent++;
  }

  await writeAudit(supabase, {
    table_name: "class_invoices", record_id: null, action: "invoices_payment_links_emailed",
    new_value: { sent, skippedNoEmail }, actor_id: actorId,
  });
  backTo("invoices", {
    ok: `Payment links emailed to ${sent} student(s).${skippedNoEmail ? ` ${skippedNoEmail} skipped (no email on file).` : ""}`,
  });
}

export async function updateInvoiceStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const payment_reference = String(formData.get("payment_reference") ?? "").trim() || null;
  if (!["unpaid", "paid", "void"].includes(status)) backTo("invoices", { error: "Invalid status." });
  const { supabase, actorId } = await getActor();
  const update: Record<string, unknown> = { status };
  if (payment_reference) update.payment_reference = payment_reference;
  const { error } = await supabase.from("class_invoices").update(update).eq("id", id);
  if (error) backTo("invoices", { error: "Could not update invoice." });
  await writeAudit(supabase, {
    table_name: "class_invoices", record_id: id, action: `invoice_${status}`,
    new_value: update, actor_id: actorId,
  });
  backTo("invoices", { ok: `Invoice marked ${status}.` });
}
