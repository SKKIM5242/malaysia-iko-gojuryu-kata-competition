"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { sendConfirmationEmail } from "@/lib/notify";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import { normalizeIban } from "@/lib/bank";

export interface DirectoryState {
  ok: boolean;
  error?: string;
  name?: string;
  fieldErrors?: Record<string, string>;
  /** When Stripe is configured, the tier registration fee checkout to
   * redirect to right after the record is created. */
  checkoutUrl?: string;
}

/** Validates the chosen competition tier and returns it with its fee —
 * School/Sensei directory registration costs the tier's own registration
 * fee (USD 10 / 100 / 200), paid once per record. */
async function loadTier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string,
): Promise<{ id: string; name: string; fee: number } | null> {
  if (!competitionId) return null;
  const { data } = await supabase
    .from("competitions")
    .select("id, name, registration_fee_usd, status")
    .eq("id", competitionId)
    .maybeSingle();
  if (!data || data.status !== "open") return null;
  return { id: data.id, name: data.name, fee: Number(data.registration_fee_usd ?? 0) };
}

/** The 3-slot "Kata Competition Tier(s) you'll participate in" (see
 * components/TierSlotsField): tier 1 required, 2 and 3 optional. Validated
 * against real open competition ids so a hand-crafted POST can't store an
 * arbitrary uuid. Returns an error string on the one failure case (tier 1
 * missing or invalid) so the caller can surface it the same way as every
 * other required-field check in this file. */
async function readTierSlots(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
): Promise<
  | { tier1: string; tier2: string | null; tier3: string | null }
  | { error: string }
> {
  const { data } = await supabase.from("competitions").select("id").eq("status", "open");
  const valid = new Set((data ?? []).map((c) => c.id as string));
  const read = (name: string) => {
    const v = String(formData.get(name) ?? "").trim();
    return v && valid.has(v) ? v : null;
  };
  const tier1 = read("participating_tier_1_id");
  if (!tier1) return { error: "Select at least Tier 1 for the kata competition tier(s) you'll participate in." };
  return { tier1, tier2: read("participating_tier_2_id"), tier3: read("participating_tier_3_id") };
}

/** Best-effort Stripe checkout for the tier fee; null when payments are
 * not configured (record stays pending for a manual payment instead). */
async function directoryCheckout(
  kind: "school" | "sensei",
  recordId: string,
  displayName: string,
  tier: { id: string; name: string; fee: number },
): Promise<string | null> {
  if (!paymentsEnabled() || tier.fee <= 0) return null;
  const origin =
    (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(tier.fee * 100),
            product_data: {
              name: `${kind === "school" ? "School / Dojo" : "Sensei / Coach"} registration — ${tier.name}`,
              description: `${displayName} — IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: kind === "school" ? { school_id: recordId } : { sensei_id: recordId },
      success_url: `${origin}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/register?cancelled=1`,
    });
    return session.url;
  } catch {
    return null;
  }
}

/** Public School / Dojo self-registration (anonymous insert allowed by RLS). */
export async function registerSchool(
  _prev: DirectoryState,
  formData: FormData,
): Promise<DirectoryState> {
  const name = String(formData.get("name") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const contact_title = String(formData.get("contact_title") ?? "").trim();
  const contact_name = String(formData.get("contact_name") ?? "").trim();
  const contact_karate_title = String(formData.get("contact_karate_title") ?? "").trim();
  const contact_rank = String(formData.get("contact_rank") ?? "").trim();
  const contact_ic_passport = String(formData.get("contact_ic_passport") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const home_address = String(formData.get("home_address") ?? "").trim();
  const city_town = String(formData.get("city_town") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const home_country = String(formData.get("home_country") ?? "").trim();
  const bank_name = String(formData.get("bank_name") ?? "").trim();
  const bank_account_no = normalizeIban(String(formData.get("bank_account_no") ?? ""));
  const bank_account_name = String(formData.get("bank_account_name") ?? "").trim();
  const competition_id = String(formData.get("competition_id") ?? "").trim();
  const referral_source = String(formData.get("referral_source") ?? "").trim();
  if (!name) return { ok: false, error: "School / dojo name is required." };
  if (!contact_title || !["Mr.", "Ms."].includes(contact_title)) {
    return { ok: false, error: "Person in-charge's title is required." };
  }
  if (!contact_name) return { ok: false, error: "Person in-charge's name is required." };
  if (!contact_karate_title) return { ok: false, error: "Person in-charge's karate title is required." };
  if (!contact_rank) return { ok: false, error: "Person in-charge's rank in karate-do is required." };
  if (!contact_ic_passport) return { ok: false, error: "Person in-charge's IC / Passport No. is required." };
  if (!email) return { ok: false, error: "Email address is required." };
  if (!phone) return { ok: false, error: "Mobile phone is required." };
  if (!home_address) return { ok: false, error: "Home address is required." };
  if (!city_town) return { ok: false, error: "City / Town is required." };
  if (!postcode) return { ok: false, error: "Postcode is required." };
  if (!home_country) return { ok: false, error: "Home country is required." };
  if (!bank_name || !bank_account_no || !bank_account_name) {
    return { ok: false, error: "Bank name, account number, and account holder name are required." };
  }
  const gender = contact_title === "Mr." ? "male" : "female";

  const supabase = await createClient();
  const tier = await loadTier(supabase, competition_id);
  if (!tier) return { ok: false, error: "Select the competition tier you are registering under." };
  const slots = await readTierSlots(supabase, formData);
  if ("error" in slots) return { ok: false, error: slots.error };
  const { data: existing } = await supabase
    .from("schools")
    .select("id")
    .ilike("name", name)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: "A school with this name is already registered." };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("schools").insert({
    id,
    name,
    state: state || null,
    contact_title,
    contact_name,
    contact_karate_title,
    contact_rank,
    contact_ic_passport,
    gender,
    email,
    phone,
    home_address,
    city_town,
    postcode,
    home_country,
    bank_name,
    bank_account_no,
    bank_account_name,
    referral_source: referral_source || null,
    registration_competition_id: tier.id,
    participating_tier_1_id: slots.tier1,
    participating_tier_2_id: slots.tier2,
    participating_tier_3_id: slots.tier3,
  });
  if (error) return { ok: false, error: "Could not register the school. Please try again." };

  await writeAudit(supabase, {
    table_name: "schools",
    record_id: id,
    action: "school_self_registered",
    new_value: { name, state, contact_title, contact_name, contact_karate_title, contact_rank, tier: tier.name },
  });
  // Best-effort: if an account with this email already exists, it picks up
  // the "school" role right away — one account can hold more than one role.
  await supabase.rpc("grant_profile_role", { p_email: email, p_role: "school" });
  const checkoutUrl = await directoryCheckout("school", id, name, tier);
  await sendConfirmationEmail({
    toEmail: email,
    recipientName: name,
    subject: `School / Dojo registered — ${name}`,
    telegramCategory: "school",
    bodyLines: [
      `"${name}" is now in the directory and can be selected on registration forms.`,
      `Registration tier: ${tier.name} — one-time registration fee USD ${tier.fee.toFixed(2)}.`,
      "Next: register your Sensei / Coach, then register participants.",
      "",
      "Your paid tier registration fee unlocks unlimited sign-in to watch your own students' " +
        "kata recordings and judges scores any time — if you have 10 or more participants' " +
        "category events, you qualify for a 10% share of their registration fees.",
      "",
      "Next: once every registration under this email is done, create your sign-in account " +
        "(or sign in if you already have one) using the Kata Arena log in link below.",
    ],
  });
  return { ok: true, name, checkoutUrl: checkoutUrl ?? undefined };
}

/** Public Sensei / Coach self-registration (anonymous insert allowed by RLS). */
export async function registerSensei(
  _prev: DirectoryState,
  formData: FormData,
): Promise<DirectoryState> {
  const name = String(formData.get("name") ?? "").trim();
  const rank = String(formData.get("rank") ?? "").trim();
  const ic_passport = String(formData.get("ic_passport") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const school_id = String(formData.get("school_id") ?? "").trim();
  const registered_by = ["self", "student", "other"].includes(String(formData.get("registered_by")))
    ? String(formData.get("registered_by"))
    : "other";
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const home_address = String(formData.get("home_address") ?? "").trim();
  const city_town = String(formData.get("city_town") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const home_country = String(formData.get("home_country") ?? "").trim();
  const bank_name = String(formData.get("bank_name") ?? "").trim();
  const bank_account_no = normalizeIban(String(formData.get("bank_account_no") ?? ""));
  const bank_account_name = String(formData.get("bank_account_name") ?? "").trim();
  const competition_id = String(formData.get("competition_id") ?? "").trim();
  const referral_source = String(formData.get("referral_source") ?? "").trim();
  if (!name) return { ok: false, error: "Sensei / coach name is required." };
  if (!rank) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { rank: "Latest rank is required" },
    };
  }
  if (!ic_passport) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { ic_passport: "IC / Passport No. is required" },
    };
  }
  if (!["male", "female"].includes(gender)) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { gender: "Sex is required" },
    };
  }
  if (!school_id) return { ok: false, error: "Select the sensei's school / dojo." };
  if (!email) return { ok: false, error: "Email address is required." };
  if (!phone) return { ok: false, error: "Mobile phone is required." };
  if (!home_address) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { home_address: "Home address is required" },
    };
  }
  if (!city_town) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { city_town: "City / Town is required" },
    };
  }
  if (!postcode) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { postcode: "Postcode is required" },
    };
  }
  if (!home_country) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { home_country: "Home country is required" },
    };
  }
  if (!bank_name || !bank_account_no || !bank_account_name) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: {
        ...(!bank_name ? { bank_name: "Bank name is required" } : {}),
        ...(!bank_account_no ? { bank_account_no: "Account No. / IBAN is required" } : {}),
        ...(!bank_account_name ? { bank_account_name: "Account holder name is required" } : {}),
      },
    };
  }

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

  const supabase = await createClient();
  const tier = await loadTier(supabase, competition_id);
  if (!tier) return { ok: false, error: "Select the competition tier you are registering under." };
  const slots = await readTierSlots(supabase, formData);
  if ("error" in slots) return { ok: false, error: slots.error };
  const { data: existing } = await supabase
    .from("senseis")
    .select("id")
    .ilike("name", name)
    .eq("school_id", school_id)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: "This sensei is already registered for that school." };
  }

  const ext = (certificate.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const certificate_path = `sensei-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("certificates")
    .upload(certificate_path, certificate, { contentType: certificate.type || "image/jpeg" });
  if (upErr) return { ok: false, error: "Could not upload the certificate. Please try again." };

  const id = crypto.randomUUID();
  const { error } = await supabase.from("senseis").insert({
    id,
    name,
    rank,
    ic_passport,
    gender,
    school_id,
    registered_by,
    email,
    phone,
    certificate_path,
    home_address,
    city_town,
    postcode,
    home_country,
    bank_name,
    bank_account_no,
    bank_account_name,
    referral_source: referral_source || null,
    registration_competition_id: tier.id,
    participating_tier_1_id: slots.tier1,
    participating_tier_2_id: slots.tier2,
    participating_tier_3_id: slots.tier3,
  });
  if (error) return { ok: false, error: "Could not register the sensei. Please try again." };

  await writeAudit(supabase, {
    table_name: "senseis",
    record_id: id,
    action: "sensei_self_registered",
    new_value: { name, rank, school_id, tier: tier.name },
  });
  // Best-effort: if an account with this email already exists, it picks up
  // the "sensei" role right away — one account can hold more than one role.
  await supabase.rpc("grant_profile_role", { p_email: email, p_role: "sensei" });
  const checkoutUrl = await directoryCheckout("sensei", id, name, tier);
  await sendConfirmationEmail({
    toEmail: email,
    recipientName: name,
    subject: `Sensei / Coach registered — ${name}`,
    telegramCategory: "school",
    bodyLines: [
      `"${name}" is now in the directory.`,
      `Registration tier: ${tier.name} — one-time registration fee USD ${tier.fee.toFixed(2)}.`,
      "Next: register participants or bulk-register your students.",
      "",
      "Your paid tier registration fee unlocks unlimited sign-in to watch your own students' " +
        "kata recordings and judges scores any time — if you have 10 or more participants' " +
        "category events, you qualify for a 10% share of their registration fees.",
      "",
      "Next: once every registration under this email is done, create your sign-in account " +
        "(or sign in if you already have one) using the Kata Arena log in link below.",
    ],
  });
  return { ok: true, name, checkoutUrl: checkoutUrl ?? undefined };
}
