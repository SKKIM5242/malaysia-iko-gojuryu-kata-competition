"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getStripe, paymentsEnabled } from "@/lib/payments";
import { notifyParticipantScored } from "@/lib/notify";
import { isWithinSignInQuota } from "@/lib/sign-in-quota";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import type { TestimonialKind } from "@/lib/testimonials";

export interface AccountActionState {
  ok: boolean;
  error?: string;
  checkoutUrl?: string;
}

const EXTRA_ATTEMPTS_FEE_USD = 10;

/** Link a signed-in participant account to their PAID registration. */
export async function claimRegistration(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  // The confirmation email shows the reference ID with a space after the
  // first 4 characters purely for readability (e.g. "AC04 5C1A") -- strip
  // any whitespace here so a direct copy-paste of that spaced text works
  // without the participant needing to manually delete the space first.
  const reference = String(formData.get("reference") ?? "").replace(/\s+/g, "").toLowerCase();
  const ic = String(formData.get("ic_passport") ?? "").trim();
  if (!/^[0-9a-f]{8}$/.test(reference)) {
    return { ok: false, error: "Enter the 8-character reference ID from your registration." };
  }
  if (!ic) return { ok: false, error: "Enter the IC / passport used at registration." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_registration", {
    p_ref: reference,
    p_ic: ic,
  });
  if (error) return { ok: false, error: "Could not verify — please try again." };
  if (data !== "OK") return { ok: false, error: String(data) };
  revalidatePath("/account");
  return { ok: true };
}

/** One-click version of claimRegistration for a registration already known
 * (server-side, via email match) to belong to this account — used by the
 * "Start Recording" button on a pending-recordings list, so the participant
 * never has to retype their reference ID + IC to switch which registration
 * is currently linked for recording. */
export async function claimAndStartRecording(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  if (registrationId) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("claim_registration_by_id", {
      p_registration_id: registrationId,
    });
    if (data !== "OK") {
      redirect(`/account?claim_error=${encodeURIComponent(String(data ?? "Could not claim that registration."))}`);
    }
  }
  revalidatePath("/account");
  // Land back on the Record Your Kata section itself, not the page top --
  // otherwise the only visible sign anything happened is the pending list
  // shrinking by one row, and the participant has to scroll down manually
  // to find the recorder that's now active for their newly-claimed kata.
  redirect("/account#record-your-kata");
}

export interface DeleteVideoState {
  ok: boolean;
  error?: string;
  attemptsUsed?: number;
}

/** Deletes the participant's own submitted recording so they can re-record
 * — capped at 3 total chances shared with the pre-submission "delete &
 * re-record" flow, and blocked once a referee has already scored it. */
export async function deleteSubmittedVideo(
  _prev: DeleteVideoState,
  formData: FormData,
): Promise<DeleteVideoState> {
  const registrationId = String(formData.get("registration_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("registration_id, record_attempts")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile || profile.registration_id !== registrationId) {
    return { ok: false, error: "This recording isn't linked to your account." };
  }
  if ((profile.record_attempts ?? 0) >= 3) {
    return { ok: false, error: "No delete attempts left — 3 of 3 used.", attemptsUsed: 3 };
  }

  const { data: video } = await supabase
    .from("kata_videos")
    .select("id, storage_path")
    .eq("registration_id", registrationId)
    .maybeSingle();
  if (!video) return { ok: false, error: "No recording found to delete." };

  const { data: consumed } = await supabase.rpc("consume_delete_attempt");
  if (!consumed) {
    return { ok: false, error: "No delete attempts left — 3 of 3 used.", attemptsUsed: 3 };
  }

  const { error: delErr } = await supabase.from("kata_videos").delete().eq("id", video.id);
  if (delErr) {
    return {
      ok: false,
      error: "Could not delete — a referee may have already scored this recording.",
    };
  }
  await supabase.storage.from("kata-videos").remove([video.storage_path]);

  await writeAudit(supabase, {
    table_name: "kata_videos",
    record_id: video.id,
    action: "kata_video_deleted_by_participant",
    actor_id: user.id,
  });

  revalidatePath("/account");
  revalidatePath("/kata-arena");

  const { data: updated } = await supabase
    .from("profiles")
    .select("record_attempts")
    .eq("user_id", user.id)
    .maybeSingle();
  return { ok: true, attemptsUsed: updated?.record_attempts ?? 3 };
}

/** Burn one of the 5 re-record chances. Returns the new count. */
export async function useRecordAttempt(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("increment_record_attempts");
  return typeof data === "number" ? data : 5;
}

/** Requests 3 more delete-and-re-record chances for USD 10 — creates a
 * pending request the organizer confirms manually (same pattern as every
 * other payment here, since there's no real payment gateway). Refuses a
 * second request while one is already pending. */
export async function requestExtraAttempts(
  _prev: AccountActionState,
  _formData: FormData,
): Promise<AccountActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: existing } = await supabase
    .from("attempt_purchases")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return { ok: false, error: "You already have a purchase request awaiting confirmation." };

  const id = crypto.randomUUID();
  const { error } = await supabase.from("attempt_purchases").insert({ id, user_id: user.id });
  if (error) return { ok: false, error: "Could not submit the request — please try again." };

  if (paymentsEnabled()) {
    const origin =
      (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    try {
      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: EXTRA_ATTEMPTS_FEE_USD * 100,
              product_data: {
                name: "3 more delete-and-re-record attempts",
                description: "Malaysia Open Virtual Karate-do Kata Competition — Kata Arena recording",
              },
            },
            quantity: 1,
          },
        ],
        metadata: { attempt_purchase_id: id },
        success_url: `${origin}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/account?cancelled=1`,
      });
      if (session.url) return { ok: true, checkoutUrl: session.url };
    } catch {
      // Fall through to the manual bank-transfer flow below.
    }
  }

  revalidatePath("/account");
  return { ok: true };
}

/** Requests a new subscription once someone's sign-in quota (count and/or
 * valid date range — see lib/sign-in-quota.ts) runs out. Priced off their
 * CURRENT tier: USD 10 tier renews at 10x (USD 100); USD 100 and USD 200
 * tiers renew at the same price. Paid via Stripe Checkout (falls back to
 * the manual organizer-confirms flow if Stripe isn't configured); on
 * success (finalizeSubscriptionRenewalSession in lib/finalize.ts) the new
 * window is exactly 3 months from the purchase date with 30 sign-ins,
 * whichever runs out first. Refuses a second request while one is already
 * pending. */
export async function requestNewSubscription(
  _prev: AccountActionState,
  _formData: FormData,
): Promise<AccountActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: existing } = await supabase
    .from("subscription_renewals")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return { ok: false, error: "You already have a renewal request awaiting confirmation." };

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "sign_in_competition_id, registration_id, school_id, sensei_id, role, sign_in_limit, sign_in_count, sign_in_valid_from, sign_in_valid_until",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // Belt-and-suspenders alongside SubscriptionBlocked hiding its own
  // button: reject a renewal outright if this account isn't actually in a
  // state a payment would fix (e.g. its sign-in window just hasn't opened
  // yet) — this is the real Stripe-charging entry point, so it shouldn't
  // trust the UI alone to keep someone from paying for nothing.
  if (profile) {
    const quotaCheck = isWithinSignInQuota(profile);
    if (!quotaCheck.ok && quotaCheck.canRenew === false) {
      return { ok: false, error: "Your account doesn't need a renewal right now." };
    }
  }

  // Resolve which competition tier this account belongs to — usually
  // already tracked on the profile, but fall back to whatever record it's
  // linked to for an older account that predates that tracking.
  let competitionId: string | null = profile?.sign_in_competition_id ?? null;
  if (!competitionId && profile?.registration_id) {
    const { data: reg } = await supabase
      .from("registrations")
      .select("competition_id")
      .eq("id", profile.registration_id)
      .maybeSingle();
    competitionId = reg?.competition_id ?? null;
  }
  if (!competitionId && profile?.school_id) {
    const { data: school } = await supabase
      .from("schools")
      .select("registration_competition_id")
      .eq("id", profile.school_id)
      .maybeSingle();
    competitionId = school?.registration_competition_id ?? null;
  }
  if (!competitionId && profile?.sensei_id) {
    const { data: sensei } = await supabase
      .from("senseis")
      .select("registration_competition_id")
      .eq("id", profile.sensei_id)
      .maybeSingle();
    competitionId = sensei?.registration_competition_id ?? null;
  }
  if (!competitionId) {
    return {
      ok: false,
      error: "We couldn't find which competition tier your account belongs to — contact the organizer to renew manually.",
    };
  }

  const { data: competition } = await supabase
    .from("competitions")
    .select("registration_fee_usd, name")
    .eq("id", competitionId)
    .maybeSingle();
  const tierFee = Number(competition?.registration_fee_usd ?? 0);
  const renewalFee = tierFee === 10 ? tierFee * 10 : tierFee;
  if (!renewalFee) {
    return { ok: false, error: "Could not determine the renewal price — contact the organizer to renew manually." };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("subscription_renewals")
    .insert({ id, user_id: user.id, competition_id: competitionId, amount_usd: renewalFee });
  if (error) return { ok: false, error: "Could not submit the request — please try again." };

  if (paymentsEnabled()) {
    const origin =
      (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    try {
      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: renewalFee * 100,
              product_data: {
                name: "New sign-in subscription — 3 months, 30 sign-ins",
                description: `${competition?.name ?? "Malaysia Open Virtual Karate-do Kata Competition"} — Kata Arena sign-in renewal`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: { subscription_renewal_id: id },
        success_url: `${origin}/pay/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/account?cancelled=1`,
      });
      if (session.url) return { ok: true, checkoutUrl: session.url };
    } catch {
      // Fall through to the manual organizer-confirms flow below.
    }
  }

  revalidatePath("/account");
  return { ok: true };
}

/** Register the uploaded recording as the participant's competition entry. */
export async function submitKataVideo(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const path = String(formData.get("path") ?? "");
  const mime = String(formData.get("mime") ?? "video/webm");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!path.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid recording reference." };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("registration_id, participant_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.registration_id) {
    return { ok: false, error: "Link your paid registration before submitting a recording." };
  }

  // Server-side backstop for the recording window — deliberately generous
  // since the server can't know the participant's own timezone (the exact,
  // precise cutoff is enforced client-side in KataRecorder.tsx using their
  // own browser clock): stays open from the earliest moment anyone on
  // Earth could call it the event date (UTC+14) through the latest moment
  // anyone could still call it the deadline (UTC-12), so a participant
  // using their own correct local time is never wrongly rejected here.
  const { data: regRow } = await supabase
    .from("registrations")
    .select("payment_status, competition:competitions(event_date, registration_deadline)")
    .eq("id", profile.registration_id)
    .maybeSingle();
  const reg = regRow as unknown as {
    payment_status: string;
    competition: { event_date: string | null; registration_deadline: string | null } | null;
  } | null;

  // Re-check payment here, not just at link time. claim_registration and
  // auto_link_other_roles_by_email both require 'paid' before setting
  // profiles.registration_id, but that is a one-time gate: a registration
  // flipped back to pending or rejected afterwards (a refund, a chargeback,
  // an organizer correcting a row marked paid by mistake, or an admin-created
  // entry whose Stripe Checkout was abandoned) would otherwise keep its
  // recording rights indefinitely. Recording is what the entry fee buys, so
  // it has to follow the money on every submission.
  if (reg && reg.payment_status !== "paid") {
    return {
      ok: false,
      error:
        "Your linked registration is not paid, so recording is on hold. Once payment is confirmed you can submit straight away.",
    };
  }
  const competition = reg?.competition;
  const opensAt = competition?.event_date ? new Date(`${competition.event_date}T00:00:00+14:00`) : null;
  const closesAt = competition?.registration_deadline
    ? new Date(`${competition.registration_deadline}T23:59:59-12:00`)
    : null;
  const now = new Date();
  if (opensAt && now < opensAt) {
    return { ok: false, error: "Recording hasn't opened yet for your competition tier." };
  }
  if (closesAt && now > closesAt) {
    return { ok: false, error: "The recording window for your competition tier has closed." };
  }

  const { error } = await supabase.from("kata_videos").insert({
    registration_id: profile.registration_id,
    participant_id: profile.participant_id,
    user_id: user.id,
    storage_path: path,
    mime,
  });
  if (error) {
    return { ok: false, error: "Could not submit — you may already have a submitted recording." };
  }
  await writeAudit(supabase, {
    table_name: "kata_videos",
    record_id: profile.registration_id,
    action: "kata_video_submitted",
    new_value: { storage_path: path },
    actor_id: user.id,
  });
  revalidatePath("/account");
  return { ok: true };
}

/** A Top-3 winner's testimonial — video/voice (already uploaded client-side
 * to the `testimonials` bucket, this just registers the resulting path) or
 * a typed message. One per registration (table has a unique constraint);
 * submitting again fails rather than silently overwriting the first one.
 * Unlocks the Winner Certificate download (see CertificatesSection.tsx and
 * the certificate API route) and clears the reward payout hold (see
 * app/admin/commissions/page.tsx). */
export async function submitTestimonial(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const kind = String(formData.get("kind") ?? "");
  if (!["video", "voice", "message"].includes(kind)) {
    return { ok: false, error: "Invalid testimonial type." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("registration_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.registration_id) return { ok: false, error: "Link your registration first." };

  const { data: reg } = await supabase
    .from("registrations")
    .select("competition_id")
    .eq("id", profile.registration_id)
    .maybeSingle();
  if (!reg) return { ok: false, error: "Registration not found." };

  // Same Top-3 check the certificate route and reward payout list use —
  // a testimonial only ever applies to a registration that actually won.
  const rankings = await computeCategoryRankings(supabase, reg.competition_id as string);
  const isWinner = [...rankings.values()].flat().some((e) => e.registrationId === profile.registration_id);
  if (!isWinner) return { ok: false, error: "Testimonials are only for Top 3 winners." };

  let media_path: string | null = null;
  let message: string | null = null;
  if (kind === "message") {
    message = String(formData.get("message") ?? "").trim();
    if (!message) return { ok: false, error: "Type your testimonial message." };
  } else {
    media_path = String(formData.get("path") ?? "");
    if (!media_path.startsWith(`${user.id}/`)) return { ok: false, error: "Invalid recording reference." };
  }

  const { error } = await supabase.from("winner_testimonials").insert({
    registration_id: profile.registration_id,
    kind,
    media_path,
    message,
  });
  if (error) return { ok: false, error: "Could not save — you may have already submitted a testimonial." };
  await writeAudit(supabase, {
    table_name: "winner_testimonials",
    record_id: profile.registration_id,
    action: "testimonial_submitted",
    new_value: { kind: kind as TestimonialKind },
    actor_id: user.id,
  });
  revalidatePath("/account");
  revalidatePath("/winners");
  return { ok: true };
}

/** After a score is saved, checks whether this just completed the
 * competition's judges_required count for the video — if so, notifies the
 * participant (email + Telegram DM) exactly once. Runs on the admin
 * (service-role) client since the submitting referee's own session has no
 * read access to another user's profile (telegram_chat_id) or email.
 * Guarded by kata_videos.participant_notified_at so a referee editing their
 * score afterward never re-sends it. Best-effort — never throws. */
async function maybeNotifyParticipantScored(videoId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { count } = await admin
      .from("video_scores")
      .select("id", { count: "exact", head: true })
      .eq("video_id", videoId);
    const { data: video } = await admin
      .from("kata_videos")
      .select(
        "participant_notified_at, registration_id, " +
          "participant:participants(full_name, email), " +
          "registration:registrations(category:categories(name), competition:competitions(judges_required))",
      )
      .eq("id", videoId)
      .maybeSingle();
    const v = video as unknown as {
      participant_notified_at: string | null;
      registration_id: string;
      participant: { full_name: string; email: string | null } | null;
      registration: {
        category: { name: string } | null;
        competition: { judges_required: number } | null;
      } | null;
    } | null;
    if (!v || v.participant_notified_at) return;
    const judgesRequired = v.registration?.competition?.judges_required ?? 3;
    if ((count ?? 0) < judgesRequired) return;

    // Atomic claim — only the request that actually flips this from null to
    // a timestamp proceeds to send, guarding against two referees' scores
    // landing at nearly the same moment both trying to fire the notice.
    const { data: claimed } = await admin
      .from("kata_videos")
      .update({ participant_notified_at: new Date().toISOString() })
      .eq("id", videoId)
      .is("participant_notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return;

    const { data: profile } = await admin
      .from("profiles")
      .select("telegram_chat_id")
      .eq("registration_id", v.registration_id)
      .maybeSingle();

    await notifyParticipantScored({
      participantEmail: v.participant?.email ?? null,
      participantTelegramChatId: profile?.telegram_chat_id ?? null,
      participantName: v.participant?.full_name ?? "Participant",
      categoryName: v.registration?.category?.name ?? null,
    });
  } catch {
    // Best-effort — the score itself already saved successfully regardless.
  }
}

/** Referee: save a 0.0–10.0 score for an assigned video — the sum of the
 * official rubric's 7 criteria (1+1+1+1+1+3+3 = 11 max). */
export async function submitScore(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const raw = String(formData.get("score") ?? "").trim();
  const score = Math.round(Number(raw) * 10) / 10;
  // Optional per-criterion breakdown (10 rows = Score Sheet 1, 7 rows =
  // Score Sheet 2 of the official rubric) — kept alongside the total so
  // Admin/Organizer can review how it was made up. Absent when an
  // Admin/Organizer override-scores via the plain single-number field on
  // /admin/judging.
  const criteriaRaw = formData.getAll("criteria");
  const criteria = criteriaRaw.length > 0 ? criteriaRaw.map((v) => Number(v)) : null;
  // A Total Score of 0 disqualifies the entry — a reason is mandatory
  // (dropdown from the organizer's official list, or free text), enforced
  // here as well as client-side in RefereeScoring.tsx's submitBlocked.
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !videoId || Number.isNaN(score) || score < 0 || score > 10) {
    revalidatePath("/account");
    return;
  }
  if (score === 0 && !reason) {
    revalidatePath("/account");
    return;
  }
  // Admin/Organizer/Staff full-access override: they may score any
  // recording, not just ones formally assigned to them. This intentionally
  // does NOT self-assign into referee_assignments — an override isn't a
  // judge slot, and doing so was silently pushing recordings past their
  // "Judges per recording" target. The RLS policy scores_manager_upsert
  // already allows this upsert for admin/organizer/staff without requiring
  // a referee_assignments row; the Judging page and Full View read
  // overrides straight from video_scores instead (see overrideByVideo in
  // app/admin/judging/page.tsx).
  const disqualification_reason = score === 0 ? reason : null;
  const { error } = await supabase
    .from("video_scores")
    .upsert(
      { video_id: videoId, referee_user_id: user.id, score, criteria, disqualification_reason },
      { onConflict: "video_id,referee_user_id" },
    );
  if (!error) {
    await writeAudit(supabase, {
      table_name: "video_scores",
      record_id: videoId,
      action: "score_submitted",
      new_value: { score, disqualification_reason },
      actor_id: user.id,
    });
    await maybeNotifyParticipantScored(videoId);
  }
  revalidatePath("/account");
}
