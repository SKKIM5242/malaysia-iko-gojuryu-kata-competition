import crypto from "crypto";
import { NextResponse } from "next/server";

/**
 * Supabase "Send Email" Auth Hook — replaces Supabase's built-in (locked,
 * unpaid-tier, template-uneditable) auth emails entirely. Supabase calls
 * this endpoint for every auth email (signup, recovery, magic link, email
 * change, invite, reauthentication); we build the link ourselves — pointing
 * at our own /auth/confirm route, per that route's own docs — and send it
 * via Resend, the same provider lib/notify.ts already uses elsewhere.
 *
 * Configure in Supabase Dashboard → Authentication → Hooks → "Send Email":
 * type HTTPS, URL https://<site>/api/auth-email-hook. Supabase then shows a
 * signing secret (format `v1,whsec_<base64>`) — set it as
 * SEND_EMAIL_HOOK_SECRET here (Vercel env vars), verbatim, prefix included.
 */

interface HookUser {
  email: string;
}

interface HookEmailData {
  token_hash: string;
  token: string;
  redirect_to: string;
  email_action_type: "signup" | "recovery" | "invite" | "magiclink" | "email_change" | "reauthentication";
  site_url: string;
}

interface HookPayload {
  user: HookUser;
  email_data: HookEmailData;
}

function errorResponse(httpCode: string, message: string, status: number) {
  return NextResponse.json({ error: { http_code: httpCode, message } }, { status });
}

/** Standard Webhooks verification (https://www.standardwebhooks.com/) —
 * Supabase HTTP Hooks sign every request this way. Verifying against the
 * raw request body (not a re-serialized JSON.stringify) is required —
 * re-serializing can reorder/reformat bytes and break the signature. */
function verifySignature(rawBody: string, headers: Headers): boolean {
  const secretEnv = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secretEnv) return false;
  const secretB64 = secretEnv.replace(/^v1,whsec_/, "");

  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) return false;

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", Buffer.from(secretB64, "base64"))
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expected, "base64");

  return signatureHeader.split(" ").some((entry) => {
    const provided = entry.split(",")[1];
    if (!provided) return false;
    try {
      const providedBuf = Buffer.from(provided, "base64");
      return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

function buildEmail(user: HookUser, data: HookEmailData): { subject: string; text: string } {
  const next = (() => {
    try {
      return new URL(data.redirect_to).pathname;
    } catch {
      return "/account";
    }
  })();
  const link = `${data.site_url}/auth/confirm?token_hash=${data.token_hash}&type=${data.email_action_type}&next=${encodeURIComponent(next)}`;

  switch (data.email_action_type) {
    case "recovery":
      return {
        subject: "Reset your password",
        text:
          `Hi,\n\nWe received a request to reset your password. Click the link below to choose a new one:\n\n${link}\n\n` +
          `If you didn't request this, you can safely ignore this email — your password won't change.\n\n` +
          `— Malaysia Open IKO Goju-ryu Kata Championship`,
      };
    case "signup":
      return {
        subject: "Confirm your email",
        text: `Hi,\n\nConfirm your email address to activate your account:\n\n${link}\n\n— Malaysia Open IKO Goju-ryu Kata Championship`,
      };
    case "magiclink":
      return {
        subject: "Your sign-in link",
        text: `Hi,\n\nClick the link below to sign in:\n\n${link}\n\nIf you didn't request this, you can safely ignore this email.\n\n— Malaysia Open IKO Goju-ryu Kata Championship`,
      };
    case "invite":
      return {
        subject: "You've been invited",
        text: `Hi,\n\nYou've been invited to join. Click the link below to accept:\n\n${link}\n\n— Malaysia Open IKO Goju-ryu Kata Championship`,
      };
    case "email_change":
      return {
        subject: "Confirm your new email address",
        text: `Hi,\n\nConfirm this as your new email address:\n\n${link}\n\nIf you didn't request this, please secure your account.\n\n— Malaysia Open IKO Goju-ryu Kata Championship`,
      };
    case "reauthentication":
      return {
        subject: "Your confirmation code",
        text: `Hi,\n\nYour confirmation code is: ${data.token}\n\nEnter it in the app to continue.\n\n— Malaysia Open IKO Goju-ryu Kata Championship`,
      };
    default:
      return {
        subject: "Confirm your request",
        text: `Hi,\n\nClick the link below to continue:\n\n${link}\n\n— Malaysia Open IKO Goju-ryu Kata Championship`,
      };
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers)) {
    return errorResponse("401", "Invalid webhook signature.", 401);
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return errorResponse("400", "Malformed JSON payload.", 400);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return errorResponse("500", "RESEND_API_KEY is not configured.", 500);
  }

  const { subject, text } = buildEmail(payload.user, payload.email_data);

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: payload.user.email,
        subject,
        text,
      }),
    });
    if (!resendRes.ok) {
      const body = await resendRes.text();
      return errorResponse(String(resendRes.status), `Resend API error: ${body.slice(0, 300)}`, 500);
    }
  } catch (err) {
    return errorResponse("500", `Failed to reach Resend: ${err instanceof Error ? err.message : String(err)}`, 500);
  }

  return NextResponse.json({});
}
