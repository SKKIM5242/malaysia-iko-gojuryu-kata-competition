"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getStripe, paymentsEnabled } from "@/lib/payments";
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

// ── Fee plans ────────────────────────────────────────────────────────────────

export async function saveFeePlan(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const amountRaw = String(formData.get("amount_myr") ?? "").trim();
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    kind: ["membership_yearly", "training_monthly", "grading"].includes(String(formData.get("kind")))
      ? String(formData.get("kind"))
      : "training_monthly",
    amount_myr: amountRaw ? Number(amountRaw) : null,
    billing_interval: ["yearly", "monthly", "bimonthly", "quarterly"].includes(String(formData.get("billing_interval")))
      ? String(formData.get("billing_interval"))
      : "monthly",
    audience: ["student", "adult", "all"].includes(String(formData.get("audience")))
      ? String(formData.get("audience"))
      : "all",
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
  const due_date = String(formData.get("due_date") ?? "") || null;
  if (!student_id || !description) backTo("invoices", { error: "Student and description are required." });
  if (!amount || Number.isNaN(amount) || amount <= 0) backTo("invoices", { error: "Enter a valid amount." });
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase
    .from("class_invoices")
    .insert({ student_id, fee_plan_id, description, amount_myr: amount, due_date })
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
            currency: "myr",
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
