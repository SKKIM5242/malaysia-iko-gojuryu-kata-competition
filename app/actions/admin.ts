"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { kataBaseOf, groupByKata, ageAt, resolveCategory, AGE_BRACKETS } from "@/lib/division";
import { KATA_FAMILIES, categoriesInFamily, adjacentKataOf, type KataFamily } from "@/lib/kata-families";
import { WATERMARK_DIRECTIONS } from "@/lib/watermark";
import {
  logCategoryMerge, snapshotRegistrationCategories, undoLastCategoryMerge,
  logCategoryDelete, undoLastCategoryDelete,
} from "@/lib/category-merge";
import { getStripe, paymentsEnabled, REFEREE_DEPOSIT_USD, AUDIENCE_FEE_USD } from "@/lib/payments";
import {
  notifyRefereeUnassigned, sendConfirmationEmail, notifyAnnouncementPublished,
  notifyCertificatesPublished, competitionCertificateRecipients, notifyInvitationCodeIssued, notifyStatusChanged,
  notifyOrganizersBulkPaymentConfirmed, notifyOrganizersBulkTallyDone, notifySenseiBulkPaymentConfirmed,
  notifySenseiBulkCsvConfirmed, notifyOrganizersDirectoryBulkUpload, sendAdminTelegramDM,
  notifyParticipantEmailChanged, notifyTestimonialDeleted, sendStaffEmail, sendStaffTelegramDM,
  refereeVideoNotice, notifyVideoAssignment,
} from "@/lib/notify";
import { autoAssignForVideos } from "@/lib/auto-assign";
import { applySubscriptionRenewalTerms } from "@/lib/finalize";
import type { PaymentStatus, Category } from "@/lib/types";
import { parseCsvWithHeader, parseDDMMYYYY, type CsvUploadResult } from "@/lib/csv-bulk";
import { PROFILE_ROLE_KEYS, KATA_FAMILY_BELT_GROUP_OPTIONS } from "@/lib/reference-data";
import { normalizeIban } from "@/lib/bank";
import { codePrefix, nextSequentialCode, shortTierName } from "@/lib/invitation-codes";
import { listTelegramGroups, type TelegramCategory } from "@/lib/telegram";
import { ACCESS_MATRIX, accessMatrixAnnouncementIntro } from "@/lib/access-matrix";
import { DEFAULT_COMPARISON_ROWS } from "@/components/AccessComparisonTable";
import { DEFAULT_AUTO_ASSIGN_CRITERIA } from "@/lib/auto-assign-criteria";
import { formatUSD, formatDate } from "@/components/ui";
import { sanitizeTextStyle } from "@/lib/certificate-render";

/**
 * Admin server actions. Sprint 3 runs these under the v1 open RLS policies;
 * Sprint 4 gates /admin behind a session and the actions verify it.
 */

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, actorId: user?.id ?? null };
}

/** The caller's own role, read server-side from their session — never
 * trust a role value supplied by the client for permission checks. */
async function getActorRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
): Promise<string | null> {
  if (!actorId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role, approved")
    .eq("user_id", actorId)
    .maybeSingle();
  return data?.approved ? data.role : null;
}

/** Bulk CSV upload is restricted to Admin/Organizer only — returns an error
 * string to short-circuit a CsvUploadResult-returning action, or null when
 * the caller is allowed to proceed. */
async function bulkUploadRoleError(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
): Promise<string | null> {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer"].includes(role ?? "")) {
    return "Only Admin or Organizer accounts can bulk-upload records.";
  }
  return null;
}

/** Participant Support has edit access to registrations/participants and can
 * merge/edit/delete categories, but never delete registrations/participants
 * and never manages competitions — called at the top of every action that
 * should reject them specifically. */
async function blockCustomerSupport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (role === "customer_support") {
    backTo(returnTo, { error: "Participant Support accounts cannot perform this action." });
  }
}

/** Only Admin/Organizer (and legacy "staff") may create or edit competitions,
 * or add/edit/delete/merge/reorder their kata categories — Referee and
 * Participant Support can view but not change either. */
async function requireCompetitionManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can manage competitions." });
  }
}

/** Testimonial moderation specifically — the competition-manager tier PLUS
 * Participant Support. Support is deliberately blocked from competition
 * management everywhere else, but taking down a testimonial that's abusive
 * or works against the competition's purpose is front-line moderation, and
 * the organizer asked for Support to be able to act on it without waiting
 * for an Admin. Deliberately its own gate rather than widening
 * requireCompetitionManager, which would hand Support the whole
 * competition/kata-category surface as a side effect. */
async function requireTestimonialModerator(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer / Participant Support can remove a testimonial." });
  }
}

/** Only Admin/Organizer (and legacy "staff") may create, edit, reorder, or
 * delete announcements/notes/messages — every other admin-panel role
 * (Referee/Judge, Participant Support) has read-only access to the Content
 * page's listing. */
async function requireContentManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can manage announcements." });
  }
}

/** Referee accounts can view registrations/participants but never change
 * payment status or delete anything — called at the top of the actions that
 * should reject them specifically. */
async function blockReferee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (role === "referee") {
    backTo(returnTo, { error: "Judge accounts cannot perform this action." });
  }
}

/** Schools/Senseis/Referees/Audience/Participants: the Add/Edit (and, for
 * everything except Participants, Delete) forms next to each list are shown
 * to every staff-tier role, including Participant Support and Referee/Judge
 * — not just Admin/Organizer/Staff — per the existing UI (those forms are
 * never hidden from them) and blockCustomerSupport's own doc comment above
 * ("Participant Support has edit access to registrations/participants").
 * The underlying save/delete actions had no server-side check at all,
 * meaning a Participant/Audience/School/Sensei self-service login could
 * have called them directly too — this closes that off while keeping the
 * intended Support/Referee access working, not narrowing it further to
 * requireCompetitionManager (which would break existing behavior). */
async function requireCommunityManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support", "referee"].includes(role ?? "")) {
    backTo(returnTo, { error: "You don't have permission to do that." });
  }
}

/** Judging Arena mutations (assign/unassign referees, set judges-required,
 * auto-assign) are Super Admin only — Organizer, Participant Support, and
 * Referee can view the arena but not configure it. */
async function requireJudgingManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "referee"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer or a Judge can configure judging." });
  }
}

/** A judge's kata-family eligibility and conflict-of-interest exclusions are
 * organizer-configured, not open to every judge — confirmed with the
 * organizer, a Chief-titled judge (Chief Referee / Chief Judge / Chief
 * Referee & Judge — judge_title is free text, matched the same way
 * isChiefJudge does in app/admin/judging/page.tsx) gets the same access as
 * Admin/Organizer/Staff here, including editing their OWN row — a plain
 * (non-Chief) judge still gets none. Mirrors is_admin() OR is_chief_judge()
 * at the RLS layer on referee_category_exclusions (see migration 0126).
 * Shared by the redirect-based mutations (via requireRefereeConfigManager
 * below) and the state-returning trace actions (which can't redirect, so
 * they call this directly). */
async function canConfigureReferees(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
): Promise<boolean> {
  const role = await getActorRole(supabase, actorId);
  if (["admin", "organizer", "staff"].includes(role ?? "")) return true;
  if (role === "referee") {
    // .maybeSingle() would error out (not just miss) if this login owns more
    // than one referees row — e.g. a Sensei who is also independently
    // registered as a judge under a second record — so this checks every
    // row for a Chief title rather than assuming exactly one.
    const { data } = await supabase.from("referees").select("judge_title").eq("user_id", actorId);
    if ((data ?? []).some((r) => /chief (referee|judge)/i.test(r.judge_title ?? ""))) return true;
  }
  return false;
}

async function requireRefereeConfigManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  if (await canConfigureReferees(supabase, actorId)) return;
  backTo(returnTo, { error: "Only Admin / Organizer or a Chief Judge can configure a judge's kata families or exclusions." });
}

function backTo(path: string, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  // path can itself already carry a query string (e.g. "/admin/schools?edit=…"
  // from generateRecordInvitationCode, so the redirect lands back on the same
  // record's edit view instead of the bare list) — append with "&" in that
  // case instead of blindly using "?" twice, which would corrupt the URL.
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${q ? `${separator}${q}` : ""}`);
}

/** Uploads an optional "certificate" file field to the private bucket; returns
 * the new path, or null when no file was submitted (existing value untouched). */
async function uploadCertificateIfPresent(
  supabase: SupabaseClient,
  formData: FormData,
  prefix: string,
  returnTo: string,
): Promise<string | null> {
  const certificate = formData.get("certificate");
  if (!(certificate instanceof File) || certificate.size === 0) return null;
  if (certificate.size > 10 * 1024 * 1024) {
    backTo(returnTo, { error: "Certificate file is too large (max 10 MB)." });
  }
  const ext = (certificate.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const path = `${prefix}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("certificates")
    .upload(path, certificate, { contentType: certificate.type || "image/jpeg" });
  if (error) backTo(returnTo, { error: "Could not upload the certificate. Please try again." });
  return path;
}

// ── Registrations ────────────────────────────────────────────────────────────

/** Best-effort — never throws, so a notification hiccup can't undo a
 * payment status update that already succeeded. Fires on every status —
 * pending (submission received, waiting for approval), paid, and rejected
 * all notify the participant personally, per the organizer's instruction.
 * Telegram lookup tries two links: the reliable one is
 * profiles.registration_id, set once they sign in and claim this specific
 * registration (see claim_registration / claim_registration_by_id in
 * supabase/migrations/0072_claim_registration_any_role.sql); as a fallback
 * (e.g. they have an account but never claimed this particular
 * registration) it also tries a plain email match on profiles. */
async function notifyRegistrationStatusChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  registrationId: string,
  status: string,
) {
  try {
    const { data: reg } = await supabase
      .from("registrations")
      .select("participant:participants(full_name, email)")
      .eq("id", registrationId)
      .maybeSingle();
    const participant = (reg as unknown as { participant: { full_name: string; email: string | null } | null } | null)?.participant;
    if (!participant) return;
    const { data: byClaim } = await supabase
      .from("profiles").select("telegram_chat_id").eq("registration_id", registrationId).maybeSingle();
    let telegramChatId = byClaim?.telegram_chat_id ?? null;
    if (!telegramChatId && participant.email) {
      const { data: byEmail } = await supabase
        .from("profiles").select("telegram_chat_id").ilike("email", participant.email).maybeSingle();
      telegramChatId = byEmail?.telegram_chat_id ?? null;
    }
    const participantGroup = (await listTelegramGroups()).find((g) => g.category === "participant");
    await notifyStatusChanged({
      email: participant.email,
      telegramChatId,
      name: participant.full_name,
      fieldLabel: "Payment status",
      valueLabel: STATUS_VALUE_LABELS[status] ?? status,
      telegramGroups: participantGroup
        ? [{ label: participantGroup.label, url: participantGroup.url, memberUrl: participantGroup.memberUrl }]
        : null,
    });
  } catch {
    // Best-effort
  }
}

export async function updatePaymentStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as PaymentStatus;
  const returnTo = String(formData.get("return_to") ?? "/admin/registrations");
  if (!id || !["pending", "paid", "rejected"].includes(status)) {
    backTo(returnTo, { error: "Invalid payment status update." });
  }
  const { supabase, actorId } = await getActor();
  await blockReferee(supabase, actorId, returnTo);

  const { data: before } = await supabase
    .from("registrations")
    .select("id, payment_status, payment_reference")
    .eq("id", id)
    .maybeSingle();
  if (!before) backTo(returnTo, { error: "Registration not found." });

  const { error } = await supabase
    .from("registrations")
    .update({ payment_status: status })
    .eq("id", id);
  if (error) backTo(returnTo, { error: "Update failed — please try again." });

  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: id,
    action: "payment_status_changed",
    old_value: { payment_status: before!.payment_status },
    new_value: { payment_status: status },
    actor_id: actorId,
  });

  await notifyRegistrationStatusChange(supabase, id, status);

  revalidatePath("/participants");
  revalidatePath("/admin/registrations");
  backTo(returnTo, { ok: `Registration marked ${status}.` });
}

export async function deleteRegistration(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/registrations");
  const { supabase, actorId } = await getActor();
  await blockCustomerSupport(supabase, actorId, returnTo);
  await blockReferee(supabase, actorId, returnTo);
  const { data: before } = await supabase
    .from("registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("registrations").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Delete failed — the record may be referenced elsewhere." });
  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: id,
    action: "registration_deleted",
    old_value: before,
    actor_id: actorId,
  });
  revalidatePath("/participants");
  backTo(returnTo, { ok: "Registration deleted." });
}

// ── Competitions ─────────────────────────────────────────────────────────────

export async function saveCompetition(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    venue: String(formData.get("venue") ?? "").trim() || null,
    event_date: String(formData.get("event_date") ?? "") || null,
    registration_deadline: String(formData.get("registration_deadline") ?? "") || null,
    registration_fee_usd: formData.get("registration_fee_usd")
      ? Number(formData.get("registration_fee_usd"))
      : null,
    status: String(formData.get("status") ?? "draft"),
    description: String(formData.get("description") ?? "").trim() || null,
    winners_announce_date: String(formData.get("winners_announce_date") ?? "") || null,
    audience_signin_date: String(formData.get("audience_signin_date") ?? "") || null,
    default_sign_in_valid_from: String(formData.get("default_sign_in_valid_from") ?? "") || null,
    default_sign_in_valid_until: String(formData.get("default_sign_in_valid_until") ?? "") || null,
    sign_in_from_follows_event_date: formData.get("sign_in_from_follows_event_date") === "on",
    watermark_text: String(formData.get("watermark_text") ?? "").trim() || null,
    watermark_font_size_px: formData.get("watermark_font_size_px")
      ? Number(formData.get("watermark_font_size_px"))
      : null,
    watermark_font_family: String(formData.get("watermark_font_family") ?? "").trim() || null,
    watermark_bold: formData.get("watermark_bold") === "true",
    watermark_color: String(formData.get("watermark_color") ?? "").trim() || null,
    watermark_direction: String(formData.get("watermark_direction") ?? "ltr"),
  };
  // Overwrites whatever was typed into "Sign-in valid from" with the
  // current Event date on every save when linked -- this is what keeps the
  // two from silently drifting apart again (see migration 0119: USD 10
  // Tier's sign-in window had drifted 2 days past its own event date,
  // blocking every paid participant, including from their own recording
  // page, until the gap was noticed).
  if (values.sign_in_from_follows_event_date) {
    values.default_sign_in_valid_from = values.event_date;
  }
  if (!values.name) backTo(returnTo, { error: "Competition name is required." });
  if (
    values.default_sign_in_valid_from &&
    values.default_sign_in_valid_until &&
    values.default_sign_in_valid_until < values.default_sign_in_valid_from
  ) {
    backTo(returnTo, { error: "Sign-in valid until must be on or after Sign-in valid from." });
  }
  if (values.registration_fee_usd != null && Number.isNaN(values.registration_fee_usd)) {
    backTo(returnTo, { error: "Fee must be a number." });
  }
  if (values.watermark_font_size_px != null && (Number.isNaN(values.watermark_font_size_px) || values.watermark_font_size_px < 6)) {
    backTo(returnTo, { error: "Watermark font size must be a number of at least 6px, or left blank for auto." });
  }
  if (!WATERMARK_DIRECTIONS.includes(values.watermark_direction as (typeof WATERMARK_DIRECTIONS)[number])) {
    backTo(returnTo, { error: "Unknown watermark direction." });
  }

  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  if (id) {
    const { data: before } = await supabase
      .from("competitions").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from("competitions").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update competition." });
    await writeAudit(supabase, {
      table_name: "competitions", record_id: id, action: "competition_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
    // Editing the sign-in window here previously did nothing for anyone
    // already tied to this tier -- their cached sign_in_valid_from/until
    // only ever refreshed via a handful of unrelated actions (renewal,
    // unlink, editing sign_in_role_defaults). Recompute everyone this tier
    // actually affects so the new dates take effect immediately.
    if (
      before?.default_sign_in_valid_from !== values.default_sign_in_valid_from ||
      before?.default_sign_in_valid_until !== values.default_sign_in_valid_until
    ) {
      await supabase.rpc("recompute_sign_in_quota_for_competition", { p_competition_id: id });
    }
  } else {
    const { data, error } = await supabase
      .from("competitions").insert(values).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create competition." });
    await writeAudit(supabase, {
      table_name: "competitions", record_id: data!.id, action: "competition_created",
      new_value: values, actor_id: actorId,
    });
  }
  revalidatePath("/");
  backTo(returnTo, { ok: id ? "Competition updated." : "Competition created." });
}

/**
 * One-click override of a competition's winners_announce_date to today --
 * the same manual-override column saveCompetition already lets an admin
 * set by hand (see winners_announce_date above), just without having to
 * open Edit Competition and type a date. Immediately unlocks the public
 * Winners page and every eligible certificate for this tier, since both
 * gate on winnersRevealed()/winnersRevealDateFor() reading this same
 * column (lib/winners.ts) -- lets the organizer announce early once
 * judging is finished, instead of waiting for the automatic
 * deadline+30-days rule.
 */
export async function publishWinnersNow(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/winners";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const today = new Date().toISOString().slice(0, 10);
  const { data: before } = await supabase
    .from("competitions")
    .select("name, winners_announce_date, certificates_notified_at")
    .eq("id", competitionId)
    .maybeSingle();
  if (!before) backTo(returnTo, { error: "Competition not found." });

  const { error } = await supabase
    .from("competitions").update({ winners_announce_date: today }).eq("id", competitionId);
  if (error) backTo(returnTo, { error: "Could not publish winners." });

  await writeAudit(supabase, {
    table_name: "competitions", record_id: competitionId, action: "winners_published_manually",
    old_value: { winners_announce_date: before!.winners_announce_date }, new_value: { winners_announce_date: today },
    actor_id: actorId,
  });

  // Best-effort — publish already succeeded regardless of whether this
  // notice goes out. certificates_notified_at guards it from firing twice
  // if the automatic cron reveal (judging-timeline route) later notices
  // the same competition is now revealed.
  if (!before!.certificates_notified_at) {
    try {
      await notifyCertificatesPublished(before!.name, await competitionCertificateRecipients(competitionId));
      await supabase
        .from("competitions")
        .update({ certificates_notified_at: new Date().toISOString() })
        .eq("id", competitionId);
    } catch {
      // Best-effort — the publish itself already succeeded regardless.
    }
  }

  revalidatePath("/");
  backTo(returnTo, { ok: `Winners published for “${before!.name}” -- live on the public Winners page and certificates now.` });
}

/**
 * Sets the date printed on every certificate for a tier (see
 * lib/certificate-render.tsx's dateLabel and certificate_date in
 * app/api/certificates/[kind]/[id]/route.tsx) — independent of publishing,
 * so the organizer can set or correct it before or after the tier is live.
 * Blank clears it back to falling through to event_date.
 */
export async function saveCertificateDate(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const certificateDate = String(formData.get("certificate_date") ?? "").trim() || null;
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/certificates";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const { data: before } = await supabase
    .from("competitions")
    .select("name, certificate_date")
    .eq("id", competitionId)
    .maybeSingle();
  if (!before) backTo(returnTo, { error: "Competition not found." });

  const { error } = await supabase
    .from("competitions").update({ certificate_date: certificateDate }).eq("id", competitionId);
  if (error) backTo(returnTo, { error: "Could not save the certificate date." });

  await writeAudit(supabase, {
    table_name: "competitions", record_id: competitionId, action: "certificate_date_changed",
    old_value: { certificate_date: before!.certificate_date }, new_value: { certificate_date: certificateDate },
    actor_id: actorId,
  });

  backTo(returnTo, { ok: `Certificate date saved for “${before!.name}”.` });
}

/** Admin/Organizer/Staff removes an inappropriate winner testimonial — the
 * ✕ button on /winners (and the admin Rewards/Winners preview tables) only
 * they can see. This is a soft delete: media_path/message are cleared so
 * nothing plays back, but the row itself (and its unique registration_id
 * constraint) stays, on purpose — the Winner Certificate and reward payout
 * gates only check "does a row exist," so they stay unlocked, and a second
 * insert for the same registration is blocked, so the winner can't submit
 * a replacement. Notifies the winner and every Admin/Organizer/Staff
 * account by email + Telegram DM (see notifyTestimonialDeleted). */
export async function deleteTestimonial(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const returnTo = String(formData.get("return_to") ?? "") || "/winners";
  const { supabase, actorId } = await getActor();
  await requireTestimonialModerator(supabase, actorId, returnTo);

  const admin = createAdminClient();
  const { data: beforeRaw } = await admin
    .from("winner_testimonials")
    .select(
      "id, registration_id, kind, media_path, message, deleted_at, " +
        "registration:registrations(competition:competitions(name), participant:participants(full_name, email))",
    )
    .eq("id", id)
    .maybeSingle();
  const before = beforeRaw as unknown as {
    id: string;
    registration_id: string;
    kind: string;
    media_path: string | null;
    message: string | null;
    deleted_at: string | null;
    registration: {
      competition: { name: string } | null;
      participant: { full_name: string; email: string | null } | null;
    } | null;
  } | null;
  if (!before || before.deleted_at) {
    backTo(returnTo, { error: "Testimonial not found or already removed." });
  }

  if (before!.media_path) {
    await admin.storage.from("testimonials").remove([before!.media_path]);
  }

  const { error } = await admin
    .from("winner_testimonials")
    .update({ deleted_at: new Date().toISOString(), deleted_by: actorId, delete_reason: reason, media_path: null, message: null })
    .eq("id", id);
  if (error) backTo(returnTo, { error: "Could not remove testimonial." });

  await writeAudit(supabase, {
    table_name: "winner_testimonials", record_id: id,
    action: "testimonial_deleted_by_organizer", old_value: before, new_value: { reason }, actor_id: actorId,
  });

  const registration = before!.registration;
  const { data: winnerProfile } = await admin
    .from("profiles")
    .select("telegram_chat_id")
    .eq("registration_id", before!.registration_id)
    .maybeSingle();

  await notifyTestimonialDeleted({
    winnerEmail: registration?.participant?.email ?? null,
    winnerName: registration?.participant?.full_name ?? "Winner",
    winnerTelegramChatId: (winnerProfile?.telegram_chat_id as string | null) ?? null,
    competitionName: registration?.competition?.name ?? "the competition",
    reason,
  });

  revalidatePath("/winners");
  revalidatePath("/admin/winners");
  revalidatePath("/admin/commissions");
  backTo(returnTo, { ok: "Testimonial removed. The winner and organizer team have been notified." });
}

export interface StripeConnectionResult {
  ok: boolean;
  message: string;
  /** Reported by Stripe itself (not derived from the key's own prefix) —
   * a second, independent confirmation of test vs live mode. */
  livemode?: boolean;
}

/** "Test connection" button on the Commissions page's Stripe Setup panel —
 * confirms the STRIPE_SECRET_KEY currently set in Vercel's environment
 * variables actually authenticates, via a read-only balance lookup. Never
 * touches, stores, or displays the key itself — keys stay in Vercel env
 * vars by design (see StripeSetupPanel.tsx for why this app doesn't offer
 * a form to type them into instead). */
export async function testStripeConnection(): Promise<StripeConnectionResult> {
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    return { ok: false, message: "Only Admin/Organizer/Staff can test the Stripe connection." };
  }
  if (!paymentsEnabled()) {
    return { ok: false, message: "STRIPE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set in Vercel yet." };
  }
  try {
    const balance = await getStripe().balance.retrieve();
    const currencies = [...new Set(balance.available.map((b) => b.currency.toUpperCase()))].join(", ") || "none";
    return {
      ok: true,
      message: `Connected — ${balance.livemode ? "LIVE" : "TEST"} mode, balance currencies: ${currencies}.`,
      livemode: balance.livemode,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? `Stripe rejected the key: ${err.message}` : "Could not reach Stripe.",
    };
  }
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function saveCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const values = {
    competition_id: String(formData.get("competition_id") ?? "") || null,
    name: String(formData.get("name") ?? "").trim(),
    age_min: formData.get("age_min") ? Number(formData.get("age_min")) : null,
    age_max: formData.get("age_max") ? Number(formData.get("age_max")) : null,
    belt_group: String(formData.get("belt_group") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    max_participants: formData.get("max_participants") ? Number(formData.get("max_participants")) : null,
  };
  if (!values.name || !values.competition_id) {
    backTo(returnTo, { error: "Category name and competition are required." });
  }
  if (values.max_participants != null && Number.isNaN(values.max_participants)) {
    backTo(returnTo, { error: "Max participants must be a number." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  if (id) {
    const { error } = await supabase.from("categories").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update category." });
    await writeAudit(supabase, {
      table_name: "categories", record_id: id, action: "category_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase.from("categories").insert(values).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create category." });
    await writeAudit(supabase, {
      table_name: "categories", record_id: data!.id, action: "category_created",
      new_value: values, actor_id: actorId,
    });
  }
  revalidatePath("/");
  backTo(returnTo, { ok: "Category saved." });
}

export async function deleteCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const { data: source } = await supabase.from("categories").select("*").eq("id", id).maybeSingle();
  if (!source) backTo(returnTo, { error: "Category not found." });

  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — registrations reference this category." });

  await logCategoryDelete(supabase, { competitionId: source!.competition_id, category: source as Category, actorId });

  await writeAudit(supabase, {
    table_name: "categories", record_id: id, action: "category_deleted", actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: "Category deleted." });
}

/** Sending feedback to a participant — Admin/Organizer/Staff plus
 * Participant Support, who are the ones actually answering participants
 * day to day. Its own gate rather than widening requireCompetitionManager,
 * which would also hand Support the competition/kata-category surface. */
async function requireParticipantMessenger(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer / Participant Support can message participants." });
  }
}

/** Sends one message to a participant over Telegram DM or email and records
 * exactly what was sent, where it went, and whether it actually landed.
 *
 * The destination is resolved here and stored ON the log row rather than
 * left as a pointer to the participant: if they change their email later,
 * the record of what we sent and where must not silently rewrite itself.
 * Failures are logged too — an organizer needs to see a bounce, not an
 * empty list that implies nothing was ever attempted. */
export async function sendParticipantMessage(formData: FormData) {
  const participantId = String(formData.get("participant_id") ?? "");
  const channel = String(formData.get("channel") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/participants";
  const { supabase, actorId } = await getActor();
  await requireParticipantMessenger(supabase, actorId, returnTo);

  if (!["email", "telegram"].includes(channel)) backTo(returnTo, { error: "Unknown message channel." });
  if (!participantId) backTo(returnTo, { error: "No participant selected." });
  if (!body) backTo(returnTo, { error: "Type the message you want to send." });

  const admin = createAdminClient();
  const { data: participant } = await admin
    .from("participants")
    .select("id, full_name, email")
    .eq("id", participantId)
    .maybeSingle();
  if (!participant) backTo(returnTo, { error: "Participant not found." });

  // A login can reach a participant through its own primary link or through
  // profile_participants (a Sensei recording for several students), so check
  // both before concluding there's no Telegram to send to.
  const { data: primaryProfile } = await admin
    .from("profiles")
    .select("user_id, telegram_chat_id")
    .eq("participant_id", participantId)
    .maybeSingle();
  let recipientUserId = (primaryProfile?.user_id as string | null) ?? null;
  let chatId = (primaryProfile?.telegram_chat_id as string | null) ?? null;
  if (!chatId) {
    const { data: link } = await admin
      .from("profile_participants")
      .select("user_id")
      .eq("participant_id", participantId)
      .maybeSingle();
    if (link?.user_id) {
      const { data: linked } = await admin
        .from("profiles")
        .select("user_id, telegram_chat_id")
        .eq("user_id", link.user_id as string)
        .maybeSingle();
      recipientUserId = recipientUserId ?? ((linked?.user_id as string | null) ?? null);
      chatId = (linked?.telegram_chat_id as string | null) ?? null;
    }
  }

  const name = (participant!.full_name as string | null) ?? "there";
  const email = (participant!.email as string | null) ?? null;
  let result: { ok: boolean; error?: string };

  if (channel === "email") {
    if (!email) {
      backTo(returnTo, { error: `${name} has no email address on file.` });
    }
    result = await sendStaffEmail(
      email!,
      subject || "A message about the Malaysia Open Virtual Karate-do Kata Competition",
      `Hi ${name},\n\n${body}\n\n— Malaysia Open Virtual Karate-do Kata Competition`,
    );
  } else {
    if (!chatId) {
      backTo(returnTo, {
        error: `${name} hasn't connected Telegram yet, so there is no chat to message. Ask them to connect it from My Account first.`,
      });
    }
    result = await sendStaffTelegramDM(chatId!, `🥋 ${subject ? subject + "\n\n" : ""}${body}`);
  }

  const { data: actorProfile } = actorId
    ? await admin.from("profiles").select("full_name").eq("user_id", actorId).maybeSingle()
    : { data: null };

  await admin.from("participant_messages").insert({
    participant_id: participantId,
    recipient_user_id: recipientUserId,
    recipient_name: participant!.full_name ?? null,
    recipient_email: channel === "email" ? email : null,
    recipient_telegram_chat_id: channel === "telegram" ? chatId : null,
    channel,
    subject: subject || null,
    body,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : (result.error ?? "Unknown error"),
    sent_by: actorId,
    sent_by_name: (actorProfile?.full_name as string | null) ?? null,
  });

  await writeAudit(supabase, {
    table_name: "participant_messages", record_id: participantId,
    action: result.ok ? "participant_message_sent" : "participant_message_failed",
    new_value: { channel, subject, status: result.ok ? "sent" : "failed" }, actor_id: actorId,
  });

  revalidatePath(returnTo);
  if (!result.ok) {
    backTo(returnTo, { error: `Could not send: ${result.error ?? "unknown error"}. It has been logged as failed.` });
  }
  backTo(returnTo, { ok: `${channel === "email" ? "Email" : "Telegram DM"} sent to ${name} and recorded.` });
}

/** The two belt labels exactly as they appear inside a category name — the
 * generated set has to match the existing rows character for character,
 * because kataBaseOf/splitCategoryName parse names on " — ". */
const KATA_BELT_LABEL: Record<"kyu" | "dan", string> = {
  kyu: "Color/Kyu Belt",
  dan: "Black Belt & Dan Holders",
};

/** The standard 16 sub-categories for one kata: 2 belt groups x 4 age
 * brackets x male/female, in the same belt → age → gender order the admin
 * list already displays them in. */
function kataSubcategoryRows(
  competitionId: string,
  base: string,
  maxParticipants: number | null,
  startSortOrder: number,
) {
  const rows = [];
  let sortOrder = startSortOrder;
  for (const belt of ["kyu", "dan"] as const) {
    for (const [lo, hi] of AGE_BRACKETS) {
      for (const gender of ["male", "female"] as const) {
        rows.push({
          competition_id: competitionId,
          name: `${base} — ${KATA_BELT_LABEL[belt]} — Age ${lo}–${hi} — ${gender === "male" ? "Male" : "Female"}`,
          age_min: lo,
          age_max: hi,
          belt_group: belt,
          gender,
          max_participants: maxParticipants,
          sort_order: sortOrder++,
        });
      }
    }
  }
  return rows;
}

/** Creates a whole kata at once — the full standard set of 16
 * sub-categories — rather than making the organizer add sixteen rows by
 * hand and risk a half-built kata that resolveCategory can't place a
 * registrant into. */
export async function addKata(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const base = String(formData.get("kata_base") ?? "").trim();
  const maxRaw = String(formData.get("max_participants") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  if (!competitionId || !base) backTo(returnTo, { error: "Kata name is required." });
  // " — " is the separator every name is parsed on, so a kata name
  // containing it would split into the wrong belt/age/gender parts.
  if (base.includes(" — ")) {
    backTo(returnTo, { error: "Kata name can't contain “ — ” — that separates the belt, age and gender parts." });
  }
  const maxParticipants = maxRaw ? Number(maxRaw) : 200;
  if (Number.isNaN(maxParticipants)) backTo(returnTo, { error: "Max participants must be a number." });

  const { data: existing } = await supabase
    .from("categories")
    .select("name, sort_order")
    .eq("competition_id", competitionId);
  const rows = (existing ?? []) as Array<{ name: string; sort_order: number | null }>;
  if (rows.some((r) => kataBaseOf(r.name) === base)) {
    backTo(returnTo, { error: `“${base}” already exists in this tier.` });
  }
  const nextSort = rows.reduce((max, r) => Math.max(max, r.sort_order ?? 0), 0) + 1;

  const { error } = await supabase
    .from("categories")
    .insert(kataSubcategoryRows(competitionId, base, maxParticipants, nextSort));
  if (error) backTo(returnTo, { error: "Could not create the kata." });

  await writeAudit(supabase, {
    table_name: "categories", record_id: competitionId, action: "kata_created",
    new_value: { kata_base: base, max_participants: maxParticipants, sub_categories: 16 }, actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: `Kata “${base}” added, with all 16 sub-categories.` });
}

/** Renames a kata across every one of its sub-categories at once. Only the
 * kata part of each name changes; the belt/age/gender tail is preserved
 * exactly, so nothing about how registrants are resolved into categories
 * shifts. Registrations are untouched — they point at category IDs, not
 * names. */
export async function renameKata(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const oldBase = String(formData.get("kata_base") ?? "");
  const newBase = String(formData.get("new_name") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  if (!competitionId || !oldBase || !newBase) backTo(returnTo, { error: "New kata name is required." });
  if (newBase.includes(" — ")) {
    backTo(returnTo, { error: "Kata name can't contain “ — ” — that separates the belt, age and gender parts." });
  }
  if (newBase === oldBase) backTo(returnTo, { ok: "Kata name unchanged." });

  const { data: all } = await supabase
    .from("categories")
    .select("id, name")
    .eq("competition_id", competitionId);
  const rows = (all ?? []) as Array<{ id: string; name: string }>;
  if (rows.some((r) => kataBaseOf(r.name) === newBase)) {
    backTo(returnTo, { error: `“${newBase}” already exists in this tier — merge them instead of renaming.` });
  }
  const mine = rows.filter((r) => kataBaseOf(r.name) === oldBase);
  if (mine.length === 0) backTo(returnTo, { error: "Kata not found." });

  for (const row of mine) {
    const tail = row.name.split(" — ").slice(1).join(" — ");
    const { error } = await supabase
      .from("categories")
      .update({ name: tail ? `${newBase} — ${tail}` : newBase })
      .eq("id", row.id);
    if (error) backTo(returnTo, { error: "Could not rename every sub-category — nothing else was changed." });
  }

  await writeAudit(supabase, {
    table_name: "categories", record_id: competitionId, action: "kata_renamed",
    old_value: { kata_base: oldBase }, new_value: { kata_base: newBase, sub_categories: mine.length },
    actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: `Renamed to “${newBase}” across ${mine.length} sub-categories.` });
}

/** Deletes a whole kata (every sub-category under it). Refused outright if
 * ANY sub-category already has a registration against it — per the
 * organizer's instruction that a kata with a slot taken must not be
 * deletable. Each row is logged individually first, so the existing
 * undoLastDelete path can restore the whole kata. */
export async function deleteKata(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const base = String(formData.get("kata_base") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const { data: all } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId);
  const mine = ((all ?? []) as Category[]).filter((c) => kataBaseOf(c.name) === base);
  if (mine.length === 0) backTo(returnTo, { error: "Kata not found." });

  const ids = mine.map((c) => c.id);
  const { count } = await supabase
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .in("category_id", ids);
  if ((count ?? 0) > 0) {
    backTo(returnTo, {
      error: `Cannot delete “${base}” — ${count} registration${count === 1 ? "" : "s"} already reference it. Merge it instead, or remove those registrations first.`,
    });
  }

  for (const category of mine) {
    await logCategoryDelete(supabase, { competitionId, category, actorId });
  }
  const { error } = await supabase.from("categories").delete().in("id", ids);
  if (error) backTo(returnTo, { error: "Cannot delete — registrations reference this kata." });

  await writeAudit(supabase, {
    table_name: "categories", record_id: competitionId, action: "kata_deleted",
    old_value: { kata_base: base, sub_categories: mine.length }, actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: `Kata “${base}” and its ${mine.length} sub-categories deleted. Use Undo if that was a mistake.` });
}

/**
 * Merges a Male or Female sub-category into a Mix (Male & Female) category
 * for the same kata + belt group + age bracket — creating the Mix category
 * on first use. Every registration currently in the Male and/or Female
 * sub-category for that slot is moved onto the Mix category (no
 * resubmission needed — same registration/recording rows, just repointed),
 * then the now-empty Male/Female categories are deleted so only the merged
 * Mix category remains — mirrors mergeCategoryAgeGroup's behavior below.
 */
export async function mergeCategoryToMix(formData: FormData) {
  const categoryId = String(formData.get("category_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const { data: source } = await supabase
    .from("categories")
    .select("*")
    .eq("id", categoryId)
    .maybeSingle();
  if (!source) backTo(returnTo, { error: "Category not found." });
  if (source!.gender === "mix") backTo(returnTo, { ok: "Already a Mix category." });

  const kataBase = kataBaseOf(source!.name);
  const beltLabel = source!.belt_group === "dan" ? "Black Belt & Dan Holders" : "Color/Kyu Belt";
  const mixName = `${kataBase} — ${beltLabel} — Age ${source!.age_min}–${source!.age_max} — Mix (Male & Female)`;

  const { data: siblingsRaw } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", source!.competition_id)
    .eq("belt_group", source!.belt_group)
    .eq("age_min", source!.age_min)
    .eq("age_max", source!.age_max)
    .in("gender", ["male", "female"]);
  const siblings = ((siblingsRaw ?? []) as Category[]).filter((s) => kataBaseOf(s.name) === kataBase);
  const mergeCats = siblings.some((s) => s.id === categoryId) ? siblings : [...siblings, source as Category];
  const mergeIds = mergeCats.map((c) => c.id);

  let mixCategoryId: string;
  let targetWasNew: boolean;
  const { data: existingMix } = await supabase
    .from("categories")
    .select("id")
    .eq("competition_id", source!.competition_id)
    .eq("name", mixName)
    .maybeSingle();
  if (existingMix) {
    mixCategoryId = existingMix.id;
    targetWasNew = false;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("categories")
      .insert({
        competition_id: source!.competition_id,
        name: mixName,
        age_min: source!.age_min,
        age_max: source!.age_max,
        belt_group: source!.belt_group,
        gender: "mix",
        sort_order: (source!.sort_order ?? 0) + 1,
        max_participants: null,
      })
      .select("id")
      .single();
    if (createErr || !created) backTo(returnTo, { error: "Could not create the Mix category." });
    mixCategoryId = created!.id;
    targetWasNew = true;
    await writeAudit(supabase, {
      table_name: "categories", record_id: mixCategoryId, action: "category_created",
      new_value: { name: mixName, gender: "mix" }, actor_id: actorId,
    });
  }

  const movedRegistrations = await snapshotRegistrationCategories(supabase, mergeIds);

  const { error: moveErr } = await supabase
    .from("registrations")
    .update({ category_id: mixCategoryId })
    .in("category_id", mergeIds);
  if (moveErr) backTo(returnTo, { error: "Could not move registrations into the Mix category." });

  // mergeIds only ever holds the Male/Female sibling ids (never mixCategoryId,
  // whose gender is "mix") — safe to delete now that every registration
  // pointing at them has been moved onto the Mix category above.
  const { error: deleteErr } = await supabase.from("categories").delete().in("id", mergeIds);
  if (deleteErr) {
    backTo(returnTo, {
      error: `Registrations moved into “${mixName}”, but the old Male/Female categories could not be removed.`,
    });
  }

  await logCategoryMerge(supabase, {
    competitionId: source!.competition_id,
    mergeType: "to_mix",
    targetCategoryId: mixCategoryId,
    targetWasNew,
    sourceCategories: mergeCats,
    movedRegistrations,
    description: `Merged into “${mixName}”.`,
    actorId,
  });

  await writeAudit(supabase, {
    table_name: "registrations", record_id: null, action: "registrations_merged_to_mix",
    new_value: { from_category_ids: mergeIds, to_category_id: mixCategoryId, deleted_source_categories: true }, actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: `Merged into “${mixName}” — the old Male/Female categories have been removed.` });
}

/**
 * Merges a category with its ADJACENT age group in the same kata event,
 * belt division, and gender — the "merge before/after age group" button,
 * used when an age group has too few submissions (the organizer's policy:
 * events under 100 recordings get merged). Builds a fresh widened category
 * (its name's "Age lo–hi" part rewritten to cover both), moves both
 * sides' registrations onto it, and deletes both original age brackets —
 * always creating rather than mutating one of the two in place, so this
 * follows the same create-or-reuse/move/delete shape as every other merge
 * action here and undoes the same way. Repeatable, so 2 or 3 age groups
 * can be combined by clicking again on the newly-merged category.
 */
export async function mergeCategoryAgeGroup(formData: FormData) {
  const categoryId = String(formData.get("category_id") ?? "");
  const direction = formData.get("direction") === "before" ? "before" : "after";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const { data: source } = await supabase
    .from("categories").select("*").eq("id", categoryId).maybeSingle();
  if (!source) backTo(returnTo, { error: "Category not found." });
  if (source!.age_min == null || source!.age_max == null) {
    backTo(returnTo, { error: "This category has no age range to merge." });
  }

  const kataBase = kataBaseOf(source!.name);
  const { data: siblingsRaw } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", source!.competition_id)
    .eq("belt_group", source!.belt_group)
    .eq("gender", source!.gender);
  const siblings = (siblingsRaw ?? []).filter(
    (s) => kataBaseOf(s.name) === kataBase && s.id !== categoryId && s.age_min != null && s.age_max != null,
  );
  const neighbor =
    direction === "before"
      ? siblings.filter((s) => s.age_max! < source!.age_min!).sort((a, b) => b.age_max! - a.age_max!)[0]
      : siblings.filter((s) => s.age_min! > source!.age_max!).sort((a, b) => a.age_min! - b.age_min!)[0];
  if (!neighbor) {
    backTo(returnTo, { error: `No ${direction === "before" ? "earlier" : "later"} age group left to merge with.` });
  }

  const newMin = Math.min(source!.age_min!, neighbor!.age_min!);
  const newMax = Math.max(source!.age_max!, neighbor!.age_max!);
  // Rewrite only the "Age lo–hi" part of the hierarchical name.
  const newName = source!.name.replace(/Age \d+–\d+/, `Age ${newMin}–${newMax}`);
  const sourceIds = [categoryId, neighbor!.id];

  const movedRegistrations = await snapshotRegistrationCategories(supabase, sourceIds);

  const { data: created, error: createErr } = await supabase
    .from("categories")
    .insert({
      competition_id: source!.competition_id,
      name: newName,
      age_min: newMin,
      age_max: newMax,
      belt_group: source!.belt_group,
      gender: source!.gender,
      max_participants: null,
      sort_order: Math.min(source!.sort_order, neighbor!.sort_order),
    })
    .select("id")
    .single();
  if (createErr || !created) backTo(returnTo, { error: "Could not create the merged age group." });
  const targetId = created!.id;

  const { error: moveErr } = await supabase
    .from("registrations")
    .update({ category_id: targetId })
    .in("category_id", sourceIds);
  if (moveErr) backTo(returnTo, { error: "Could not move registrations into the merged age group." });

  await supabase.from("categories").delete().in("id", sourceIds);

  await logCategoryMerge(supabase, {
    competitionId: source!.competition_id,
    mergeType: "age_group",
    targetCategoryId: targetId,
    targetWasNew: true,
    sourceCategories: [source as Category, neighbor as Category],
    movedRegistrations,
    description: `Merged “${neighbor!.name}” into “${newName}”.`,
    actorId,
  });

  await writeAudit(supabase, {
    table_name: "categories", record_id: targetId, action: "age_groups_merged",
    new_value: { absorbed_category: neighbor!.name, into: newName, direction }, actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: `Merged “${neighbor!.name}” into “${newName}”.` });
}

/**
 * Collapses EVERY category belonging to one kata family (Elementary,
 * Intermediate, Advanced, or Kobudo — see lib/kata-families.ts) for one
 * competition tier into a single combined category, regardless of kata,
 * belt group, age bracket, or gender. Every registration currently sitting
 * in any of that family's categories is moved onto the combined one (same
 * registration/recording rows, just repointed — no resubmission needed),
 * then the now-empty source categories are deleted, mirroring
 * mergeCategoryToMix/mergeCategoryAgeGroup's established pattern above.
 *
 * Like those two merges, this closes the door on new registrations for the
 * merged kata going forward — resolveCategory() can no longer find a
 * belt/age/gender-specific category for "Kata Taikyoku Jodan" once its rows
 * are gone. This is intended as a late-stage/deadline-time consolidation
 * (the same assumption the existing per-kata merges already make, and the
 * app's own automatic below-cap merge already documents on the home page),
 * not something to click while registration is still open.
 */
export async function mergeKataFamily(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const family = String(formData.get("family") ?? "") as KataFamily;
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  if (!KATA_FAMILIES.includes(family)) backTo(returnTo, { error: "Unknown kata family." });
  if (!competitionId) backTo(returnTo, { error: "Missing competition." });

  const { data: allCats } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId);
  const sourceCats = categoriesInFamily((allCats as Category[]) ?? [], family);
  if (sourceCats.length === 0) backTo(returnTo, { error: `No ${family} Kata categories found for this tier.` });

  const mergedName = `${family} Kata — Combined (All Kata, Belts, Ages & Genders)`;
  const already = sourceCats.find((c) => c.name === mergedName);
  if (already && sourceCats.length === 1) {
    backTo(returnTo, { ok: `${family} Kata is already merged into one category.` });
  }

  let targetId: string;
  let targetWasNew: boolean;
  if (already) {
    targetId = already.id;
    targetWasNew = false;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("categories")
      .insert({
        competition_id: competitionId,
        name: mergedName,
        belt_group: "mix",
        gender: "mix",
        age_min: 4,
        age_max: 99,
        max_participants: null,
        sort_order: Math.min(...sourceCats.map((c) => c.sort_order)),
      })
      .select("id")
      .single();
    if (createErr || !created) backTo(returnTo, { error: "Could not create the combined category." });
    targetId = created!.id;
    targetWasNew = true;
  }

  const sourceIds = sourceCats.filter((c) => c.id !== targetId).map((c) => c.id);
  if (sourceIds.length > 0) {
    const movedRegistrations = await snapshotRegistrationCategories(supabase, sourceIds);
    const { error: moveErr } = await supabase
      .from("registrations")
      .update({ category_id: targetId })
      .in("category_id", sourceIds);
    if (moveErr) backTo(returnTo, { error: "Could not move registrations into the combined category." });

    await supabase.from("categories").delete().in("id", sourceIds);

    await logCategoryMerge(supabase, {
      competitionId,
      mergeType: "family",
      targetCategoryId: targetId,
      targetWasNew,
      sourceCategories: sourceCats.filter((c) => c.id !== targetId),
      movedRegistrations,
      description: `${family} Kata merged — ${sourceIds.length} categor${sourceIds.length === 1 ? "y" : "ies"} consolidated.`,
      actorId,
    });
  }

  await writeAudit(supabase, {
    table_name: "categories", record_id: targetId, action: "kata_family_merged",
    new_value: { family, competition_id: competitionId, categories_consolidated: sourceIds.length },
    actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, {
    ok: sourceIds.length > 0
      ? `${family} Kata merged — ${sourceIds.length} categor${sourceIds.length === 1 ? "y" : "ies"} consolidated into one.`
      : `${family} Kata is already merged into one category.`,
  });
}

/**
 * Collapses one kata event's Color/Kyu Belt (or Black Belt & Dan Holders)
 * categories into a single one, across every age bracket and gender —
 * narrower than mergeKataFamily above (which spans every kata in a whole
 * family): this stays within one kata event, merging only across its own
 * belt/age/gender sub-categories. Same move-then-delete mechanism as every
 * other merge action in this file.
 */
export async function mergeKataBeltGroup(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const kataBase = String(formData.get("kata_base") ?? "");
  const beltGroupValue = formData.get("belt_group") === "dan" ? "dan" : "kyu";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  if (!competitionId || !kataBase) backTo(returnTo, { error: "Missing competition or kata." });

  const { data: allCats } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId);
  const sourceCats = ((allCats as Category[]) ?? []).filter(
    (c) => kataBaseOf(c.name) === kataBase && c.belt_group === beltGroupValue,
  );
  const beltLabel = beltGroupValue === "dan" ? "Black Belt & Dan Holders" : "Color/Kyu Belt";
  if (sourceCats.length === 0) backTo(returnTo, { error: `No ${beltLabel} categories found for this kata.` });

  const mergedName = `${kataBase} — ${beltLabel} — Combined (All Ages & Genders)`;
  const already = sourceCats.find((c) => c.name === mergedName);
  if (already && sourceCats.length === 1) {
    backTo(returnTo, { ok: `${beltLabel} is already merged into one category for this kata.` });
  }

  let targetId: string;
  let targetWasNew: boolean;
  if (already) {
    targetId = already.id;
    targetWasNew = false;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("categories")
      .insert({
        competition_id: competitionId,
        name: mergedName,
        belt_group: beltGroupValue,
        gender: "mix",
        age_min: 4,
        age_max: 99,
        max_participants: null,
        sort_order: Math.min(...sourceCats.map((c) => c.sort_order)),
      })
      .select("id")
      .single();
    if (createErr || !created) backTo(returnTo, { error: "Could not create the combined category." });
    targetId = created!.id;
    targetWasNew = true;
  }

  const sourceIds = sourceCats.filter((c) => c.id !== targetId).map((c) => c.id);
  if (sourceIds.length > 0) {
    const movedRegistrations = await snapshotRegistrationCategories(supabase, sourceIds);
    const { error: moveErr } = await supabase
      .from("registrations")
      .update({ category_id: targetId })
      .in("category_id", sourceIds);
    if (moveErr) backTo(returnTo, { error: "Could not move registrations into the combined category." });

    await supabase.from("categories").delete().in("id", sourceIds);

    await logCategoryMerge(supabase, {
      competitionId,
      mergeType: "belt_group",
      targetCategoryId: targetId,
      targetWasNew,
      sourceCategories: sourceCats.filter((c) => c.id !== targetId),
      movedRegistrations,
      description: `${beltLabel} merged for “${kataBase}” — ${sourceIds.length} categor${sourceIds.length === 1 ? "y" : "ies"} consolidated.`,
      actorId,
    });
  }

  await writeAudit(supabase, {
    table_name: "categories", record_id: targetId, action: "kata_belt_group_merged",
    new_value: { kataBase, beltGroup: beltGroupValue, competition_id: competitionId, categories_consolidated: sourceIds.length },
    actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, {
    ok: sourceIds.length > 0
      ? `${beltLabel} merged for “${kataBase}” — ${sourceIds.length} categor${sourceIds.length === 1 ? "y" : "ies"} consolidated into one.`
      : `${beltLabel} is already merged into one category for this kata.`,
  });
}

/**
 * Merges one entire kata event's categories (every belt/age/gender
 * sub-category) with the kata immediately ABOVE or BELOW it in the
 * organizer's canonical 1-24 order — the "merge with kata above" / "merge
 * with kata below" buttons. Only ever pairs kata within the same family
 * (see adjacentKataOf in lib/kata-families.ts); at a family boundary there
 * is no neighbor to offer, so the action simply reports nothing to merge.
 * Same create-or-reuse/move/delete pattern as every other merge action in
 * this file, logged for undo via category_merge_log.
 */
export async function mergeAdjacentKata(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const kataBase = String(formData.get("kata_base") ?? "");
  const direction = formData.get("direction") === "above" ? "above" : "below";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  if (!competitionId || !kataBase) backTo(returnTo, { error: "Missing competition or kata." });

  const neighborBase = adjacentKataOf(kataBase, direction);
  if (!neighborBase) {
    backTo(returnTo, {
      error: `No ${direction === "above" ? "earlier" : "later"} kata left to merge with in this family.`,
    });
  }

  const { data: allCats } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId);
  const cats = ((allCats as Category[]) ?? []);
  const sourceCats = cats.filter((c) => {
    const base = kataBaseOf(c.name);
    return base === kataBase || base === neighborBase;
  });
  if (sourceCats.length === 0) backTo(returnTo, { error: "No categories found for these kata." });

  const mergedName = `${kataBase} & ${neighborBase} — Combined (All Belts, Ages & Genders)`;
  const already = sourceCats.find((c) => c.name === mergedName);
  if (already && sourceCats.every((c) => c.id === already.id)) {
    backTo(returnTo, { ok: "These kata are already merged into one category." });
  }

  let targetId: string;
  let targetWasNew: boolean;
  if (already) {
    targetId = already.id;
    targetWasNew = false;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("categories")
      .insert({
        competition_id: competitionId,
        name: mergedName,
        belt_group: "mix",
        gender: "mix",
        age_min: 4,
        age_max: 99,
        max_participants: null,
        sort_order: Math.min(...sourceCats.map((c) => c.sort_order)),
      })
      .select("id")
      .single();
    if (createErr || !created) backTo(returnTo, { error: "Could not create the combined category." });
    targetId = created!.id;
    targetWasNew = true;
  }

  const sourceIds = sourceCats.filter((c) => c.id !== targetId).map((c) => c.id);
  if (sourceIds.length > 0) {
    const movedRegistrations = await snapshotRegistrationCategories(supabase, sourceIds);
    const { error: moveErr } = await supabase
      .from("registrations")
      .update({ category_id: targetId })
      .in("category_id", sourceIds);
    if (moveErr) backTo(returnTo, { error: "Could not move registrations into the combined category." });

    await supabase.from("categories").delete().in("id", sourceIds);

    await logCategoryMerge(supabase, {
      competitionId,
      mergeType: "adjacent_kata",
      targetCategoryId: targetId,
      targetWasNew,
      sourceCategories: sourceCats.filter((c) => c.id !== targetId),
      movedRegistrations,
      description: `Merged “${kataBase}” with “${neighborBase}” — ${sourceIds.length} categor${sourceIds.length === 1 ? "y" : "ies"} consolidated.`,
      actorId,
    });
  }

  await writeAudit(supabase, {
    table_name: "categories", record_id: targetId, action: "adjacent_kata_merged",
    new_value: { kataBase, neighborBase, competition_id: competitionId, categories_consolidated: sourceIds.length },
    actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, {
    ok: sourceIds.length > 0
      ? `Merged “${kataBase}” with “${neighborBase}” — ${sourceIds.length} categor${sourceIds.length === 1 ? "y" : "ies"} consolidated into one.`
      : "These kata are already merged into one category.",
  });
}

/**
 * Reverses the most recent not-yet-undone merge (Merge -> Mix, Merge age,
 * Merge family, Merge belt group, or Merge with kata above/below) for one
 * competition tier — the "Undo" button next to "+ Add Category". Repeated
 * clicks step back one merge further each time; see
 * lib/category-merge.ts for the actual restore logic.
 */
export async function undoLastMerge(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  if (!competitionId) backTo(returnTo, { error: "Missing competition." });

  const result = await undoLastCategoryMerge(supabase, competitionId);
  if (!result.ok) backTo(returnTo, { error: result.error ?? "Nothing to undo." });

  await writeAudit(supabase, {
    table_name: "category_merge_log", record_id: null, action: "category_merge_undone",
    new_value: { competition_id: competitionId, description: result.description ?? null },
    actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: result.description ? `Undone: ${result.description}` : "Merge undone." });
}

/**
 * Reverses the most recent not-yet-undone plain category Delete for one
 * competition tier — the "Undo delete" button next to "+ Add Category",
 * alongside "Undo last merge" above. Repeated clicks step back one delete
 * further each time; see lib/category-merge.ts for the actual restore
 * logic.
 */
export async function undoLastDelete(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  if (!competitionId) backTo(returnTo, { error: "Missing competition." });

  const result = await undoLastCategoryDelete(supabase, competitionId);
  if (!result.ok) backTo(returnTo, { error: result.error ?? "Nothing to undo." });

  await writeAudit(supabase, {
    table_name: "category_delete_log", record_id: null, action: "category_delete_undone",
    new_value: { competition_id: competitionId, description: result.description ?? null },
    actor_id: actorId,
  });
  revalidatePath("/");
  backTo(returnTo, { ok: result.description ? `Undone: ${result.description}` : "Delete undone." });
}

/** Re-sequences sort_order for exactly the rows whose position actually
 * changed in `newOrder` (compared to their current sort_order) -- swapping
 * two adjacent kata groups only touches that many rows, not the whole
 * competition's category list, since every other group's rows keep their
 * existing sort_order values untouched. */
async function persistCategoryOrder(
  supabase: SupabaseClient,
  newOrder: Array<{ id: string; sort_order: number }>,
): Promise<void> {
  const changed = newOrder.filter((r) => r.sort_order !== undefined);
  await Promise.all(
    changed.map((r) => supabase.from("categories").update({ sort_order: r.sort_order }).eq("id", r.id)),
  );
}

/** Drags an entire kata group (e.g. "Kata Saifa", all its belt/age/gender
 * sub-categories together) to sit where another kata group currently is
 * among the other kata groups in the same competition -- lets the
 * organizer reorder which event appears first without touching any
 * individual sub-category's own ordering within that group. */
export async function reorderCategoryGroups(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const sourceBase = String(formData.get("source_base") ?? "");
  const targetBase = String(formData.get("target_base") ?? "");
  const position = formData.get("position") === "after" ? "after" : "before";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  if (!sourceBase || !targetBase || sourceBase === targetBase) {
    backTo(returnTo, { error: "Could not reorder — try again." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const { data: all } = await supabase
    .from("categories")
    .select("id, name, sort_order")
    .eq("competition_id", competitionId)
    .order("sort_order")
    .order("name");
  const groups = groupByKata((all ?? []) as Category[]);
  const sourceIdx = groups.findIndex(([base]) => base === sourceBase);
  if (sourceIdx === -1) backTo(returnTo, { error: "Could not reorder — try again." });
  const [moved] = groups.splice(sourceIdx, 1);
  // Recomputed AFTER removing the source, so the insert lands in the right
  // spot whether the drop target was earlier or later in the list.
  const targetIdx = groups.findIndex(([base]) => base === targetBase);
  if (targetIdx === -1) backTo(returnTo, { error: "Could not reorder — try again." });
  groups.splice(position === "after" ? targetIdx + 1 : targetIdx, 0, moved);

  const flattened = groups.flatMap(([, cats]) => cats);
  const changes = flattened
    .map((cat, idx) => ({ id: cat.id, oldOrder: cat.sort_order, sort_order: idx }))
    .filter((c) => c.sort_order !== c.oldOrder);
  await persistCategoryOrder(supabase, changes);
  revalidatePath("/");
  backTo(returnTo, { ok: "Kata order updated." });
}

/** Drags one sub-category (a single belt/age/gender row) to sit where
 * another row currently is within its own kata group, without affecting
 * the group's position among other kata groups or any other group's
 * internal ordering. */
export async function reorderSubcategories(formData: FormData) {
  const sourceId = String(formData.get("source_id") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  const position = formData.get("position") === "after" ? "after" : "before";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  if (!sourceId || !targetId || sourceId === targetId) {
    backTo(returnTo, { error: "Could not reorder — try again." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const { data: source } = await supabase
    .from("categories").select("competition_id, name").eq("id", sourceId).maybeSingle();
  if (!source) backTo(returnTo, { error: "Category not found." });

  const { data: all } = await supabase
    .from("categories")
    .select("id, name, sort_order")
    .eq("competition_id", source!.competition_id)
    .order("sort_order")
    .order("name");
  const groups = groupByKata((all ?? []) as Category[]);
  const kataBase = kataBaseOf(source!.name);
  const groupIdx = groups.findIndex(([base]) => base === kataBase);
  if (groupIdx === -1) backTo(returnTo, { error: "Category not found." });
  const cats = groups[groupIdx][1];
  const srcIdx = cats.findIndex((c) => c.id === sourceId);
  if (srcIdx === -1) backTo(returnTo, { error: "Category not found." });
  const [moved] = cats.splice(srcIdx, 1);
  const tgtIdx = cats.findIndex((c) => c.id === targetId);
  if (tgtIdx === -1) backTo(returnTo, { error: "Could not reorder — try again." });
  cats.splice(position === "after" ? tgtIdx + 1 : tgtIdx, 0, moved);
  groups[groupIdx] = [groups[groupIdx][0], cats];

  const flattened = groups.flatMap(([, c]) => c);
  const changes = flattened
    .map((cat, idx) => ({ id: cat.id, oldOrder: cat.sort_order, sort_order: idx }))
    .filter((c) => c.sort_order !== c.oldOrder);
  await persistCategoryOrder(supabase, changes);
  revalidatePath("/");
  backTo(returnTo, { ok: "Category order updated." });
}

// ── Certificates ─────────────────────────────────────────────────────────────

async function uploadBrandingIfPresent(
  supabase: SupabaseClient,
  formData: FormData,
  fieldName: string,
  prefix: string,
  returnTo: string,
  label: string = prefix,
): Promise<string | null> {
  const file = formData.get(fieldName);
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 5 * 1024 * 1024) {
    backTo(returnTo, { error: `${label} image is too large (max 5 MB).` });
  }
  const ext = (file.name.split(".").pop() || "png").toLowerCase().slice(0, 5);
  const path = `${prefix}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("branding")
    .upload(path, file, { contentType: file.type || "image/png" });
  if (error) {
    backTo(returnTo, { error: `Could not upload the ${label.toLowerCase()} image. Please try again.` });
  }
  return path;
}

/** Org-wide branding used on every generated certificate (see
 * lib/certificate-render.tsx) — signer name/title plus signature and
 * stamp/seal images, stored once in the certificate_settings singleton row
 * and the "branding" storage bucket. Leaving an image field blank on
 * re-save keeps whatever was uploaded before. */
export async function saveCertificateSettings(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/certificates";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const signerName = String(formData.get("signer_name") ?? "").trim() || null;
  const signerTitle = String(formData.get("signer_title") ?? "").trim() || null;
  const signerName2 = String(formData.get("signer_name_2") ?? "").trim() || null;
  const signerTitle2 = String(formData.get("signer_title_2") ?? "").trim() || null;
  const signaturePath = await uploadBrandingIfPresent(supabase, formData, "signature", "signature", returnTo, "Signature");
  const stampPath = await uploadBrandingIfPresent(supabase, formData, "stamp", "stamp", returnTo, "Stamp");

  const update: Record<string, unknown> = {
    signer_name: signerName, signer_title: signerTitle,
    signer_name_2: signerName2, signer_title_2: signerTitle2,
    updated_at: new Date().toISOString(),
  };
  if (signaturePath) update.signature_path = signaturePath;
  if (stampPath) update.stamp_path = stampPath;

  const { error } = await supabase.from("certificate_settings").update(update).eq("id", true);
  if (error) backTo(returnTo, { error: "Could not save certificate settings." });

  await writeAudit(supabase, {
    table_name: "certificate_settings", record_id: null, action: "certificate_settings_updated",
    new_value: update, actor_id: actorId,
  });
  revalidatePath("/admin/certificates");
  backTo(returnTo, { ok: "Certificate settings saved." });
}

// ── Certificate templates ────────────────────────────────────────────────────

const CERTIFICATE_KINDS = ["winner", "participant", "referee", "sensei", "school", "support"] as const;
type CertificateKindValue = (typeof CERTIFICATE_KINDS)[number];
const MEDAL_POSITIONS = ["between", "left", "right"] as const;

/** Deliberately narrower than requireCompetitionManager (which, despite the
 * name, also lets Staff through) -- the organizer specifically asked for
 * certificate *template design* (wording, logos, medal) to be Admin +
 * Organizer only, unlike Settings/Publish on this same page which Staff can
 * already touch. Mirrors is_certificate_template_manager() on the database
 * side (migration 0128), which gates the row itself the same way. */
async function requireCertificateTemplateManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit certificate templates." });
  }
}

/** Header1/Header2/Body1-3 text, logo count, and medal show/position for
 * one certificate kind -- plus, same "leave blank to keep the existing
 * image" convention as Certificate Settings above, an optional new
 * logo1/logo2/medal upload right in the same form. Deleting an existing
 * image is a separate action (deleteCertificateTemplateImage) so it has
 * its own explicit confirm, rather than living inside this general save. */
const ALIGN3 = ["left", "center", "right"] as const;
const LINE_STYLES = ["solid", "dashed"] as const;

function numField(formData: FormData, name: string, fallback: number): number {
  const n = Number(formData.get(name));
  return Number.isFinite(n) ? n : fallback;
}

function align3Field(formData: FormData, name: string, fallback: (typeof ALIGN3)[number]): (typeof ALIGN3)[number] {
  const v = String(formData.get(name) ?? "");
  return (ALIGN3 as readonly string[]).includes(v) ? (v as (typeof ALIGN3)[number]) : fallback;
}

function lineStyleField(formData: FormData, name: string, fallback: (typeof LINE_STYLES)[number]): (typeof LINE_STYLES)[number] {
  const v = String(formData.get(name) ?? "");
  return (LINE_STYLES as readonly string[]).includes(v) ? (v as (typeof LINE_STYLES)[number]) : fallback;
}

/** Each Header/Body field's typography (font size/color/alignment/weight/
 * italic/underline+thickness/line spacing/max-lines) is managed client-side
 * as one object and posted as a single JSON string in a hidden input (see
 * components/CertificateTemplateForm.tsx's TextStyleControls) -- simpler
 * than flattening ~10 style properties x 5 fields into 50 separate named
 * inputs. sanitizeTextStyle re-validates the shape before it reaches the
 * jsonb column, rather than trusting client JSON blindly. */
function styleField(formData: FormData, name: string): ReturnType<typeof sanitizeTextStyle> {
  const raw = String(formData.get(name) ?? "");
  if (!raw) return sanitizeTextStyle(null);
  try {
    return sanitizeTextStyle(JSON.parse(raw));
  } catch {
    return sanitizeTextStyle(null);
  }
}

export async function saveCertificateTemplate(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/certificates";
  const kind = String(formData.get("kind") ?? "");
  if (!(CERTIFICATE_KINDS as readonly string[]).includes(kind)) backTo(returnTo, { error: "Unknown certificate kind." });
  const { supabase, actorId } = await getActor();
  await requireCertificateTemplateManager(supabase, actorId, returnTo);

  const logoCount = Number(formData.get("logo_count")) === 1 ? 1 : 2;
  const medalPositionRaw = String(formData.get("medal_position") ?? "between");
  const medalPosition = (MEDAL_POSITIONS as readonly string[]).includes(medalPositionRaw) ? medalPositionRaw : "between";

  const logo1Path = await uploadBrandingIfPresent(supabase, formData, "logo1", `cert-${kind}-logo1`, returnTo, "Logo 1");
  const logo2Path = await uploadBrandingIfPresent(supabase, formData, "logo2", `cert-${kind}-logo2`, returnTo, "Logo 2");
  const medalPath = await uploadBrandingIfPresent(supabase, formData, "medal", `cert-${kind}-medal`, returnTo, "Medal");

  const update: Record<string, unknown> = {
    header1: String(formData.get("header1") ?? "").trim(),
    header2: String(formData.get("header2") ?? "").trim(),
    body1: String(formData.get("body1") ?? "").trim(),
    body2: String(formData.get("body2") ?? "").trim(),
    body3: String(formData.get("body3") ?? "").trim(),
    logo_count: logoCount,
    show_medal: formData.get("show_medal") === "on",
    medal_position: medalPosition,
    logo1_size: numField(formData, "logo1_size", 420),
    logo2_size: numField(formData, "logo2_size", 420),
    medal_size: numField(formData, "medal_size", 368),
    logos_alignment: align3Field(formData, "logos_alignment", "center"),
    logos_no_spacing: formData.get("logos_no_spacing") === "on",
    date_color: String(formData.get("date_color") ?? "").trim() || "#44403c",
    date_size: numField(formData, "date_size", 55),
    date_alignment: align3Field(formData, "date_alignment", "center"),
    date_description: String(formData.get("date_description") ?? "").trim() || "Announcement Date",
    date_line_style: lineStyleField(formData, "date_line_style", "solid"),
    date_line_width: numField(formData, "date_line_width", 380),
    signer_name_size: numField(formData, "signer_name_size", 28),
    signer_title_size: numField(formData, "signer_title_size", 22),
    signer_name_bold: formData.get("signer_name_bold") === "on",
    signer_title_bold: formData.get("signer_title_bold") === "on",
    signer_position: align3Field(formData, "signer_position", "center"),
    signer_line_style: lineStyleField(formData, "signer_line_style", "solid"),
    signer_line_width: numField(formData, "signer_line_width", 500),
    frame_outer_width: numField(formData, "frame_outer_width", 14),
    frame_inner_width: numField(formData, "frame_inner_width", 3),
    frame_color: formData.get("frame_color_override") === "on"
      ? (String(formData.get("frame_color") ?? "").trim() || null)
      : null,
    header1_style: styleField(formData, "header1_style"),
    header2_style: styleField(formData, "header2_style"),
    body1_style: styleField(formData, "body1_style"),
    body2_style: styleField(formData, "body2_style"),
    body3_style: styleField(formData, "body3_style"),
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };
  if (logo1Path) update.logo1_path = logo1Path;
  if (logo2Path) update.logo2_path = logo2Path;
  if (medalPath) update.medal_path = medalPath;

  const { error } = await supabase.from("certificate_templates").update(update).eq("kind", kind);
  if (error) backTo(returnTo, { error: "Could not save this certificate template." });

  await writeAudit(supabase, {
    table_name: "certificate_templates", record_id: kind, action: "certificate_template_updated",
    new_value: update, actor_id: actorId,
  });
  revalidatePath("/admin/certificates");
  backTo(returnTo, { ok: `${kind[0].toUpperCase()}${kind.slice(1)} certificate template saved.` });
}

/** Clears one uploaded image (logo1/logo2/medal) back to null, so
 * rendering falls back to the built-in default (Logo 1/2) or simply stops
 * showing a medal (medal has no built-in fallback for non-Winner kinds). */
export async function deleteCertificateTemplateImage(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/certificates";
  const kind = String(formData.get("kind") ?? "");
  const field = String(formData.get("field") ?? "");
  const column = field === "logo1" ? "logo1_path" : field === "logo2" ? "logo2_path" : field === "medal" ? "medal_path" : null;
  if (!(CERTIFICATE_KINDS as readonly string[]).includes(kind) || !column) {
    backTo(returnTo, { error: "Nothing to delete." });
  }
  const { supabase, actorId } = await getActor();
  await requireCertificateTemplateManager(supabase, actorId, returnTo);

  const { data: before } = await supabase.from("certificate_templates").select(column!).eq("kind", kind).maybeSingle();
  const oldPath = (before as Record<string, unknown> | null)?.[column!] as string | null;

  const { error } = await supabase.from("certificate_templates").update({ [column!]: null }).eq("kind", kind);
  if (error) backTo(returnTo, { error: "Could not remove this image." });
  if (oldPath) await supabase.storage.from("branding").remove([oldPath]);

  await writeAudit(supabase, {
    table_name: "certificate_templates", record_id: kind, action: "certificate_template_image_deleted",
    old_value: { [column!]: oldPath }, actor_id: actorId,
  });
  revalidatePath("/admin/certificates");
  backTo(returnTo, { ok: "Image removed." });
}

// ── Site appearance ──────────────────────────────────────────────────────────

const TEXT_ALIGN_VALUES = ["left", "center", "right"] as const;
function readAlign(formData: FormData, field: string, fallback: string): string {
  const v = String(formData.get(field) ?? "");
  return (TEXT_ALIGN_VALUES as readonly string[]).includes(v) ? v : fallback;
}
function readNumber(formData: FormData, field: string, fallback: number): number {
  const v = Number(formData.get(field));
  return Number.isFinite(v) ? v : fallback;
}

/** Site-wide header/footer branding — logo, title/subtitle, main menu, and
 * footer text plus every style knob for each, stored once in the
 * site_appearance singleton row and read by SiteHeader/SiteFooter on every
 * public page. Leaving the logo field blank on re-save keeps whatever was
 * uploaded before, same as certificate signature/stamp uploads. */
export async function saveSiteAppearance(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const logoPath = await uploadBrandingIfPresent(supabase, formData, "logo", "logo", returnTo);

  const buttonLabels = formData.getAll("button_label").map((v) => String(v).trim());
  const buttonUrls = formData.getAll("button_url").map((v) => String(v).trim());
  const buttons = buttonLabels
    .map((label, i) => ({ id: crypto.randomUUID(), label, url: buttonUrls[i] ?? "" }))
    .filter((b) => b.label && b.url);

  const update: Record<string, unknown> = {
    title_text: String(formData.get("title_text") ?? "").trim() || null,
    title_align: readAlign(formData, "title_align", "left"),
    title_line_height: readNumber(formData, "title_line_height", 1.2),
    title_color: String(formData.get("title_color") ?? "#ffffff").trim() || "#ffffff",
    title_font_size: readNumber(formData, "title_font_size", 16),
    title_font_family: String(formData.get("title_font_family") ?? "sans").trim() || "sans",
    title_bold: formData.get("title_bold") === "on",

    subtitle_text: String(formData.get("subtitle_text") ?? "").trim() || null,
    subtitle_align: readAlign(formData, "subtitle_align", "left"),
    subtitle_line_height: readNumber(formData, "subtitle_line_height", 1.2),
    subtitle_color: String(formData.get("subtitle_color") ?? "#ffffff").trim() || "#ffffff",
    subtitle_font_size: readNumber(formData, "subtitle_font_size", 12),
    subtitle_font_family: String(formData.get("subtitle_font_family") ?? "sans").trim() || "sans",
    subtitle_bold: formData.get("subtitle_bold") === "on",

    menu_color: String(formData.get("menu_color") ?? "#ffffff").trim() || "#ffffff",
    menu_font_size: readNumber(formData, "menu_font_size", 14),
    menu_bold: formData.get("menu_bold") === "on",
    menu_font_family: String(formData.get("menu_font_family") ?? "sans").trim() || "sans",
    menu_align: readAlign(formData, "menu_align", "right"),
    menu_line_height: readNumber(formData, "menu_line_height", 1.2),

    footer_text: String(formData.get("footer_text") ?? "").trim() || null,
    footer_align: readAlign(formData, "footer_align", "center"),
    footer_line_height: readNumber(formData, "footer_line_height", 1.2),
    footer_color: String(formData.get("footer_color") ?? "#ffffff").trim() || "#ffffff",
    footer_font_size: readNumber(formData, "footer_font_size", 13),
    footer_font_family: String(formData.get("footer_font_family") ?? "sans").trim() || "sans",
    footer_bold: formData.get("footer_bold") === "on",

    buttons,
    updated_at: new Date().toISOString(),
  };
  if (logoPath) update.logo_path = logoPath;

  const { error } = await supabase.from("site_appearance").update(update).eq("id", true);
  if (error) backTo(returnTo, { error: "Could not save site appearance settings." });

  await writeAudit(supabase, {
    table_name: "site_appearance", record_id: null, action: "site_appearance_updated",
    new_value: update, actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/admin/competitions");
  backTo(returnTo, { ok: "Site appearance saved." });
}

/** Branding for the recording screens — the banner logo, its two lines, and
 * the footer watermark that sit around a live camera view. Deliberately a
 * separate row from site_appearance: see migration 0121 for why the
 * website's chrome and a competitor's recording chrome must not share one
 * set of fields. Leaving the logo field blank on re-save keeps whatever was
 * uploaded before, same as every other branding upload here. */
export async function saveRecordingAppearance(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const logoPath = await uploadBrandingIfPresent(supabase, formData, "logo", "recording-logo", returnTo);

  const update: Record<string, unknown> = {
    line1_text: String(formData.get("line1_text") ?? "").trim() || null,
    line1_align: readAlign(formData, "line1_align", "center"),
    line1_line_height: readNumber(formData, "line1_line_height", 1.2),
    line1_color: String(formData.get("line1_color") ?? "#ffffff").trim() || "#ffffff",
    line1_font_size: readNumber(formData, "line1_font_size", 18),
    line1_font_family: String(formData.get("line1_font_family") ?? "serif").trim() || "serif",
    line1_bold: formData.get("line1_bold") === "on",

    line2_text: String(formData.get("line2_text") ?? "").trim() || null,
    line2_align: readAlign(formData, "line2_align", "center"),
    line2_line_height: readNumber(formData, "line2_line_height", 1.2),
    line2_color: String(formData.get("line2_color") ?? "#ffffff").trim() || "#ffffff",
    line2_font_size: readNumber(formData, "line2_font_size", 11),
    line2_font_family: String(formData.get("line2_font_family") ?? "sans").trim() || "sans",
    line2_bold: formData.get("line2_bold") === "on",

    footer_text: String(formData.get("footer_text") ?? "").trim() || null,
    footer_align: readAlign(formData, "footer_align", "center"),
    footer_line_height: readNumber(formData, "footer_line_height", 1.2),
    footer_color: String(formData.get("footer_color") ?? "#ffffff").trim() || "#ffffff",
    footer_font_size: readNumber(formData, "footer_font_size", 12),
    footer_font_family: String(formData.get("footer_font_family") ?? "sans").trim() || "sans",
    footer_bold: formData.get("footer_bold") === "on",

    updated_at: new Date().toISOString(),
  };
  if (logoPath) update.logo_path = logoPath;

  const { error } = await supabase.from("recording_appearance").update(update).eq("id", true);
  if (error) backTo(returnTo, { error: "Could not save recording appearance settings." });

  await writeAudit(supabase, {
    table_name: "recording_appearance", record_id: null, action: "recording_appearance_updated",
    new_value: update, actor_id: actorId,
  });
  revalidatePath("/winners");
  revalidatePath("/account");
  revalidatePath("/admin/competitions");
  backTo(returnTo, { ok: "Recording appearance saved." });
}

/** Back to migration 0121's own defaults, including re-seeding the three
 * texts with the organizer's wording rather than nulling them — a blank
 * banner over a live camera is worse than the default one. */
export async function resetRecordingAppearance(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const update = {
    logo_path: null,
    line1_text: "MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION",
    line1_align: "center", line1_line_height: 1.2, line1_color: "#ffffff",
    line1_font_size: 18, line1_font_family: "serif", line1_bold: true,
    line2_text: "Organized by IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD",
    line2_align: "center", line2_line_height: 1.2, line2_color: "#ffffff",
    line2_font_size: 11, line2_font_family: "sans", line2_bold: false,
    footer_text: "Malaysia Open Virtual Karate-do Kata Competition 2026",
    footer_align: "center", footer_line_height: 1.2, footer_color: "#ffffff",
    footer_font_size: 12, footer_font_family: "sans", footer_bold: true,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("recording_appearance").update(update).eq("id", true);
  if (error) backTo(returnTo, { error: "Could not reset recording appearance settings." });

  await writeAudit(supabase, {
    table_name: "recording_appearance", record_id: null, action: "recording_appearance_reset", actor_id: actorId,
  });
  revalidatePath("/winners");
  revalidatePath("/account");
  revalidatePath("/admin/competitions");
  backTo(returnTo, { ok: "Recording appearance reset to defaults." });
}

/** Clears every field back to the table's own defaults — logo, title,
 * subtitle, and footer text all reset to null (falls back to the site's
 * hardcoded copy), every style knob back to its default, and every custom
 * button removed. Does not delete the row itself (id=true always exists). */
export async function resetSiteAppearance(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/competitions";
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const update = {
    logo_path: null,
    title_text: null, title_align: "left", title_line_height: 1.2,
    title_color: "#ffffff", title_font_size: 16, title_font_family: "sans", title_bold: true,
    subtitle_text: null, subtitle_align: "left", subtitle_line_height: 1.2,
    subtitle_color: "#ffffff", subtitle_font_size: 12, subtitle_font_family: "sans", subtitle_bold: true,
    menu_color: "#ffffff", menu_font_size: 14, menu_bold: false, menu_font_family: "sans",
    menu_align: "right", menu_line_height: 1.2,
    footer_text: null, footer_align: "center", footer_line_height: 1.2,
    footer_color: "#ffffff", footer_font_size: 13, footer_font_family: "sans", footer_bold: true,
    buttons: [],
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("site_appearance").update(update).eq("id", true);
  if (error) backTo(returnTo, { error: "Could not reset site appearance settings." });

  await writeAudit(supabase, {
    table_name: "site_appearance", record_id: null, action: "site_appearance_reset", actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/admin/competitions");
  backTo(returnTo, { ok: "Site appearance reset to defaults." });
}

// ── Announcements ────────────────────────────────────────────────────────────

export async function saveAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const values = {
    competition_id: String(formData.get("competition_id") ?? "") || null,
    title: String(formData.get("title") ?? "").trim(),
    body: String(formData.get("body") ?? "").trim() || null,
    published: formData.get("published") === "on",
  };
  if (!values.title) backTo(returnTo, { error: "Title is required." });
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);
  let justPublished = false;
  if (id) {
    const { data: before } = await supabase
      .from("announcements").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from("announcements").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update announcement." });
    await writeAudit(supabase, {
      table_name: "announcements", record_id: id, action: "announcement_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
    justPublished = values.published && before?.published !== true;
  } else {
    const { data, error } = await supabase
      .from("announcements").insert(values).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create announcement." });
    await writeAudit(supabase, {
      table_name: "announcements", record_id: data!.id, action: "announcement_created",
      new_value: values, actor_id: actorId,
    });
    justPublished = values.published;
  }
  if (justPublished) await notifyAnnouncementPublished(values.title, values.body);
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: "Announcement saved." });
}

export async function toggleAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const publish = formData.get("publish") === "true";
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);
  const { data: before } = await supabase
    .from("announcements").select("title, body, published").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("announcements").update({ published: publish }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not change publish state." });
  await writeAudit(supabase, {
    table_name: "announcements", record_id: id,
    action: publish ? "announcement_published" : "announcement_unpublished",
    new_value: { published: publish }, actor_id: actorId,
  });
  if (publish && before && before.published !== true) {
    await notifyAnnouncementPublished(before.title, before.body);
  }
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: publish ? "Announcement published." : "Announcement unpublished." });
}

export async function moveAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);

  const { data } = await supabase
    .from("announcements")
    .select("id, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  const list = data ?? [];
  const index = list.findIndex((a) => a.id === id);
  if (index === -1) backTo(returnTo, { error: "Announcement not found." });
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= list.length) {
    backTo(returnTo, { ok: "Already at the edge of the list." });
  }

  // Normalise sort_order to the current display order, then swap the two
  for (let i = 0; i < list.length; i++) {
    const target = i === index ? swapWith : i === swapWith ? index : i;
    if (list[i].sort_order !== target) {
      await supabase.from("announcements").update({ sort_order: target }).eq("id", list[i].id);
    }
  }
  await writeAudit(supabase, {
    table_name: "announcements", record_id: id,
    action: `announcement_moved_${direction}`, actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: "Order updated." });
}

export async function deleteAnnouncement(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/announcements";
  const { supabase, actorId } = await getActor();
  await requireContentManager(supabase, actorId, returnTo);
  const { data: before } = await supabase
    .from("announcements").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete announcement." });
  await writeAudit(supabase, {
    table_name: "announcements", record_id: id, action: "announcement_deleted",
    old_value: before, actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/announcements");
  backTo(returnTo, { ok: "Announcement deleted." });
}

/** Creates a new draft announcement pre-filled with the current Access
 * Matrix (see lib/access-matrix.ts), then sends the admin to Announcements
 * to review and publish it. Never auto-publishes — the admin should read it
 * over first. Call again (from the Accounts page) whenever access rules
 * change, to keep the published copy current. */
export async function publishAccessMatrixAnnouncement() {
  const returnTo = "/admin/accounts?tab=access";
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (actorRole !== "admin") {
    backTo(returnTo, { error: "Only the Super Admin can publish the Access Matrix." });
  }
  const generatedAt = formatDate(new Date().toISOString().slice(0, 10));
  const values = {
    competition_id: null,
    title: `Admin Panel Access Matrix — updated ${generatedAt}`,
    body: accessMatrixAnnouncementIntro(generatedAt),
    published: false,
  };
  const { data, error } = await supabase.from("announcements").insert(values).select("id").single();
  if (error) backTo(returnTo, { error: "Could not create the announcement." });
  await writeAudit(supabase, {
    table_name: "announcements", record_id: data!.id, action: "announcement_created",
    new_value: { title: values.title }, actor_id: actorId,
  });
  redirect(`/admin/announcements?edit=${data!.id}`);
}

const ADMIN_ADD_ROLE_LABEL: Record<string, string> = {
  school: "School / Dojo",
  sensei: "Sensei / Coach",
  referee: "Judge",
  audience: "Audience / Spectator",
  participant: "Participant",
};

const ADMIN_ADD_TELEGRAM_CATEGORY: Record<string, TelegramCategory> = {
  school: "school",
  sensei: "school",
  referee: "referee",
  audience: "audience",
  participant: "participant",
};

/** Fires once, right after an Admin/Organizer manually adds a School,
 * Sensei, Referee, Audience, or Participant record directly (not via
 * public self-registration, which already emails its own confirmation) —
 * asks them to join the Telegram group right away. The "DM within about
 * an hour" line is deliberately conditional, not a guarantee: a Telegram
 * DM can only ever reach someone who has both created their account and
 * connected Telegram from their Account page (Bot API can't message an
 * arbitrary phone/email) — nothing here schedules or forces that to
 * happen, it just sets the expectation for once they do. Best-effort —
 * never throws, so a notification hiccup can't undo the record having
 * already been saved. */
async function notifyAddedByAdmin(role: string, email: string | null, recipientName: string) {
  if (!email) return;
  const roleLabel = ADMIN_ADD_ROLE_LABEL[role] ?? role;
  try {
    await sendConfirmationEmail({
      toEmail: email,
      recipientName,
      subject: `You've been added as a ${roleLabel}`,
      bodyLines: [
        `Hello! The organizer has added you to the Malaysia Open Virtual Karate-do Kata Competition as a ${roleLabel}.`,
        "Please join our Telegram group as soon as possible — that's where the organizer posts announcements and where you can reach the team.",
        "Once you've created your account and connected Telegram from your Account page, you'll typically receive a Telegram DM confirming your status within about an hour.",
      ],
      telegramCategory: ADMIN_ADD_TELEGRAM_CATEGORY[role],
    });
  } catch {
    // Best-effort
  }
}

// ── Schools ──────────────────────────────────────────────────────────────────

export async function saveSchool(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/schools";
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    state: String(formData.get("state") ?? "").trim() || null,
    contact_title: String(formData.get("contact_title") ?? "").trim() || null,
    contact_name: String(formData.get("contact_name") ?? "").trim() || null,
    contact_karate_title: String(formData.get("contact_karate_title") ?? "").trim() || null,
    contact_rank: String(formData.get("contact_rank") ?? "").trim() || null,
    contact_ic_passport: String(formData.get("contact_ic_passport") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: normalizeIban(String(formData.get("bank_account_no") ?? "")) || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    registration_competition_id: String(formData.get("competition_id") ?? "") || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
    participating_tier_1_id: String(formData.get("participating_tier_1_id") ?? "").trim() || null,
    participating_tier_2_id: String(formData.get("participating_tier_2_id") ?? "").trim() || null,
    participating_tier_3_id: String(formData.get("participating_tier_3_id") ?? "").trim() || null,
  };
  if (!values.name) backTo(returnTo, { error: "School name is required." });
  if (!values.contact_title || !values.contact_name || !values.contact_karate_title || !values.contact_rank || !values.contact_ic_passport) {
    backTo(returnTo, { error: "Person in-charge's title, name, karate title, rank, and IC / Passport No. are required." });
  }
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and home country are required." });
  }
  if (!values.email || !values.phone) {
    backTo(returnTo, { error: "Email address and mobile phone are required." });
  }
  if (!values.bank_name || !values.bank_account_no || !values.bank_account_name) {
    backTo(returnTo, { error: "Bank name, account number, and account holder name are required." });
  }
  const record = { ...values, gender: values.contact_title === "Mr." ? "male" : "female" };
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);
  if (!id) {
    const { data: dup } = await supabase
      .from("schools").select("id").ilike("name", values.name).limit(1);
    if (dup && dup.length > 0) {
      backTo(returnTo, { error: "A school with this name already exists." });
    }
  }
  if (id) {
    const { error } = await supabase.from("schools").update(record).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update school." });
    await writeAudit(supabase, {
      table_name: "schools", record_id: id, action: "school_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase.from("schools").insert(record).select("id").single();
    if (error) backTo(returnTo, { error: "Could not create school." });
    await writeAudit(supabase, {
      table_name: "schools", record_id: data!.id, action: "school_created",
      new_value: values, actor_id: actorId,
    });
    await notifyAddedByAdmin("school", values.email, values.contact_name || values.name);
    // No invitation code means the fee is due now — straight to Stripe. With a
    // code the fee is waived or settled off-platform, so the record just stays
    // pending for the organizer to mark waived/paid.
    if (!values.invitation_code) {
      const fee = await tierFeeUsd(supabase, values.registration_competition_id ?? null);
      const url = await communityRecordCheckoutUrl(
        "school", data!.id, values.name, fee, "School / Dojo registration fee",
      );
      if (url) redirect(url);
    }
  }
  backTo(returnTo, { ok: "School saved." });
}

export async function deleteSchool(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/schools";
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("schools").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — senseis or participants reference this school." });
  await writeAudit(supabase, {
    table_name: "schools", record_id: id, action: "school_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "School deleted." });
}

// ── Senseis ──────────────────────────────────────────────────────────────────

export async function saveSensei(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/senseis";
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    ic_passport: String(formData.get("ic_passport") ?? "").trim() || null,
    date_of_birth: String(formData.get("date_of_birth") ?? "").trim() || null,
    rank: String(formData.get("rank") ?? "").trim() || null,
    gender: String(formData.get("gender") ?? "").trim() || null,
    school_id: String(formData.get("school_id") ?? "") || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: normalizeIban(String(formData.get("bank_account_no") ?? "")) || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    registration_competition_id: String(formData.get("competition_id") ?? "") || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
    participating_tier_1_id: String(formData.get("participating_tier_1_id") ?? "").trim() || null,
    participating_tier_2_id: String(formData.get("participating_tier_2_id") ?? "").trim() || null,
    participating_tier_3_id: String(formData.get("participating_tier_3_id") ?? "").trim() || null,
  };
  if (!values.name) backTo(returnTo, { error: "Sensei name is required." });
  if (!values.ic_passport) backTo(returnTo, { error: "IC / Passport is required." });
  if (!values.date_of_birth) backTo(returnTo, { error: "Date of birth is required." });
  if (!values.rank) backTo(returnTo, { error: "Rank is required." });
  if (!values.gender || !["male", "female"].includes(values.gender)) {
    backTo(returnTo, { error: "Sex is required." });
  }
  if (!values.school_id) backTo(returnTo, { error: "School is required." });
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Personal home address, city/town, postcode, and home country are required." });
  }
  if (!values.email || !values.phone) {
    backTo(returnTo, { error: "Email address and mobile phone are required." });
  }
  if (!values.bank_name || !values.bank_account_no || !values.bank_account_name) {
    backTo(returnTo, { error: "Personal bank details (bank name, account number, and account holder name) are required." });
  }
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "sensei", returnTo);
  if (!id && !certificatePath) {
    backTo(returnTo, { error: "Latest rank certificate is required." });
  }

  if (!id) {
    // Guard against duplicate submissions (e.g. double-clicks)
    let dupQuery = supabase.from("senseis").select("id").ilike("name", values.name).limit(1);
    dupQuery = values.school_id
      ? dupQuery.eq("school_id", values.school_id)
      : dupQuery.is("school_id", null);
    const { data: dup } = await dupQuery;
    if (dup && dup.length > 0) {
      backTo(returnTo, { error: "A sensei with this name (and school) already exists." });
    }
  }
  if (id) {
    const { error } = await supabase
      .from("senseis")
      .update(certificatePath ? { ...values, certificate_path: certificatePath } : values)
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update sensei." });
    await writeAudit(supabase, {
      table_name: "senseis", record_id: id, action: "sensei_updated",
      new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("senseis")
      .insert({ ...values, certificate_path: certificatePath })
      .select("id").single();
    if (error) backTo(returnTo, { error: "Could not create sensei." });
    await writeAudit(supabase, {
      table_name: "senseis", record_id: data!.id, action: "sensei_created",
      new_value: values, actor_id: actorId,
    });
    await notifyAddedByAdmin("sensei", values.email, values.name);
    if (!values.invitation_code) {
      const fee = await tierFeeUsd(supabase, values.registration_competition_id ?? null);
      const url = await communityRecordCheckoutUrl(
        "sensei", data!.id, values.name, fee, "Sensei / Coach registration fee",
      );
      if (url) redirect(url);
    }
  }
  backTo(returnTo, { ok: "Sensei saved." });
}

export async function deleteSensei(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/senseis";
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("senseis").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — participants reference this sensei." });
  await writeAudit(supabase, {
    table_name: "senseis", record_id: id, action: "sensei_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Sensei deleted." });
}

// ── Community (referees / audiences / staff applications) ───────────────────

const STATUS_FIELD_LABELS: Record<string, Record<string, string>> = {
  referees: { status: "Approval status", payment_status: "Deposit status" },
  audiences: { payment_status: "Payment status" },
  staff_applications: { status: "Application status" },
  schools: { payment_status: "Fee status" },
  senseis: { payment_status: "Fee status" },
};

const STATUS_VALUE_LABELS: Record<string, string> = {
  pending: "Pending", approved: "Approved", rejected: "Rejected",
  paid: "Paid", waived: "Waived", refunded: "Refunded", forfeited: "Forfeited",
};

/** Resolves who a status/payment button click on `updateCommunityStatus`
 * notifies, and how to reach them. Referees and audiences carry their own
 * `user_id` column, auto-linked by email match right at signup (see
 * handle_new_user in supabase/migrations/0060_multi_role_accounts.sql).
 * Schools and senseis now get the same email-match auto-link on their own
 * `user_id` column (supabase/migrations/0080_school_sensei_email_autolink.sql)
 * — checked alongside the older invitation-code reverse-link
 * (profiles.school_id / profiles.sensei_id, set from the invitation code's
 * for_record_id at signup, still used by the sign-in-quota lookups), since
 * older accounts may only have the reverse-link. staff_applications rows
 * have no user_id/school_id-style column of their own — approving one here
 * doesn't create a login by itself (see the note under the Organizer
 * Applications table) — so the only way to find a Telegram chat for one is
 * a plain email match against profiles, for whoever *did* separately get an
 * account created (e.g. via "Create an Admin / Organizer account"). */
async function statusChangeRecipient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  id: string,
): Promise<{ email: string | null; name: string; telegramChatId: string | null; roleRequested: string | null } | null> {
  const { data: row } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const r = row as Record<string, unknown>;
  const nameColumn = table === "schools" ? "contact_name" : table === "senseis" ? "name" : "full_name";
  const email = (r.email as string | null) ?? null;
  const name = (r[nameColumn] as string | null) ?? "there";
  const roleRequested = (r.role_requested as string | null) ?? null;

  let telegramChatId: string | null = null;
  if ((table === "referees" || table === "audiences" || table === "schools" || table === "senseis") && r.user_id) {
    const { data: profile } = await supabase
      .from("profiles").select("telegram_chat_id").eq("user_id", r.user_id as string).maybeSingle();
    telegramChatId = profile?.telegram_chat_id ?? null;
  }
  if (!telegramChatId && (table === "schools" || table === "senseis")) {
    const { data: profile } = await supabase
      .from("profiles").select("telegram_chat_id")
      .eq(table === "schools" ? "school_id" : "sensei_id", id).maybeSingle();
    telegramChatId = profile?.telegram_chat_id ?? null;
  }
  if (!telegramChatId && table === "staff_applications" && email) {
    const { data: profile } = await supabase
      .from("profiles").select("telegram_chat_id").ilike("email", email).maybeSingle();
    telegramChatId = profile?.telegram_chat_id ?? null;
  }
  return { email, name, telegramChatId, roleRequested };
}

/** All 5 competition-related groups (excludes "class", which is the
 * unrelated dojo-class-students feature) — what an Organizer/Admin
 * application's approval email links to, since that role moderates across
 * every category, not just one. */
const ORGANIZER_TELEGRAM_CATEGORIES: TelegramCategory[] = ["participant", "school", "referee", "audience", "staff"];

/** Which Telegram group link(s) go in a community status-change email.
 * Organizer/Admin applications get all 5 competition groups' links (they
 * moderate across the whole competition); every other table gets just its
 * own. One DB fetch covers every category, rather than one round trip per
 * lookup. */
async function communityTelegramGroups(
  table: string,
  roleRequested: string | null,
): Promise<Array<{ label: string; url: string; memberUrl: string | null }> | null> {
  const byCategory = new Map((await listTelegramGroups()).map((g) => [g.category, g]));
  if (table === "staff_applications") {
    if (roleRequested === "admin" || roleRequested === "organizer") {
      const groups = ORGANIZER_TELEGRAM_CATEGORIES
        .map((category) => byCategory.get(category))
        .filter((g): g is NonNullable<typeof g> => !!g)
        .map((g) => ({ label: g.label, url: g.url, memberUrl: g.memberUrl }));
      return groups.length ? groups : null;
    }
    const staffGroup = byCategory.get("staff");
    return staffGroup ? [{ label: staffGroup.label, url: staffGroup.url, memberUrl: staffGroup.memberUrl }] : null;
  }
  const category = table === "referees" ? "referee" : table === "audiences" ? "audience" : "school";
  const group = byCategory.get(category);
  return group ? [{ label: group.label, url: group.url, memberUrl: group.memberUrl }] : null;
}

/** Best-effort — never throws, so a notification hiccup can't undo a
 * status update that already succeeded. */
async function notifyCommunityStatusChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  id: string,
  field: string,
  value: string,
) {
  const fieldLabel = STATUS_FIELD_LABELS[table]?.[field];
  if (!fieldLabel) return;
  try {
    const recipient = await statusChangeRecipient(supabase, table, id);
    if (!recipient) return;
    await notifyStatusChanged({
      email: recipient.email,
      telegramChatId: recipient.telegramChatId,
      name: recipient.name,
      fieldLabel,
      valueLabel: STATUS_VALUE_LABELS[value] ?? value,
      telegramGroups: await communityTelegramGroups(table, recipient.roleRequested),
    });
  } catch {
    // Best-effort
  }
}

export async function updateCommunityStatus(formData: FormData) {
  const table = String(formData.get("table") ?? "");
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/referees");
  const allowed: Record<string, Record<string, string[]>> = {
    referees: {
      payment_status: ["pending", "paid", "waived", "refunded", "forfeited"],
      status: ["pending", "approved", "rejected"],
    },
    audiences: { payment_status: ["pending", "paid", "waived"] },
    staff_applications: { status: ["pending", "approved", "rejected"] },
    schools: { payment_status: ["pending", "paid", "waived"] },
    senseis: { payment_status: ["pending", "paid", "waived"] },
  };
  if (!allowed[table]?.[field]?.includes(value) || !id) {
    backTo(returnTo, { error: "Invalid update." });
  }
  const { supabase, actorId } = await getActor();
  // Financially/approval-sensitive (marks a fee paid/waived, or approves a
  // referee/staff application) -- kept admin/organizer/staff only, same as
  // commission and winner payout status, rather than opened to Support/
  // Referee the way the plain Save/Delete forms on these same pages are.
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase.from(table).update({ [field]: value }).eq("id", id);
  if (error) backTo(returnTo, { error: "Update failed — please try again." });
  await writeAudit(supabase, {
    table_name: table, record_id: id, action: `${field}_changed`,
    new_value: { [field]: value }, actor_id: actorId,
  });
  await notifyCommunityStatusChange(supabase, table, id, field, value);
  backTo(returnTo, { ok: "Updated." });
}

/** Admin/Organizer/Participant Support/Referee directly adds an Audience /
 * Spectator (rather than the person self-registering) — e.g. someone paid
 * or was invited in person. An invitation code here waives the USD 10 fee
 * exactly like self-registration does.
 *
 * Also handles editing an existing member (when `id` is present) — a plain
 * field update, since a record that already exists has already had its
 * invitation code redeemed or its fee charged and neither should re-fire on
 * every edit. */
export async function saveAudienceMember(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/audience";
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const home_country = String(formData.get("home_country") ?? "").trim() || null;
  const invitation_code = String(formData.get("invitation_code") ?? "").trim() || null;
  const support_referral = String(formData.get("support_referral") ?? "").trim() || null;
  const referral_source = String(formData.get("referral_source") ?? "").trim() || null;
  if (!full_name || !email || !phone) {
    backTo(returnTo, { error: "Name, email, and mobile phone are required." });
  }
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);

  if (id) {
    const { error } = await supabase
      .from("audiences")
      .update({ full_name, email, phone, home_country, invitation_code, support_referral, referral_source })
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not save changes — please try again." });
    await writeAudit(supabase, {
      table_name: "audiences", record_id: id, action: "audience_updated_by_admin",
      new_value: { full_name, email, invitation_code }, actor_id: actorId,
    });
    revalidatePath(returnTo);
    backTo(returnTo, { ok: `${full_name} updated.` });
    return;
  }

  let payment_status: "pending" | "waived" = "pending";
  if (invitation_code) {
    const { data: redeemed } = await supabase.rpc("redeem_invitation_code", {
      p_code: invitation_code,
      p_role: "audience",
      p_email: email,
    });
    if (redeemed === true) payment_status = "waived";
  }

  const newId = crypto.randomUUID();
  const { error } = await supabase.from("audiences").insert({
    id: newId, full_name, email, phone, home_country, invitation_code, support_referral, referral_source, payment_status,
  });
  if (error) backTo(returnTo, { error: "Could not add audience member — please try again." });
  await writeAudit(supabase, {
    table_name: "audiences", record_id: newId, action: "audience_added_by_admin",
    new_value: { full_name, email, invitation_code }, actor_id: actorId,
  });
  await notifyAddedByAdmin("audience", email, full_name);
  revalidatePath(returnTo);
  // payment_status is already 'waived' when a code was redeemed above, so
  // only an un-coded add owes the flat sign-in fee.
  if (payment_status !== "waived") {
    const url = await communityRecordCheckoutUrl(
      "audience", newId, full_name, AUDIENCE_FEE_USD, "Audience / Spectator sign-in fee",
    );
    if (url) redirect(url);
  }
  backTo(returnTo, { ok: `${full_name} added to Audience / Spectators.` });
}

export async function deleteAudienceMember(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/audience";
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("audiences").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete — please try again." });
  await writeAudit(supabase, {
    table_name: "audiences", record_id: id, action: "audience_deleted", actor_id: actorId,
  });
  revalidatePath(returnTo);
  backTo(returnTo, { ok: "Audience / Spectator record deleted." });
}

export async function saveReferee(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/referees";
  const values = {
    full_name: String(formData.get("full_name") ?? "").trim(),
    ic_passport: String(formData.get("ic_passport") ?? "").trim(),
    date_of_birth: String(formData.get("date_of_birth") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    karate_rank: String(formData.get("karate_rank") ?? "").trim() || null,
    judge_title: String(formData.get("judge_title") ?? "").trim() || null,
    judging_experience_count: formData.get("judging_experience_count")
      ? Number(formData.get("judging_experience_count"))
      : null,
    school: String(formData.get("school") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: normalizeIban(String(formData.get("bank_account_no") ?? "")) || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
    participating_tier_1_id: String(formData.get("participating_tier_1_id") ?? "").trim() || null,
    participating_tier_2_id: String(formData.get("participating_tier_2_id") ?? "").trim() || null,
    participating_tier_3_id: String(formData.get("participating_tier_3_id") ?? "").trim() || null,
  };
  if (!values.full_name || !values.ic_passport) {
    backTo(returnTo, { error: "Name and IC/passport are required." });
  }
  if (!values.date_of_birth || !values.gender || !values.karate_rank || values.judging_experience_count == null) {
    backTo(returnTo, { error: "Date of birth, gender, karate rank, and judging experience are required." });
  }
  if (!values.judge_title) {
    backTo(returnTo, { error: "Role is required." });
  }
  if (!values.school || !values.email || !values.phone) {
    backTo(returnTo, { error: "School/organization, email, and mobile phone are required." });
  }
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and home country are required." });
  }
  if (!values.bank_name || !values.bank_account_no || !values.bank_account_name) {
    backTo(returnTo, { error: "Bank details are required." });
  }
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "referee", returnTo);
  if (!id && !certificatePath) {
    backTo(returnTo, { error: "Latest rank certificate is required." });
  }

  if (id) {
    const { data: before } = await supabase.from("referees").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase
      .from("referees")
      .update(certificatePath ? { ...values, certificate_path: certificatePath } : values)
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update referee." });
    await writeAudit(supabase, {
      table_name: "referees", record_id: id, action: "referee_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("referees")
      .insert({ ...values, certificate_path: certificatePath })
      .select("id").single();
    if (error) backTo(returnTo, { error: "Could not create judge." });
    await writeAudit(supabase, {
      table_name: "referees", record_id: data!.id, action: "referee_created_by_admin",
      new_value: values, actor_id: actorId,
    });
    await notifyAddedByAdmin("referee", values.email, values.full_name);
    // Flat USD 100 deposit, not a tier fee — refundable to referees who also
    // participate, forfeited otherwise (see the public referee copy).
    if (!values.invitation_code) {
      const url = await communityRecordCheckoutUrl(
        "referee", data!.id, values.full_name, REFEREE_DEPOSIT_USD,
        "Judge deposit",
      );
      if (url) redirect(url);
    }
  }
  backTo(returnTo, { ok: "Judge saved." });
}

export async function deleteReferee(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/referees";
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("referees").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete judge." });
  await writeAudit(supabase, {
    table_name: "referees", record_id: id, action: "referee_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Judge deleted." });
}

/** Which of the 5 kata families (see lib/kata-families.ts) a judge is
 * eligible to be assigned into, plus an optional per-family belt-group
 * narrowing ("Elementary:kyu" — see migration 0127) — feeds
 * autoAssignReferees' eligible pool. Saved together since they're one
 * "how far does this judge's coverage go" decision on the same form. */
export async function saveRefereeKataFamilies(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo =
    String(formData.get("return_to") ?? "") || (id ? `/admin/referees?editref=${id}` : "/admin/referees");
  if (!id) backTo("/admin/referees", { error: "Missing judge." });
  const families = formData.getAll("kata_families").map(String)
    .filter((f) => (KATA_FAMILIES as readonly string[]).includes(f));
  const validBeltKeys = new Set<string>(KATA_FAMILY_BELT_GROUP_OPTIONS.map((o) => o.key));
  const beltGroups = formData.getAll("kata_family_belt_groups").map(String)
    .filter((token) => {
      const [family, belt] = token.split(":");
      return (KATA_FAMILIES as readonly string[]).includes(family) && validBeltKeys.has(belt);
    });
  const { supabase, actorId } = await getActor();
  await requireRefereeConfigManager(supabase, actorId, returnTo);

  const { data: before } = await supabase
    .from("referees")
    .select("kata_families, kata_family_belt_groups")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("referees")
    .update({ kata_families: families, kata_family_belt_groups: beltGroups })
    .eq("id", id);
  if (error) backTo(returnTo, { error: "Could not update kata families." });
  await writeAudit(supabase, {
    table_name: "referees", record_id: id, action: "referee_kata_families_updated",
    old_value: before, new_value: { kata_families: families, kata_family_belt_groups: beltGroups }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Kata families updated." });
}

/** Adds one conflict-of-interest exclusion (a specific kata+belt+age+gender
 * category) that autoAssignReferees and manual assignment must both treat
 * this judge as ineligible for. No cap — a judge can be excluded from as
 * many categories as needed. */
export async function addRefereeExclusion(formData: FormData) {
  const refereeId = String(formData.get("referee_id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "");
  const returnTo =
    String(formData.get("return_to") ?? "") || (refereeId ? `/admin/referees?editref=${refereeId}` : "/admin/referees");
  if (!refereeId) backTo("/admin/referees", { error: "Missing judge." });
  if (!categoryId) backTo(returnTo, { error: "Select a kata, belt group, gender, and age group first." });
  const { supabase, actorId } = await getActor();
  await requireRefereeConfigManager(supabase, actorId, returnTo);

  const { data: existingRows } = await supabase
    .from("referee_category_exclusions")
    .select("id, category_id")
    .eq("referee_id", refereeId);
  if ((existingRows ?? []).some((r) => r.category_id === categoryId)) {
    backTo(returnTo, { error: "That exact category is already excluded for this judge." });
  }

  const { error } = await supabase
    .from("referee_category_exclusions")
    .insert({ referee_id: refereeId, category_id: categoryId });
  if (error) backTo(returnTo, { error: "Could not add exclusion." });
  await writeAudit(supabase, {
    table_name: "referee_category_exclusions", record_id: refereeId,
    action: "referee_exclusion_added", new_value: { category_id: categoryId }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Exclusion added." });
}

/** Bulk version of addRefereeExclusion, for the trace boxes' tick-several-
 * then-add-once flow (a participant competing in several kata categories no
 * longer has to be added one at a time). Silently skips any category_id
 * already excluded for this judge rather than erroring the whole batch. */
export async function addRefereeExclusions(formData: FormData) {
  const refereeId = String(formData.get("referee_id") ?? "");
  const categoryIds = [...new Set(formData.getAll("category_ids").map(String).filter(Boolean))];
  const returnTo =
    String(formData.get("return_to") ?? "") || (refereeId ? `/admin/referees?editref=${refereeId}` : "/admin/referees");
  if (!refereeId) backTo("/admin/referees", { error: "Missing judge." });
  if (categoryIds.length === 0) backTo(returnTo, { error: "Tick at least one category first." });
  const { supabase, actorId } = await getActor();
  await requireRefereeConfigManager(supabase, actorId, returnTo);

  const { data: existingRows } = await supabase
    .from("referee_category_exclusions")
    .select("category_id")
    .eq("referee_id", refereeId);
  const existingIds = new Set((existingRows ?? []).map((r) => r.category_id as string));
  const newIds = categoryIds.filter((id) => !existingIds.has(id));
  if (newIds.length === 0) {
    backTo(returnTo, { error: "Every ticked category is already excluded for this judge." });
  }

  const { error } = await supabase
    .from("referee_category_exclusions")
    .insert(newIds.map((category_id) => ({ referee_id: refereeId, category_id })));
  if (error) backTo(returnTo, { error: "Could not add exclusions." });
  await writeAudit(supabase, {
    table_name: "referee_category_exclusions", record_id: refereeId,
    action: "referee_exclusions_bulk_added", new_value: { category_ids: newIds }, actor_id: actorId,
  });
  const skipped = categoryIds.length - newIds.length;
  backTo(returnTo, {
    ok: `${newIds.length} exclusion${newIds.length === 1 ? "" : "s"} added` +
      (skipped > 0 ? ` (${skipped} already excluded, skipped).` : "."),
  });
}

export async function removeRefereeExclusion(formData: FormData) {
  const exclusionId = String(formData.get("exclusion_id") ?? "");
  const refereeId = String(formData.get("referee_id") ?? "");
  const returnTo =
    String(formData.get("return_to") ?? "") || (refereeId ? `/admin/referees?editref=${refereeId}` : "/admin/referees");
  if (!exclusionId) backTo(returnTo, { error: "Missing exclusion." });
  const { supabase, actorId } = await getActor();
  await requireRefereeConfigManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("referee_category_exclusions").delete().eq("id", exclusionId);
  if (error) backTo(returnTo, { error: "Could not remove exclusion." });
  await writeAudit(supabase, {
    table_name: "referee_category_exclusions", record_id: refereeId,
    action: "referee_exclusion_removed", new_value: { exclusion_id: exclusionId }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Exclusion removed." });
}

export interface ParticipantTraceMatch {
  registrationId: string;
  participantName: string;
  categoryId: string;
  categoryName: string;
}

export interface TraceParticipantState {
  ok: boolean;
  error?: string;
  matches?: ParticipantTraceMatch[];
}

/** Splits a trace box's raw input into individual search terms — one per
 * line (a pasted spreadsheet column) and/or comma-separated on one line,
 * trimmed, deduped, no cap on how many. */
function parseNameList(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Runs one ILIKE search per name and merges the results by id, so a
 * multi-name paste returns the union of every match instead of only ever
 * searching the first name. */
async function searchManyByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  nameColumn: string,
  names: string[],
  limitPerName: number,
): Promise<Array<{ id: string; name: string }>> {
  const byId = new Map<string, string>();
  for (const n of names) {
    const { data } = await supabase.from(table).select(`id, ${nameColumn}`).ilike(nameColumn, `%${n}%`).limit(limitPerName);
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      byId.set(row.id as string, row[nameColumn] as string);
    }
  }
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

/** Every category registration for the given participants, shared by all 3
 * trace-for-exclusion actions below — only HOW participantIds is resolved
 * (by their own name, or via their school/sensei) differs between them. */
async function participantTraceMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  participantIds: string[],
  nameById: Map<string, string>,
): Promise<ParticipantTraceMatch[]> {
  const { data: regs } = await supabase
    .from("registrations")
    .select("id, participant_id, category_id")
    .in("participant_id", participantIds)
    .not("category_id", "is", null);
  const categoryIds = [...new Set((regs ?? []).map((r) => r.category_id as string))];
  if (categoryIds.length === 0) return [];

  const { data: categories } = await supabase.from("categories").select("id, name").in("id", categoryIds);
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));

  return (regs ?? [])
    .filter((r) => r.category_id && categoryNameById.has(r.category_id as string))
    .map((r) => ({
      registrationId: r.id as string,
      participantName: nameById.get(r.participant_id as string) ?? "",
      categoryId: r.category_id as string,
      categoryName: categoryNameById.get(r.category_id as string) ?? "",
    }));
}

/** Looks up participants by name — one, or several pasted as a column or
 * comma-separated list, no limit — and returns every category registration
 * found, so the exclusion form's dropdowns can be filled from a real
 * registration instead of an admin re-typing a category by hand, or, with
 * the trace box's tick boxes, several/all of them added as exclusions in
 * one go. Read-only, but gated the same as the mutations above since it's
 * part of the same restricted form. */
export async function traceParticipantForExclusion(
  _prev: TraceParticipantState,
  formData: FormData,
): Promise<TraceParticipantState> {
  const names = parseNameList(String(formData.get("name") ?? ""));
  if (names.length === 0) return { ok: false, error: "Enter at least one participant name to search." };
  const { supabase, actorId } = await getActor();
  if (!(await canConfigureReferees(supabase, actorId))) {
    return { ok: false, error: "Only Admin / Organizer or a Chief Judge can trace a participant." };
  }

  const participants = await searchManyByName(supabase, "participants", "full_name", names, 25);
  if (participants.length === 0) {
    return { ok: false, error: `No participant found matching ${names.length === 1 ? `"${names[0]}"` : "any of those names"}.` };
  }
  const participantIds = participants.map((p) => p.id);
  const nameById = new Map(participants.map((p) => [p.id, p.name]));

  const matches = await participantTraceMatches(supabase, participantIds, nameById);
  if (matches.length === 0) {
    return {
      ok: false,
      error:
        participants.length === 1
          ? `${nameById.get(participantIds[0])} has no category registration yet.`
          : "None of those participants have a category registration yet.",
    };
  }
  return { ok: true, matches };
}

/** Same as traceParticipantForExclusion, but searching by the participants'
 * School / Dojo name instead — for excluding a judge from every category a
 * whole school's roster competes in (e.g. the judge coaches there). */
export async function traceSchoolForExclusion(
  _prev: TraceParticipantState,
  formData: FormData,
): Promise<TraceParticipantState> {
  const names = parseNameList(String(formData.get("name") ?? ""));
  if (names.length === 0) return { ok: false, error: "Enter at least one school / dojo name to search." };
  const { supabase, actorId } = await getActor();
  if (!(await canConfigureReferees(supabase, actorId))) {
    return { ok: false, error: "Only Admin / Organizer or a Chief Judge can trace a school." };
  }

  const schools = await searchManyByName(supabase, "schools", "name", names, 25);
  if (schools.length === 0) {
    return { ok: false, error: `No school found matching ${names.length === 1 ? `"${names[0]}"` : "any of those names"}.` };
  }
  const schoolIds = schools.map((s) => s.id);

  const { data: participantsData } = await supabase
    .from("participants")
    .select("id, full_name")
    .in("school_id", schoolIds)
    .limit(2000);
  if (!participantsData || participantsData.length === 0) {
    return { ok: false, error: `No participants found under a school matching ${names.length === 1 ? `"${names[0]}"` : "those names"}.` };
  }
  const participantIds = participantsData.map((p) => p.id as string);
  const nameById = new Map(participantsData.map((p) => [p.id as string, p.full_name as string]));

  const matches = await participantTraceMatches(supabase, participantIds, nameById);
  if (matches.length === 0) {
    return {
      ok: false,
      error: `No category registrations found for participants under a school matching ${names.length === 1 ? `"${names[0]}"` : "those names"}.`,
    };
  }
  return { ok: true, matches };
}

/** Same as traceParticipantForExclusion, but searching by the participants'
 * Sensei name instead — for excluding a judge from every category their
 * own sensei's students compete in. */
export async function traceSenseiForExclusion(
  _prev: TraceParticipantState,
  formData: FormData,
): Promise<TraceParticipantState> {
  const names = parseNameList(String(formData.get("name") ?? ""));
  if (names.length === 0) return { ok: false, error: "Enter at least one sensei name to search." };
  const { supabase, actorId } = await getActor();
  if (!(await canConfigureReferees(supabase, actorId))) {
    return { ok: false, error: "Only Admin / Organizer or a Chief Judge can trace a sensei." };
  }

  const senseis = await searchManyByName(supabase, "senseis", "name", names, 25);
  if (senseis.length === 0) {
    return { ok: false, error: `No sensei found matching ${names.length === 1 ? `"${names[0]}"` : "any of those names"}.` };
  }
  const senseiIds = senseis.map((s) => s.id);

  const { data: participantsData } = await supabase
    .from("participants")
    .select("id, full_name")
    .in("sensei_id", senseiIds)
    .limit(2000);
  if (!participantsData || participantsData.length === 0) {
    return { ok: false, error: `No participants found under a sensei matching ${names.length === 1 ? `"${names[0]}"` : "those names"}.` };
  }
  const participantIds = participantsData.map((p) => p.id as string);
  const nameById = new Map(participantsData.map((p) => [p.id as string, p.full_name as string]));

  const matches = await participantTraceMatches(supabase, participantIds, nameById);
  if (matches.length === 0) {
    return {
      ok: false,
      error: `No category registrations found for participants under a sensei matching ${names.length === 1 ? `"${names[0]}"` : "those names"}.`,
    };
  }
  return { ok: true, matches };
}

// ── Participants ─────────────────────────────────────────────────────────────

export async function saveParticipant(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/participants";
  const values = {
    full_name: String(formData.get("full_name") ?? "").trim(),
    ic_passport: String(formData.get("ic_passport") ?? "").trim(),
    date_of_birth: String(formData.get("date_of_birth") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    belt_rank: String(formData.get("belt_rank") ?? "").trim() || null,
    rank_confirmation: String(formData.get("rank_confirmation") ?? "") || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    home_country: String(formData.get("home_country") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    school_id: String(formData.get("school_id") ?? "") || null,
    sensei_id: String(formData.get("sensei_id") ?? "") || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
  };
  if (!values.full_name || !values.ic_passport) {
    backTo(returnTo, { error: "Name and IC/passport are required." });
  }
  if (!values.date_of_birth || !values.gender || !values.belt_rank || !values.rank_confirmation) {
    backTo(returnTo, { error: "Date of birth, gender, belt rank, and rank confirmation are required." });
  }
  if (!values.home_address || !values.city_town || !values.postcode || !values.home_country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and home country are required." });
  }
  if (!values.email || !values.phone) {
    backTo(returnTo, { error: "Email address and mobile phone are required." });
  }
  if (!values.school_id || !values.sensei_id) {
    backTo(returnTo, { error: "School and sensei are required." });
  }
  const bank = {
    bank_name: String(formData.get("bank_name") ?? "").trim(),
    bank_account_no: normalizeIban(String(formData.get("bank_account_no") ?? "")),
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim(),
  };
  if (!bank.bank_name || !bank.bank_account_no || !bank.bank_account_name) {
    backTo(returnTo, { error: "Reward payout bank details are required." });
  }
  const { supabase, actorId } = await getActor();
  await requireCommunityManager(supabase, actorId, returnTo);

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "participant", returnTo);

  let targetId = id;
  if (id) {
    const { data: before } = await supabase
      .from("participants").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase
      .from("participants")
      .update(certificatePath ? { ...values, certificate_path: certificatePath } : values)
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update participant." });
    await writeAudit(supabase, {
      table_name: "participants", record_id: id, action: "participant_updated",
      old_value: before, new_value: values, actor_id: actorId,
    });
    // Changing which email a paid registration is tied to is more
    // consequential than most edits -- whoever controls that inbox can now
    // claim it via "Link to account" -- so both addresses and the
    // organizers get a heads-up. Distinct from Link to account itself,
    // which never changes a participant's email.
    if (before && before.email !== values.email) {
      await notifyParticipantEmailChanged({
        participantName: values.full_name,
        oldEmail: before.email,
        newEmail: values.email,
        changedBy: null,
      });
    }
  } else {
    const { data, error } = await supabase
      .from("participants")
      .insert({ ...values, certificate_path: certificatePath })
      .select("id").single();
    if (error) backTo(returnTo, { error: "Could not create participant." });
    targetId = data!.id;
    await writeAudit(supabase, {
      table_name: "participants", record_id: targetId, action: "participant_created",
      new_value: values, actor_id: actorId,
    });
    await notifyAddedByAdmin("participant", values.email, values.full_name);
  }

  // Upsert reward bank details when all three fields are provided
  if (targetId && bank.bank_name && bank.bank_account_no && bank.bank_account_name) {
    await supabase
      .from("participant_bank_details")
      .upsert({ participant_id: targetId, ...bank }, { onConflict: "participant_id" });
    await writeAudit(supabase, {
      table_name: "participant_bank_details", record_id: targetId,
      action: "bank_details_saved", actor_id: actorId,
    });
  }

  // Kata entries, when the Add form's Kata events picker was used. Only on
  // create -- editing an existing participant must not silently mint a second
  // set of registrations, which is why the picker is hidden when editing.
  if (targetId && !id) {
    const created = await createAdminRegistrations(supabase, actorId, formData, {
      participantId: targetId,
      dateOfBirth: values.date_of_birth,
      beltRank: values.belt_rank,
      gender: values.gender,
      invitationCode: values.invitation_code,
    });
    if ("error" in created) {
      backTo(returnTo, { error: created.error });
      return;
    }
    if (created.checkoutUrl) redirect(created.checkoutUrl);
    if (created.count > 0) {
      revalidatePath("/participants");
      backTo(returnTo, {
        ok: created.waived
          ? `Participant saved with ${created.count} kata event${created.count === 1 ? "" : "s"} — fee waived by invitation code, marked pending.`
          : `Participant saved with ${created.count} kata event${created.count === 1 ? "" : "s"}.`,
      });
    }
  }

  revalidatePath("/participants");
  backTo(returnTo, { ok: "Participant saved." });
}

/** Turns the Add Participant form's Kata events picks into real
 * `registrations` rows — the admin equivalent of what the public
 * submitRegistration does, so a participant added by the organizer is
 * actually entered in events rather than existing as a person entered in
 * nothing.
 *
 * Payment follows the invitation code, per the organizer's rule:
 *   • no code  -> Stripe Checkout, rows created 'pending' and confirmed by
 *                 the webhook exactly like a public registration
 *   • has code -> fee waived / settled another way, rows created 'pending'
 *                 for the organizer to mark paid or waived manually
 *
 * Nothing is ever created 'paid' here: a registration that counts toward a
 * school's or sensei's 10% commission must reflect money actually received.
 */
async function createAdminRegistrations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  formData: FormData,
  ctx: {
    participantId: string;
    dateOfBirth: string | null;
    beltRank: string | null;
    gender: string | null;
    invitationCode: string | null;
  },
): Promise<{ count: number; waived: boolean; checkoutUrl?: string } | { error: string }> {
  const { data: openComps } = await supabase
    .from("competitions")
    .select("id, name, event_date, registration_fee_usd, status")
    .eq("status", "open")
    .order("registration_fee_usd", { ascending: true });
  const comps = (openComps ?? []) as Array<{
    id: string; name: string; event_date: string | null; registration_fee_usd: number | null;
  }>;
  if (comps.length === 0) return { count: 0, waived: false };

  // The picker names its selects by tier INDEX, in the same cheapest-first
  // order this query returns.
  const picks: Array<{ competitionId: string; kataBase: string; fee: number }> = [];
  comps.forEach((c, i) => {
    for (const slot of [1, 2, 3]) {
      const kataBase = String(formData.get(`kata_${i}_${slot}`) ?? "").trim();
      if (kataBase) picks.push({ competitionId: c.id, kataBase, fee: Number(c.registration_fee_usd ?? 0) });
    }
  });
  if (picks.length === 0) return { count: 0, waived: false };

  if (!ctx.dateOfBirth || !ctx.beltRank || !ctx.gender) {
    return { error: "Date of birth, belt rank, and gender are all required to enter a kata event." };
  }

  const rows: Array<{ competition_id: string; category_id: string; division: string }> = [];
  for (const pick of picks) {
    const { data: cats } = await supabase.from("categories").select("*").eq("competition_id", pick.competitionId);
    const comp = comps.find((c) => c.id === pick.competitionId)!;
    const resolved = resolveCategory(
      (cats ?? []) as unknown as Parameters<typeof resolveCategory>[0],
      pick.kataBase,
      ctx.dateOfBirth,
      ctx.beltRank,
      ctx.gender,
      comp.event_date,
    );
    if (resolved.error || !resolved.category) {
      return { error: `${pick.kataBase}: ${resolved.error ?? "no matching sub-category for this belt / age / gender."}` };
    }
    rows.push({
      competition_id: pick.competitionId,
      category_id: resolved.category.id,
      division: ctx.gender.toLowerCase() === "female" ? "Female" : "Male",
    });
  }

  const { data: inserted, error } = await supabase
    .from("registrations")
    .insert(
      rows.map((r) => ({
        ...r,
        participant_id: ctx.participantId,
        payment_status: "pending",
        slot_status: "active",
        notes: ctx.invitationCode ? `Added by admin — invitation code ${ctx.invitationCode}` : "Added by admin",
      })),
    )
    .select("id");
  if (error) return { error: "Saved the participant, but could not create the kata entries." };

  await writeAudit(supabase, {
    table_name: "registrations", record_id: ctx.participantId,
    action: "admin_registrations_created",
    new_value: { count: rows.length, invitation_code: ctx.invitationCode }, actor_id: actorId,
  });

  // An invitation code means the fee is waived or settled off-platform, so
  // no checkout. Without one, send the organizer straight to Stripe.
  if (ctx.invitationCode) return { count: rows.length, waived: true };

  const totalUsd = picks.reduce((sum, p) => sum + p.fee, 0);
  if (totalUsd <= 0 || !paymentsEnabled()) return { count: rows.length, waived: false };

  const checkoutUrl = await adminRegistrationCheckoutUrl(
    (inserted ?? []).map((r) => r.id as string),
    totalUsd,
    picks.length,
  );
  return { count: rows.length, waived: false, checkoutUrl: checkoutUrl ?? undefined };
}

export async function deleteParticipant(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/participants";
  const { supabase, actorId } = await getActor();
  // Deliberately an allow-list (admin/organizer/staff), not the deny-list
  // this used to be (blockCustomerSupport + blockReferee) -- a deny-list
  // silently admits any future/unlisted role too, whereas canDelete on the
  // Participants page itself is already "everyone except Support/Referee".
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("participants").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Cannot delete — registrations reference this participant. Delete those first." });
  await writeAudit(supabase, {
    table_name: "participants", record_id: id, action: "participant_deleted", actor_id: actorId,
  });
  revalidatePath("/participants");
  backTo(returnTo, { ok: "Participant deleted." });
}

// ── Accounts (profiles, invitation codes, referee assignment) ──────────────

export async function setProfileApproval(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const approve = formData.get("approve") === "true";
  const returnTo = "/admin/accounts";
  const { supabase, actorId } = await getActor();
  // Defense-in-depth: approve_profile() is SECURITY DEFINER and already
  // asserts is_admin() itself, so an unauthorized call would fail at the DB
  // layer regardless -- this just gives a clearer error and matches every
  // other action's own explicit guard, rather than relying solely on the RPC.
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase.rpc("approve_profile", { p_user: userId, p_approve: approve });
  if (error) backTo(returnTo, { error: "Could not update approval." });
  await writeAudit(supabase, {
    table_name: "profiles", record_id: userId,
    action: approve ? "account_approved" : "account_unapproved", actor_id: actorId,
  });
  backTo(returnTo, { ok: approve ? "Account approved." : "Approval revoked." });
}

const INVITATION_CODE_ROLES = ["referee", "staff", "audience", "school", "sensei", "participant", "organizer", "customer_support", "admin", "any"];

/** Every field is required except Note, per the organizer's explicit
 * instruction — including Code (no more auto-generation), Email, and Max
 * uses (no more "unlimited shared code" — every code is now a deliberate,
 * fully-specified grant). Returns the parsed values, or redirects back with
 * an error via backTo if anything required is missing/invalid. */
function requireInvitationCodeFields(formData: FormData, returnTo: string) {
  const role = String(formData.get("role") ?? "");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const note = String(formData.get("note") ?? "").trim() || null;
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const validFrom = String(formData.get("valid_from") ?? "").trim();
  const validUntil = String(formData.get("valid_until") ?? "").trim();
  const signInLimitRaw = String(formData.get("sign_in_limit") ?? "").trim();
  const competitionIdsRaw = String(formData.get("competition_ids") ?? "").trim();
  const competitionIds = competitionIdsRaw ? competitionIdsRaw.split(",").filter(Boolean) : [];
  if (!INVITATION_CODE_ROLES.includes(role)) backTo(returnTo, { error: "A valid role is required." });
  if (!code) backTo(returnTo, { error: "Code is required." });
  if (!maxUsesRaw || Number(maxUsesRaw) < 1) backTo(returnTo, { error: "Max uses is required." });
  if (!email) backTo(returnTo, { error: "Email is required." });
  if (!validFrom) backTo(returnTo, { error: "Valid from is required." });
  if (!validUntil) backTo(returnTo, { error: "Valid until is required." });
  if (!signInLimitRaw || Number(signInLimitRaw) < 1) backTo(returnTo, { error: "Sign-in limit is required." });
  if (competitionIds.length === 0) backTo(returnTo, { error: "Competition tier is required." });
  return {
    role, code, note, email, phone,
    max_uses: Number(maxUsesRaw),
    valid_from: validFrom,
    valid_until: validUntil,
    sign_in_limit: Number(signInLimitRaw),
    // Cheapest tier stays the single-value primary (backward-compat display
    // and profiles.sign_in_competition_id); competition_ids carries the
    // full granted range — see lib/invitation-codes.ts's tierCombinations.
    competition_id: competitionIds[0],
    competition_ids: competitionIds,
  };
}

/** Computes (never writes) the next systematic code for a role + competition
 * tier — IKO-<ROLE>-TIER-<TIER>-2026-<NNNNN>, see lib/invitation-codes.ts.
 * Read-only: since nothing is inserted here, a number shown by "Run" but
 * never actually submitted via createInvitationCode is simply never
 * recorded, so the very next Run click computes that same number again —
 * no separate reservation or release step needed. Callable directly from
 * the InvitationCodeForm client component (not tied to a <form> element),
 * since Server Actions can be invoked like a plain async function from
 * event handlers, not just form submissions. */
export async function generateSequentialInvitationCode(
  role: string,
  competitionIds: string[],
): Promise<{ code: string } | { error: string }> {
  if (!INVITATION_CODE_ROLES.includes(role)) return { error: "Pick a role first." };
  if (!competitionIds.length) return { error: "Pick a competition tier first." };
  const { supabase, actorId } = await getActor();
  // This returns a value rather than redirecting, so it can't use the
  // backTo-based requireCompetitionManager helper -- same allow-list,
  // returned as an error value instead.
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    return { error: "Only Admin / Organizer can generate invitation codes." };
  }
  const { data: competitions } = await supabase
    .from("competitions")
    .select("id, registration_fee_usd")
    .in("id", competitionIds);
  if (!competitions || competitions.length !== competitionIds.length) return { error: "Competition not found." };
  const fees = competitions
    .map((c) => Number(c.registration_fee_usd ?? 0))
    .sort((a, b) => a - b);
  const prefix = codePrefix(role, fees);
  const { data: existing } = await supabase
    .from("invitation_codes")
    .select("code")
    .ilike("code", `${prefix}%`);
  const code = nextSequentialCode(prefix, (existing ?? []).map((r) => r.code as string));
  return { code };
}

export async function createInvitationCode(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  const fields = requireInvitationCodeFields(formData, returnTo);
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  // Who generated it is read from the signer's own session, never typed in —
  // falls back to their account email when they haven't set a display name.
  const { data: myProfile } = actorId
    ? await supabase.from("profiles").select("full_name, email").eq("user_id", actorId).maybeSingle()
    : { data: null };
  const generated_by = myProfile?.full_name || myProfile?.email || null;
  const { data, error } = await supabase
    .from("invitation_codes")
    .insert({ ...fields, generated_by })
    .select("id")
    .single();
  if (error) backTo(returnTo, { error: `Could not create code: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: data!.id, action: "invitation_code_created",
    new_value: fields, actor_id: actorId,
  });
  // Best-effort — the code itself already exists regardless of whether this
  // notice goes out.
  await notifyInvitationCodeIssued({ email: fields.email, role: fields.role, code: fields.code }).catch(() => {});
  backTo(returnTo, { ok: `Invitation code created: ${fields.code}` });
}

export async function updateInvitationCode(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  if (!id) backTo(returnTo, { error: "Invalid request." });
  const fields = requireInvitationCodeFields(formData, returnTo);
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { data: before } = await supabase.from("invitation_codes").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("invitation_codes").update(fields).eq("id", id);
  if (error) backTo(returnTo, { error: `Could not update code: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: id, action: "invitation_code_updated",
    old_value: before, new_value: fields, actor_id: actorId,
  });
  backTo(returnTo, { ok: `Invitation code updated: ${fields.code}` });
}

const INVITATION_CODE_CSV_COLUMNS = [
  "code", "role", "email", "max_uses", "valid_from", "valid_until", "sign_in_limit", "competition_name", "note",
] as const;

export async function bulkUploadInvitationCodes(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), INVITATION_CODE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 1000) return { done: false, error: "Maximum 1000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const { data: myProfile } = actorId
    ? await supabase.from("profiles").select("full_name, email").eq("user_id", actorId).maybeSingle()
    : { data: null };
  const generated_by = myProfile?.full_name || myProfile?.email || null;

  const { data: competitions } = await supabase.from("competitions").select("id, name, registration_fee_usd");
  const competitionByName = new Map(
    (competitions ?? []).map((c) => [c.name.trim().toLowerCase(), { id: c.id, fee: Number(c.registration_fee_usd ?? 0) }]),
  );

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const code = get(r, "code").toUpperCase() || `Row ${rowNo}`;
    const role = get(r, "role").toLowerCase();
    if (!get(r, "code")) { failures.push({ row: rowNo, name: code, error: "code is required" }); continue; }
    if (!INVITATION_CODE_ROLES.includes(role)) { failures.push({ row: rowNo, name: code, error: "role is not a valid role key" }); continue; }
    const email = get(r, "email").toLowerCase();
    const maxUses = Number(get(r, "max_uses"));
    const validFromRaw = get(r, "valid_from");
    const validUntilRaw = get(r, "valid_until");
    const validFrom = validFromRaw ? parseDDMMYYYY(validFromRaw) : null;
    const validUntil = validUntilRaw ? parseDDMMYYYY(validUntilRaw) : null;
    const signInLimit = Number(get(r, "sign_in_limit"));
    // A code can cover more than one tier — "USD 10 Tier + USD 100 Tier" —
    // joined with "+" the same way the combination is displayed elsewhere.
    const tierNames = get(r, "competition_name").split("+").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const matchedTiers = tierNames.map((n) => competitionByName.get(n)).filter((t): t is { id: string; fee: number } => !!t);
    matchedTiers.sort((a, b) => a.fee - b.fee);
    const competitionIds = matchedTiers.map((t) => t.id);
    if ((validFromRaw && !validFrom) || (validUntilRaw && !validUntil)) {
      failures.push({ row: rowNo, name: code, error: "Invalid valid_from/valid_until (use DD/MM/YYYY)" });
      continue;
    }
    if (!email || !maxUses || maxUses < 1 || !validFrom || !validUntil || !signInLimit || signInLimit < 1) {
      failures.push({ row: rowNo, name: code, error: "email, max_uses, valid_from, valid_until, and sign_in_limit are all required" });
      continue;
    }
    if (matchedTiers.length === 0 || matchedTiers.length !== tierNames.length) {
      failures.push({ row: rowNo, name: code, error: "competition_name does not match existing competition(s) — separate multiple tiers with +" });
      continue;
    }

    const record = {
      code, role, email, max_uses: maxUses, valid_from: validFrom, valid_until: validUntil,
      sign_in_limit: signInLimit, competition_id: competitionIds[0], competition_ids: competitionIds,
      note: get(r, "note") || null, generated_by,
    };
    const { data, error } = await supabase.from("invitation_codes").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: code, error: error.message.includes("duplicate") ? "This code already exists" : "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "invitation_codes", record_id: data!.id, action: "invitation_code_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: null, action: "bulk_csv_invitation_codes",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

export async function deleteInvitationCode(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("invitation_codes").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete code." });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: id, action: "invitation_code_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Invitation code deleted." });
}

// ── Editable Access Matrix + Access Comparison tables ───────────────────────

async function requireAccessTableEditor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit the access tables." });
  }
}

/** One-click import of the code's built-in rows into the editable tables
 * (only fills a table that is still empty, so re-clicking is safe). */
export async function seedAccessTables(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);

  const { count: matrixCount } = await supabase
    .from("access_matrix_rows").select("id", { count: "exact", head: true });
  if (!matrixCount) {
    await supabase.from("access_matrix_rows").insert(
      ACCESS_MATRIX.map((r, i) => ({
        position: i + 1, resource: r.resource, note: r.note ?? null,
        admin: r.admin, organizer: r.organizer, customer_support: r.customerSupport, referee: r.referee,
      })),
    );
  }
  const { count: cmpCount } = await supabase
    .from("access_comparison_rows").select("id", { count: "exact", head: true });
  if (!cmpCount) {
    await supabase.from("access_comparison_rows").insert(
      DEFAULT_COMPARISON_ROWS.map((r, i) => ({
        position: i + 1, what: r.what,
        participant: r.cells[0], school: r.cells[1], sensei: r.cells[2], referee: r.cells[3],
        audience: r.cells[4], organizer: r.cells[5], support: r.cells[6],
      })),
    );
  }
  await writeAudit(supabase, {
    table_name: "access_matrix_rows", record_id: null, action: "access_tables_seeded", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Access tables imported — edit the rows below." });
}

export async function saveAccessMatrixRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    resource: String(formData.get("resource") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim() || null,
    admin: String(formData.get("admin") ?? "").trim(),
    organizer: String(formData.get("organizer") ?? "").trim(),
    customer_support: String(formData.get("customer_support") ?? "").trim(),
    referee: String(formData.get("referee") ?? "").trim(),
  };
  if (!values.resource) backTo(returnTo, { error: "Resource name is required." });
  const { error } = id
    ? await supabase.from("access_matrix_rows").update(values).eq("id", id)
    : await supabase.from("access_matrix_rows").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the Access Matrix row." });
  await writeAudit(supabase, {
    table_name: "access_matrix_rows", record_id: id || null,
    action: id ? "access_matrix_row_updated" : "access_matrix_row_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Access Matrix row saved." });
}

export async function deleteAccessMatrixRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("access_matrix_rows").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the row." });
  await writeAudit(supabase, {
    table_name: "access_matrix_rows", record_id: id, action: "access_matrix_row_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Access Matrix row deleted." });
}

/** Sign-in Access Matrix (Editable) — each role's default sign-in cap and
 * whether it's tied to a competition tier's default valid window. Read by
 * default_sign_in_limit_for_role / recompute_sign_in_quota, so an edit here
 * actually changes future defaults (never retroactively touches an
 * account whose sign_in_quota_auto is already false — see
 * recompute_sign_in_quota in migration 0089). Shown editable on
 * /admin/content, and read-only for everyone on the Account page. */
export async function saveSignInRoleDefault(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const role = String(formData.get("role") ?? "").trim();
  // The join key onto profiles.role, kept separate from the free-text `role`
  // label above precisely so renaming the label can't detach the row — which
  // is exactly what happened before migration 0093. Blank = display-only row.
  const roleKeyRaw = String(formData.get("role_key") ?? "").trim().toLowerCase();
  const role_key = (PROFILE_ROLE_KEYS as readonly string[]).includes(roleKeyRaw)
    ? roleKeyRaw
    : null;
  const limitRaw = String(formData.get("default_sign_in_limit") ?? "").trim();
  const validFrom = String(formData.get("valid_from") ?? "").trim();
  const validUntil = String(formData.get("valid_until") ?? "").trim();
  const values = {
    role,
    role_key,
    default_sign_in_limit: limitRaw ? Number(limitRaw) : null,
    tier_tied: formData.get("tier_tied") === "on",
    notes: String(formData.get("notes") ?? "").trim() || null,
    sort_order: Number(formData.get("sort_order") ?? 0) || 0,
    valid_from: validFrom || null,
    valid_until: validUntil || null,
  };
  if (!role) backTo(returnTo, { error: "Role is required." });
  const { error } = id
    ? await supabase.from("sign_in_role_defaults").update(values).eq("id", id)
    : await supabase.from("sign_in_role_defaults").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the row — role names must be unique." });
  await writeAudit(supabase, {
    table_name: "sign_in_role_defaults", record_id: id || null,
    action: id ? "sign_in_role_default_updated" : "sign_in_role_default_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Sign-in Access Matrix row saved." });
}

export async function deleteSignInRoleDefault(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("sign_in_role_defaults").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the row." });
  await writeAudit(supabase, {
    table_name: "sign_in_role_defaults", record_id: id, action: "sign_in_role_default_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Row deleted — that role now falls back to the built-in 250 default." });
}

const ACCESS_MATRIX_CSV_COLUMNS = ["position", "resource", "admin", "organizer", "customer_support", "referee", "note"] as const;

export async function bulkUploadAccessMatrixRows(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/content";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), ACCESS_MATRIX_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 200) return { done: false, error: "Maximum 200 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const resource = get(r, "resource");
    if (!resource) { failures.push({ row: rowNo, name: `Row ${rowNo}`, error: "resource is required" }); continue; }
    const values = {
      position: Number(get(r, "position")) || 0,
      resource,
      admin: get(r, "admin"),
      organizer: get(r, "organizer"),
      customer_support: get(r, "customer_support"),
      referee: get(r, "referee"),
      note: get(r, "note") || null,
    };
    const { data, error } = await supabase.from("access_matrix_rows").insert(values).select("id").single();
    if (error) { failures.push({ row: rowNo, name: resource, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "access_matrix_rows", record_id: data!.id, action: "access_matrix_row_created",
      new_value: values, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const SIGN_IN_ROLE_DEFAULTS_CSV_COLUMNS = ["role", "role_key", "default_sign_in_limit", "tier_tied", "valid_from", "valid_until", "notes", "sort_order"] as const;

/** Upserts by role (its unique key) — re-uploading the same CSV updates
 * existing rows instead of duplicating them, unlike the other two tables
 * here which only insert. */
export async function bulkUploadSignInRoleDefaults(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/content";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), SIGN_IN_ROLE_DEFAULTS_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 50) return { done: false, error: "Maximum 50 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const role = get(r, "role");
    if (!role) { failures.push({ row: rowNo, name: `Row ${rowNo}`, error: "role is required" }); continue; }
    const limitRaw = get(r, "default_sign_in_limit");
    const roleKeyRaw = get(r, "role_key").trim().toLowerCase();
    if (roleKeyRaw && !(PROFILE_ROLE_KEYS as readonly string[]).includes(roleKeyRaw)) {
      failures.push({
        row: rowNo, name: role,
        error: `role_key must be one of: ${PROFILE_ROLE_KEYS.join(", ")} (or blank for a display-only row)`,
      });
      continue;
    }
    const values = {
      role,
      role_key: roleKeyRaw || null,
      default_sign_in_limit: limitRaw ? Number(limitRaw) : null,
      tier_tied: /^(true|yes|1)$/i.test(get(r, "tier_tied")),
      valid_from: parseDDMMYYYY(get(r, "valid_from")) || null,
      valid_until: parseDDMMYYYY(get(r, "valid_until")) || null,
      notes: get(r, "notes") || null,
      sort_order: Number(get(r, "sort_order")) || 0,
    };
    const { error } = await supabase.from("sign_in_role_defaults").upsert(values, { onConflict: "role" });
    if (error) { failures.push({ row: rowNo, name: role, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "sign_in_role_defaults", record_id: null, action: "sign_in_role_default_upserted",
      new_value: values, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const ACCESS_COMPARISON_CSV_COLUMNS = ["position", "what", "participant", "school", "sensei", "referee", "audience", "organizer", "support"] as const;

export async function bulkUploadAccessComparisonRows(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/content";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), ACCESS_COMPARISON_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 200) return { done: false, error: "Maximum 200 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const what = get(r, "what");
    if (!what) { failures.push({ row: rowNo, name: `Row ${rowNo}`, error: "what is required" }); continue; }
    const values = {
      position: Number(get(r, "position")) || 0,
      what,
      participant: get(r, "participant"),
      school: get(r, "school"),
      sensei: get(r, "sensei"),
      referee: get(r, "referee"),
      audience: get(r, "audience"),
      organizer: get(r, "organizer"),
      support: get(r, "support"),
    };
    const { data, error } = await supabase.from("access_comparison_rows").insert(values).select("id").single();
    if (error) { failures.push({ row: rowNo, name: what, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "access_comparison_rows", record_id: data!.id, action: "access_comparison_row_created",
      new_value: values, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

export async function saveAccessComparisonRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    what: String(formData.get("what") ?? "").trim(),
    participant: String(formData.get("participant") ?? "").trim(),
    school: String(formData.get("school") ?? "").trim(),
    sensei: String(formData.get("sensei") ?? "").trim(),
    referee: String(formData.get("referee") ?? "").trim(),
    audience: String(formData.get("audience") ?? "").trim(),
    organizer: String(formData.get("organizer") ?? "").trim(),
    support: String(formData.get("support") ?? "").trim(),
  };
  if (!values.what) backTo(returnTo, { error: "The Access row name is required." });
  const { error } = id
    ? await supabase.from("access_comparison_rows").update(values).eq("id", id)
    : await supabase.from("access_comparison_rows").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the comparison row." });
  await writeAudit(supabase, {
    table_name: "access_comparison_rows", record_id: id || null,
    action: id ? "access_comparison_row_updated" : "access_comparison_row_created",
    new_value: values, actor_id: actorId,
  });
  revalidatePath("/register");
  backTo(returnTo, { ok: "Access Comparison row saved." });
}

export async function deleteAccessComparisonRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("access_comparison_rows").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the row." });
  await writeAudit(supabase, {
    table_name: "access_comparison_rows", record_id: id, action: "access_comparison_row_deleted", actor_id: actorId,
  });
  revalidatePath("/register");
  backTo(returnTo, { ok: "Access Comparison row deleted." });
}

// ── Notification Reference + Telegram-Link Reference tables ────────────────
// Two hand-maintained documentation tables on /admin/content: every button
// in the app and what it does/doesn't notify (email / Telegram DM / "join
// group" link), and which roles can ever end up Telegram-linked. Same
// editable-table + CSV import/export shape as the Access Matrix above —
// these describe app behavior, they don't drive it.

export async function saveNotificationReferenceRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    page: String(formData.get("page") ?? "").trim(),
    button_label: String(formData.get("button_label") ?? "").trim(),
    sends_email: String(formData.get("sends_email") ?? "").trim(),
    sends_telegram_dm: String(formData.get("sends_telegram_dm") ?? "").trim(),
    telegram_group_link: String(formData.get("telegram_group_link") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  if (!values.page || !values.button_label) backTo(returnTo, { error: "Page and Button are required." });
  const { error } = id
    ? await supabase.from("notification_reference_rows").update(values).eq("id", id)
    : await supabase.from("notification_reference_rows").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the row." });
  await writeAudit(supabase, {
    table_name: "notification_reference_rows", record_id: id || null,
    action: id ? "notification_reference_row_updated" : "notification_reference_row_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Notification Reference row saved." });
}

export async function deleteNotificationReferenceRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("notification_reference_rows").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the row." });
  await writeAudit(supabase, {
    table_name: "notification_reference_rows", record_id: id, action: "notification_reference_row_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Notification Reference row deleted." });
}

const NOTIFICATION_REFERENCE_CSV_COLUMNS = [
  "position", "page", "button_label", "sends_email", "sends_telegram_dm", "telegram_group_link", "notes",
] as const;

export async function bulkUploadNotificationReferenceRows(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/content";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), NOTIFICATION_REFERENCE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 200) return { done: false, error: "Maximum 200 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const page = get(r, "page");
    const button_label = get(r, "button_label");
    if (!page || !button_label) { failures.push({ row: rowNo, name: `Row ${rowNo}`, error: "page and button_label are required" }); continue; }
    const values = {
      position: Number(get(r, "position")) || 0,
      page,
      button_label,
      sends_email: get(r, "sends_email"),
      sends_telegram_dm: get(r, "sends_telegram_dm"),
      telegram_group_link: get(r, "telegram_group_link"),
      notes: get(r, "notes") || null,
    };
    const { data, error } = await supabase.from("notification_reference_rows").insert(values).select("id").single();
    if (error) { failures.push({ row: rowNo, name: button_label, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "notification_reference_rows", record_id: data!.id, action: "notification_reference_row_created",
      new_value: values, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

export async function saveTelegramLinkReferenceRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    role: String(formData.get("role") ?? "").trim(),
    can_be_linked: String(formData.get("can_be_linked") ?? "").trim(),
    how_to_link: String(formData.get("how_to_link") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  if (!values.role) backTo(returnTo, { error: "Role is required." });
  const { error } = id
    ? await supabase.from("telegram_link_reference_rows").update(values).eq("id", id)
    : await supabase.from("telegram_link_reference_rows").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the row." });
  await writeAudit(supabase, {
    table_name: "telegram_link_reference_rows", record_id: id || null,
    action: id ? "telegram_link_reference_row_updated" : "telegram_link_reference_row_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Telegram Link Reference row saved." });
}

export async function deleteTelegramLinkReferenceRow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/content";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("telegram_link_reference_rows").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the row." });
  await writeAudit(supabase, {
    table_name: "telegram_link_reference_rows", record_id: id, action: "telegram_link_reference_row_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Telegram Link Reference row deleted." });
}

const TELEGRAM_LINK_REFERENCE_CSV_COLUMNS = ["position", "role", "can_be_linked", "how_to_link", "notes"] as const;

export async function bulkUploadTelegramLinkReferenceRows(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/content";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), TELEGRAM_LINK_REFERENCE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 200) return { done: false, error: "Maximum 200 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const role = get(r, "role");
    if (!role) { failures.push({ row: rowNo, name: `Row ${rowNo}`, error: "role is required" }); continue; }
    const values = {
      position: Number(get(r, "position")) || 0,
      role,
      can_be_linked: get(r, "can_be_linked"),
      how_to_link: get(r, "how_to_link"),
      notes: get(r, "notes") || null,
    };
    const { data, error } = await supabase.from("telegram_link_reference_rows").insert(values).select("id").single();
    if (error) { failures.push({ row: rowNo, name: role, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "telegram_link_reference_rows", record_id: data!.id, action: "telegram_link_reference_row_created",
      new_value: values, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

// ── Telegram Groups ──────────────────────────────────────────────────────────

async function requireTelegramGroupEditor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit Telegram groups." });
  }
}

/** Category is fixed once created for the 6 built-in categories (participant/
 * school/referee/audience/staff/class) — many registration pages and
 * notification emails look a group up by that exact string (see
 * lib/telegram.ts), so silently renaming it here would break those links.
 * The admin page only lets category be set when creating a new row; existing
 * rows only let label/url/order be edited. */
export async function saveTelegramGroup(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/telegram";
  const { supabase, actorId } = await getActor();
  await requireTelegramGroupEditor(supabase, actorId, returnTo);
  const values = {
    category: String(formData.get("category") ?? "").trim(),
    label: String(formData.get("label") ?? "").trim(),
    url: String(formData.get("url") ?? "").trim(),
    member_url: String(formData.get("member_url") ?? "").trim() || null,
    sort_order: Number(formData.get("sort_order") ?? 0) || 0,
  };
  if (!values.category || !values.label || !values.url) {
    backTo(returnTo, { error: "Category, label, and invite link are all required." });
  }
  const { error } = id
    ? await supabase.from("telegram_groups").update(values).eq("id", id)
    : await supabase.from("telegram_groups").insert(values);
  if (error) {
    backTo(returnTo, {
      error: error.message.toLowerCase().includes("duplicate")
        ? `A Telegram group with category "${values.category}" already exists.`
        : "Could not save the Telegram group.",
    });
  }
  await writeAudit(supabase, {
    table_name: "telegram_groups", record_id: id || null,
    action: id ? "telegram_group_updated" : "telegram_group_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Telegram group saved." });
}

export async function deleteTelegramGroup(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/telegram";
  const { supabase, actorId } = await getActor();
  await requireTelegramGroupEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("telegram_groups").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the Telegram group." });
  await writeAudit(supabase, {
    table_name: "telegram_groups", record_id: id, action: "telegram_group_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Telegram group deleted." });
}

// ── Admin Telegram Direct Messages ──────────────────────────────────────────

async function requireTelegramDmSender(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string | null,
  returnTo: string,
) {
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support", "referee"].includes(role ?? "")) {
    backTo(returnTo, { error: "You don't have permission to send Telegram messages." });
  }
}

/** Sends a manually-composed Telegram DM to one connected profile (see
 * /admin/telegram-dm). The chat id is always re-resolved server-side from
 * the profile's user_id -- never trusted from the submitted form -- so
 * nobody can be DMed by tampering with a chat id in the request. */
export async function sendAdminTelegramDirectMessage(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/telegram-dm";
  const { supabase, actorId } = await getActor();
  await requireTelegramDmSender(supabase, actorId, returnTo);
  if (!message) backTo(returnTo, { error: "Message text is required." });
  if (!userId) backTo(returnTo, { error: "No recipient selected." });

  const { data: recipient } = await supabase
    .from("profiles")
    .select("full_name, email, telegram_chat_id")
    .eq("user_id", userId)
    .maybeSingle();
  const chatId = recipient?.telegram_chat_id as string | null;
  const recipientLabel = (recipient?.full_name as string | null) || (recipient?.email as string | null) || "that person";
  if (!chatId) backTo(returnTo, { error: `${recipientLabel} hasn't connected Telegram yet — nothing was sent.` });

  const result = await sendAdminTelegramDM(chatId!, message);
  await writeAudit(supabase, {
    table_name: "profiles", record_id: userId, action: "admin_telegram_dm_sent",
    new_value: { to: recipientLabel, message, ok: result.ok, error: result.error ?? null },
    actor_id: actorId,
  });
  if (!result.ok) backTo(returnTo, { error: result.error ?? "Could not send the message." });
  backTo(returnTo, { ok: `Message sent to ${recipientLabel}.` });
}

// ── Participant Support tickets (per-resolved-ticket bounty) ────────────────

export async function saveSupportTicket(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/support";
  const question = String(formData.get("question") ?? "").trim();
  const telegram_group = String(formData.get("telegram_group") ?? "").trim() || null;
  const category = ["advance", "intermediate", "general"].includes(String(formData.get("category")))
    ? String(formData.get("category"))
    : "general";
  const status = formData.get("status") === "resolved" ? "resolved" : "open";
  const answered_by = String(formData.get("answered_by") ?? "").trim() || null;
  const answer = String(formData.get("answer") ?? "").trim() || null;
  const own_school = formData.get("own_school") === "on";
  if (!question) backTo(returnTo, { error: "The question text is required." });

  const { supabase, actorId } = await getActor();
  const values = {
    question, telegram_group, category, status, answered_by, answer, own_school,
    resolved_at: status === "resolved" ? new Date().toISOString() : null,
  };
  if (id) {
    const { error } = await supabase.from("support_tickets").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update the ticket." });
  } else {
    const { error } = await supabase.from("support_tickets").insert(values);
    if (error) backTo(returnTo, { error: "Could not create the ticket." });
  }
  await writeAudit(supabase, {
    table_name: "support_tickets", record_id: id || null,
    action: id ? "support_ticket_updated" : "support_ticket_created",
    new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Ticket saved." });
}

export async function deleteSupportTicket(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can delete tickets." });
  }
  const { error } = await supabase.from("support_tickets").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the ticket." });
  await writeAudit(supabase, {
    table_name: "support_tickets", record_id: id, action: "support_ticket_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Ticket deleted." });
}

export async function toggleTicketComplaint(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const complaint = formData.get("complaint") === "true";
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can record complaints." });
  }
  const { error } = await supabase.from("support_tickets").update({ complaint }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not update the complaint flag." });
  await writeAudit(supabase, {
    table_name: "support_tickets", record_id: id,
    action: complaint ? "support_complaint_recorded" : "support_complaint_cleared", actor_id: actorId,
  });
  backTo(returnTo, { ok: complaint ? "Complaint recorded (-1 USD)." : "Complaint cleared." });
}

// ── Auto-assign Referee Terms & Conditions ──────────────────────────────────

export async function saveAutoAssignTerm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const position = Number(formData.get("position") ?? 0);
  const content = String(formData.get("content") ?? "").trim();
  const returnTo = "/admin/referees";
  if (!content) backTo(returnTo, { error: "The term's text is required." });
  if (!position || position < 1) backTo(returnTo, { error: "No. must be 1 or higher." });
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit the auto-assign terms." });
  }
  if (id) {
    const { data: before } = await supabase.from("auto_assign_terms").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase
      .from("auto_assign_terms")
      .update({ position, content, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) backTo(returnTo, { error: "Could not update the term." });
    await writeAudit(supabase, {
      table_name: "auto_assign_terms", record_id: id, action: "auto_assign_term_updated",
      old_value: before, new_value: { position, content }, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("auto_assign_terms").insert({ position, content }).select("id").single();
    if (error) backTo(returnTo, { error: "Could not add the term." });
    await writeAudit(supabase, {
      table_name: "auto_assign_terms", record_id: data!.id, action: "auto_assign_term_created",
      new_value: { position, content }, actor_id: actorId,
    });
  }
  backTo(returnTo, { ok: "Auto-assign term saved." });
}

export async function deleteAutoAssignTerm(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/referees";
  const { supabase, actorId } = await getActor();
  const role = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can edit the auto-assign terms." });
  }
  const { error } = await supabase.from("auto_assign_terms").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the term." });
  await writeAudit(supabase, {
    table_name: "auto_assign_terms", record_id: id, action: "auto_assign_term_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Auto-assign term deleted." });
}

const AUTO_ASSIGN_TERMS_CSV_COLUMNS = ["position", "content"] as const;

export async function bulkUploadAutoAssignTerms(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), AUTO_ASSIGN_TERMS_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 500) return { done: false, error: "Maximum 500 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const position = Number(get(r, "position"));
    const content = get(r, "content");
    const name = content.slice(0, 40) || `Row ${rowNo}`;
    if (!content || !position || position < 1) {
      failures.push({ row: rowNo, name, error: "position (1+) and content are both required" });
      continue;
    }
    const { data, error } = await supabase.from("auto_assign_terms").insert({ position, content }).select("id").single();
    if (error) { failures.push({ row: rowNo, name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "auto_assign_terms", record_id: data!.id, action: "auto_assign_term_created",
      new_value: { position, content }, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath("/admin/referees");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const RECORD_CODE_TABLES: Record<string, string> = {
  school: "schools",
  sensei: "senseis",
  referee: "referees",
  audience: "audiences",
  customer_support: "staff_applications",
};

const RECORD_CODE_REVALIDATE_PATHS: Record<string, string> = {
  school: "/admin/schools",
  sensei: "/admin/senseis",
  referee: "/admin/referees",
  audience: "/admin/audience",
  customer_support: "/admin/support",
};

/** Lenient partial-save of a School/Sensei record's other editable fields
 * (everything except file uploads) — used only by
 * generateRecordInvitationCode below, so clicking Generate/Regenerate
 * personal code never discards whatever the organizer already typed
 * elsewhere on the same shared form (e.g. Bank Details still mid-entry)
 * before they've clicked the real Save button. Unlike saveSchool/
 * saveSensei, nothing here is rejected for being blank — this is a draft,
 * not the final save; `name` is left untouched (undefined, so Supabase
 * drops it from the update) if blank, so a cleared name can never
 * accidentally wipe the record. */
function draftRecordFields(role: string, formData: FormData): Record<string, unknown> | null {
  const str = (key: string) => String(formData.get(key) ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim() || undefined;
  const iban = normalizeIban(String(formData.get("bank_account_no") ?? "")) || null;
  const shared = {
    home_address: str("home_address"),
    city_town: str("city_town"),
    postcode: str("postcode"),
    home_country: str("home_country"),
    email: str("email"),
    phone: str("phone"),
    bank_name: str("bank_name"),
    bank_account_no: iban,
    bank_account_name: str("bank_account_name"),
    referral_source: str("referral_source"),
  };
  if (role === "school") {
    const contact_title = str("contact_title");
    return {
      name, ...shared,
      state: str("state"),
      contact_title,
      contact_name: str("contact_name"),
      contact_karate_title: str("contact_karate_title"),
      contact_rank: str("contact_rank"),
      gender: contact_title === "Mr." ? "male" : contact_title === "Ms." ? "female" : undefined,
    };
  }
  if (role === "sensei") {
    return {
      name, ...shared,
      ic_passport: str("ic_passport"),
      date_of_birth: str("date_of_birth"),
      rank: str("rank"),
      gender: str("gender"),
      school_id: str("school_id"),
    };
  }
  return null;
}

/** Generates a personal, single-use invitation code for one already-saved
 * School/Sensei record, bound to that record's own email (only that email
 * can redeem it) — auto-recorded onto the record's own invitation_code
 * column so it stays visible without having to look it up separately. This
 * is additive to createInvitationCode's generic shared codes above, not a
 * replacement for them.
 *
 * Competition Tier / Valid from / Valid until / Sign-in limit are all
 * optional — left blank, each just means no restriction on that front
 * (handle_new_user's redemption check already treats a null valid_from/
 * valid_until as unrestricted; a null sign_in_limit means unlimited, same
 * as the rest of the site's quota logic). Only genuinely invalid input
 * (a sign-in limit under 1) is rejected. max_uses stays fixed at 1: the
 * code is single-use for creating the login itself; ongoing sign-in access
 * after that is governed entirely by whichever of Valid from/until and
 * Sign-in limit were actually set, copied onto the resulting profile at
 * signup (see handle_new_user). */
export async function generateRecordInvitationCode(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin");
  const table = RECORD_CODE_TABLES[role];
  if (!table || !id) backTo(returnTo, { error: "Invalid request." });

  const competitionId = String(formData.get("pic_competition_id") ?? "").trim();
  const validFrom = String(formData.get("pic_valid_from") ?? "").trim();
  const validUntil = String(formData.get("pic_valid_until") ?? "").trim();
  const signInLimitRaw = String(formData.get("pic_sign_in_limit") ?? "").trim();
  if (signInLimitRaw && Number(signInLimitRaw) < 1) {
    backTo(returnTo, { error: "Sign-in limit must be at least 1 — or leave it blank for unlimited." });
  }

  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);

  const draft = draftRecordFields(role, formData);
  if (draft) await supabase.from(table).update(draft).eq("id", id);

  const { data: record } = await supabase.from(table).select("email").eq("id", id).maybeSingle();
  if (!record?.email) {
    backTo(returnTo, { error: "This record needs an email address before a code can be generated." });
  }

  // Same systematic IKO-<ROLE>-TIER-<TIER>-2026-<NNNNN> format and running
  // sequence as the "Run" button on the general Create Code form (see
  // generateSequentialInvitationCode above) — a personal code is still just
  // one more code sharing that role+tier's counter, not a separate scheme.
  // No tier picked -> no TIER- segment at all (see codePrefix), sharing
  // whatever counter every other tier-less code for this role uses.
  const picCompetition = competitionId
    ? (await supabase.from("competitions").select("registration_fee_usd").eq("id", competitionId).maybeSingle()).data
    : null;
  const prefix = codePrefix(role, picCompetition ? [Number(picCompetition.registration_fee_usd ?? 0)] : []);
  const { data: existingCodes } = await supabase
    .from("invitation_codes")
    .select("code")
    .ilike("code", `${prefix}%`);
  const code = nextSequentialCode(prefix, (existingCodes ?? []).map((r) => r.code as string));
  const { data: myProfile } = actorId
    ? await supabase.from("profiles").select("full_name, email").eq("user_id", actorId).maybeSingle()
    : { data: null };
  const generated_by = myProfile?.full_name || myProfile?.email || null;

  const { data: inserted, error } = await supabase
    .from("invitation_codes")
    .insert({
      code, role, email: record!.email, max_uses: 1, generated_by, for_record_id: id,
      competition_id: competitionId || null, valid_from: validFrom || null, valid_until: validUntil || null,
      sign_in_limit: signInLimitRaw ? Number(signInLimitRaw) : null,
      note: `Personal code for ${role} record ${id.slice(0, 8).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (error) backTo(returnTo, { error: `Could not generate code: ${error.message}` });

  await supabase.from(table).update({ invitation_code: code }).eq("id", id);
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: inserted!.id, action: "invitation_code_created",
    new_value: {
      code, role, email: record!.email, competition_id: competitionId,
      valid_from: validFrom, valid_until: validUntil, sign_in_limit: Number(signInLimitRaw),
      for_table: table, for_id: id,
    },
    actor_id: actorId,
  });
  // The redirect below lands back on this exact same edit view (returnTo
  // carries ?edit=<id> etc.) so the admin can see the code they just
  // generated -- without this, Next.js's router cache can keep serving the
  // pre-generation render of that same URL, showing the "Generate" button
  // (not yet "Regenerate", still the wrong red/white color) until a manual
  // page refresh forces a fresh fetch.
  revalidatePath(RECORD_CODE_REVALIDATE_PATHS[role] ?? returnTo.split("?")[0]);
  backTo(returnTo, { ok: `Invitation code generated: ${code}` });
}

export async function toggleInvitationCode(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const returnTo = String(formData.get("return_to") ?? "/admin/accounts");
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("invitation_codes").update({ active }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not update code." });
  await writeAudit(supabase, {
    table_name: "invitation_codes", record_id: id,
    action: active ? "invitation_code_activated" : "invitation_code_deactivated", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Invitation code updated." });
}

/** Same lookup as notifyVideoAssignment (now in lib/notify.ts), for the
 * referee losing the assignment instead — fired by unassignRefereeFromVideo.
 * Best-effort — never throws, so a notification hiccup can't undo a
 * successful removal. */
async function notifyVideoUnassignment(videoId: string, refereeUserId: string) {
  try {
    await notifyRefereeUnassigned(await refereeVideoNotice(videoId, refereeUserId));
  } catch {
    // Best-effort — removal already succeeded regardless.
  }
}

export async function assignRefereeToVideo(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/judging");
  if (!videoId || !refereeUserId) backTo(returnTo, { error: "Select a video and a referee." });
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { error } = await supabase.rpc("assign_referee", { p_video: videoId, p_referee: refereeUserId });
  if (error) backTo(returnTo, { error: error.message || "Could not assign referee." });
  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: videoId,
    action: "referee_assigned", new_value: { referee_user_id: refereeUserId }, actor_id: actorId,
  });
  await notifyVideoAssignment(videoId, refereeUserId);
  backTo(returnTo, { ok: "Referee assigned." });
}

/** Manually re-sends the same assignment email/Telegram notification a
 * referee already got automatically when assigned — for when they missed
 * it the first time. Available to any admin-tier viewer (not just Super
 * Admin), unlike assign/unassign, since it's a read-only nudge. */
export async function resendRefereeNotification(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/judging");
  if (!videoId || !refereeUserId) backTo(returnTo, { error: "Missing video or referee." });
  const { supabase } = await getActor();
  await notifyVideoAssignment(videoId, refereeUserId);
  backTo(returnTo, { ok: "Notification sent." });
}

export async function unassignRefereeFromVideo(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const refereeUserId = String(formData.get("referee_user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/judging");
  // Present only when an Organizer/Admin/Staff unassigns a DIFFERENT
  // referee (the popup on the Judging page) -- never on a referee
  // removing themselves, which the RPC below already forbids from
  // targeting anyone else.
  const forfeitRaw = formData.get("forfeit");
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { error } = await supabase.rpc("unassign_referee", { p_video: videoId, p_referee: refereeUserId });
  if (error) backTo(returnTo, { error: "Could not remove referee." });
  if (forfeitRaw != null && actorId !== refereeUserId) {
    await supabase.rpc("increment_referee_unassigned_count", {
      p_user_id: refereeUserId, p_forfeit: forfeitRaw === "true",
    });
  }
  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: videoId,
    action: "referee_unassigned", new_value: { referee_user_id: refereeUserId, forfeit: forfeitRaw }, actor_id: actorId,
  });
  await notifyVideoUnassignment(videoId, refereeUserId);
  backTo(returnTo, { ok: "Referee removed." });
}

export async function setJudgesRequired(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const judgesRequired = Number(formData.get("judges_required") ?? "");
  const returnTo = "/admin/judging";
  if (!competitionId || !Number.isInteger(judgesRequired) || judgesRequired < 1) {
    backTo(returnTo, { error: "Enter a whole number of judges (1 or more)." });
  }
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { error } = await supabase
    .from("competitions")
    .update({ judges_required: judgesRequired })
    .eq("id", competitionId);
  if (error) backTo(returnTo, { error: "Could not update judges required." });
  await writeAudit(supabase, {
    table_name: "competitions", record_id: competitionId,
    action: "judges_required_changed", new_value: { judges_required: judgesRequired }, actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Judges required updated." });
}

/**
 * Catch-up tool: tops up every under-assigned recording in a competition to
 * its judges_required target. Every recording submitted through
 * submitKataVideo already gets this automatically the instant it's
 * uploaded (see app/actions/account.ts) — this button exists for whatever
 * that automatic pass couldn't fill at the time (no eligible referee yet,
 * a recording submitted before auto-fire existed, or a slot opened up
 * later by unassigning someone). Shares its eligibility/fill algorithm
 * with the automatic path via lib/auto-assign.ts; only the actual
 * assignment call differs — this one runs as the clicking admin/organizer/
 * referee via assign_referee, which still enforces a referee may only
 * assign themselves, exactly as before this was extracted.
 */
export async function autoAssignReferees(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const returnTo = "/admin/judging";
  if (!competitionId) backTo(returnTo, { error: "Select a competition." });
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);

  const { data: regs } = await supabase.from("registrations").select("id").eq("competition_id", competitionId);
  const regIds = (regs ?? []).map((r) => r.id as string);
  const { data: videos } =
    regIds.length > 0
      ? await supabase.from("kata_videos").select("id").in("registration_id", regIds)
      : { data: [] as Array<{ id: string }> };
  const videoIds = (videos ?? []).map((v) => v.id as string);
  if (videoIds.length === 0) backTo(returnTo, { ok: "No recordings submitted yet for this competition." });

  const { data: anyReferees } = await supabase
    .from("referees")
    .select("user_id")
    .eq("status", "approved")
    .not("user_id", "is", null)
    .limit(1);
  if (!anyReferees || anyReferees.length === 0) {
    backTo(returnTo, { error: "No approved referees with a linked login yet — link accounts on the Referees page first." });
  }

  const newAssignments = await autoAssignForVideos(competitionId, videoIds, (videoId, refereeUserId) =>
    supabase.rpc("assign_referee", { p_video: videoId, p_referee: refereeUserId }),
  );

  await Promise.all(newAssignments.map((a) => notifyVideoAssignment(a.videoId, a.refereeUserId)));

  await writeAudit(supabase, {
    table_name: "referee_assignments", record_id: null, action: "referees_auto_assigned",
    new_value: { competition_id: competitionId, new_assignments: newAssignments.length },
    actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, {
    ok: newAssignments.length > 0
      ? `Auto-assigned ${newAssignments.length} referee slot${newAssignments.length === 1 ? "" : "s"}.`
      : "Every recording already has its full panel of judges.",
  });
}

export async function seedAutoAssignCriteria(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/judging";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { count } = await supabase.from("auto_assign_criteria").select("id", { count: "exact", head: true });
  if (!count) {
    await supabase.from("auto_assign_criteria").insert(
      DEFAULT_AUTO_ASSIGN_CRITERIA.map((r, i) => ({ position: i + 1, title: r.title, description: r.description })),
    );
  }
  await writeAudit(supabase, {
    table_name: "auto_assign_criteria", record_id: null, action: "auto_assign_criteria_seeded", actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Default criteria imported — edit the rows below." });
}

export async function saveAutoAssignCriterion(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/judging";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const values = {
    position: Number(formData.get("position") ?? 0) || 0,
    title: String(formData.get("title") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
  };
  if (!values.title) backTo(returnTo, { error: "A title is required." });
  const { error } = id
    ? await supabase.from("auto_assign_criteria").update(values).eq("id", id)
    : await supabase.from("auto_assign_criteria").insert(values);
  if (error) backTo(returnTo, { error: "Could not save the criterion." });
  await writeAudit(supabase, {
    table_name: "auto_assign_criteria", record_id: id || null,
    action: id ? "auto_assign_criterion_updated" : "auto_assign_criterion_created",
    new_value: values, actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Criterion saved." });
}

export async function deleteAutoAssignCriterion(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/judging";
  const { supabase, actorId } = await getActor();
  await requireAccessTableEditor(supabase, actorId, returnTo);
  const { error } = await supabase.from("auto_assign_criteria").delete().eq("id", id);
  if (error) backTo(returnTo, { error: "Could not delete the criterion." });
  await writeAudit(supabase, {
    table_name: "auto_assign_criteria", record_id: id, action: "auto_assign_criterion_deleted", actor_id: actorId,
  });
  revalidatePath("/admin/judging");
  backTo(returnTo, { ok: "Criterion deleted." });
}

export interface AdminVideoUploadState {
  ok: boolean;
  error?: string;
}

/**
 * Admin-only backup path: attaches a recording to a registration on the
 * participant's behalf (e.g. their live-camera submission failed, or they
 * sent the organizer a video another way) — the file itself is uploaded
 * client-side straight to the kata-videos bucket (see migration 0030's
 * admin storage policy) before this is called with just the resulting
 * path. Replaces any existing recording for that registration rather than
 * erroring, since "fix a broken submission" is the whole point.
 */
export async function adminAttachVideo(
  _prev: AdminVideoUploadState,
  formData: FormData,
): Promise<AdminVideoUploadState> {
  const registrationId = String(formData.get("registration_id") ?? "");
  const path = String(formData.get("path") ?? "");
  const mime = String(formData.get("mime") ?? "video/mp4");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (actorRole !== "admin") {
    return { ok: false, error: "Only the Super Admin can upload a recording on a participant's behalf." };
  }
  if (!registrationId || !path) return { ok: false, error: "Missing recording upload." };

  const { data: reg } = await supabase
    .from("registrations").select("id, participant_id").eq("id", registrationId).maybeSingle();
  if (!reg) return { ok: false, error: "Registration not found." };

  const { data: existing } = await supabase
    .from("kata_videos").select("id").eq("registration_id", registrationId).maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("kata_videos")
      .update({ storage_path: path, mime, status: "submitted" })
      .eq("id", existing.id);
    if (error) return { ok: false, error: "Could not replace the recording." };
    await writeAudit(supabase, {
      table_name: "kata_videos", record_id: existing.id, action: "kata_video_admin_replaced",
      new_value: { storage_path: path }, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("kata_videos")
      .insert({
        registration_id: registrationId,
        participant_id: reg.participant_id,
        user_id: actorId,
        storage_path: path,
        mime,
      })
      .select("id").single();
    if (error) return { ok: false, error: "Could not attach the recording." };
    await writeAudit(supabase, {
      table_name: "kata_videos", record_id: data!.id, action: "kata_video_admin_uploaded",
      new_value: { storage_path: path, registration_id: registrationId }, actor_id: actorId,
    });
  }
  revalidatePath("/admin/records");
  revalidatePath("/kata-arena");
  revalidatePath("/admin/judging");
  return { ok: true };
}

// ── Organizer / Participant Support account creation ───────────────────────────

const ROLE_LABEL: Record<string, string> = {
  organizer: "Admin / Organizer",
  customer_support: "Participant Support",
};

/**
 * Directly creates a real login (auth user + approved profile) for an
 * Organizer or Participant Support account — no self-signup or invitation code
 * involved. Gated server-side on the CALLER's own role (never on anything
 * the client submits): only Super Admin may create Organizer accounts;
 * Super Admin or an existing Organizer may create Participant Support accounts.
 */
export async function createStaffAccount(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const returnTo = role === "organizer" ? "/admin/organizers" : "/admin/support";
  if (!["organizer", "customer_support"].includes(role)) {
    backTo(returnTo, { error: "Invalid role." });
  }
  const full_name = String(formData.get("full_name") ?? "").trim();
  const short_name = String(formData.get("short_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!full_name || !email) {
    backTo(returnTo, { error: "Full name and email are required." });
  }
  if (role === "customer_support" && !short_name) {
    backTo(returnTo, { error: "My short name or initial is required." });
  }
  const extra = {
    short_name: short_name || null,
    staff_title: String(formData.get("staff_title") ?? "").trim() || null,
    ic_passport: String(formData.get("ic_passport") ?? "").trim() || null,
    date_of_birth: String(formData.get("date_of_birth") ?? "").trim() || null,
    gender: String(formData.get("gender") ?? "").trim() || null,
    belt_rank: String(formData.get("belt_rank") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    country: String(formData.get("country") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: normalizeIban(String(formData.get("bank_account_no") ?? "")) || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    invitation_code: String(formData.get("invitation_code") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
    highest_education: String(formData.get("highest_education") ?? "").trim() || null,
    languages_count: formData.get("languages_count") ? Number(formData.get("languages_count")) : null,
    languages: formData.getAll("languages").map((l) => String(l)).filter(Boolean),
    support_tier_1_id: String(formData.get("support_tier_1_id") ?? "").trim() || null,
    support_tier_2_id: String(formData.get("support_tier_2_id") ?? "").trim() || null,
    support_tier_3_id: String(formData.get("support_tier_3_id") ?? "").trim() || null,
    preferred_region: String(formData.get("preferred_region") ?? "").trim() || null,
    based_country: String(formData.get("based_country") ?? "").trim() || null,
  };
  if (!extra.staff_title) {
    backTo(returnTo, { error: "Role is required." });
  }
  if (!extra.ic_passport || !extra.date_of_birth || !extra.gender) {
    backTo(returnTo, { error: "IC / Passport, date of birth, and gender are required." });
  }
  if (!extra.home_address || !extra.city_town || !extra.postcode || !extra.country) {
    backTo(returnTo, { error: "Home address, city/town, postcode, and country are required." });
  }
  if (!extra.phone) {
    backTo(returnTo, { error: "Mobile phone is required." });
  }
  if (!extra.bank_name || !extra.bank_account_no || !extra.bank_account_name) {
    backTo(returnTo, { error: "Bank details are required." });
  }
  if (role === "customer_support" && (!extra.highest_education || extra.languages_count == null)) {
    backTo(returnTo, { error: "Highest Education Attended and number of languages are required." });
  }
  if (role === "customer_support" && (!extra.preferred_region || !extra.based_country)) {
    backTo(returnTo, { error: "Preferred region and current country are required." });
  }

  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (role === "organizer" && !["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin or Organizer can create an Organizer account." });
  }
  if (role === "customer_support" && !["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Super Admin or Admin / Organizer can create Participant Support accounts." });
  }

  const certificatePath = await uploadCertificateIfPresent(supabase, formData, "staff", returnTo);

  const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (error || !created.user) {
    backTo(returnTo, { error: "Could not create the account — the email may already be registered." });
  }
  // handle_new_user already inserted a profiles row with approved=false;
  // flip it here via the service-role client (never via client metadata).
  await admin
    .from("profiles")
    .update({ approved: true, ...extra, certificate_path: certificatePath })
    .eq("user_id", created!.user!.id);

  await writeAudit(supabase, {
    table_name: "profiles",
    record_id: created!.user!.id,
    action: "staff_account_created",
    new_value: { role, full_name, email, ...extra },
    actor_id: actorId,
  });

  await sendConfirmationEmail({
    toEmail: email,
    recipientName: full_name,
    subject: `Your ${ROLE_LABEL[role]} account is ready`,
    bodyLines: [
      `An account has been created for you as ${ROLE_LABEL[role]}.`,
      `Temporary password: ${tempPassword}`,
      "Sign in and keep this password safe — there is currently no self-service password reset, contact the organizer if you need it changed.",
      "Please join our Telegram group as soon as possible — that's where the organizer posts announcements and where you can reach the team.",
      "Once you've signed in and connected Telegram from your Account page, you'll typically receive a Telegram DM confirming your status within about an hour.",
    ],
    telegramCategory: "staff",
  });

  revalidatePath(returnTo);
  backTo(returnTo, { ok: `${ROLE_LABEL[role]} account created for ${full_name} — login details emailed.` });
}

/** Edits an existing Admin / Organizer / Participant Support account's own
 * details. Deliberately does NOT touch `role` or `approved` — reassigning a
 * staff role is a bigger decision than a contact-details edit and stays out
 * of this form; role is fixed at creation via createStaffAccount.
 *
 * Editing `email` also updates the real Supabase Auth login (not just the
 * denormalized profiles.email column), since that's what this person
 * actually signs in with — leaving the two out of sync would let them see a
 * new email on their own profile while still logging in with the old one. */
export async function saveStaffAccount(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/organizers";
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin/Organizer can edit staff accounts." });
  }
  // Organizer/Staff can edit another Organizer or Participant Support
  // account, but never an Admin one — only the Super Admin can change a
  // fellow Admin's details.
  const { data: targetProfile } = await supabase.from("profiles").select("role").eq("user_id", userId).maybeSingle();
  if (targetProfile?.role === "admin" && actorRole !== "admin") {
    backTo(returnTo, { error: "Only the Super Admin can edit an Admin account." });
  }

  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const staff_title = String(formData.get("staff_title") ?? "").trim();
  if (!userId || !full_name || !email) {
    backTo(returnTo, { error: "Full name and email are required." });
  }
  if (!staff_title) {
    backTo(returnTo, { error: "Role is required." });
  }

  const values: Record<string, unknown> = {
    full_name,
    email,
    short_name: String(formData.get("short_name") ?? "").trim() || null,
    staff_title: String(formData.get("staff_title") ?? "").trim() || null,
    ic_passport: String(formData.get("ic_passport") ?? "").trim() || null,
    date_of_birth: String(formData.get("date_of_birth") ?? "").trim() || null,
    gender: String(formData.get("gender") ?? "").trim() || null,
    belt_rank: String(formData.get("belt_rank") ?? "").trim() || null,
    home_address: String(formData.get("home_address") ?? "").trim() || null,
    city_town: String(formData.get("city_town") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    country: String(formData.get("country") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    bank_name: String(formData.get("bank_name") ?? "").trim() || null,
    bank_account_no: normalizeIban(String(formData.get("bank_account_no") ?? "")) || null,
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    referral_source: String(formData.get("referral_source") ?? "").trim() || null,
  };
  // Participant Support only.
  if (formData.has("highest_education")) {
    values.highest_education = String(formData.get("highest_education") ?? "").trim() || null;
    values.languages_count = formData.get("languages_count") ? Number(formData.get("languages_count")) : null;
    values.languages = formData.getAll("languages").map((l) => String(l)).filter(Boolean);
    values.support_tier_1_id = String(formData.get("support_tier_1_id") ?? "").trim() || null;
    values.support_tier_2_id = String(formData.get("support_tier_2_id") ?? "").trim() || null;
    values.support_tier_3_id = String(formData.get("support_tier_3_id") ?? "").trim() || null;
    values.preferred_region = String(formData.get("preferred_region") ?? "").trim() || null;
    values.based_country = String(formData.get("based_country") ?? "").trim() || null;
  }

  const admin = createAdminClient();
  const { data: current } = await admin.from("profiles").select("email").eq("user_id", userId).maybeSingle();
  if (current && current.email !== email) {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, { email });
    if (authError) backTo(returnTo, { error: "Could not update the login email — it may already be in use." });
  }

  const { error } = await admin.from("profiles").update(values).eq("user_id", userId);
  if (error) backTo(returnTo, { error: "Could not save changes — please try again." });

  await writeAudit(supabase, {
    table_name: "profiles", record_id: userId, action: "staff_account_updated",
    new_value: values, actor_id: actorId,
  });
  // Only Participant Support edits can move a support tier link, and that's
  // exactly what recompute_sign_in_quota needs to re-run for — the window
  // and count it derives depend on which tiers this account supports.
  if (formData.has("highest_education")) {
    await admin.rpc("recompute_sign_in_quota", { p_user_id: userId });
  }
  revalidatePath(returnTo);
  backTo(returnTo, { ok: `${full_name} updated.` });
}

/** Deletes a staff login outright — via the actual Supabase Auth user, whose
 * ON DELETE CASCADE on profiles.user_id removes the profile row too, so
 * there is no separate profiles delete to keep in sync.
 *
 * Two guardrails a plain "delete row" button doesn't need elsewhere: an
 * account can't delete itself (the actor would lose access mid-request with
 * no way to undo it), and the Super Admin can't be deleted while they're the
 * only one — the app would otherwise have no account left able to approve
 * another Admin. */
export async function deleteStaffAccount(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/organizers";
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin or Organizer can delete staff accounts." });
  }
  if (userId === actorId) {
    backTo(returnTo, { error: "You can't delete your own account while signed in as it." });
  }

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("role, full_name").eq("user_id", userId).maybeSingle();
  if (!target) backTo(returnTo, { error: "Account not found." });
  // Organizer/Staff can delete another Organizer or Participant Support
  // login, but never an Admin one — only the Super Admin can remove a
  // fellow Admin.
  if (target!.role === "admin" && actorRole !== "admin") {
    backTo(returnTo, { error: "Only the Super Admin can delete an Admin account." });
  }
  if (target!.role === "admin") {
    const { count } = await admin.from("profiles").select("user_id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) <= 1) {
      backTo(returnTo, { error: "Can't delete the last Admin account — create another Admin first." });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) backTo(returnTo, { error: "Could not delete the account — please try again." });

  await writeAudit(supabase, {
    table_name: "profiles", record_id: userId, action: "staff_account_deleted",
    old_value: { role: target!.role, full_name: target!.full_name }, actor_id: actorId,
  });
  revalidatePath(returnTo);
  backTo(returnTo, { ok: `${target!.full_name ?? "Account"} deleted.` });
}

// ── CSV bulk upload — Schools / Senseis / Referees / Audience / Staff ───────
// Each mirrors the validation of its single-record "Add" action above, but
// processes many rows from one CSV file, row by row, collecting per-row
// failures instead of aborting the whole file on the first bad row.

const SCHOOL_CSV_COLUMNS = [
  "name", "state", "contact_title", "contact_name", "contact_karate_title", "contact_rank", "contact_ic_passport",
  "home_address", "city_town", "postcode", "home_country", "email", "phone",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadSchools(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), SCHOOL_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const name = get(r, "name") || `Row ${rowNo}`;
    const record = {
      name: get(r, "name"),
      state: get(r, "state") || null,
      contact_title: get(r, "contact_title") || null,
      contact_name: get(r, "contact_name") || null,
      contact_karate_title: get(r, "contact_karate_title") || null,
      contact_rank: get(r, "contact_rank") || null,
      contact_ic_passport: get(r, "contact_ic_passport") || null,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      postcode: get(r, "postcode") || null,
      home_country: get(r, "home_country") || null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      bank_name: get(r, "bank_name") || null,
      bank_account_no: normalizeIban(get(r, "bank_account_no")) || null,
      bank_account_name: get(r, "bank_account_name") || null,
    };
    if (!record.name) { failures.push({ row: rowNo, name, error: "School name is required" }); continue; }
    if (!record.contact_title || !record.contact_name || !record.contact_karate_title || !record.contact_rank || !record.contact_ic_passport) {
      failures.push({ row: rowNo, name, error: "Person in-charge's title, name, karate title, rank, and IC / Passport No. are required" });
      continue;
    }
    if (!record.home_address || !record.city_town || !record.postcode || !record.home_country) {
      failures.push({ row: rowNo, name, error: "Home address, city/town, postcode, and home country are required" });
      continue;
    }
    if (!record.email || !record.phone) {
      failures.push({ row: rowNo, name, error: "Email address and mobile phone are required" });
      continue;
    }
    if (!record.bank_name || !record.bank_account_no || !record.bank_account_name) {
      failures.push({ row: rowNo, name, error: "Bank name, account number, and account holder name are required" });
      continue;
    }
    const { data: dup } = await supabase.from("schools").select("id").ilike("name", record.name).limit(1);
    if (dup && dup.length > 0) { failures.push({ row: rowNo, name, error: "A school with this name already exists" }); continue; }

    const { data, error } = await supabase
      .from("schools")
      .insert({ ...record, gender: record.contact_title === "Mr." ? "male" : "female" })
      .select("id").single();
    if (error) { failures.push({ row: rowNo, name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "schools", record_id: data!.id, action: "school_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "schools", record_id: null, action: "bulk_csv_schools",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  await notifyOrganizersDirectoryBulkUpload({ kind: "Schools", succeeded, failed: failures.length, adminPath: "/admin/schools" });
  revalidatePath("/admin/schools");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const SENSEI_CSV_COLUMNS = [
  "name", "ic_passport", "date_of_birth", "rank", "gender", "school_name",
  "home_address", "city_town", "postcode", "home_country", "email", "phone",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadSenseis(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), SENSEI_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const { data: schools } = await supabase.from("schools").select("id, name");
  const schoolIdByName = new Map((schools ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const name = get(r, "name") || `Row ${rowNo}`;
    const schoolName = get(r, "school_name");
    let schoolId: string | null = null;
    if (schoolName) {
      schoolId = schoolIdByName.get(schoolName.trim().toLowerCase()) ?? null;
      if (!schoolId) { failures.push({ row: rowNo, name, error: `School "${schoolName}" not found` }); continue; }
    }
    const gender = get(r, "gender").toLowerCase();
    const dobRaw = get(r, "date_of_birth");
    const dob = dobRaw ? parseDDMMYYYY(dobRaw) : null;
    if (dobRaw && !dob) { failures.push({ row: rowNo, name, error: "Invalid date of birth (use DD/MM/YYYY)" }); continue; }
    const record = {
      name: get(r, "name"),
      ic_passport: get(r, "ic_passport") || null,
      date_of_birth: dob,
      rank: get(r, "rank") || null,
      gender: gender || null,
      school_id: schoolId,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      postcode: get(r, "postcode") || null,
      home_country: get(r, "home_country") || null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      bank_name: get(r, "bank_name") || null,
      bank_account_no: normalizeIban(get(r, "bank_account_no")) || null,
      bank_account_name: get(r, "bank_account_name") || null,
    };
    if (!record.name) { failures.push({ row: rowNo, name, error: "Sensei name is required" }); continue; }
    if (!record.ic_passport) { failures.push({ row: rowNo, name, error: "IC / Passport is required" }); continue; }
    if (!record.date_of_birth) { failures.push({ row: rowNo, name, error: "Date of birth is required" }); continue; }
    if (!record.rank) { failures.push({ row: rowNo, name, error: "Rank is required" }); continue; }
    if (!gender || !["male", "female"].includes(gender)) { failures.push({ row: rowNo, name, error: "Gender must be male or female" }); continue; }
    if (!schoolId) { failures.push({ row: rowNo, name, error: "School is required" }); continue; }
    if (!record.home_address || !record.city_town || !record.postcode || !record.home_country) {
      failures.push({ row: rowNo, name, error: "Personal home address, city/town, postcode, and home country are required" });
      continue;
    }
    if (!record.email || !record.phone) {
      failures.push({ row: rowNo, name, error: "Email address and mobile phone are required" });
      continue;
    }
    if (!record.bank_name || !record.bank_account_no || !record.bank_account_name) {
      failures.push({ row: rowNo, name, error: "Personal bank details are required" });
      continue;
    }

    let dupQuery = supabase.from("senseis").select("id").ilike("name", record.name).limit(1);
    dupQuery = schoolId ? dupQuery.eq("school_id", schoolId) : dupQuery.is("school_id", null);
    const { data: dup } = await dupQuery;
    if (dup && dup.length > 0) { failures.push({ row: rowNo, name, error: "A sensei with this name (and school) already exists" }); continue; }

    const { data, error } = await supabase.from("senseis").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "senseis", record_id: data!.id, action: "sensei_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "senseis", record_id: null, action: "bulk_csv_senseis",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  await notifyOrganizersDirectoryBulkUpload({ kind: "Senseis", succeeded, failed: failures.length, adminPath: "/admin/senseis" });
  revalidatePath("/admin/senseis");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const REFEREE_CSV_COLUMNS = [
  "full_name", "school", "ic_passport", "date_of_birth", "gender", "karate_rank", "judge_title",
  "judging_experience_count", "email", "phone", "home_address", "city_town", "home_country",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadReferees(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), REFEREE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const experienceRaw = get(r, "judging_experience_count");
    const dobRaw = get(r, "date_of_birth");
    const dob = dobRaw ? parseDDMMYYYY(dobRaw) : null;
    if (dobRaw && !dob) { failures.push({ row: rowNo, name: full_name, error: "Invalid date of birth (use DD/MM/YYYY)" }); continue; }
    const record = {
      full_name: get(r, "full_name"),
      school: get(r, "school") || null,
      ic_passport: get(r, "ic_passport"),
      date_of_birth: dob,
      gender: get(r, "gender") || null,
      karate_rank: get(r, "karate_rank") || null,
      judge_title: get(r, "judge_title") || null,
      judging_experience_count: experienceRaw ? Number(experienceRaw) : null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      home_country: get(r, "home_country") || null,
      bank_name: get(r, "bank_name") || null,
      bank_account_no: normalizeIban(get(r, "bank_account_no")) || null,
      bank_account_name: get(r, "bank_account_name") || null,
    };
    if (!record.full_name || !record.school || !record.ic_passport || !record.judge_title) {
      failures.push({ row: rowNo, name: full_name, error: "Name, school/organization, IC/passport, and Role are required" });
      continue;
    }
    const { data, error } = await supabase.from("referees").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: full_name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "referees", record_id: data!.id, action: "referee_created_by_admin",
      new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "referees", record_id: null, action: "bulk_csv_referees",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  await notifyOrganizersDirectoryBulkUpload({ kind: "Referees", succeeded, failed: failures.length, adminPath: "/admin/referees" });
  revalidatePath("/admin/referees");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const AUDIENCE_CSV_COLUMNS = ["full_name", "email", "phone", "home_country", "invitation_code", "payment_status"] as const;

export async function bulkUploadAudience(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), AUDIENCE_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 5000) return { done: false, error: "Maximum 5000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const statusRaw = get(r, "payment_status").toLowerCase() || "pending";
    if (!["pending", "paid", "waived"].includes(statusRaw)) {
      failures.push({ row: rowNo, name: full_name, error: "payment_status must be pending, paid, or waived" });
      continue;
    }
    const record = {
      full_name: get(r, "full_name"),
      email: get(r, "email"),
      phone: get(r, "phone") || null,
      home_country: get(r, "home_country"),
      invitation_code: get(r, "invitation_code") || null,
      payment_status: statusRaw,
    };
    if (!record.full_name || !record.email || !record.home_country) {
      failures.push({ row: rowNo, name: full_name, error: "Full name, email, and home country are required" });
      continue;
    }
    const { data, error } = await supabase.from("audiences").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: full_name, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "audiences", record_id: data!.id, action: "audience_created_by_admin",
      new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "audiences", record_id: null, action: "bulk_csv_audience",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  await notifyOrganizersDirectoryBulkUpload({ kind: "Audience", succeeded, failed: failures.length, adminPath: "/admin/audience" });
  revalidatePath("/admin/audience");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const PARTICIPANT_CSV_COLUMNS = [
  "full_name", "ic_passport", "date_of_birth", "age", "gender", "belt_rank", "rank_confirmation",
  "home_address", "city_town", "postcode", "home_country", "email", "phone",
  "school_name", "sensei_name", "invitation_code",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

export async function bulkUploadParticipants(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), PARTICIPANT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 2000) return { done: false, error: "Maximum 2000 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const [{ data: schools }, { data: senseis }] = await Promise.all([
    supabase.from("schools").select("id, name"),
    supabase.from("senseis").select("id, name"),
  ]);
  const schoolIdByName = new Map((schools ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));
  const senseiIdByName = new Map((senseis ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const rankConfirmationRaw = get(r, "rank_confirmation").toLowerCase() || "pending_confirmation";
    if (!["sensei_confirmed", "pending_confirmation"].includes(rankConfirmationRaw)) {
      failures.push({ row: rowNo, name: full_name, error: "rank_confirmation must be sensei_confirmed or pending_confirmation (certificates can't be uploaded via CSV)" });
      continue;
    }
    const schoolId = schoolIdByName.get(get(r, "school_name").trim().toLowerCase());
    if (!schoolId) { failures.push({ row: rowNo, name: full_name, error: "school_name does not match an existing school" }); continue; }
    const senseiId = senseiIdByName.get(get(r, "sensei_name").trim().toLowerCase());
    if (!senseiId) { failures.push({ row: rowNo, name: full_name, error: "sensei_name does not match an existing sensei" }); continue; }

    const dob = get(r, "date_of_birth") ? parseDDMMYYYY(get(r, "date_of_birth")) : null;
    if (get(r, "date_of_birth") && !dob) {
      failures.push({ row: rowNo, name: full_name, error: "Invalid date of birth (use DD/MM/YYYY)" });
      continue;
    }
    if (dob && get(r, "age")) {
      const ageInput = Number(get(r, "age"));
      const computedAge = ageAt(dob, null);
      if (!Number.isFinite(ageInput) || Math.abs(ageInput - computedAge) > 1) {
        failures.push({ row: rowNo, name: full_name, error: `Age (${get(r, "age")}) doesn't match date of birth — expected around ${computedAge}` });
        continue;
      }
    }

    const record = {
      full_name: get(r, "full_name"),
      ic_passport: get(r, "ic_passport"),
      date_of_birth: dob,
      gender: get(r, "gender") || null,
      belt_rank: get(r, "belt_rank") || null,
      rank_confirmation: rankConfirmationRaw,
      home_address: get(r, "home_address") || null,
      city_town: get(r, "city_town") || null,
      postcode: get(r, "postcode") || null,
      home_country: get(r, "home_country") || null,
      email: get(r, "email") || null,
      phone: get(r, "phone") || null,
      school_id: schoolId,
      sensei_id: senseiId,
      invitation_code: get(r, "invitation_code") || null,
    };
    if (!record.full_name || !record.ic_passport) {
      failures.push({ row: rowNo, name: full_name, error: "Full name and IC/passport are required" });
      continue;
    }
    if (!record.date_of_birth || !record.gender || !record.belt_rank) {
      failures.push({ row: rowNo, name: full_name, error: "Date of birth, gender, and belt rank are required" });
      continue;
    }
    if (!record.home_address || !record.city_town || !record.postcode || !record.home_country) {
      failures.push({ row: rowNo, name: full_name, error: "Home address, city/town, postcode, and home country are required" });
      continue;
    }
    if (!record.email || !record.phone) {
      failures.push({ row: rowNo, name: full_name, error: "Email address and mobile phone are required" });
      continue;
    }
    const bank = {
      bank_name: get(r, "bank_name"),
      bank_account_no: normalizeIban(get(r, "bank_account_no")),
      bank_account_name: get(r, "bank_account_name"),
    };
    if (!bank.bank_name || !bank.bank_account_no || !bank.bank_account_name) {
      failures.push({ row: rowNo, name: full_name, error: "Reward payout bank details are required" });
      continue;
    }

    const { data, error } = await supabase.from("participants").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: full_name, error: "Could not save" }); continue; }
    await supabase.from("participant_bank_details").upsert({ participant_id: data!.id, ...bank }, { onConflict: "participant_id" });
    await writeAudit(supabase, {
      table_name: "participants", record_id: data!.id, action: "participant_created", new_value: record, actor_id: actorId,
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "participants", record_id: null, action: "bulk_csv_participants",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  await notifyOrganizersDirectoryBulkUpload({ kind: "Participants", succeeded, failed: failures.length, adminPath: "/admin/participants" });
  revalidatePath("/admin/participants");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const ANNOUNCEMENT_CSV_COLUMNS = ["title", "competition_name", "body", "published"] as const;

export async function bulkUploadAnnouncements(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), ANNOUNCEMENT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 500) return { done: false, error: "Maximum 500 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const { data: competitions } = await supabase.from("competitions").select("id, name");
  const competitionIdByName = new Map((competitions ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const title = get(r, "title") || `Row ${rowNo}`;
    if (!get(r, "title")) { failures.push({ row: rowNo, name: title, error: "Title is required" }); continue; }

    const competitionName = get(r, "competition_name").trim();
    let competitionId: string | null = null;
    if (competitionName) {
      competitionId = competitionIdByName.get(competitionName.toLowerCase()) ?? null;
      if (!competitionId) { failures.push({ row: rowNo, name: title, error: "competition_name does not match an existing competition" }); continue; }
    }

    const publishedRaw = get(r, "published").toLowerCase();
    const published = ["true", "yes", "1", "published"].includes(publishedRaw);

    const record = {
      competition_id: competitionId,
      title: get(r, "title"),
      body: get(r, "body") || null,
      published,
    };
    const { data, error } = await supabase.from("announcements").insert(record).select("id").single();
    if (error) { failures.push({ row: rowNo, name: title, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "announcements", record_id: data!.id, action: "announcement_created", new_value: record, actor_id: actorId,
    });
    if (published) await notifyAnnouncementPublished(record.title, record.body);
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "announcements", record_id: null, action: "bulk_csv_announcements",
    new_value: { rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath("/admin/announcements");
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const STAFF_CSV_COLUMNS = [
  "full_name", "staff_title", "email", "ic_passport", "date_of_birth", "gender", "belt_rank",
  "home_address", "city_town", "postcode", "country", "phone",
  "bank_name", "bank_account_no", "bank_account_name",
] as const;

/** Shared by bulkUploadOrganizers / bulkUploadSupport below — creates a real
 * login + emails a temporary password per row, same as createStaffAccount
 * above but looped over CSV rows. Capped far lower than the data-only bulk
 * uploads (200 rows) since every row is a real account + an email sent. */
async function bulkCreateStaffAccounts(formData: FormData, role: "organizer" | "customer_support"): Promise<CsvUploadResult> {
  const returnTo = role === "organizer" ? "/admin/organizers" : "/admin/support";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), STAFF_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 200) return { done: false, error: "Maximum 200 rows per upload — this creates a real login per row." };

  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (role === "organizer" && actorRole !== "admin") {
    return { done: false, error: "Only the Super Admin can bulk-create Admin / Organizer accounts." };
  }
  if (role === "customer_support" && !["admin", "organizer"].includes(actorRole ?? "")) {
    return { done: false, error: "Only Admin / Organizer can bulk-create Participant Support accounts." };
  }

  const admin = createAdminClient();
  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const full_name = get(r, "full_name") || `Row ${rowNo}`;
    const staff_title = get(r, "staff_title");
    const email = get(r, "email");
    const ic_passport = get(r, "ic_passport");
    const date_of_birth_raw = get(r, "date_of_birth");
    const date_of_birth = date_of_birth_raw ? parseDDMMYYYY(date_of_birth_raw) : null;
    const gender = get(r, "gender");
    const home_address = get(r, "home_address");
    const city_town = get(r, "city_town");
    const postcode = get(r, "postcode");
    const country = get(r, "country");
    const phone = get(r, "phone");
    const bank_name = get(r, "bank_name");
    const bank_account_no = normalizeIban(get(r, "bank_account_no"));
    const bank_account_name = get(r, "bank_account_name");
    if (date_of_birth_raw && !date_of_birth) {
      failures.push({ row: rowNo, name: full_name, error: "Invalid date of birth (use DD/MM/YYYY)" });
      continue;
    }
    if (!full_name || !staff_title || !email || !ic_passport || !date_of_birth || !gender) {
      failures.push({ row: rowNo, name: full_name, error: "Full name, Role, email, IC/Passport, date of birth, and gender are required" });
      continue;
    }
    if (!home_address || !city_town || !postcode || !country || !phone) {
      failures.push({ row: rowNo, name: full_name, error: "Home address, city/town, postcode, country, and phone are required" });
      continue;
    }
    if (!bank_name || !bank_account_no || !bank_account_name) {
      failures.push({ row: rowNo, name: full_name, error: "Bank details are required" });
      continue;
    }
    const extra = {
      staff_title,
      ic_passport,
      date_of_birth,
      gender,
      belt_rank: get(r, "belt_rank") || null,
      home_address,
      city_town,
      postcode,
      country,
      phone,
      bank_name,
      bank_account_no,
      bank_account_name,
    };
    const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 14);
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name, role },
    });
    if (error || !created.user) {
      failures.push({ row: rowNo, name: full_name, error: "Could not create account — email may already be registered" });
      continue;
    }
    await admin.from("profiles").update({ approved: true, ...extra }).eq("user_id", created.user.id);
    await writeAudit(supabase, {
      table_name: "profiles", record_id: created.user.id, action: "staff_account_created",
      new_value: { role, full_name, email, ...extra }, actor_id: actorId,
    });
    await sendConfirmationEmail({
      toEmail: email,
      recipientName: full_name,
      subject: `Your ${ROLE_LABEL[role]} account is ready`,
      bodyLines: [
        `An account has been created for you as ${ROLE_LABEL[role]}.`,
        `Temporary password: ${tempPassword}`,
        "Sign in and keep this password safe — there is currently no self-service password reset, contact the organizer if you need it changed.",
      ],
    });
    succeeded++;
  }

  await writeAudit(supabase, {
    table_name: "profiles", record_id: null, action: "bulk_csv_staff_accounts",
    new_value: { role, rows: dataRows.length, succeeded, failed: failures.length }, actor_id: actorId,
  });
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

export async function bulkUploadOrganizers(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  return bulkCreateStaffAccounts(formData, "organizer");
}

export async function bulkUploadSupport(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  return bulkCreateStaffAccounts(formData, "customer_support");
}

// ── Commission payouts ───────────────────────────────────────────────────────

/** Marks a computed School/Sensei/Referee commission as paid or unpaid --
 * bookkeeping only, the commission amount itself is always recomputed live
 * from registration data (see lib/commissions.ts), never stored here. */
export async function setCommissionPayoutStatus(formData: FormData) {
  const recipientType = String(formData.get("recipient_type") ?? "");
  const recipientId = String(formData.get("recipient_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const returnTo = "/admin/commissions";
  if (!["school", "sensei", "referee"].includes(recipientType) || !recipientId || !["unpaid", "paid"].includes(status)) {
    backTo(returnTo, { error: "Invalid request." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase
    .from("commission_payouts")
    .upsert(
      {
        recipient_type: recipientType, recipient_id: recipientId, status,
        paid_at: status === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "recipient_type,recipient_id" },
    );
  if (error) backTo(returnTo, { error: `Could not update payout status: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "commission_payouts", record_id: recipientId, action: "commission_payout_status_changed",
    new_value: { recipient_type: recipientType, status }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Payout status updated." });
}

export async function setWinnerPayoutStatus(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const returnTo = "/admin/commissions";
  if (!registrationId || !["unpaid", "paid"].includes(status)) {
    backTo(returnTo, { error: "Invalid request." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase
    .from("winner_payouts")
    .upsert(
      {
        registration_id: registrationId, status,
        paid_at: status === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "registration_id" },
    );
  if (error) backTo(returnTo, { error: `Could not update payout status: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "winner_payouts", record_id: registrationId, action: "winner_payout_status_changed",
    new_value: { status }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Payout status updated." });
}

/** Shared by both receipt-upload actions below — mirrors
 * uploadCertificateIfPresent's shape (private bucket, random filename), just
 * pointed at "payout-receipts" instead of "certificates". */
async function uploadReceiptIfPresent(
  supabase: SupabaseClient,
  formData: FormData,
  prefix: string,
  returnTo: string,
): Promise<string | null> {
  const receipt = formData.get("receipt");
  if (!(receipt instanceof File) || receipt.size === 0) return null;
  if (receipt.size > 10 * 1024 * 1024) {
    backTo(returnTo, { error: "Receipt file is too large (max 10 MB)." });
  }
  const ext = (receipt.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const path = `${prefix}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("payout-receipts")
    .upload(path, receipt, { contentType: receipt.type || "image/jpeg" });
  if (error) backTo(returnTo, { error: "Could not upload the receipt. Please try again." });
  return path;
}

/** Attaches a photo/scan of the actual bank transfer to a school/sensei/
 * referee commission payout — proof behind the Paid button, not just the
 * checkbox itself. Uploading doesn't change payout status by itself; mark
 * Paid separately (or first) as today. */
export async function uploadCommissionReceipt(formData: FormData) {
  const recipientType = String(formData.get("recipient_type") ?? "");
  const recipientId = String(formData.get("recipient_id") ?? "");
  const returnTo = "/admin/commissions";
  if (!["school", "sensei", "referee"].includes(recipientType) || !recipientId) {
    backTo(returnTo, { error: "Invalid request." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const receiptPath = await uploadReceiptIfPresent(supabase, formData, `commission-${recipientType}`, returnTo);
  if (!receiptPath) backTo(returnTo, { error: "Choose a receipt file first." });
  const { error } = await supabase
    .from("commission_payouts")
    .upsert(
      { recipient_type: recipientType, recipient_id: recipientId, receipt_path: receiptPath, updated_at: new Date().toISOString() },
      { onConflict: "recipient_type,recipient_id" },
    );
  if (error) backTo(returnTo, { error: `Could not save the receipt: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "commission_payouts", record_id: recipientId, action: "commission_receipt_uploaded",
    new_value: { recipient_type: recipientType, receipt_path: receiptPath }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Receipt uploaded." });
}

/** Same as uploadCommissionReceipt, for a Top-3 winner reward payout. */
export async function uploadWinnerReceipt(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const returnTo = "/admin/commissions";
  if (!registrationId) backTo(returnTo, { error: "Invalid request." });
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const receiptPath = await uploadReceiptIfPresent(supabase, formData, "winner", returnTo);
  if (!receiptPath) backTo(returnTo, { error: "Choose a receipt file first." });
  const { error } = await supabase
    .from("winner_payouts")
    .upsert(
      { registration_id: registrationId, receipt_path: receiptPath, updated_at: new Date().toISOString() },
      { onConflict: "registration_id" },
    );
  if (error) backTo(returnTo, { error: `Could not save the receipt: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "winner_payouts", record_id: registrationId, action: "winner_receipt_uploaded",
    new_value: { receipt_path: receiptPath }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Receipt uploaded." });
}

// ── Other Payout (free-form, organizer-entered) ─────────────────────────────

/** Creates or edits one manually-entered payout row — unlike commission/
 * winner payouts (computed live, only ever tracked by status), every field
 * here is real stored data the organizer typed in, so both create and edit
 * go through this one action. */
export async function saveOtherPayout(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/commissions";
  const competitionId = String(formData.get("competition_id") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const amountRaw = String(formData.get("amount_usd") ?? "").trim();
  if (!competitionId || !description || !amountRaw || Number.isNaN(Number(amountRaw)) || Number(amountRaw) < 0) {
    backTo(returnTo, { error: "Tier, description, and a valid amount are all required." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const values = { competition_id: competitionId, description, amount_usd: Number(amountRaw), updated_at: new Date().toISOString() };
  if (id) {
    const { error } = await supabase.from("other_payouts").update(values).eq("id", id);
    if (error) backTo(returnTo, { error: `Could not save: ${error.message}` });
    await writeAudit(supabase, {
      table_name: "other_payouts", record_id: id, action: "other_payout_updated", new_value: values, actor_id: actorId,
    });
  } else {
    const { data, error } = await supabase
      .from("other_payouts")
      .insert({ ...values, created_by: actorId })
      .select("id")
      .single();
    if (error) backTo(returnTo, { error: `Could not create: ${error.message}` });
    await writeAudit(supabase, {
      table_name: "other_payouts", record_id: data!.id, action: "other_payout_created", new_value: values, actor_id: actorId,
    });
  }
  backTo(returnTo, { ok: "Other payout saved." });
}

export async function deleteOtherPayout(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/commissions";
  if (!id) backTo(returnTo, { error: "Invalid request." });
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase.from("other_payouts").delete().eq("id", id);
  if (error) backTo(returnTo, { error: `Could not delete: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "other_payouts", record_id: id, action: "other_payout_deleted", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Other payout deleted." });
}

export async function setOtherPayoutStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const returnTo = "/admin/commissions";
  if (!id || !["unpaid", "paid"].includes(status)) {
    backTo(returnTo, { error: "Invalid request." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const { error } = await supabase
    .from("other_payouts")
    .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) backTo(returnTo, { error: `Could not update payout status: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "other_payouts", record_id: id, action: "other_payout_status_changed", new_value: { status }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Payout status updated." });
}

export async function uploadOtherPayoutReceipt(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/commissions";
  if (!id) backTo(returnTo, { error: "Invalid request." });
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const receiptPath = await uploadReceiptIfPresent(supabase, formData, "other-payout", returnTo);
  if (!receiptPath) backTo(returnTo, { error: "Choose a receipt file first." });
  const { error } = await supabase.from("other_payouts").update({ receipt_path: receiptPath, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) backTo(returnTo, { error: `Could not save the receipt: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "other_payouts", record_id: id, action: "other_payout_receipt_uploaded", new_value: { receipt_path: receiptPath }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Receipt uploaded." });
}

/** Top-3 prize amounts per tier -- a real organizer-controlled setting (see
 * migration 0103_tier_prizes.sql), not parsed from announcement text, since
 * this feeds the Profit/Loss report and a reworded announcement shouldn't
 * silently change what that report computes. */
export async function saveTierPrizes(formData: FormData) {
  const competitionId = String(formData.get("competition_id") ?? "");
  const returnTo = "/admin/commissions";
  if (!competitionId) backTo(returnTo, { error: "Invalid request." });
  const firstRaw = String(formData.get("first_place_usd") ?? "").trim();
  const secondRaw = String(formData.get("second_place_usd") ?? "").trim();
  const thirdRaw = String(formData.get("third_place_usd") ?? "").trim();
  const first = Number(firstRaw);
  const second = Number(secondRaw);
  const third = Number(thirdRaw);
  if ([first, second, third].some((n) => Number.isNaN(n) || n < 0)) {
    backTo(returnTo, { error: "Prize amounts must be valid non-negative numbers." });
  }
  const { supabase, actorId } = await getActor();
  await requireCompetitionManager(supabase, actorId, returnTo);
  const values = {
    competition_id: competitionId, first_place_usd: first, second_place_usd: second, third_place_usd: third,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("tier_prizes").upsert(values, { onConflict: "competition_id" });
  if (error) backTo(returnTo, { error: `Could not save: ${error.message}` });
  await writeAudit(supabase, {
    table_name: "tier_prizes", record_id: competitionId, action: "tier_prizes_saved", new_value: values, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Prize amounts saved." });
}

// ── Commissions/Rewards/Other Payouts CSV bulk upload ───────────────────────
// All three re-use the exact CSV shape each table's own "Download CSV"
// button already produces -- download, edit the status (and for Other
// Payouts, any field) column(s), re-upload the same file to override
// whatever's there now. Commission/Winner rows are otherwise computed live
// (see lib/commissions.ts / lib/rewards.ts), so only their payout bookkeeping
// is ever writable; Other Payouts is real stored data, so its upload can
// both create new rows (blank id) and update existing ones (id present).

const COMMISSION_PAYOUT_CSV_COLUMNS = ["recipient_type", "recipient_id", "status"] as const;

export async function bulkUploadCommissionPayouts(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/commissions";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), COMMISSION_PAYOUT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 500) return { done: false, error: "Maximum 500 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const recipientType = get(r, "recipient_type").trim().toLowerCase();
    const recipientId = get(r, "recipient_id").trim();
    const status = get(r, "status").trim().toLowerCase();
    const label = recipientId || `Row ${rowNo}`;
    if (!["school", "sensei", "referee"].includes(recipientType)) {
      failures.push({ row: rowNo, name: label, error: "recipient_type must be school, sensei, or referee" });
      continue;
    }
    if (!recipientId) { failures.push({ row: rowNo, name: label, error: "recipient_id is required" }); continue; }
    if (!["unpaid", "paid"].includes(status)) {
      failures.push({ row: rowNo, name: label, error: "status must be unpaid or paid" });
      continue;
    }
    const { error } = await supabase
      .from("commission_payouts")
      .upsert(
        {
          recipient_type: recipientType, recipient_id: recipientId, status,
          paid_at: status === "paid" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
        },
        { onConflict: "recipient_type,recipient_id" },
      );
    if (error) { failures.push({ row: rowNo, name: label, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "commission_payouts", record_id: recipientId, action: "commission_payout_bulk_upserted",
      new_value: { recipient_type: recipientType, status }, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const WINNER_PAYOUT_CSV_COLUMNS = ["registration_id", "status"] as const;

export async function bulkUploadWinnerPayouts(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/commissions";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), WINNER_PAYOUT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 500) return { done: false, error: "Maximum 500 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const registrationId = get(r, "registration_id").trim();
    const status = get(r, "status").trim().toLowerCase();
    const label = registrationId || `Row ${rowNo}`;
    if (!registrationId) { failures.push({ row: rowNo, name: label, error: "registration_id is required" }); continue; }
    if (!["unpaid", "paid"].includes(status)) {
      failures.push({ row: rowNo, name: label, error: "status must be unpaid or paid" });
      continue;
    }
    const { error } = await supabase
      .from("winner_payouts")
      .upsert(
        { registration_id: registrationId, status, paid_at: status === "paid" ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
        { onConflict: "registration_id" },
      );
    if (error) { failures.push({ row: rowNo, name: label, error: "Could not save" }); continue; }
    await writeAudit(supabase, {
      table_name: "winner_payouts", record_id: registrationId, action: "winner_payout_bulk_upserted",
      new_value: { status }, actor_id: actorId,
    });
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

const OTHER_PAYOUT_CSV_COLUMNS = ["id", "tier", "description", "amount_usd", "status"] as const;

/** Unlike the two above, every field here is real stored data -- a blank
 * `id` creates a new row, a populated one updates the matching row (and
 * fails that row specifically if the id doesn't exist, rather than silently
 * creating a duplicate from a typo'd id). */
export async function bulkUploadOtherPayouts(_prev: CsvUploadResult, formData: FormData): Promise<CsvUploadResult> {
  const returnTo = "/admin/commissions";
  const file = formData.get("csv_file");
  if (!(file instanceof File) || file.size === 0) return { done: false, error: "Choose a CSV file to upload." };
  if (file.size > 5 * 1024 * 1024) return { done: false, error: "CSV file too large (max 5 MB)." };

  const parsed = parseCsvWithHeader(await file.text(), OTHER_PAYOUT_CSV_COLUMNS);
  if ("error" in parsed) return { done: false, error: parsed.error };
  const { dataRows, get } = parsed;
  if (dataRows.length === 0) return { done: false, error: "The CSV has no data rows." };
  if (dataRows.length > 500) return { done: false, error: "Maximum 500 rows per upload." };

  const { supabase, actorId } = await getActor();
  const roleError = await bulkUploadRoleError(supabase, actorId);
  if (roleError) return { done: false, error: roleError };

  const { data: comps } = await supabase.from("competitions").select("id, name");
  const tierByName = new Map<string, string>();
  for (const c of comps ?? []) {
    const id = c.id as string;
    const name = c.name as string;
    tierByName.set(name.trim().toLowerCase(), id);
    tierByName.set(shortTierName(name).trim().toLowerCase(), id);
  }

  const failures: Array<{ row: number; name: string; error: string }> = [];
  let succeeded = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2;
    const id = get(r, "id").trim();
    const tierRaw = get(r, "tier").trim();
    const description = get(r, "description").trim();
    const amountRaw = get(r, "amount_usd").trim();
    const statusRaw = get(r, "status").trim().toLowerCase() || "unpaid";
    const label = description || `Row ${rowNo}`;

    if (!["unpaid", "paid"].includes(statusRaw)) {
      failures.push({ row: rowNo, name: label, error: "status must be unpaid or paid" });
      continue;
    }
    const amount = Number(amountRaw);
    if (!amountRaw || Number.isNaN(amount) || amount < 0) {
      failures.push({ row: rowNo, name: label, error: "amount_usd must be a valid non-negative number" });
      continue;
    }
    const competitionId = tierByName.get(tierRaw.toLowerCase());
    if (!description) { failures.push({ row: rowNo, name: label, error: "description is required" }); continue; }
    if (!competitionId) {
      failures.push({ row: rowNo, name: label, error: `tier "${tierRaw}" not recognized — must exactly match a competition tier name` });
      continue;
    }
    const values = {
      competition_id: competitionId, description, amount_usd: amount, status: statusRaw,
      paid_at: statusRaw === "paid" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    };
    if (id) {
      const { data, error } = await supabase.from("other_payouts").update(values).eq("id", id).select("id");
      if (error) { failures.push({ row: rowNo, name: label, error: "Could not save" }); continue; }
      if (!data || data.length === 0) { failures.push({ row: rowNo, name: label, error: `id "${id}" not found` }); continue; }
      await writeAudit(supabase, {
        table_name: "other_payouts", record_id: id, action: "other_payout_bulk_updated", new_value: values, actor_id: actorId,
      });
    } else {
      const { data, error } = await supabase.from("other_payouts").insert({ ...values, created_by: actorId }).select("id").single();
      if (error) { failures.push({ row: rowNo, name: label, error: "Could not save" }); continue; }
      await writeAudit(supabase, {
        table_name: "other_payouts", record_id: data!.id, action: "other_payout_bulk_created", new_value: values, actor_id: actorId,
      });
    }
    succeeded++;
  }
  revalidatePath(returnTo);
  return { done: true, succeeded, failed: failures.length, failures: failures.slice(0, 50) };
}

// ── Participant Support shift log ────────────────────────────────────────────

/** Manual clock-in — deliberately not tied to page-session timestamps,
 * since Participant Support also works via the Telegram assistant/community
 * groups where there's no page session to derive a sign-in time from. */
export async function clockIn(formData: FormData) {
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  if (!actorId) backTo(returnTo, { error: "Sign in first." });
  const { data: open } = await supabase
    .from("support_shifts")
    .select("id")
    .eq("user_id", actorId!)
    .is("clock_out_at", null)
    .maybeSingle();
  if (open) backTo(returnTo, { error: "You already have an open shift — clock out first." });
  const { error } = await supabase.from("support_shifts").insert({ user_id: actorId });
  if (error) backTo(returnTo, { error: "Could not clock in — please try again." });
  backTo(returnTo, { ok: "Clocked in." });
}

export async function clockOut(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const task_summary = String(formData.get("task_summary") ?? "").trim() || null;
  const returnTo = "/admin/support";
  const { supabase, actorId } = await getActor();
  if (!actorId || !id) backTo(returnTo, { error: "Invalid request." });
  const { error } = await supabase
    .from("support_shifts")
    .update({ clock_out_at: new Date().toISOString(), task_summary })
    .eq("id", id)
    .eq("user_id", actorId!);
  if (error) backTo(returnTo, { error: "Could not clock out — please try again." });
  backTo(returnTo, { ok: "Clocked out." });
}

// ── Referee <-> login manual link (fallback for mismatched emails) ─────────

/** referees.user_id is auto-linked by email at signup (migration 0040), but
 * a referee who signed up with a different email than their directory
 * record needs this manual override — admin types the email they actually
 * sign in with, and it's matched against profiles directly. */
export async function linkRefereeAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const loginEmail = String(formData.get("login_email") ?? "").trim();
  const returnTo = "/admin/referees";
  if (!id || !loginEmail) backTo(returnTo, { error: "Enter the email they sign in with." });
  const { supabase, actorId } = await getActor();
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("role", "referee")
    .ilike("email", loginEmail)
    .maybeSingle();
  if (!profile) backTo(returnTo, { error: `No Referee/Judge login found for ${loginEmail}.` });
  const { error } = await supabase.from("referees").update({ user_id: profile!.user_id }).eq("id", id);
  if (error) backTo(returnTo, { error: "Could not link the account — please try again." });
  await writeAudit(supabase, {
    table_name: "referees", record_id: id, action: "referee_account_linked",
    new_value: { user_id: profile!.user_id, login_email: loginEmail }, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Account linked." });
}

// ── Extra re-record attempt purchases (USD 10 for 3 more) ───────────────────

/** Confirms a participant's USD 10 payment and adds 3 more
 * delete-and-re-record chances to their account. */
export async function markAttemptPurchasePaid(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  const { data: purchase } = await supabase
    .from("attempt_purchases")
    .select("id, user_id, registration_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!purchase || purchase.status !== "pending") {
    backTo(returnTo, { error: "That request is no longer pending." });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("bonus_record_attempts, full_name, email")
    .eq("user_id", purchase!.user_id)
    .maybeSingle();
  // Credits the specific registration this purchase was for (see migration
  // 0118) -- independent per linked participant, not a shared login-wide
  // pool. Falls back to profiles for a pre-migration purchase that somehow
  // still has no registration_id.
  let err1: { message: string } | null = null;
  if (purchase!.registration_id) {
    const { data: link } = await supabase
      .from("profile_participants")
      .select("bonus_record_attempts")
      .eq("user_id", purchase!.user_id)
      .eq("registration_id", purchase!.registration_id)
      .maybeSingle();
    ({ error: err1 } = await supabase
      .from("profile_participants")
      .update({ bonus_record_attempts: (link?.bonus_record_attempts ?? 0) + 3 })
      .eq("user_id", purchase!.user_id)
      .eq("registration_id", purchase!.registration_id));
  } else {
    ({ error: err1 } = await supabase
      .from("profiles")
      .update({ bonus_record_attempts: (profile?.bonus_record_attempts ?? 0) + 3 })
      .eq("user_id", purchase!.user_id));
  }
  const { error: err2 } = await supabase
    .from("attempt_purchases")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id);
  if (err1 || err2) backTo(returnTo, { error: "Could not confirm the purchase — please try again." });
  await writeAudit(supabase, {
    table_name: "attempt_purchases", record_id: id, action: "attempt_purchase_confirmed",
    new_value: { user_id: purchase!.user_id }, actor_id: actorId,
  });
  if (profile?.email) {
    await sendConfirmationEmail({
      toEmail: profile.email,
      recipientName: profile.full_name ?? "there",
      subject: "Your USD 10 payment is confirmed — 3 more attempts added",
      bodyLines: [
        "Your USD 10 payment for extra delete-and-re-record attempts has been confirmed.",
        "3 more chances have been added to your account — go back to My Account to continue recording.",
      ],
    });
  }
  backTo(returnTo, { ok: "Purchase confirmed — 3 attempts added." });
}

// ── Bulk-upload payment gate (Sensei pays before uploading participants) ────

/** Confirms a sensei's upfront bulk-registration payment — unlocks their
 * next CSV/table upload for up to the paid headcount/event budget (see
 * consume_bulk_upload_payment, called from app/actions/bulk.ts once the
 * upload actually succeeds). One enquiry can cover up to 3 tiers at once
 * (sharing a batch_id) with one combined bill, so confirming any one row
 * confirms every sibling row in the same batch together. */
export async function markBulkUploadPaymentPaid(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  const { data: payment } = await supabase
    .from("bulk_upload_payments")
    .select("id, batch_id, sensei_id, school_id, participant_count, declared_participants, amount_usd, status")
    .eq("id", id)
    .maybeSingle();
  if (!payment || payment.status !== "pending") {
    backTo(returnTo, { error: "That request is no longer pending." });
  }

  const { data: siblings } = payment!.batch_id
    ? await supabase
        .from("bulk_upload_payments")
        .select("id, participant_count, declared_participants, amount_usd, status")
        .eq("batch_id", payment!.batch_id)
        .eq("status", "pending")
    : { data: [payment] };
  const batchRows = siblings ?? [payment!];
  const ids = batchRows.map((r) => r!.id);

  const { error } = await supabase
    .from("bulk_upload_payments")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .in("id", ids);
  if (error) backTo(returnTo, { error: "Could not confirm the payment — please try again." });
  await writeAudit(supabase, {
    table_name: "bulk_upload_payments", record_id: id, action: "bulk_upload_payment_confirmed",
    new_value: { sensei_id: payment!.sensei_id, batch_id: payment!.batch_id, tiers: batchRows.length }, actor_id: actorId,
  });
  const [{ data: sensei }, { data: school }] = await Promise.all([
    supabase.from("senseis").select("name, email, user_id").eq("id", payment!.sensei_id).maybeSingle(),
    supabase.from("schools").select("name").eq("id", payment!.school_id).maybeSingle(),
  ]);
  let senseiTelegramChatId: string | null = null;
  if (sensei?.user_id) {
    const { data: senseiProfile } = await supabase
      .from("profiles")
      .select("telegram_chat_id")
      .eq("user_id", sensei.user_id)
      .maybeSingle();
    senseiTelegramChatId = (senseiProfile?.telegram_chat_id as string | null) ?? null;
  }
  const totalAmount = batchRows.reduce((sum, r) => sum + Number(r!.amount_usd), 0);
  await notifySenseiBulkPaymentConfirmed({
    email: sensei?.email ?? null,
    telegramChatId: senseiTelegramChatId,
    senseiName: sensei?.name ?? "Sensei",
    totalAmountLabel: formatUSD(totalAmount),
    tierCount: batchRows.length,
  });
  const batchRef = (payment!.batch_id ?? payment!.id).slice(0, 8).toUpperCase();
  await notifyOrganizersBulkPaymentConfirmed({
    senseiName: sensei?.name ?? "Sensei",
    schoolName: school?.name ?? "School",
    batchRef,
    tierSummary: `${batchRows.length} tier${batchRows.length === 1 ? "" : "s"} (${formatUSD(totalAmount)} total)`,
  });
  revalidatePath(returnTo);
  backTo(returnTo, { ok: "Payment confirmed — sensei can now upload." });
}

/** Marks a bulk_upload_submissions row confirmed — Admin/Organizer's
 * acknowledgement that they've checked a sensei's uploaded CSV/table
 * against what was paid for. Separate from the tally (see
 * markBulkUploadTallyDone below): this just confirms "the file itself is
 * fine," the tally is the deeper "does headcount/amount actually match"
 * reconciliation. */
export async function confirmBulkUploadSubmission(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { data: submission } = await supabase
    .from("bulk_upload_submissions")
    .select("id, competition_id, sensei_id, row_count, status")
    .eq("id", id)
    .maybeSingle();
  if (!submission || submission.status !== "received") {
    backTo(returnTo, { error: "That upload is no longer pending confirmation." });
  }
  const { error } = await supabase
    .from("bulk_upload_submissions")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: actorId })
    .eq("id", id);
  if (error) backTo(returnTo, { error: "Could not confirm the upload — please try again." });
  await writeAudit(supabase, {
    table_name: "bulk_upload_submissions", record_id: id, action: "bulk_upload_submission_confirmed",
    new_value: { sensei_id: submission!.sensei_id }, actor_id: actorId,
  });
  const [{ data: sensei }, { data: competition }] = await Promise.all([
    supabase.from("senseis").select("name, email, user_id").eq("id", submission!.sensei_id).maybeSingle(),
    supabase.from("competitions").select("name").eq("id", submission!.competition_id).maybeSingle(),
  ]);
  let senseiTelegramChatId: string | null = null;
  if (sensei?.user_id) {
    const { data: senseiProfile } = await supabase
      .from("profiles")
      .select("telegram_chat_id")
      .eq("user_id", sensei.user_id)
      .maybeSingle();
    senseiTelegramChatId = (senseiProfile?.telegram_chat_id as string | null) ?? null;
  }
  await notifySenseiBulkCsvConfirmed({
    email: sensei?.email ?? null,
    telegramChatId: senseiTelegramChatId,
    senseiName: sensei?.name ?? "Sensei",
    competitionName: competition?.name ?? "the competition",
    rowCount: submission!.row_count,
  });
  revalidatePath(returnTo);
  backTo(returnTo, { ok: "Upload confirmed." });
}

/** Marks a bulk upload batch's tally done — Admin/Organizer's sign-off
 * that the uploaded headcount was checked against what the sensei paid
 * for. Applies to every bulk_upload_submissions row sharing this batch_id
 * (a batch can cover up to 3 tiers uploaded separately), and tells every
 * Organizer it's settled. */
export async function markBulkUploadTallyDone(formData: FormData) {
  const batchId = String(formData.get("batch_id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  await requireJudgingManager(supabase, actorId, returnTo);
  const { data: rows } = await supabase
    .from("bulk_upload_submissions")
    .select("id, sensei_id, school_id, tally_status")
    .eq("batch_id", batchId);
  if (!rows || rows.length === 0) backTo(returnTo, { error: "Batch not found." });
  const ids = rows!.filter((r) => r.tally_status !== "done").map((r) => r.id);
  if (ids.length > 0) {
    const { error } = await supabase
      .from("bulk_upload_submissions")
      .update({ tally_status: "done", tally_done_at: new Date().toISOString(), tally_done_by: actorId })
      .in("id", ids);
    if (error) backTo(returnTo, { error: "Could not mark the tally done — please try again." });
    await writeAudit(supabase, {
      table_name: "bulk_upload_submissions", record_id: batchId, action: "bulk_upload_tally_done",
      new_value: { batch_id: batchId }, actor_id: actorId,
    });
    const [{ data: sensei }, { data: school }] = await Promise.all([
      supabase.from("senseis").select("name").eq("id", rows![0].sensei_id).maybeSingle(),
      supabase.from("schools").select("name").eq("id", rows![0].school_id).maybeSingle(),
    ]);
    await notifyOrganizersBulkTallyDone({
      senseiName: sensei?.name ?? "Sensei",
      schoolName: school?.name ?? "School",
      batchRef: batchId.slice(0, 8).toUpperCase(),
      tierSummary: `${rows!.length} upload${rows!.length === 1 ? "" : "s"}`,
    });
  }
  revalidatePath(returnTo);
  backTo(returnTo, { ok: "Tally marked done." });
}

// ── Registration slot status (Admin/Organizer/Referee) ──────────────────────

const SLOT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  unslotted: "Unslotted",
  forfeited: "Forfeited",
  given_up: "Given up",
};

/** Admin, Organizer, and Referee/Judge accounts can flag a registration as
 * unslotted, forfeited, or self-given-up (or reset it back to active) to
 * clean up the Participant Records list — e.g. after a missed recording
 * deadline. Delegates to the set_registration_slot_status() RPC so
 * referees get exactly this one capability without a general UPDATE grant
 * on registrations. */
/** Moves one registration into a different kata category.
 *
 * The Participant Records table shows the category split into its four
 * parts (Kata / Belt group / Gender group / Age group), but they are NOT
 * four independent fields — a category is one row in `categories`, and the
 * four parts are just its name parsed on " — ". So editing is a choice
 * between categories that already exist in that registration's own
 * competition, never four free-text boxes: typing "Sanchin" into a Kata
 * cell would otherwise produce a category name matching no real category,
 * and the registration would drop out of its own division listing.
 *
 * Restricted to Admin / Organizer / Participant Support. Referees can
 * change slot status but must not be able to move a competitor between
 * divisions, which would change who they are judged against. */
export async function updateRegistrationCategory(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/records");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer / Participant Support can change a participant's category." });
  }
  if (!registrationId || !categoryId) backTo(returnTo, { error: "Pick a category first." });

  const { data: reg } = await supabase
    .from("registrations")
    .select("id, competition_id, category_id")
    .eq("id", registrationId)
    .maybeSingle();
  if (!reg) backTo(returnTo, { error: "That registration no longer exists." });

  const { data: category } = await supabase
    .from("categories")
    .select("id, name, competition_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (!category) backTo(returnTo, { error: "That category no longer exists." });
  // A category belongs to exactly one competition tier. Moving a
  // registration across tiers here would silently change what was paid for,
  // so it is refused rather than quietly allowed.
  if (category!.competition_id !== reg!.competition_id) {
    backTo(returnTo, { error: "That category belongs to a different competition tier." });
  }

  const { error } = await supabase
    .from("registrations")
    .update({ category_id: categoryId })
    .eq("id", registrationId);
  if (error) backTo(returnTo, { error: "Could not update the category — please try again." });

  await writeAudit(supabase, {
    table_name: "registrations",
    record_id: registrationId,
    action: "category_updated",
    old_value: { category_id: reg!.category_id },
    new_value: { category_id: categoryId, name: category!.name },
    actor_id: actorId,
  });
  backTo(returnTo, { ok: `Category updated to ${category!.name}.` });
}

export async function updateRegistrationSlotStatus(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const newStatus = String(formData.get("slot_status") ?? "");
  const note = String(formData.get("slot_status_note") ?? "").trim();
  const returnTo = String(formData.get("return_to") ?? "/admin/records");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "referee"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin, Organizer, or Referee/Judge accounts can update slot status." });
  }
  if (!["active", "unslotted", "forfeited", "given_up"].includes(newStatus)) {
    backTo(returnTo, { error: "Invalid slot status." });
  }

  const { error } = await supabase.rpc("set_registration_slot_status", {
    reg_id: registrationId,
    new_status: newStatus,
    note: note || null,
  });
  if (error) backTo(returnTo, { error: "Could not update slot status — please try again." });
  await writeAudit(supabase, {
    table_name: "registrations", record_id: registrationId, action: "slot_status_updated",
    new_value: { status: newStatus, note }, actor_id: actorId,
  });
  backTo(returnTo, { ok: `Marked ${SLOT_STATUS_LABEL[newStatus] ?? newStatus}.` });
}

/** Links a paid registration to its owner's account by matching the
 * participant's email on file — for when a participant can't self-link
 * from My Account (typo'd reference ID, signed up with a different email,
 * etc.). Available to Admin, Organizer, Participant Support, and
 * Referee/Judge so they can resolve this themselves instead of needing a
 * manual database fix every time. Delegates to admin_link_registration()
 * so the matching/validation logic lives in one place, shared with the
 * self-service claim_registration RPCs' rules. */
export async function linkRegistrationToAccount(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/records");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support", "referee"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin, Organizer, Participant Support, or Referee/Judge accounts can link a registration." });
  }
  const { data, error } = await supabase.rpc("admin_link_registration", { p_registration_id: registrationId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not link that registration — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "profiles", record_id: registrationId, action: "registration_linked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Linked — the participant can now sign in and record their kata." });
}

/** Frees up an account that's linked to a registration, so it can be
 * re-linked to a different one — the fix for "already has a different
 * registration linked" when Link to account is clicked. Symmetric with
 * linkRegistrationToAccount: same permission tier, delegates to
 * admin_unlink_registration() so the account-matching logic lives in one
 * place. The account itself isn't touched otherwise (still approved, role
 * unchanged) — only its registration_id/participant_id are cleared, and
 * its sign-in quota is recomputed so it reflects the account no longer
 * being tied to that competition. */
export async function unlinkRegistrationFromAccount(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/records");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support", "referee"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin, Organizer, Participant Support, or Referee/Judge accounts can unlink a registration." });
  }
  const { data, error } = await supabase.rpc("admin_unlink_registration", { p_registration_id: registrationId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not unlink that registration — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "profiles", record_id: registrationId, action: "registration_unlinked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Unlinked — that account is now free to be linked to a different registration." });
}

/**
 * The same manual "Link to account" / "Unlink" pair as Participant Records,
 * extended to School, Sensei, Referee, and Audience — the other four
 * registrant types that only connect to a login by email match (at signup,
 * or via auto_link_other_roles_by_email), with no manual fallback until
 * now when that match never happened. Unlike Participant, these four store
 * the link on their OWN table's user_id column (schools.user_id etc.), not
 * on profiles — see admin_link_school and its siblings in the migration
 * for why, and why linking one also picks up every other role sharing that
 * email in one action, same as admin_link_registration already does.
 */
export async function linkSchoolToAccount(formData: FormData) {
  const schoolId = String(formData.get("school_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/schools");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_link_school", { p_school_id: schoolId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not link that school — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "schools", record_id: schoolId, action: "school_linked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Linked — they can now sign in." });
}

export async function unlinkSchoolFromAccount(formData: FormData) {
  const schoolId = String(formData.get("school_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/schools");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_unlink_school", { p_school_id: schoolId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not unlink that school — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "schools", record_id: schoolId, action: "school_unlinked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Unlinked — that account is now free to be linked to a different school." });
}

export async function linkSenseiToAccount(formData: FormData) {
  const senseiId = String(formData.get("sensei_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/senseis");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_link_sensei", { p_sensei_id: senseiId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not link that sensei — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "senseis", record_id: senseiId, action: "sensei_linked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Linked — they can now sign in." });
}

export async function unlinkSenseiFromAccount(formData: FormData) {
  const senseiId = String(formData.get("sensei_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/senseis");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_unlink_sensei", { p_sensei_id: senseiId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not unlink that sensei — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "senseis", record_id: senseiId, action: "sensei_unlinked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Unlinked — that account is now free to be linked to a different sensei." });
}

export async function linkRefereeToAccount(formData: FormData) {
  const refereeId = String(formData.get("referee_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/referees");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_link_referee", { p_referee_id: refereeId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not link that referee — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "referees", record_id: refereeId, action: "referee_linked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Linked — they can now sign in." });
}

export async function unlinkRefereeFromAccount(formData: FormData) {
  const refereeId = String(formData.get("referee_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/referees");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_unlink_referee", { p_referee_id: refereeId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not unlink that referee — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "referees", record_id: refereeId, action: "referee_unlinked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Unlinked — that account is now free to be linked to a different referee." });
}

export async function linkAudienceToAccount(formData: FormData) {
  const audienceId = String(formData.get("audience_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/audience");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_link_audience", { p_audience_id: audienceId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not link that audience record — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "audiences", record_id: audienceId, action: "audience_linked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Linked — they can now sign in." });
}

export async function unlinkAudienceFromAccount(formData: FormData) {
  const audienceId = String(formData.get("audience_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/audience");
  const { supabase, actorId } = await getActor();
  const { data, error } = await supabase.rpc("admin_unlink_audience", { p_audience_id: audienceId });
  if (error || data !== "OK") {
    backTo(returnTo, { error: String(data ?? "Could not unlink that audience record — please try again.") });
  }
  await writeAudit(supabase, {
    table_name: "audiences", record_id: audienceId, action: "audience_unlinked_by_staff", actor_id: actorId,
  });
  backTo(returnTo, { ok: "Unlinked — that account is now free to be linked to a different audience record." });
}

/** Manually resends a registration's confirmation email — for when the
 * automatic one never arrived (e.g. an email-provider misconfiguration) and
 * the organizer wants to get the participant their reference ID without
 * waiting on a fix. Rebuilds the same content the original would have sent,
 * from this one registration's current data. Admin/Organizer/Staff only. */
export async function resendRegistrationConfirmation(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin/records");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff", "customer_support"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin/Organizer/Participant Support can resend a confirmation email." });
  }

  const { data: reg } = await supabase
    .from("registrations")
    .select(
      "id, payment_status, participant:participants(full_name, email, ic_passport), category:categories(name), competition:competitions(name)",
    )
    .eq("id", registrationId)
    .maybeSingle();
  if (!reg || !reg.participant) {
    backTo(returnTo, { error: "Registration not found." });
  }
  const participant = reg!.participant as unknown as { full_name: string; email: string | null; ic_passport: string };
  if (!participant.email) {
    backTo(returnTo, { error: "This participant has no email address on file." });
  }
  const category = reg!.category as unknown as { name: string } | null;
  const competition = reg!.competition as unknown as { name: string } | null;
  const kataBase = category?.name ? kataBaseOf(category.name) : "your kata event";
  const competitionName = competition?.name ?? "the competition";
  const referenceId = registrationId.slice(0, 8).toUpperCase();

  await sendConfirmationEmail({
    toEmail: participant.email,
    recipientName: participant.full_name,
    subject: `Registration confirmed (resent) — ${competitionName}`,
    telegramCategory: "participant",
    bodyLines: [
      `This confirms your registration for ${competitionName} (${kataBase}).`,
      reg!.payment_status === "paid"
        ? "Payment received — your slot is confirmed and your name appears on the participants list."
        : "Payment status: pending — transfer the registration fee and send your receipt to the organizer to confirm your slot.",
      `Your reference ID: ${referenceId}.`,
      `Keep your reference ID and the IC/passport (${participant.ic_passport}) you registered with — you'll need both to link your account when you're ready to record your kata.`,
    ],
  });

  await writeAudit(supabase, {
    table_name: "registrations", record_id: registrationId, action: "confirmation_email_resent", actor_id: actorId,
  });
  backTo(returnTo, { ok: `Confirmation email resent to ${participant.email}.` });
}

// ── Sign-in quota control (Admin/Organizer only) ────────────────────────────

/** Sets how many times a registrant may sign in, which competition tier
 * that allowance is tied to, and the date range it's valid for — read by
 * lib/sign-in-quota.ts on every protected-page load. Admin/Organizer only;
 * never touches admin/organizer/staff accounts themselves (see
 * record_sign_in()'s exemption in the same migration). */
export async function updateSignInControl(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "/admin");
  const { supabase, actorId } = await getActor();
  const actorRole = await getActorRole(supabase, actorId);
  if (!["admin", "organizer", "staff"].includes(actorRole ?? "")) {
    backTo(returnTo, { error: "Only Admin/Organizer can manage sign-in control." });
  }
  if (!userId) backTo(returnTo, { error: "This record has no linked login yet." });

  const limitRaw = String(formData.get("sign_in_limit") ?? "").trim();
  const competitionId = String(formData.get("sign_in_competition_id") ?? "").trim();
  const validFrom = String(formData.get("sign_in_valid_from") ?? "").trim();
  const validUntil = String(formData.get("sign_in_valid_until") ?? "").trim();
  const resetCount = formData.get("reset_count") === "on";

  const update: Record<string, unknown> = {
    sign_in_limit: limitRaw ? Number(limitRaw) : null,
    sign_in_competition_id: competitionId || null,
    sign_in_valid_from: validFrom || null,
    sign_in_valid_until: validUntil || null,
    // A manual save here is a deliberate override — recompute_sign_in_quota
    // (fired whenever a new role/tier link appears for this account) must
    // never silently replace it with a system default afterward.
    sign_in_quota_auto: false,
  };
  if (resetCount) update.sign_in_count = 0;

  const { error } = await supabase.from("profiles").update(update).eq("user_id", userId);
  if (error) backTo(returnTo, { error: "Could not update sign-in control — please try again." });
  await writeAudit(supabase, {
    table_name: "profiles", record_id: userId, action: "sign_in_control_updated",
    new_value: update, actor_id: actorId,
  });
  backTo(returnTo, { ok: "Sign-in control updated." });
}

/** Marks a "New Subscription" request as fulfilled — manual fallback for
 * when the request wasn't (or couldn't be) paid through Stripe. Applies
 * the same standard terms (30 sign-ins, valid 3 months from today) and
 * sends the same notification as the online path, via
 * applySubscriptionRenewalTerms in lib/finalize.ts, so the two paths never
 * drift apart. Idempotent — a request already paid online is a no-op here. */
export async function markSubscriptionRenewalFulfilled(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const returnTo = "/admin/records";
  const { supabase, actorId } = await getActor();
  const admin = createAdminClient();
  const result = await applySubscriptionRenewalTerms(admin, id);
  if (!result.ok) backTo(returnTo, { error: result.error ?? "Could not update the request — please try again." });
  await writeAudit(supabase, {
    table_name: "subscription_renewals", record_id: id, action: "subscription_renewal_fulfilled",
    actor_id: actorId,
  });
  backTo(returnTo, { ok: "Marked as fulfilled." });
}

/** Stripe Checkout for kata entries the organizer just created from the admin
 * Add Participant form. Carries the new registration ids in metadata so
 * finalizeAdminRegistrationSession can flip exactly those rows to paid —
 * distinct from the public flow, which defers row creation to a draft. */
async function adminRegistrationCheckoutUrl(
  registrationIds: string[],
  totalUsd: number,
  eventCount: number,
): Promise<string | null> {
  if (registrationIds.length === 0) return null;
  const origin =
    (await headers()).get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round((totalUsd / eventCount) * 100),
            product_data: {
              name: "Kata event registration",
              description: `${eventCount} kata event${eventCount === 1 ? "" : "s"} added by the organizer`,
            },
          },
          quantity: eventCount,
        },
      ],
      metadata: { admin_registration_ids: registrationIds.join(",") },
      success_url: `${origin}/admin/participants?ok=${encodeURIComponent("Payment received — kata entries are now paid.")}`,
      cancel_url: `${origin}/admin/participants?error=${encodeURIComponent("Payment cancelled — the kata entries are saved as pending.")}`,
    });
    return session.url;
  } catch {
    // Rows are already saved as pending, so a gateway failure is recoverable:
    // the organizer can mark them paid or retry from Registrations.
    return null;
  }
}

/** Stripe Checkout for a community record the organizer just added from the
 * admin panel (School / Sensei / Referee / Audience).
 *
 * Reuses the same metadata shape the public School/Sensei flow already
 * uses, so finalizeDirectorySession marks the record paid on webhook —
 * nothing new to keep in sync. Returns null when payments are off or the fee
 * is zero, in which case the record simply stays pending for the organizer
 * to settle by hand. */
async function communityRecordCheckoutUrl(
  kind: "school" | "sensei" | "referee" | "audience",
  recordId: string,
  displayName: string,
  amountUsd: number,
  label: string,
): Promise<string | null> {
  if (!paymentsEnabled() || amountUsd <= 0) return null;
  const origin =
    (await headers()).get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const metadata: Record<string, string> =
    kind === "school"
      ? { school_id: recordId }
      : kind === "sensei"
        ? { sensei_id: recordId }
        : kind === "referee"
          ? { referee_id: recordId }
          : { audience_id: recordId };
  const backTo = `/admin/${kind === "audience" ? "audience" : `${kind}s`}`;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amountUsd * 100),
            product_data: {
              name: label,
              description: `${displayName} — IKO GOJU-RYU KARATE-DO MALAYSIA SDN BHD`,
            },
          },
          quantity: 1,
        },
      ],
      metadata,
      success_url: `${origin}${backTo}?ok=${encodeURIComponent("Payment received — the record is now marked paid.")}`,
      cancel_url: `${origin}${backTo}?error=${encodeURIComponent("Payment cancelled — the record is saved as pending.")}`,
    });
    return session.url;
  } catch {
    // Record is already saved as pending, so a gateway failure is
    // recoverable: the organizer can mark it paid or retry.
    return null;
  }
}

/** The fee a School/Sensei owes, from the tier they were registered under. */
async function tierFeeUsd(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string | null,
): Promise<number> {
  if (!competitionId) return 0;
  const { data } = await supabase
    .from("competitions")
    .select("registration_fee_usd")
    .eq("id", competitionId)
    .maybeSingle();
  return Number(data?.registration_fee_usd ?? 0);
}
