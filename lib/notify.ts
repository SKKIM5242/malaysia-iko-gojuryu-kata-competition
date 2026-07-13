/**
 * Best-effort assignment notifications. Each channel no-ops gracefully until
 * its credentials exist (same pattern as lib/telegram.ts's group links) —
 * safe to call unconditionally from the assignment code paths.
 */

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

interface RegistrationNotice {
  participantEmail: string | null;
  participantName: string;
  competitionName: string;
  referenceId: string;
  kataName: string | null;
}

/** Record-purpose confirmation sent right after a registration is created
 * (manual bank-transfer flow or a successful Stripe payment) — reminds the
 * participant to join the Telegram group for updates. */
export async function notifyRegistrationConfirmation(notice: RegistrationNotice): Promise<void> {
  if (!notice.participantEmail) return;
  const telegramUrl = process.env.TELEGRAM_GROUP_PARTICIPANT?.trim() || null;
  await sendEmail(
    notice.participantEmail,
    `Registration confirmed — ${notice.competitionName}`,
    `Hi ${notice.participantName},\n\n` +
      `This confirms your registration for ${notice.competitionName}` +
      `${notice.kataName ? ` (${notice.kataName})` : ""}.\n` +
      `Reference ID: ${notice.referenceId}\n\n` +
      `Keep this email for your records.\n\n` +
      (telegramUrl
        ? `Don't forget to join the Participants Telegram group for updates: ${telegramUrl}\n\n`
        : "") +
      `— Malaysia Open IKO Goju-ryu Kata Championship`,
  );
}
