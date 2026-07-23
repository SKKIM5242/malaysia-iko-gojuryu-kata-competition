import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/payments";
import { writeAudit } from "@/lib/audit";
import { sendConfirmationEmail } from "@/lib/notify";
import { formatUSD } from "@/components/ui";

export type FinalizeResult =
  | { status: "paid"; referenceIds: string[] }
  | { status: "unpaid" }
  | { status: "error"; message: string };

/**
 * Marks a class invoice paid after its Stripe Checkout session succeeds.
 * Idempotent — safe to call from both the webhook and the thank-you page.
 */
export async function finalizeInvoiceSession(sessionId: string): Promise<FinalizeResult> {
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: "error", message: "Payment session not found." };
  }
  if (session.payment_status !== "paid") return { status: "unpaid" };
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) return { status: "error", message: "No invoice reference on this payment." };

  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("class_invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { status: "error", message: "Invoice not found." };
  if (invoice.status !== "paid") {
    await admin
      .from("class_invoices")
      .update({ status: "paid", payment_reference: sessionId })
      .eq("id", invoiceId);
    await writeAudit(admin, {
      table_name: "class_invoices",
      record_id: invoiceId,
      action: "invoice_paid_online",
      new_value: { stripe_session: sessionId },
    });
  }
  return { status: "paid", referenceIds: [invoiceId.slice(0, 8).toUpperCase()] };
}

/**
 * Marks a School/Dojo or Sensei/Coach directory record paid after its
 * tier-fee Stripe Checkout session succeeds. Idempotent — safe to call
 * from both the webhook and the thank-you page.
 */
export async function finalizeDirectorySession(sessionId: string): Promise<FinalizeResult> {
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: "error", message: "Payment session not found." };
  }
  if (session.payment_status !== "paid") return { status: "unpaid" };
  const schoolId = session.metadata?.school_id;
  const senseiId = session.metadata?.sensei_id;
  const table = schoolId ? "schools" : senseiId ? "senseis" : null;
  const recordId = schoolId ?? senseiId;
  if (!table || !recordId) return { status: "error", message: "No record reference on this payment." };

  const admin = createAdminClient();
  const { data: record } = await admin.from(table).select("id, payment_status").eq("id", recordId).maybeSingle();
  if (!record) return { status: "error", message: "Registration record not found." };
  if (record.payment_status !== "paid") {
    await admin.from(table).update({ payment_status: "paid" }).eq("id", recordId);
    await writeAudit(admin, {
      table_name: table,
      record_id: recordId,
      action: "tier_fee_paid_online",
      new_value: { stripe_session: sessionId },
    });
  }
  return { status: "paid", referenceIds: [recordId.slice(0, 8).toUpperCase()] };
}

/**
 * Marks a "3 more re-record attempts" purchase paid after its Stripe
 * Checkout session succeeds, and immediately grants the 3 bonus attempts.
 * Idempotent — safe to call from both the webhook and the thank-you page.
 */
export async function finalizeAttemptPurchaseSession(sessionId: string): Promise<FinalizeResult> {
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: "error", message: "Payment session not found." };
  }
  if (session.payment_status !== "paid") return { status: "unpaid" };
  const purchaseId = session.metadata?.attempt_purchase_id;
  if (!purchaseId) return { status: "error", message: "No purchase reference on this payment." };

  const admin = createAdminClient();
  const { data: purchase } = await admin
    .from("attempt_purchases")
    .select("id, user_id, status")
    .eq("id", purchaseId)
    .maybeSingle();
  if (!purchase) return { status: "error", message: "Purchase record not found." };
  if (purchase.status !== "paid") {
    const { data: profile } = await admin
      .from("profiles")
      .select("bonus_record_attempts")
      .eq("user_id", purchase.user_id)
      .maybeSingle();
    await admin
      .from("profiles")
      .update({ bonus_record_attempts: (profile?.bonus_record_attempts ?? 0) + 3 })
      .eq("user_id", purchase.user_id);
    await admin
      .from("attempt_purchases")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", purchaseId);
    await writeAudit(admin, {
      table_name: "attempt_purchases",
      record_id: purchaseId,
      action: "attempt_purchase_paid_online",
      new_value: { stripe_session: sessionId },
    });
  }
  return { status: "paid", referenceIds: [purchaseId.slice(0, 8).toUpperCase()] };
}

/**
 * Turn a paid Stripe Checkout session into real participant + bank-details +
 * registration rows. Idempotent: called by both the webhook and the success
 * page, whichever wins; the loser finds the existing registration by
 * payment_reference and returns the same reference ID.
 */
export async function finalizeStripeSession(sessionId: string): Promise<FinalizeResult> {
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: "error", message: "Payment session not found." };
  }
  if (session.payment_status !== "paid") return { status: "unpaid" };

  const admin = createAdminClient();

  // Already finalised (webhook vs success page race)? A single payment
  // covers every event, so there can be more than one registration row
  // sharing this payment_reference.
  const { data: existing } = await admin
    .from("registrations")
    .select("id")
    .eq("payment_reference", sessionId);
  if (existing && existing.length > 0) {
    return { status: "paid", referenceIds: existing.map((r) => r.id.slice(0, 8).toUpperCase()) };
  }

  const draftId = session.metadata?.draft_id;
  if (!draftId) return { status: "error", message: "Payment received but no draft reference — contact the organizer with your Stripe receipt." };

  const { data: draft } = await admin
    .from("registration_drafts")
    .select("id, payload")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) {
    // Draft consumed in a race between webhook and success page; the
    // registration row lookup above will hit on retry.
    const { data: again } = await admin
      .from("registrations")
      .select("id")
      .eq("payment_reference", sessionId);
    if (again && again.length > 0) {
      return { status: "paid", referenceIds: again.map((r) => r.id.slice(0, 8).toUpperCase()) };
    }
    return { status: "error", message: "Payment received but registration data expired — contact the organizer with your Stripe receipt." };
  }

  const v = draft.payload as Record<string, string>;
  // events_json (up to 3 kata events per tier, across up to 3 competition
  // tiers, picked in one submission) is the current format; fall back to
  // the single category_id/kata_base/competition_id a draft written before
  // multi-tier support would still carry.
  type DraftEvent = { kata_base: string; category_id: string; competition_id: string };
  const events: DraftEvent[] = v.events_json
    ? (JSON.parse(v.events_json) as DraftEvent[])
    : [{ kata_base: v.kata_base ?? "", category_id: v.category_id, competition_id: v.competition_id }];

  const participantId = crypto.randomUUID();

  const { error: pErr } = await admin.from("participants").insert({
    id: participantId,
    full_name: v.full_name,
    ic_passport: v.ic_passport,
    date_of_birth: v.date_of_birth,
    gender: v.gender,
    belt_rank: v.belt_rank,
    email: v.email ?? null,
    phone: v.phone ?? null,
    home_address: v.home_address ?? null,
    postcode: v.postcode ?? null,
    home_country: v.home_country ?? null,
    city_town: v.city_town ?? null,
    certificate_path: v.certificate_path || null,
    rank_confirmation: v.rank_confirmation ?? null,
    school_id: v.school_id,
    sensei_id: v.sensei_id,
    referral_source: v.referral_source || null,
  });
  if (pErr) return { status: "error", message: "Payment received but saving failed — contact the organizer with your Stripe receipt." };

  if (v.bank_name && v.bank_account_no && v.bank_account_name) {
    await admin.from("participant_bank_details").insert({
      participant_id: participantId,
      bank_name: v.bank_name,
      bank_account_no: v.bank_account_no,
      bank_account_name: v.bank_account_name,
    });
  }

  const referenceIds: string[] = [];
  for (const ev of events) {
    const registrationId = crypto.randomUUID();
    const { error: rErr } = await admin.from("registrations").insert({
      id: registrationId,
      competition_id: ev.competition_id,
      participant_id: participantId,
      category_id: ev.category_id,
      division: v.division ?? null,
      payment_status: "paid",
      payment_reference: sessionId,
      notes: "Paid online via Stripe Checkout",
    });
    if (rErr) {
      await admin.from("registrations").delete().eq("participant_id", participantId);
      await admin.from("participants").delete().eq("id", participantId);
      return { status: "error", message: "Payment received but saving failed — contact the organizer with your Stripe receipt." };
    }
    await writeAudit(admin, {
      table_name: "registrations",
      record_id: registrationId,
      action: "registration_paid_online",
      new_value: {
        participant_id: participantId,
        category_id: ev.category_id,
        kata_base: ev.kata_base,
        competition_id: ev.competition_id,
        payment_status: "paid",
        stripe_session: sessionId,
      },
    });
    referenceIds.push(registrationId.slice(0, 8).toUpperCase());
  }

  await admin.from("registration_drafts").delete().eq("id", draftId);

  // Events may span more than one competition tier in a single paid
  // submission — group by tier for a readable confirmation email.
  const competitionIds = [...new Set(events.map((e) => e.competition_id))];
  const { data: competitionRows } = await admin
    .from("competitions")
    .select("id, name")
    .in("id", competitionIds);
  const competitionNameById = new Map((competitionRows ?? []).map((c) => [c.id, c.name as string]));
  const eventsByCompetition = new Map<string, DraftEvent[]>();
  for (const ev of events) {
    const list = eventsByCompetition.get(ev.competition_id) ?? [];
    list.push(ev);
    eventsByCompetition.set(ev.competition_id, list);
  }
  const tierSummary = [...eventsByCompetition.entries()]
    .map(([compId, evs]) => `${competitionNameById.get(compId) ?? "the competition"} — ${evs.map((e) => e.kata_base).join(", ")}`)
    .join("; ");
  // Best-effort: if an account with this email already exists, it picks up
  // the "participant" role right away — one account can hold more than one role.
  if (v.email) {
    await admin.rpc("grant_profile_role", { p_email: v.email, p_role: "participant" });
  }
  await sendConfirmationEmail({
    toEmail: v.email ?? null,
    recipientName: v.full_name,
    subject: `Payment successful — registration confirmed — ${events.length} event${events.length === 1 ? "" : "s"}`,
    telegramCategory: "participant",
    bodyLines: [
      `This confirms your paid registration — ${events.length} kata event${events.length === 1 ? "" : "s"}: ${tierSummary}.`,
      `Your reference ID${referenceIds.length > 1 ? "s" : ""}: ${referenceIds.join(", ")}.`,
      "Payment received — your slot is confirmed and your name will appear on the participants list. A Stripe receipt was also sent to the email you entered at checkout.",
      "Keep your reference ID and the IC/passport you registered with — you'll need both to link your account when you're ready to record your kata.",
      "",
      "Once signed in, you can record & submit your own registered event(s) — and every event once Winners are announced.",
      "Next: once every registration under this email is done, create your sign-in account (or sign in if you already have one) using the Kata Arena log in link below.",
    ],
  });

  return { status: "paid", referenceIds };
}

/**
 * Marks every bulk_upload_payments row sharing a batch_id paid after the
 * sensei's combined Stripe Checkout session succeeds, unlocking their
 * CSV/table upload. Idempotent — safe to call from both the webhook and the
 * thank-you page.
 */
export async function finalizeBulkUploadBatchSession(sessionId: string): Promise<FinalizeResult> {
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: "error", message: "Payment session not found." };
  }
  if (session.payment_status !== "paid") return { status: "unpaid" };
  const batchId = session.metadata?.bulk_batch_id;
  if (!batchId) return { status: "error", message: "No batch reference on this payment." };

  const admin = createAdminClient();
  const { data: batchRows } = await admin
    .from("bulk_upload_payments")
    .select("id, sensei_id, amount_usd, status")
    .eq("batch_id", batchId);
  if (!batchRows || batchRows.length === 0) return { status: "error", message: "Batch not found." };

  const pending = batchRows.filter((r) => r.status === "pending");
  if (pending.length > 0) {
    await admin
      .from("bulk_upload_payments")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .in("id", pending.map((r) => r.id));
    await writeAudit(admin, {
      table_name: "bulk_upload_payments",
      record_id: batchId,
      action: "bulk_upload_batch_paid_online",
      new_value: { batch_id: batchId, tiers: batchRows.length, stripe_session: sessionId },
    });

    const senseiId = batchRows[0].sensei_id;
    const { data: sensei } = await admin.from("senseis").select("name, email").eq("id", senseiId).maybeSingle();
    if (sensei?.email) {
      const totalAmount = batchRows.reduce((sum, r) => sum + Number(r.amount_usd), 0);
      await sendConfirmationEmail({
        toEmail: sensei.email,
        recipientName: sensei.name ?? "Sensei",
        subject: "Payment received — bulk registration unlocked",
        bodyLines: [
          `Your payment of ${formatUSD(totalAmount)} covering ${batchRows.length} tier${batchRows.length === 1 ? "" : "s"} is confirmed. A Stripe receipt was also sent to the email you entered at checkout.`,
          `Batch reference: ${batchId.slice(0, 8).toUpperCase()}.`,
          "Go back to the Bulk Registration page and upload your CSV or table using the same School and Sensei — no further payment needed for these participants.",
          "Note: this batch reference is only for payment/upload tracking. Each participant gets their own individual Reference ID (sent separately once uploaded) — that is what they use with their IC/passport to sign in and record their kata.",
        ],
      });
    }
  }

  return { status: "paid", referenceIds: [batchId.slice(0, 8).toUpperCase()] };
}
