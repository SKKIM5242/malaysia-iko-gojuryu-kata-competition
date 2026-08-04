/**
 * Best-effort notifications. Each channel no-ops gracefully until its
 * credentials exist (same pattern as lib/telegram.ts's group links) — safe
 * to call unconditionally from the assignment / registration code paths.
 */

import { getTelegramLink, listTelegramGroups, type TelegramCategory } from "@/lib/telegram";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/components/ui";

interface AssignmentNotice {
  refereeEmail: string | null;
  refereeName: string | null;
  refereeTelegramChatId: string | null;
  participantName: string;
  categoryName: string | null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Sends one email via Resend, in plain text by default. Pass `html` for
 * the rare email (currently just the registration confirmation) that needs
 * inline styling Resend's plain `text` field can't carry — every email
 * client that renders HTML uses `html`, everything else falls back to
 * `text`, so both are always safe to send together. No-ops until
 * RESEND_API_KEY is set. */
async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to,
        subject,
        text,
        ...(html ? { html } : {}),
      }),
    });
    if (!res.ok) {
      // fetch() only rejects on network failure — a 4xx/5xx from Resend
      // (bad/expired key, unverified sender domain, sandbox-mode recipient
      // restriction, etc.) would otherwise fail completely silently.
      const body = await res.text().catch(() => "");
      console.error(`[notify] Resend send failed (${res.status}) to ${to}: ${body.slice(0, 500)}`);
    }
  } catch (err) {
    console.error(`[notify] Resend send threw for ${to}:`, err);
    // Best-effort — the underlying action already succeeded either way.
  }
}

async function sendAssignmentEmail(notice: AssignmentNotice): Promise<void> {
  if (!notice.refereeEmail) return;
  await sendEmail(
    notice.refereeEmail,
    "New kata recording assigned for you to judge",
    `Hi ${notice.refereeName ?? "Judge"},\n\n` +
      `You've been assigned a new recording to score: ${notice.participantName} — ${notice.categoryName ?? "Kata"}.\n\n` +
      `Sign in to Kata Arena to watch and submit your score: ${appUrl()}/account\n\n` +
      `— Malaysia Open Virtual Karate-do Kata Competition`,
  );
}

async function sendAssignmentTelegram(notice: AssignmentNotice): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !notice.refereeTelegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: notice.refereeTelegramChatId,
        text:
          `🥋 New kata recording assigned for you to judge: ${notice.participantName} — ${notice.categoryName ?? "Kata"}.\n` +
          `Sign in to Kata Arena to watch and score it: ${appUrl()}/account`,
      }),
    });
  } catch {
    // Best-effort
  }
}

export async function notifyRefereeAssignment(notice: AssignmentNotice): Promise<void> {
  await Promise.allSettled([sendAssignmentEmail(notice), sendAssignmentTelegram(notice)]);
}

interface UnassignedNotice extends AssignmentNotice {
  /** Optional context appended to the notice, e.g. why an automatic
   * reassignment happened — omitted for a plain admin-initiated removal. */
  reason?: string | null;
}

async function sendUnassignedEmail(notice: UnassignedNotice): Promise<void> {
  if (!notice.refereeEmail) return;
  await sendEmail(
    notice.refereeEmail,
    "You've been unassigned from a kata recording",
    `Hi ${notice.refereeName ?? "Judge"},\n\n` +
      `You've been unassigned from judging: ${notice.participantName} — ${notice.categoryName ?? "Kata"}.` +
      (notice.reason ? ` ${notice.reason}` : "") +
      `\n\nNo action is needed from you for this recording.\n\n` +
      `— Malaysia Open Virtual Karate-do Kata Competition`,
  );
}

async function sendUnassignedTelegram(notice: UnassignedNotice): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !notice.refereeTelegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: notice.refereeTelegramChatId,
        text:
          `🔔 You've been unassigned from judging: ${notice.participantName} — ${notice.categoryName ?? "Kata"}.` +
          (notice.reason ? ` ${notice.reason}` : "") +
          `\nNo action needed.`,
      }),
    });
  } catch {
    // Best-effort
  }
}

/** Fires whenever a referee loses an assignment — an explicit admin removal
 * (see unassignRefereeFromVideo in app/actions/admin.ts) or an automatic
 * judging-timeline reassignment/takeover (see the cron in
 * app/api/cron/judging-timeline/route.ts), which passes `reason` to explain
 * why. Mirrors notifyRefereeAssignment's email + Telegram DM pattern. */
export async function notifyRefereeUnassigned(notice: UnassignedNotice): Promise<void> {
  await Promise.allSettled([sendUnassignedEmail(notice), sendUnassignedTelegram(notice)]);
}

interface ScoredNotice {
  participantEmail: string | null;
  participantTelegramChatId: string | null;
  participantName: string;
  categoryName: string | null;
}

/** Deliberately doesn't reveal the score or any judge's individual score —
 * scores stay hidden until the competition's Winners reveal, same as the
 * Kata Arena / Winners page rule (see lib/winners.ts). Just confirms
 * judging is complete for this recording. */
async function sendScoredEmail(notice: ScoredNotice): Promise<void> {
  if (!notice.participantEmail) return;
  await sendEmail(
    notice.participantEmail,
    "Your kata recording has been fully judged",
    `Hi ${notice.participantName},\n\n` +
      `All assigned judges have now scored your recording${notice.categoryName ? ` — ${notice.categoryName}` : ""}.\n\n` +
      `Results are revealed on the Winners page once the organizer announces them: ${appUrl()}/winners\n\n` +
      `— Malaysia Open Virtual Karate-do Kata Competition`,
  );
}

async function sendScoredTelegram(notice: ScoredNotice): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !notice.participantTelegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: notice.participantTelegramChatId,
        text:
          `✅ All judges have now scored your kata recording${notice.categoryName ? ` — ${notice.categoryName}` : ""}.\n` +
          `Results are revealed on the Winners page once the organizer announces them: ${appUrl()}/winners`,
      }),
    });
  } catch {
    // Best-effort
  }
}

/** Fires once per recording, the moment the last of the competition's
 * judges_required scores is submitted for it (see maybeNotifyParticipantScored
 * in app/actions/account.ts, which guards this with kata_videos.participant_notified_at
 * so it never double-sends). */
export async function notifyParticipantScored(notice: ScoredNotice): Promise<void> {
  await Promise.allSettled([sendScoredEmail(notice), sendScoredTelegram(notice)]);
}

export interface ConfirmationEmailInput {
  toEmail: string | null;
  recipientName: string;
  subject: string;
  /** Flow-specific detail lines — mirrors what the on-screen confirmation
   * ("pop up") already shows the registrant, so the email is a faithful
   * record of it, not a generic receipt. */
  bodyLines: string[];
  referenceId?: string | null;
  telegramCategory?: TelegramCategory | null;
}

interface TelegramLinksForEmail {
  /** Public invite link — the one that lets a new member actually join. */
  url: string | null;
  /** Announcements-topic deep link — only opens for existing members. */
  memberUrl: string | null;
}

function buildConfirmationBody(input: ConfirmationEmailInput, telegram: TelegramLinksForEmail): string {
  const lines: string[] = [`Hi ${input.recipientName},`, "", ...input.bodyLines];
  if (input.referenceId) lines.push("", `Reference ID: ${input.referenceId}`);
  lines.push(
    "",
    "Keep this email for your records.",
    "",
    `Kata Arena log in: ${appUrl()}/account`,
    `App: ${appUrl()}`,
  );
  if (telegram.url) {
    lines.push(
      `Join the Telegram group: ${telegram.url}`,
      "Make sure you are in the Telegram group to receive any announcements from the " +
        "organizer — it's also where you communicate with the organizer and all other participants.",
    );
  }
  if (telegram.memberUrl) {
    lines.push(`Already in the group? Jump straight to Announcements: ${telegram.memberUrl}`);
  }
  lines.push("", "— Malaysia Open Virtual Karate-do Kata Competition");
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "AC045C1A" -> "AC04 5C1A" -- a space after the first 4 characters, purely
 * for readability in the email. Safe to copy-paste directly: the claim
 * form's reference field (components/ClaimForm.tsx) and claimRegistration
 * (app/actions/account.ts) both strip whitespace before matching, so the
 * space doesn't need to be manually removed first. */
function spacedReferenceId(id: string): string {
  return id.length === 8 ? `${id.slice(0, 4)} ${id.slice(4)}` : id;
}

/** HTML companion to buildConfirmationBody -- same content and order, sent
 * alongside the plain-text version (email clients that render HTML use
 * this; everything else falls back to text). The only real difference is
 * the reference ID: bold, larger, and spaced for readability, which plain
 * text can't express. Every dynamic value is HTML-escaped since, unlike
 * the plain-text version, this content is parsed as markup. */
function buildConfirmationHtml(input: ConfirmationEmailInput, telegram: TelegramLinksForEmail): string {
  const p = (html: string) => `<p style="margin:0 0 12px;">${html}</p>`;
  const parts: string[] = [p(`Hi ${escapeHtml(input.recipientName)},`)];
  for (const line of input.bodyLines) {
    if (line === "") continue;
    parts.push(p(escapeHtml(line)));
  }
  if (input.referenceId) {
    parts.push(
      p(
        `Reference ID: ` +
          `<strong style="font-size:18px;font-weight:900;letter-spacing:0.5px;">` +
          `${escapeHtml(spacedReferenceId(input.referenceId))}</strong>`,
      ),
    );
  }
  parts.push(p("Keep this email for your records."));
  parts.push(p(`Kata Arena log in: <a href="${appUrl()}/account">${appUrl()}/account</a>`));
  parts.push(p(`App: <a href="${appUrl()}">${appUrl()}</a>`));
  if (telegram.url) {
    parts.push(p(`Join the Telegram group: <a href="${telegram.url}">${escapeHtml(telegram.url)}</a>`));
    parts.push(
      p(
        "Make sure you are in the Telegram group to receive any announcements from the organizer " +
          "— it's also where you communicate with the organizer and all other participants.",
      ),
    );
  }
  if (telegram.memberUrl) {
    parts.push(
      p(`Already in the group? Jump straight to Announcements: <a href="${telegram.memberUrl}">${escapeHtml(telegram.memberUrl)}</a>`),
    );
  }
  parts.push(p("— Malaysia Open Virtual Karate-do Kata Competition"));
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5;">${parts.join("")}</div>`;
}

/**
 * Record-purpose confirmation sent right after any registration (participant,
 * referee, audience, staff, school, sensei) is created. Every email includes
 * the Kata Arena log-in link, the app link, and — when applicable — the
 * relevant category's Telegram invite link (to join) and Announcements-topic
 * link (for existing members), in addition to whatever detail lines the
 * caller supplies to mirror that flow's on-screen confirmation.
 */
export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<void> {
  if (!input.toEmail) return;
  const groups = await listTelegramGroups();
  const group = input.telegramCategory ? groups.find((g) => g.category === input.telegramCategory) : undefined;
  const telegram = { url: group?.url ?? null, memberUrl: group?.memberUrl ?? null };
  await sendEmail(
    input.toEmail,
    input.subject,
    buildConfirmationBody(input, telegram),
    buildConfirmationHtml(input, telegram),
  );
}

const RESEND_BATCH_SIZE = 100;

/**
 * Same confirmation email as sendConfirmationEmail, but for many recipients
 * at once (bulk registration — up to 10,000 rows) — uses Resend's Batch API
 * (up to 100 emails per HTTP request) instead of one request per recipient.
 * Sending one-request-per-email in parallel blew straight through Resend's
 * 10 req/s account rate limit past ~10 participants, silently 429-ing every
 * confirmation after that; batching keeps this to one request per 100
 * participants, sent one chunk at a time (never in parallel) to stay well
 * under the limit regardless of batch size.
 */
export async function sendConfirmationEmailBatch(inputs: ConfirmationEmailInput[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  // One lookup for the whole batch (up to 10,000 rows) instead of one per
  // recipient — every recipient's telegramCategory maps to the same handful
  // of groups, so there's no reason to hit the DB per row.
  const groupsByCategory = new Map((await listTelegramGroups()).map((g) => [g.category, g]));
  const emails = inputs
    .filter((i): i is ConfirmationEmailInput & { toEmail: string } => !!i.toEmail)
    .map((i) => {
      const group = i.telegramCategory ? groupsByCategory.get(i.telegramCategory) : undefined;
      const telegram = { url: group?.url ?? null, memberUrl: group?.memberUrl ?? null };
      return {
        from, to: i.toEmail, subject: i.subject,
        text: buildConfirmationBody(i, telegram),
        html: buildConfirmationHtml(i, telegram),
      };
    });
  if (emails.length === 0) return;

  for (let i = 0; i < emails.length; i += RESEND_BATCH_SIZE) {
    const chunk = emails.slice(i, i + RESEND_BATCH_SIZE);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[notify] Resend batch send failed (${res.status}) for ${chunk.length} recipients: ${body.slice(0, 500)}`);
      }
    } catch (err) {
      console.error(`[notify] Resend batch send threw for ${chunk.length} recipients:`, err);
    }
  }
}

/** Sent once per new account, right after signup — same no-op-until-
 * RESEND_API_KEY-is-set pattern as every other email in this file. */
export async function sendVerificationEmail(toEmail: string, verifyUrl: string): Promise<void> {
  await sendEmail(
    toEmail,
    "Please verify your email — Malaysia Open Virtual Karate-do Kata Competition",
    `Thanks for creating an account.\n\n` +
      `Please confirm this is really your email address by clicking the link below. Until you ` +
      `do, you won't be able to sign in.\n\n` +
      `Verify my email: ${verifyUrl}\n\n` +
      `If you didn't create this account, you can ignore this email.\n\n` +
      `— Malaysia Open Virtual Karate-do Kata Competition`,
  );
}

const ANNOUNCEMENT_TELEGRAM_CATEGORIES: TelegramCategory[] = [
  "participant", "school", "referee", "audience", "staff",
];

/** Posts to one group's "Announcements" topic. No-ops until that group's
 * numeric chat id (TELEGRAM_CHAT_ID_<CATEGORY>) is configured — the invite
 * link already set up in the telegram_groups table isn't enough for the Bot
 * API, which needs the chat id. TELEGRAM_TOPIC_ANNOUNCEMENT_<CATEGORY> (the
 * topic's message_thread_id) is optional — omitted, the message just posts
 * to the group's General topic instead of a dedicated one. */
async function postAnnouncementToGroup(
  category: TelegramCategory,
  title: string,
  body: string | null,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env[`TELEGRAM_CHAT_ID_${category.toUpperCase()}`];
  if (!token || !chatId) return;
  const threadId = process.env[`TELEGRAM_TOPIC_ANNOUNCEMENT_${category.toUpperCase()}`];
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        ...(threadId ? { message_thread_id: Number(threadId) } : {}),
        text: `📢 ${title}${body ? `\n\n${body}` : ""}`,
      }),
    });
  } catch {
    // Best-effort — publishing on the public site already succeeded either way.
  }
}

/** Every table an announcement email goes out to, mirroring exactly which
 * Telegram groups get the post (senseis ride along with schools -- same
 * "school" category the rest of the app uses for them; "staff" covers
 * Organizer/Admin/Participant-Support profiles, which is also the intended
 * organizer/admin heads-up -- no separate email needed since staff already
 * gets the same blast as everyone else). */
async function announcementEmailRecipients(): Promise<string[]> {
  const admin = createAdminClient();
  const [participants, schools, senseis, referees, audiences, staff] = await Promise.all([
    admin.from("participants").select("email"),
    admin.from("schools").select("email"),
    admin.from("senseis").select("email"),
    admin.from("referees").select("email"),
    admin.from("audiences").select("email"),
    admin.from("profiles").select("email").in("role", ["organizer", "admin", "customer_support"]).eq("approved", true),
  ]);
  const collect = (rows: { data: Array<{ email: string | null }> | null }) =>
    (rows.data ?? []).map((r) => r.email).filter((e): e is string => !!e);
  return [
    ...collect(participants), ...collect(schools), ...collect(senseis),
    ...collect(referees), ...collect(audiences), ...collect(staff),
  ];
}

/** Same Resend Batch API + 100-per-request chunking as sendConfirmationEmailBatch
 * (see its comment for why: one-request-per-recipient blows through Resend's
 * 10 req/s rate limit past ~10 recipients) -- a plain identical email to
 * every address, no per-recipient template needed since an announcement's
 * content doesn't vary by recipient. */
async function sendPlainEmailBatch(toEmails: string[], subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const unique = [...new Set(toEmails)];
  if (unique.length === 0) return;
  for (let i = 0; i < unique.length; i += RESEND_BATCH_SIZE) {
    const chunk = unique.slice(i, i + RESEND_BATCH_SIZE);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((to) => ({ from, to, subject, text }))),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[notify] Resend batch send failed (${res.status}) for ${chunk.length} recipients: ${body.slice(0, 500)}`);
      }
    } catch (err) {
      console.error(`[notify] Resend batch send threw for ${chunk.length} recipients:`, err);
    }
  }
}

/** Fires when an announcement is published (tick "visible on public site")
 * — posts the same announcement into every group's Announcements topic,
 * AND (previously missing entirely) emails every Participant, School,
 * Sensei, Referee, Audience member, and Organizer/Admin/Participant-Support
 * account on file. */
export async function notifyAnnouncementPublished(title: string, body: string | null): Promise<void> {
  await Promise.allSettled([
    ...ANNOUNCEMENT_TELEGRAM_CATEGORIES.map((cat) => postAnnouncementToGroup(cat, title, body)),
    (async () => {
      const emails = await announcementEmailRecipients();
      const text = [
        "Hi,", "", title, ...(body ? ["", body] : []), "",
        "— Malaysia Open Virtual Karate-do Kata Competition",
      ].join("\n");
      await sendPlainEmailBatch(emails, `📣 ${title}`, text);
    })(),
  ]);
}

const WINNER_TELEGRAM_CATEGORIES: TelegramCategory[] = [
  "participant", "school", "referee", "audience", "staff",
];

/** Posts to one group's "Winners" topic — same no-op-until-configured
 * pattern as postAnnouncementToGroup, but reads TELEGRAM_TOPIC_WINNER_
 * <CATEGORY> instead (falls back to the group's General topic if that
 * specific topic id isn't set yet). */
async function postWinnerNoticeToGroup(category: TelegramCategory, competitionName: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env[`TELEGRAM_CHAT_ID_${category.toUpperCase()}`];
  if (!token || !chatId) return;
  const threadId = process.env[`TELEGRAM_TOPIC_WINNER_${category.toUpperCase()}`];
  const url = `${appUrl()}/winners`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        ...(threadId ? { message_thread_id: Number(threadId) } : {}),
        text: `🏆 Winners announced — ${competitionName}!\n\nView recordings and judge scores: ${url}`,
      }),
    });
  } catch {
    // Best-effort — the public Winners page already has the data either way.
  }
}

/** Fires once per competition, the first time the daily cron notices
 * today has reached its winners_announce_date — posts into every group's
 * Winners topic. */
export async function notifyWinnersAnnounced(competitionName: string): Promise<void> {
  await Promise.allSettled(
    WINNER_TELEGRAM_CATEGORIES.map((cat) => postWinnerNoticeToGroup(cat, competitionName)),
  );
}

export interface CertificateEmailRecipient {
  email: string | null;
  name: string;
}

/** Same Resend Batch API pattern as sendConfirmationEmailBatch — one email
 * per participant, sent in chunks of RESEND_BATCH_SIZE to stay under
 * Resend's rate limit. */
async function sendCertificatesAvailableEmailBatch(
  recipients: CertificateEmailRecipient[],
  competitionName: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const emails = recipients
    .filter((r): r is CertificateEmailRecipient & { email: string } => !!r.email)
    .map((r) => ({
      from,
      to: r.email,
      subject: "Your certificate is now available",
      text:
        `Hi ${r.name},\n\n` +
        `Certificates for ${competitionName} are now available. Sign in to view and download yours: ${appUrl()}/account\n\n` +
        `— Malaysia Open Virtual Karate-do Kata Competition`,
    }));
  if (emails.length === 0) return;

  for (let i = 0; i < emails.length; i += RESEND_BATCH_SIZE) {
    const chunk = emails.slice(i, i + RESEND_BATCH_SIZE);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[notify] Resend batch send failed (${res.status}) for ${chunk.length} recipients: ${body.slice(0, 500)}`);
      }
    } catch (err) {
      console.error(`[notify] Resend batch send threw for ${chunk.length} recipients:`, err);
    }
  }
}

/** Fires once per competition, the moment its certificates become viewable
 * — either the manual "Publish All Certificates" button (publishWinnersNow
 * in app/actions/admin.ts) or the automatic deadline+30-days cron. Posts
 * once to the Participant group's Announcements topic and emails every
 * paid participant individually; the call site guards this with
 * competitions.certificates_notified_at so it never double-sends
 * regardless of which path reveals winners first. */
export async function notifyCertificatesPublished(
  competitionName: string,
  recipients: CertificateEmailRecipient[],
): Promise<void> {
  await Promise.allSettled([
    postAnnouncementToGroup(
      "participant",
      "Certificates now available",
      `Certificates for ${competitionName} are ready — sign in to your account to view and download yours.`,
    ),
    sendCertificatesAvailableEmailBatch(recipients, competitionName),
  ]);
}

interface StatusChangeNotice {
  email: string | null;
  telegramChatId: string | null;
  name: string;
  /** Human label for what changed, e.g. "Approval status", "Deposit status". */
  fieldLabel: string;
  /** Human label for the new value, e.g. "Approved", "Paid". */
  valueLabel: string;
  /** Telegram group link(s) to surface in the email — one per table
   * (Referee, Audience, School/Sensei, Support, Participant), except
   * Organizer/Admin applications, which get every group's link since that
   * role moderates across the whole competition, not just one category.
   * Each entry carries both the invite link (to join, for new members) and
   * the Announcements-topic link (only opens for existing members). */
  telegramGroups?: Array<{ label: string; url: string; memberUrl?: string | null }> | null;
}

function telegramGroupsBlock(
  groups: Array<{ label: string; url: string; memberUrl?: string | null }> | null | undefined,
): string {
  if (!groups || groups.length === 0) return "";
  const multi = groups.length > 1;
  const inviteList = multi
    ? `Telegram groups — join the ones you haven't already:\n${groups.map((g) => `- ${g.label}: ${g.url}`).join("\n")}\n`
    : `Telegram group — join it if you haven't already: ${groups[0].url}\n`;
  const memberGroups = groups.filter((g) => g.memberUrl);
  const memberList = memberGroups.length
    ? `\nAlready in the group? Jump straight to Announcements:\n` +
      memberGroups.map((g) => (multi ? `- ${g.label}: ${g.memberUrl}` : g.memberUrl)).join("\n") +
      `\n`
    : "";
  return `${inviteList}That's where the organizer posts announcements.\n${memberList}\n`;
}

async function sendStatusChangeEmail(notice: StatusChangeNotice): Promise<void> {
  if (!notice.email) return;
  await sendEmail(
    notice.email,
    `Your ${notice.fieldLabel.toLowerCase()} has changed to ${notice.valueLabel}`,
    `Hi ${notice.name},\n\n` +
      `Your ${notice.fieldLabel.toLowerCase()} for the Malaysia Open Virtual Karate-do Kata ` +
      `Championship has been updated to: ${notice.valueLabel}.\n\n` +
      `Sign in to your account for details: ${appUrl()}/account\n\n` +
      telegramGroupsBlock(notice.telegramGroups) +
      `— Malaysia Open Virtual Karate-do Kata Competition`,
  );
}

async function sendStatusChangeTelegram(notice: StatusChangeNotice): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !notice.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: notice.telegramChatId,
        text:
          `🔔 Your ${notice.fieldLabel.toLowerCase()} has been updated to: ${notice.valueLabel}.\n` +
          `Sign in for details: ${appUrl()}/account`,
      }),
    });
  } catch {
    // Best-effort
  }
}

/** Fires whenever an admin clicks a status/payment button for a School,
 * Sensei, Participant (registration), Referee, Audience, Organizer, or
 * Participant Support record — emails the person and DMs them on Telegram
 * if they have a connected chat (see statusChangeRecipient in
 * app/actions/admin.ts for how each table's recipient is resolved). Same
 * no-op-until-configured, Promise.allSettled pattern as every other notice
 * in this file. */
export async function notifyStatusChanged(notice: StatusChangeNotice): Promise<void> {
  await Promise.allSettled([sendStatusChangeEmail(notice), sendStatusChangeTelegram(notice)]);
}

const CODE_ROLE_LABELS: Record<string, string> = {
  participant: "Participant",
  school: "School / Dojo",
  sensei: "Sensei / Coach",
  referee: "Referee / Judge",
  audience: "Audience / Spectator",
  organizer: "Organizer",
  customer_support: "Participant Support",
  admin: "Admin",
  staff: "Admin / Organizer / Participant Support",
  any: "the assigned",
};

/** Which Telegram group this code's role should be pointed at — School and
 * Sensei share one group (see docs/TELEGRAM_SETUP.md); Organizer, Admin,
 * and Participant Support share the staff group. `any`-role codes have no
 * single sensible group, so they're omitted from the email. */
const CODE_ROLE_TELEGRAM_CATEGORY: Partial<Record<string, TelegramCategory>> = {
  participant: "participant",
  school: "school",
  sensei: "school",
  referee: "referee",
  audience: "audience",
  organizer: "staff",
  customer_support: "staff",
  admin: "staff",
  staff: "staff",
};

/**
 * Fires when an admin creates a new invitation code through the generic
 * "Create code" form (createInvitationCode in app/actions/admin.ts — not
 * the personal School/Sensei "Generate personal code" button, which has no
 * equivalent notice). Tells the invited person their role, the code, and
 * that the next step is "Create account" (not "Sign in" — they have no
 * account yet), plus the Telegram group to join for that role.
 *
 * Telegram DM is deliberately not attempted here: Telegram bots can only
 * message someone who has already started a chat with the bot, and this
 * person has no account (and so no connected chat) yet — there is no way
 * to push a message to an arbitrary phone number via the Bot API. Once
 * they've created their account and connected Telegram, they start
 * receiving DMs normally (see notifyRefereeAssignment etc. above).
 */
export async function notifyInvitationCodeIssued(input: {
  email: string;
  role: string;
  code: string;
}): Promise<void> {
  const roleLabel = CODE_ROLE_LABELS[input.role] ?? input.role;
  const category = CODE_ROLE_TELEGRAM_CATEGORY[input.role];
  const telegramUrl = category ? await getTelegramLink(category) : null;
  const lines = [
    `Hi,`,
    "",
    `You've been assigned the role of ${roleLabel} for the Malaysia Open Virtual Karate-do Kata Competition.`,
    "",
    `Your invitation code: ${input.code}`,
    "",
    `Please go to ${appUrl()}/account and click "Create account" (not "Sign in" — you don't have one yet).`,
    `Tick ${roleLabel} among the roles, enter this invitation code when it asks for one, choose a password, and submit.`,
    `Once your account is created, sign in on that same page any time after that.`,
  ];
  if (telegramUrl) {
    lines.push(
      "",
      `Telegram group: ${telegramUrl}`,
      "Please join it too — that's where the organizer posts announcements and where you'll be notified going forward.",
    );
  }
  lines.push("", "— Malaysia Open Virtual Karate-do Kata Competition");
  await sendEmail(input.email, `You've been invited as ${roleLabel}`, lines.join("\n"));
}

// ── Bulk registration — organizer fan-out + sensei confirmations ───────────

/** Every approved Organizer's contact info — used to fan a notice out to
 * the whole role at once (bulk-upload payment/CSV/tally notices below).
 * Uses the service-role client since these fire from background/best-effort
 * code paths, same reasoning as listTelegramGroups. */
async function organizerRecipients(): Promise<
  Array<{ email: string | null; telegramChatId: string | null; name: string }>
> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("email, full_name, telegram_chat_id")
    .eq("role", "organizer")
    .eq("approved", true);
  return (data ?? []).map((p) => ({
    email: (p.email as string | null) ?? null,
    telegramChatId: (p.telegram_chat_id as string | null) ?? null,
    name: (p.full_name as string | null) || (p.email as string | null) || "Organizer",
  }));
}

/** Tells Admin, Organizer and every Participant Support account that a
 * participant has filed a technical issue report, on whichever channels
 * each of them has connected. Best-effort like the rest of this file: the
 * report is already saved by the time this runs, so a dead Telegram token
 * or missing Resend key must never fail the participant's submission. */
export async function notifyStaffIssueReport(input: {
  reportId: string;
  reporterName: string;
  subject: string;
  page: string;
  section: string;
  viewTypeLabel: string;
  deviceName: string;
  screenSpec: string;
  screenshotCount: number;
}): Promise<void> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("email, full_name, telegram_chat_id")
    .in("role", ["admin", "organizer", "staff", "customer_support"])
    .eq("approved", true);
  const recipients = data ?? [];
  if (recipients.length === 0) return;

  const link = `${appUrl()}/admin/issue-reports`;
  const lines = [
    `New technical issue report from ${input.reporterName}.`,
    "",
    `Subject: ${input.subject}`,
    `Page: ${input.page}`,
    `Section: ${input.section}`,
    `View affected: ${input.viewTypeLabel}`,
    `Device: ${input.deviceName}`,
    `Screen: ${input.screenSpec}`,
    `Screenshots attached: ${input.screenshotCount}`,
    "",
    `Review and reply here: ${link}`,
  ];
  const emailText = [...lines, "", "— Malaysia Open Virtual Karate-do Kata Competition"].join("\n");
  const telegramText = lines.join("\n");

  await Promise.allSettled(
    recipients.flatMap((r) => [
      r.email ? sendEmail(r.email as string, `New issue report: ${input.subject}`, emailText) : Promise.resolve(),
      sendDirectTelegramDM((r.telegram_chat_id as string | null) ?? null, telegramText),
    ]),
  );
}

/** Posts a staff-composed message into a Telegram GROUP chat, for the
 * issue-report triage table's "notify the group" button. Distinct from
 * sendAdminTelegramDM only in intent — same Bot API call, but the chat id
 * is a group's rather than a person's, and like that one it reports
 * success/failure back because a staff member chose to send it. */
export async function sendTelegramGroupMessage(
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  return sendAdminTelegramDM(chatId, text);
}

/** Sends a staff-composed email reply to whoever filed an issue report.
 * Reports success/failure back for the same reason as the Telegram sends
 * above: this is an explicit action, not a background side effect. */
export async function sendIssueReportEmail(
  to: string,
  subject: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: "Email is not configured (RESEND_API_KEY missing)." };
  }
  try {
    await sendEmail(to, subject, text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send the email." };
  }
}

/** Sends a manually-composed Telegram DM from the admin panel (see
 * sendAdminTelegramDirectMessage in app/actions/admin.ts). Unlike every
 * other notify function in this file, this is a deliberate, explicit send
 * a staff member is choosing to make right now -- not a best-effort side
 * effect of some other action -- so it reports success/failure back
 * instead of swallowing errors silently. */
export async function sendAdminTelegramDM(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "Telegram bot is not configured (TELEGRAM_BOT_TOKEN missing)." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Telegram rejected the message (${res.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error sending to Telegram." };
  }
}

async function sendDirectTelegramDM(chatId: string | null, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Best-effort
  }
}

/** Fans one notice out to every approved Organizer, by email and Telegram
 * DM (whichever channels they've got connected) — shared by the three bulk
 * upload notices below (payment confirmed / CSV received / tally done). */
async function notifyOrganizers(subject: string, bodyLines: string[], telegramText: string): Promise<void> {
  const organizers = await organizerRecipients();
  if (organizers.length === 0) return;
  const emailText = [`Hi,`, "", ...bodyLines, "", "— Malaysia Open Virtual Karate-do Kata Competition"].join("\n");
  await Promise.allSettled(
    organizers.flatMap((o) => [
      o.email ? sendEmail(o.email, subject, emailText) : Promise.resolve(),
      sendDirectTelegramDM(o.telegramChatId, telegramText),
    ]),
  );
}

/** Fires after any admin-panel directory CSV bulk upload (Schools, Senseis,
 * Referees, Audience, Participants — see the bulkUpload* actions in
 * app/actions/admin.ts) that created at least one row. These uploads
 * previously notified nobody at all. `adminPath` points at the listing
 * page so an organizer can jump straight to reviewing what came in. */
export async function notifyOrganizersDirectoryBulkUpload(input: {
  kind: string;
  succeeded: number;
  failed: number;
  adminPath: string;
}): Promise<void> {
  if (input.succeeded === 0) return;
  const link = `${appUrl()}${input.adminPath}`;
  const failedNote = input.failed > 0 ? `, ${input.failed} row${input.failed === 1 ? "" : "s"} failed` : "";
  await notifyOrganizers(
    `Bulk CSV uploaded — ${input.kind} (${input.succeeded} added)`,
    [
      `A ${input.kind} CSV bulk upload just added ${input.succeeded} row${input.succeeded === 1 ? "" : "s"}${failedNote}.`,
      `Review it here: ${link}`,
    ],
    `📥 Bulk CSV uploaded — ${input.kind}: ${input.succeeded} added${failedNote}. ${link}`,
  );
}

interface BulkBatchNotice {
  senseiName: string;
  schoolName: string;
  batchRef: string;
  tierSummary: string;
}

/** Fires when Admin/Organizer confirms a sensei's bulk-upload payment (see
 * markBulkUploadPaymentPaid in app/actions/admin.ts) — tells every Organizer
 * so any of them can follow up once the CSV actually lands and tally it
 * against what was paid for. */
export async function notifyOrganizersBulkPaymentConfirmed(notice: BulkBatchNotice): Promise<void> {
  const link = `${appUrl()}/admin/records#bulk-upload-payments`;
  await notifyOrganizers(
    `Bulk registration payment confirmed — ${notice.senseiName}`,
    [
      `${notice.senseiName} (${notice.schoolName})'s bulk registration payment has been confirmed — batch ${notice.batchRef}, covering ${notice.tierSummary}.`,
      `They can now upload their CSV/table. Once it lands, please tally the upload against the paid headcount from the Participant Records page: ${link}`,
    ],
    `💳 Bulk registration payment confirmed — ${notice.senseiName} (${notice.schoolName}), batch ${notice.batchRef}. Tally once the CSV lands: ${link}`,
  );
}

interface BulkCsvNotice {
  senseiName: string;
  schoolName: string;
  batchRef: string;
  competitionName: string;
  rowCount: number;
}

/** Fires the moment a sensei's CSV/table upload actually succeeds (see
 * bulkRegisterCsv/bulkRegister in app/actions/bulk.ts) — tells every
 * Organizer so they can tally the upload against the paid headcount. */
export async function notifyOrganizersBulkCsvReceived(notice: BulkCsvNotice): Promise<void> {
  const link = `${appUrl()}/admin/records#participants`;
  await notifyOrganizers(
    `Bulk CSV uploaded — ${notice.senseiName} — ${notice.rowCount} participant${notice.rowCount === 1 ? "" : "s"}`,
    [
      `${notice.senseiName} (${notice.schoolName}) just uploaded ${notice.rowCount} participant${notice.rowCount === 1 ? "" : "s"} for ${notice.competitionName} — batch ${notice.batchRef}.`,
      `Please tally this against what they paid for, then mark the tally done on the Bulk Upload CSV listing (Participant Records page): ${link}`,
    ],
    `📥 Bulk CSV uploaded — ${notice.senseiName} (${notice.schoolName}), ${notice.rowCount} participant${notice.rowCount === 1 ? "" : "s"}, batch ${notice.batchRef}. Tally it here: ${link}`,
  );
}

/** Fires once an Organizer marks a bulk upload's tally done (see
 * markBulkUploadTallyDone in app/actions/admin.ts) — lets every other
 * Organizer know it's settled, no follow-up needed. */
export async function notifyOrganizersBulkTallyDone(notice: BulkBatchNotice): Promise<void> {
  await notifyOrganizers(
    `Bulk upload tally done — ${notice.senseiName}`,
    [`The tally for ${notice.senseiName} (${notice.schoolName})'s bulk upload — batch ${notice.batchRef} — is done. No follow-up needed.`],
    `✅ Tally done — ${notice.senseiName} (${notice.schoolName}), batch ${notice.batchRef}.`,
  );
}

/**
 * Fires whenever staff edit a participant record and the email on file
 * actually changes (see saveParticipant in app/actions/admin.ts) — this is
 * a distinct action from "Link to account" (which never touches a
 * participant's email; it only connects an existing registration to an
 * existing login sharing the same email already on file). Changing which
 * email a paid registration is associated with is more consequential —
 * whoever controls that inbox can now claim the registration — so both the
 * old and new address get a heads-up, and every approved Organizer gets a
 * Telegram DM + email so an unrequested change doesn't go unnoticed.
 */
export async function notifyParticipantEmailChanged(input: {
  participantName: string;
  oldEmail: string | null;
  newEmail: string | null;
  changedBy: string | null;
}): Promise<void> {
  const { participantName, oldEmail, newEmail, changedBy } = input;
  if (!oldEmail && !newEmail) return;
  const who = changedBy ? `by ${changedBy}` : "by an admin";
  const subject = `Email changed on your Kata Competition registration — ${participantName}`;
  const sends: Promise<unknown>[] = [];
  if (oldEmail) {
    sends.push(
      sendEmail(
        oldEmail,
        subject,
        `Hi,\n\nThe email address on ${participantName}'s Kata Competition registration was just changed ` +
          `${who}, from this address (${oldEmail}) to ${newEmail ?? "(removed)"}.\n\n` +
          `If you did not request this, please contact the organizer immediately — reply to this email or ` +
          `reach out via Telegram.\n\n— Malaysia Open Virtual Karate-do Kata Competition`,
      ),
    );
  }
  if (newEmail && newEmail !== oldEmail) {
    sends.push(
      sendEmail(
        newEmail,
        subject,
        `Hi,\n\n${participantName}'s Kata Competition registration is now associated with this email address ` +
          `(changed ${who}${oldEmail ? ` from ${oldEmail}` : ""}).\n\n` +
          `If you did not request this, please contact the organizer immediately.\n\n` +
          `Sign in to Kata Arena: ${appUrl()}/account\n\n— Malaysia Open Virtual Karate-do Kata Competition`,
      ),
    );
  }
  sends.push(
    notifyOrganizers(
      `Participant email changed — ${participantName}`,
      [
        `${participantName}'s registration email was changed ${who}: ${oldEmail ?? "(none)"} → ${newEmail ?? "(none)"}.`,
        `Worth a quick check if this wasn't an organizer/support-initiated change.`,
      ],
      `✏️ Email changed — ${participantName}: ${oldEmail ?? "(none)"} → ${newEmail ?? "(none)"} (${who}).`,
    ),
  );
  await Promise.allSettled(sends);
}

/** Fires when Admin/Organizer confirms a sensei's bulk-upload payment (see
 * markBulkUploadPaymentPaid in app/actions/admin.ts) — email (with the
 * usual Telegram-group-join-links via sendConfirmationEmail) plus a direct
 * Telegram DM if the sensei's login is already connected. Kept separate
 * from notifySenseiBulkCsvConfirmed below since payment and upload can
 * happen well apart in time. */
export async function notifySenseiBulkPaymentConfirmed(input: {
  email: string | null;
  telegramChatId: string | null;
  senseiName: string;
  totalAmountLabel: string;
  tierCount: number;
}): Promise<void> {
  await Promise.allSettled([
    sendConfirmationEmail({
      toEmail: input.email,
      recipientName: input.senseiName,
      subject: "Your bulk registration payment is confirmed — you can upload now",
      telegramCategory: "school",
      bodyLines: [
        `Your payment of ${input.totalAmountLabel} covering ${input.tierCount} tier${input.tierCount === 1 ? "" : "s"} is confirmed.`,
        "Go back to the Bulk registration page and upload your CSV or table using the same School and Sensei — no further payment needed for these participants.",
      ],
    }),
    sendDirectTelegramDM(
      input.telegramChatId,
      `💳 Your bulk registration payment of ${input.totalAmountLabel} (${input.tierCount} tier${input.tierCount === 1 ? "" : "s"}) is confirmed — you can upload your CSV/table now.`,
    ),
  ]);
}

/** Fires once a "Request New Subscription" is paid (Stripe or the manual
 * organizer-confirms fallback — see applySubscriptionRenewalTerms in
 * lib/finalize.ts) — spells out the new window so there's no ambiguity
 * about when it runs out: whichever of the valid-until date or the 30
 * sign-ins is reached first ends it, at which point another renewal (or
 * signing in as audience instead) is required. */
export async function notifySubscriptionRenewed(input: {
  email: string | null;
  telegramChatId: string | null;
  name: string;
  validFrom: string;
  validUntil: string;
  signInLimit: number;
}): Promise<void> {
  const fromLabel = formatDate(input.validFrom);
  const untilLabel = formatDate(input.validUntil);
  const text =
    `Hi ${input.name},\n\n` +
    `Your new subscription is confirmed. Here are the details:\n\n` +
    `- Valid from ${fromLabel} to ${untilLabel}\n` +
    `- ${input.signInLimit} sign-ins available\n\n` +
    `Whichever of these runs out first — the valid-until date, or all ${input.signInLimit} sign-ins used — ends this subscription. ` +
    `After that, you'll need to request another new subscription, or you may choose to sign in as audience instead.\n\n` +
    `— Malaysia Open Virtual Karate-do Kata Competition`;
  await Promise.allSettled([
    input.email
      ? sendEmail(input.email, `Your new subscription is confirmed — valid ${fromLabel} to ${untilLabel}`, text)
      : Promise.resolve(),
    sendDirectTelegramDM(
      input.telegramChatId,
      `✅ Your new subscription is confirmed — valid ${fromLabel} to ${untilLabel}, ${input.signInLimit} sign-ins available. ` +
        `Whichever runs out first ends it; renew again or sign in as audience after that.`,
    ),
  ]);
}

/** Fires from the daily cron (app/api/cron/judging-timeline) for any paid
 * registration at least 1 hour old whose participant has since connected
 * Telegram (matched by email, same as everywhere else in this app) —
 * confirms their registration landed and that Telegram is the right place
 * to watch for updates. Same-day best-effort timing: the cron runs once a
 * day, so this can land anywhere from ~1 hour up to ~24 hours after
 * registration depending on when they signed up relative to the run. */
export async function notifyParticipantTelegramWelcome(chatId: string, participantName: string): Promise<void> {
  await sendDirectTelegramDM(
    chatId,
    `🥋 Hi ${participantName}, thanks for registering for the Malaysia Open Virtual Karate-do Kata Competition! ` +
      `Glad you're connected here — this is where you'll hear about judging and results. ` +
      `Sign in any time to record your kata: ${appUrl()}/account`,
  );
}

/** Fires when Admin/Organizer clicks "Confirm upload CSV file" on a bulk
 * upload submission (see confirmBulkUploadSubmission in
 * app/actions/admin.ts) — separate from the payment confirmation notice,
 * since a sensei may pay and upload well apart in time. */
export async function notifySenseiBulkCsvConfirmed(input: {
  email: string | null;
  telegramChatId: string | null;
  senseiName: string;
  competitionName: string;
  rowCount: number;
}): Promise<void> {
  const text =
    `Hi ${input.senseiName},\n\n` +
    `Your bulk upload of ${input.rowCount} participant${input.rowCount === 1 ? "" : "s"} for ${input.competitionName} has been confirmed by the organizer.\n\n` +
    `— Malaysia Open Virtual Karate-do Kata Competition`;
  await Promise.allSettled([
    input.email ? sendEmail(input.email, "Your bulk upload has been confirmed", text) : Promise.resolve(),
    sendDirectTelegramDM(
      input.telegramChatId,
      `✅ Your bulk upload of ${input.rowCount} participant${input.rowCount === 1 ? "" : "s"} for ${input.competitionName} has been confirmed by the organizer.`,
    ),
  ]);
}
