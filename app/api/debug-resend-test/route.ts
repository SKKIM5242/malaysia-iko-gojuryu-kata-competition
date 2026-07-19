import { NextResponse } from "next/server";

// TEMPORARY diagnostic route — deleted immediately after use.
export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ diagnosis: "RESEND_API_KEY is not set on this deployment." });
  }
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const to = "kimsiewkiew@gmail.com";

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: "Diagnostic test (round 2)",
      text: "Diagnostic test email — checking actual delivery status via the Resend API.",
    }),
  });
  const sendBody = await sendRes.text();
  let emailId: string | null = null;
  try {
    emailId = JSON.parse(sendBody).id ?? null;
  } catch {
    // leave null
  }

  let statusRes: { status: number; body: string } | null = null;
  if (emailId) {
    // Resend needs a moment to process before status is queryable.
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    statusRes = { status: r.status, body: await r.text() };
  }

  return NextResponse.json({
    from,
    to,
    apiKeyPrefix: apiKey.slice(0, 10),
    sendStatus: sendRes.status,
    sendBody,
    emailId,
    statusCheck: statusRes,
  });
}
