import { NextResponse } from "next/server";

// TEMPORARY diagnostic route — deleted immediately after use. Sends one
// real test email via Resend and returns Resend's raw response so the
// exact rejection reason is visible directly, instead of hunting through
// Vercel's log UI.
export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ diagnosis: "RESEND_API_KEY is not set on this deployment." });
  }
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: "skkim90001@gmail.com",
      subject: "Diagnostic test",
      text: "Diagnostic test email from auth-email-hook troubleshooting.",
    }),
  });
  const body = await res.text();
  return NextResponse.json({
    fromUsed: from,
    resendStatus: res.status,
    resendBody: body,
  });
}
