import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/payments";
import { writeAudit } from "@/lib/audit";

export type FinalizeResult =
  | { status: "paid"; referenceId: string }
  | { status: "unpaid" }
  | { status: "error"; message: string };

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

  // Already finalised (webhook vs success page race)?
  const { data: existing } = await admin
    .from("registrations")
    .select("id")
    .eq("payment_reference", sessionId)
    .maybeSingle();
  if (existing) return { status: "paid", referenceId: existing.id.slice(0, 8).toUpperCase() };

  const draftId = session.metadata?.draft_id;
  if (!draftId) return { status: "error", message: "Payment received but no draft reference — contact the organiser with your Stripe receipt." };

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
      .eq("payment_reference", sessionId)
      .maybeSingle();
    if (again) return { status: "paid", referenceId: again.id.slice(0, 8).toUpperCase() };
    return { status: "error", message: "Payment received but registration data expired — contact the organiser with your Stripe receipt." };
  }

  const v = draft.payload as Record<string, string>;
  const participantId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();

  const { error: pErr } = await admin.from("participants").insert({
    id: participantId,
    full_name: v.full_name,
    ic_passport: v.ic_passport,
    date_of_birth: v.date_of_birth,
    gender: v.gender,
    belt_rank: v.belt_rank,
    school_id: v.school_id,
    sensei_id: v.sensei_id,
  });
  if (pErr) return { status: "error", message: "Payment received but saving failed — contact the organiser with your Stripe receipt." };

  if (v.bank_name && v.bank_account_no && v.bank_account_name) {
    await admin.from("participant_bank_details").insert({
      participant_id: participantId,
      bank_name: v.bank_name,
      bank_account_no: v.bank_account_no,
      bank_account_name: v.bank_account_name,
    });
  }

  const { error: rErr } = await admin.from("registrations").insert({
    id: registrationId,
    competition_id: v.competition_id,
    participant_id: participantId,
    category_id: v.category_id,
    division: v.division ?? null,
    payment_status: "paid",
    payment_reference: sessionId,
    notes: "Paid online via Stripe Checkout",
  });
  if (rErr) {
    await admin.from("participants").delete().eq("id", participantId);
    return { status: "error", message: "Payment received but saving failed — contact the organiser with your Stripe receipt." };
  }

  await writeAudit(admin, {
    table_name: "registrations",
    record_id: registrationId,
    action: "registration_paid_online",
    new_value: {
      participant_id: participantId,
      category_id: v.category_id,
      payment_status: "paid",
      stripe_session: sessionId,
    },
  });

  await admin.from("registration_drafts").delete().eq("id", draftId);

  return { status: "paid", referenceId: registrationId.slice(0, 8).toUpperCase() };
}
