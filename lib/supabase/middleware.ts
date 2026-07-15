import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured, skip the auth refresh and pass through.
  // Without this guard createServerClient throws "Your project's URL and Key
  // are required", crashing the edge middleware on every route (500
  // MIDDLEWARE_INVOCATION_FAILED).
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  try {
    let response = supabaseResponse;
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
    // participant must NOT reach /admin just by being logged in. Tiers share
    // /admin with different route allow-lists:
    //   admin (Super Admin)      -> everything
    //   organizer / staff        -> everything except /admin/accounts;
    //                               /admin/judging is reachable but the page
    //                               itself only shows them a read-only view
    //                               (no assign-referee / scoring-config UI)
    //   customer_support         -> dashboard, registrations, participants,
    //                               competitions, announcements, senseis,
    //                               referees, audience, and judging
    //                               (judging + registrations approve/reject
    //                               are further narrowed at the page/action
    //                               level — see app/actions/admin.ts)
    //   referee                  -> dashboard, competitions (category-level
    //                               actions there), registrations (view
    //                               only), participants, announcements, and
    //                               judging (view only)
    if (request.nextUrl.pathname.startsWith("/admin")) {
      if (!user) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = "/login";
        loginUrl.search = "";
        return NextResponse.redirect(loginUrl);
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, approved")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = profile?.approved ? profile.role : null;
      const path = request.nextUrl.pathname;
      const toAccount = () => {
        const homeUrl = request.nextUrl.clone();
        homeUrl.pathname = "/account";
        homeUrl.search = "";
        return NextResponse.redirect(homeUrl);
      };

      if (role === "admin") {
        // full access
      } else if (role === "organizer" || role === "staff") {
        if (path.startsWith("/admin/accounts")) {
          return toAccount();
        }
      } else if (role === "customer_support") {
        const allowedPrefixes = [
          "/admin/registrations", "/admin/participants", "/admin/competitions",
          "/admin/announcements", "/admin/senseis", "/admin/referees", "/admin/audience", "/admin/judging",
          "/admin/telegram", "/admin/records",
        ];
        const ok = path === "/admin" || allowedPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
        if (!ok) {
          const redirectUrl = request.nextUrl.clone();
          redirectUrl.pathname = "/admin/registrations";
          redirectUrl.search = "";
          return NextResponse.redirect(redirectUrl);
        }
      } else if (role === "referee") {
        const allowedPrefixes = [
          "/admin/competitions", "/admin/registrations", "/admin/participants",
          "/admin/announcements", "/admin/judging", "/admin/telegram", "/admin/records",
        ];
        const ok = path === "/admin" || allowedPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
        if (!ok) {
          const redirectUrl = request.nextUrl.clone();
          redirectUrl.pathname = "/admin/competitions";
          redirectUrl.search = "";
          return NextResponse.redirect(redirectUrl);
        }
      } else {
        return toAccount();
      }
    }
    return response;
  } catch {
    // Never let an auth hiccup crash the entire edge middleware
    return supabaseResponse;
  }
}
