import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured, skip the auth refresh and pass through.
  // Without this guard createServerClient throws "Your project's URL and Key
  // are required", crashing the edge middleware on every route (500
  // MIDDLEWARE_INVOCATION_FAILED).
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  // Declared outside the try block (not just `let` inside it) so that if
  // something throws after Supabase has already refreshed the session, the
  // catch below can still return the response carrying the NEW cookies —
  // otherwise a refreshed-but-then-discarded session forces a full
  // re-login next time the (now stale) refresh token is used.
  let response = NextResponse.next({ request });

  // Every redirect must carry forward whatever cookies are on `response` at
  // that point (a session refresh may have just written new ones) — a bare
  // `NextResponse.redirect(url)` starts a fresh response with none of them,
  // silently dropping a just-refreshed session on any redirect.
  const redirectTo = (pathname: string) => {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    target.search = "";
    const redirectResponse = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    // Refresh session so it doesn't expire while user is active
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Admin routes require an approved admin-tier session — a signed-in
    // participant must NOT reach /admin just by being logged in. Per the
    // organizer's explicit instruction, every approved staff-tier role
    // (admin, organizer/staff, customer_support, referee) gets full access
    // to every /admin listing page, including bank/IC details on Schools,
    // Senseis, Organizers, and Support — only /admin/accounts (staff
    // account approvals + invitation codes) stays restricted to the Super
    // Admin. Write actions for sensitive operations (e.g. assigning
    // referees, approving registrations) are narrowed further at the
    // page/action level — see app/actions/admin.ts.
    if (request.nextUrl.pathname.startsWith("/admin")) {
      if (!user) {
        return redirectTo("/login");
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, approved")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = profile?.approved ? profile.role : null;
      const path = request.nextUrl.pathname;

      if (role === "admin") {
        // full access
      } else if (role === "organizer" || role === "staff" || role === "customer_support" || role === "referee") {
        if (path.startsWith("/admin/accounts") || path.startsWith("/admin/email-verifications")) {
          return redirectTo("/admin");
        }
      } else {
        return redirectTo("/account");
      }
    }
    return response;
  } catch {
    // Never let an auth hiccup crash the entire edge middleware — but still
    // return `response`, not a blank NextResponse, so a session refresh that
    // already succeeded isn't thrown away by a later, unrelated error.
    return response;
  }
}
