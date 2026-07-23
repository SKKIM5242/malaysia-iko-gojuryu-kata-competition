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
      `— Malaysia Open IKO Goju-ryu Kata Championship`,
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
  lines.push("", "— Malaysia Open IKO Goju-ryu Kata Championship");
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
    "Please verify your email — Malaysia Open IKO Goju-ryu Kata Championship",
    `Thanks for creating an account.\n\n` +
      `Please confirm this is really your email address by clicking the link below. Until you ` +
      `do, you won't be able to sign in.\n\n` +
      `Verify my email: ${verifyUrl}\n\n` +
      `If you didn't create this account, you can ignore this email.\n\n` +
      `— Malaysia Open IKO Goju-ryu Kata Championship`,
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
