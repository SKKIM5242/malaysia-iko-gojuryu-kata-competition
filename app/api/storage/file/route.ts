import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hands out a short-lived signed URL for one stored object, so the Storage
 * page can offer View and Download without minting a URL for every file up
 * front — a page listing a few thousand recordings would otherwise make a
 * few thousand signing calls on every render, most of them never used.
 *
 * Gated to Admin/Organizer here, not just in the UI: these buckets hold
 * competitors' unreleased recordings, and a URL that anyone signed in could
 * hit would defeat the whole point of the bucket being private.
 *
 * `download=1` asks Storage to send Content-Disposition: attachment, so the
 * browser saves the file rather than playing it inline.
 */
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["admin", "organizer"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket");
  const path = url.searchParams.get("path");
  const wantsDownload = url.searchParams.get("download") === "1";
  if (!bucket || !path) {
    return NextResponse.json({ error: "bucket and path are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, approved")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.approved || !ALLOWED_ROLES.includes((profile.role as string) ?? "")) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 300, {
    download: wantsDownload ? (path.split("/").pop() ?? true) : false,
  });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? "Could not sign that file." }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl);
}
