"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import { resolveCategory } from "@/lib/division";
import { sendConfirmationEmail } from "@/lib/notify";
import type { Category } from "@/lib/types";

export interface RegisterState {
  ok: boolean;
  referenceIds?: string[];
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
  ["postcode", "Postcode is required"],
  ["home_country", "Home country is required"],
  ["city_town", "City / town is required"],
  ["school_id", "School is required"],
  ["sensei_id", "Coach / sensei is required"],
  ["bank_name", "Bank name is required"],
  ["bank_account_no", "Bank account number is required"],
  ["bank_account_name", "Bank account holder name is required"],
];

interface ResolvedEvent {
  kataBase: string;
  category: Category;
  competitionId: string;
  competitionName: string;
}

export async function submitRegistration(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const values: Record<string, string> = {};
  for (const [key] of REQUIRED) values[key] = String(formData.get(key) ?? "").trim();
  values.payment_reference = String(formData.get("payment_reference") ?? "").trim();
  values.referral_source = String(formData.get("referral_source") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  for (const [key, message] of REQUIRED) {
    if (!values[key]) fieldErrors[key] = message;
  }

  // Up to 3 competition tiers may be registered for in one submission — tier
  // 0 is required, tiers 1/2 are entirely optional extra tiers a Sensei or
  // participant can pick up in the same sitting (each still gets its own set
  // of up to 3 kata events).
  const tierCompetitionIds = [0, 1, 2]
    .map((i) => String(formData.get(`competition_id_${i}`) ?? "").trim())
    .filter(Boolean);
  if (tierCompetitionIds.length === 0) {
    return { ok: false, error: "No open competition to register for." };
  }
  const tierKatas = tierCompetitionIds.map((_, i) => [
    String(formData.get(`kata_${i}_1`) ?? "").trim(),
    String(formData.get(`kata_${i}_2`) ?? "").trim(),
    String(formData.get(`kata_${i}_3`) ?? "").trim(),
  ]);
  if (!tierKatas[0][0]) {
    fieldErrors.kata_base = "Kata event is required";
  }
  if (values.date_of_birth && Number.isNaN(Date.parse(values.date_of_birth))) {
    fieldErrors.date_of_birth = "Enter a valid date of birth";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  values.division = values.gender.toLowerCase() === "female" ? "Female" : "Male";

  const resolvedEvents: ResolvedEvent[] = [];
  let anyCompetition: { id: string; name: string; event_date: string } | null = null;

  for (let i = 0; i < tierCompetitionIds.length; i++) {
    const competitionId = tierCompetitionIds[i];
    const kataBases = tierKatas[i].filter(Boolean);
    if (kataBases.length === 0) continue; // an optional tier the visitor skipped

    if (new Set(kataBases).size !== kataBases.length) {
      return {
        ok: false,
        error: "Each kata event must be different — you can't register the same kata twice in the same tier.",
        fieldErrors: { kata_base: "Duplicate kata event" },
      };
    }

    const { data: competition } = await supabase
      .from("competitions")
      .select("id, name, status, event_date, registration_deadline, registration_fee_usd")
      .eq("id", competitionId)
      .maybeSingle();
    if (!competition) {
      return { ok: false, error: "Competition not found. Please refresh and try again." };
    }
    if (competition.status !== "open") {
      return { ok: false, error: `Registration is closed for ${competition.name}.` };
    }
    if (
      competition.registration_deadline &&
      new Date(competition.registration_deadline + "T23:59:59") < new Date()
    ) {
      return { ok: false, error: `The registration deadline for ${competition.name} has passed.` };
    }
    anyCompetition = { id: competition.id, name: competition.name, event_date: competition.event_date };

    const { data: kataCount } = await supabase.rpc("ic_registration_count", {
      p_ic: values.ic_passport,
      p_competition: competitionId,
    });
    if (typeof kataCount === "number" && kataCount + kataBases.length > 3) {
      return {
        ok: false,
        error: `Maximum Kata allow to compete is 3 only for ${competition.name} — you already have ${kataCount} registered there.`,
      };
    }
    for (const kb of kataBases) {
      const { data: alreadyHasKata } = await supabase.rpc("ic_has_kata", {
        p_ic: values.ic_passport,
        p_competition: competitionId,
        p_kata_base: kb,
      });
      if (alreadyHasKata === true) {
        return {
          ok: false,
          error: `You are already registered for ${kb} in ${competition.name}.`,
          fieldErrors: { kata_base: "Already registered for this kata" },
        };
      }
    }

    const { data: catRows } = await supabase
      .from("categories")
      .select("*")
      .eq("competition_id", competitionId)
      .order("sort_order");
    const categories = (catRows as Category[]) ?? [];

    for (const kb of kataBases) {
      const resolved = resolveCategory(
        categories,
        kb,
        values.date_of_birth,
        values.belt_rank,
        values.gender,
        competition.event_date,
      );
      if (!resolved.category) {
        return {
          ok: false,
          error: resolved.error ?? `No matching category for ${kb} in ${competition.name}.`,
          fieldErrors: { kata_base: resolved.error ?? "No matching category" },
        };
      }
      if (resolved.category.max_participants != null) {
        const { data: categoryPaid } = await supabase.rpc("category_paid_count", {
          p_category: resolved.category.id,
        });
        if (typeof categoryPaid === "number" && categoryPaid >= resolved.category.max_participants) {
          return {
            ok: false,
            error: `${kb}'s sub-category in ${competition.name} is full. Please choose a different kata or check back later.`,
            fieldErrors: { kata_base: "Sub-category full" },
          };
        }
      }
      resolvedEvents.push({
        kataBase: kb,
        category: resolved.category,
        competitionId,
        competitionName: competition.name,
      });
    }
  }

  if (resolvedEvents.length === 0 || !anyCompetition) {
    return { ok: false, error: "No open competition to register for." };
  }

  // Latest belt/rank certificate: required for single-participant
  // registration — uploaded to private storage before the registration is
  // written (works for both the manual flow and the pay-first flow, where
  // only the path travels in the draft). "Pending confirmation" is only
  // ever set by a Sensei on the bulk registration path, never here.
  const certificate = formData.get("certificate");
  if (!(certificate instanceof File) || certificate.size === 0) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { certificate: "Latest rank certificate is required" },
    };
  }
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
      error: "Could not upload the certificate. Please try again.",
      fieldErrors: { certificate: "Upload failed" },
    };
  }
  values.certificate_path = path;
  values.rank_confirmation = "certificate_uploaded";

  // Per-tier fee — each tier's own registration_fee_usd × its own event
  // count — summed into one combined checkout/manual total.
  const feeByCompetition = new Map<string, number>();
  for (const ev of resolvedEvents) {
    if (!feeByCompetition.has(ev.competitionId)) {
      const { data: c } = await supabase
        .from("competitions")
        .select("registration_fee_usd")
        .eq("id", ev.competitionId)
        .maybeSingle();
      feeByCompetition.set(ev.competitionId, Number(c?.registration_fee_usd ?? 0));
    }
  }
  const eventsByCompetition = new Map<string, ResolvedEvent[]>();
  for (const ev of resolvedEvents) {
    const list = eventsByCompetition.get(ev.competitionId) ?? [];
    list.push(ev);
    eventsByCompetition.set(ev.competitionId, list);
  }
  const totalFee = [...eventsByCompetition.entries()].reduce(
    (sum, [compId, evs]) => sum + (feeByCompetition.get(compId) ?? 0) * evs.length,
    0,
  );

  // ── Pay-before-submit: when the gateway is configured and the total fee is
  // above zero, no registration row is written yet. The validated payload is
  // parked as a draft and the visitor is sent to Stripe Checkout; the webhook
  // or the success page finalises it as N paid registrations (one per event,
  // possibly spread across more than one competition tier).
  if (paymentsEnabled() && totalFee > 0) {
    const draftId = crypto.randomUUID();
    values.events_json = JSON.stringify(
      resolvedEvents.map((e) => ({
        kata_base: e.kataBase,
        category_id: e.category.id,
        competition_id: e.competitionId,
      })),
    );
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
        line_items: [...eventsByCompetition.entries()].map(([compId, evs]) => ({
          price_data: {
            currency: "usd",
            unit_amount: Math.round((feeByCompetition.get(compId) ?? 0) * 100),
            product_data: {
              name: `Registration — ${evs[0].competitionName}`,
              description: `Participant: ${values.full_name} — ${evs.map((e) => e.kataBase).join(", ")}`,
            },
          },
          quantity: evs.length,
        })),
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
  // under the locked-down RLS, so INSERT ... RETURNING would fail. One
  // participant + one bank-details row covers every event across every
  // tier; each event still gets its own registration row (one kata per
  // registration, as before), so it can be individually judged and scored.
  const participantId = crypto.randomUUID();

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
    postcode: values.postcode,
    certificate_path: values.certificate_path || null,
    rank_confirmation: values.rank_confirmation,
    school_id: values.school_id,
    sensei_id: values.sensei_id,
    referral_source: values.referral_source || null,
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

  const referenceIds: string[] = [];
  for (const ev of resolvedEvents) {
    const registrationId = crypto.randomUUID();
    const { error: rErr } = await supabase.from("registrations").insert({
      id: registrationId,
      competition_id: ev.competitionId,
      participant_id: participantId,
      category_id: ev.category.id,
      division: values.division,
      payment_status: "pending",
      payment_reference: values.payment_reference || null,
    });
    if (rErr) {
      // roll back the orphan participant (and any registrations already
      // created this loop) so a retry doesn't trip the duplicate check
      await supabase.from("registrations").delete().eq("participant_id", participantId);
      await supabase.from("participants").delete().eq("id", participantId);
      return { ok: false, error: "Could not save registration. Please try again." };
    }
    await writeAudit(supabase, {
      table_name: "registrations",
      record_id: registrationId,
      action: "registration_submitted",
      new_value: {
        participant_id: participantId,
        category_id: ev.category.id,
        kata_base: ev.kataBase,
        competition_id: ev.competitionId,
        payment_status: "pending",
      },
    });
    referenceIds.push(registrationId.slice(0, 8).toUpperCase());
  }

  // Best-effort: if an account with this email already exists, it picks up
  // the "participant" role right away — one account can hold more than one role.
  if (values.email) {
    await supabase.rpc("grant_profile_role", { p_email: values.email, p_role: "participant" });
  }
  const tierSummary = [...eventsByCompetition.entries()]
    .map(([, evs]) => `${evs[0].competitionName} — ${evs.map((e) => e.kataBase).join(", ")}`)
    .join("; ");
  await sendConfirmationEmail({
    toEmail: values.email || null,
    recipientName: values.full_name,
    subject: `Registration confirmed — ${resolvedEvents.length} event${resolvedEvents.length === 1 ? "" : "s"}`,
    telegramCategory: "participant",
    bodyLines: [
      `This confirms your registration — ${resolvedEvents.length} kata event${resolvedEvents.length === 1 ? "" : "s"}: ${tierSummary}.`,
      `Your reference ID${referenceIds.length > 1 ? "s" : ""}: ${referenceIds.join(", ")}.`,
      "Payment status: pending — transfer the registration fee and send your receipt to the organizer (see the announcement for bank details). The organizer will confirm your payment, after which your name appears on the participants list.",
      "Organizer contact: WhatsApp +60 12-453 2831 / kimsiewkiew@gmail.com",
      "",
      "Once signed in, you can record & submit your own registered event(s) — and every event once Winners are announced.",
      "Next: once every registration under this email is done, create your sign-in account (or sign in if you already have one) using the Kata Arena log in link below.",
    ],
  });

  return { ok: true, referenceIds };
}
