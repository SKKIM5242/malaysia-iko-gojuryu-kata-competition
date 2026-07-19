import { NextResponse } from "next/server";

// TEMPORARY diagnostic route — deleted immediately after use.
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
    keyPrefix: apiKey.slice(0, 10),
    keyLength: apiKey.length,
    fromUsed: from,
    resendStatus: res.status,
    resendBody: body,
  });
}
