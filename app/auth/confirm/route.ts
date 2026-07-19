import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side confirmation endpoint for every Supabase email-link flow
 * (password recovery, email confirmation, magic link, invite). Required
 * because this app's Supabase client is cookie-based (@supabase/ssr) —
 * Supabase's own hosted /auth/v1/verify endpoint hands sessions back via a
 * URL hash fragment, which a cookie-based client has no reliable way to
 * pick up client-side. Verifying the token_hash here, server-side, writes
 * the session straight into cookies before the browser ever loads the
 * destination page.
 *
 * Requires the Supabase Dashboard's "Reset Password" email template (and
 * ideally Confirm signup / Magic Link / Invite) to link to
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
 * instead of the default `{{ .ConfirmationURL }}`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/account/reset-password";

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.search = "";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/account/reset-password";
  redirectTo.searchParams.set("error", "invalid");
  return NextResponse.redirect(redirectTo);
}
