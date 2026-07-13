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
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to,
        subject,
        text,
      }),
    });
  } catch {
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

interface ConfirmationEmailInput {
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

/**
 * Record-purpose confirmation sent right after any registration (participant,
 * referee, audience, staff, school, sensei) is created. Every email includes
 * the Kata Arena log-in link, the app link, and — when applicable — the
 * relevant category's Telegram group link, in addition to whatever detail
 * lines the caller supplies to mirror that flow's on-screen confirmation.
 */
export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<void> {
  if (!input.toEmail) return;
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
  if (telegramUrl) lines.push(`Telegram group: ${telegramUrl}`);
  lines.push("", "— Malaysia Open IKO Goju-ryu Kata Championship");
  await sendEmail(input.toEmail, input.subject, lines.join("\n"));
}
