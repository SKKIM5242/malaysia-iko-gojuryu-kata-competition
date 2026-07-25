/**
 * Best-effort notifications. Each channel no-ops gracefully until its
 * credentials exist (same pattern as lib/telegram.ts's group links) — safe
 * to call unconditionally from the assignment / registration code paths.
 */

import { getTelegramLink, type TelegramCategory } from "@/lib/telegram";

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

/** Sends one plain-text email via Resend. No-ops until RESEND_API_KEY is set. */
async function sendEmail(to: string, subject: string, text: string): Promise<void> {
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
      `— Malaysia Open Virtual Karate-do Kata Championship`,
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
      `— Malaysia Open Virtual Karate-do Kata Championship`,
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
      `— Malaysia Open Virtual Karate-do Kata Championship`,
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

function buildConfirmationBody(input: ConfirmationEmailInput): string {
  const telegramUrl = input.telegramCategory ? getTelegramLink(input.telegramCategory) : null;
  const lines: string[] = [`Hi ${input.recipientName},`, "", ...input.bodyLines];
  if (input.referenceId) lines.push("", `Reference ID: ${input.referenceId}`);
  lines.push(
    "",
    "Keep this email for your records.",
    "",
    `Kata Arena log in: ${appUrl()}/account`,
    `App: ${appUrl()}`,
  );
  if (telegramUrl) {
    lines.push(
      `Telegram group: ${telegramUrl}`,
      "Make sure you are in the Telegram group to receive any announcements from the " +
        "organizer — it's also where you communicate with the organizer and all other participants.",
    );
  }
  lines.push("", "— Malaysia Open Virtual Karate-do Kata Championship");
  return lines.join("\n");
}

/**
 * Record-purpose confirmation sent right after any registration (participant,
 * referee, audience, staff, school, sensei) is created. Every email includes
 * the Kata Arena log-in link, the app link, and — when applicable — the
 * relevant category's Telegram group link, in addition to whatever detail
 * lines the caller supplies to mirror that flow's on-screen confirmation.
 */
export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<void> {
  if (!input.toEmail) return;
  await sendEmail(input.toEmail, input.subject, buildConfirmationBody(input));
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
  const emails = inputs
    .filter((i): i is ConfirmationEmailInput & { toEmail: string } => !!i.toEmail)
    .map((i) => ({ from, to: i.toEmail, subject: i.subject, text: buildConfirmationBody(i) }));
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
    "Please verify your email — Malaysia Open Virtual Karate-do Kata Championship",
    `Thanks for creating an account.\n\n` +
      `Please confirm this is really your email address by clicking the link below. Until you ` +
      `do, you won't be able to sign in.\n\n` +
      `Verify my email: ${verifyUrl}\n\n` +
      `If you didn't create this account, you can ignore this email.\n\n` +
      `— Malaysia Open Virtual Karate-do Kata Championship`,
  );
}

const ANNOUNCEMENT_TELEGRAM_CATEGORIES: TelegramCategory[] = [
  "participant", "school", "referee", "audience", "staff",
];

/** Posts to one group's "Announcements" topic. No-ops until that group's
 * numeric chat id (TELEGRAM_CHAT_ID_<CATEGORY>) is configured — the invite
 * links already set up (TELEGRAM_GROUP_<CATEGORY>) aren't enough for the Bot
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

/** Fires when an announcement is published (tick "visible on public site")
 * — posts the same announcement into every group's Announcements topic. */
export async function notifyAnnouncementPublished(title: string, body: string | null): Promise<void> {
  await Promise.allSettled(
    ANNOUNCEMENT_TELEGRAM_CATEGORIES.map((cat) => postAnnouncementToGroup(cat, title, body)),
  );
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
        `— Malaysia Open Virtual Karate-do Kata Championship`,
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
  const telegramUrl = category ? getTelegramLink(category) : null;
  const lines = [
    `Hi,`,
    "",
    `You've been assigned the role of ${roleLabel} for the Malaysia Open Virtual Karate-do Kata Championship.`,
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
  lines.push("", "— Malaysia Open Virtual Karate-do Kata Championship");
  await sendEmail(input.email, `You've been invited as ${roleLabel}`, lines.join("\n"));
}
