import { createClient } from "@/lib/supabase/server";
import type { RecordingAppearance } from "@/lib/recording-appearance";

/** Fetches the singleton recording_appearance row (always exists — seeded
 * by migration 0121) plus the banner logo's public URL. Read by the
 * recording screens and by the admin Recording Appearance form. Kept out of
 * lib/recording-appearance.ts on purpose — see that file's header for why. */
export async function getRecordingAppearance(): Promise<{
  settings: RecordingAppearance | null;
  logoUrl: string | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase.from("recording_appearance").select("*").eq("id", true).maybeSingle();
  const settings = (data as RecordingAppearance | null) ?? null;
  const logoUrl = settings?.logo_path
    ? supabase.storage.from("branding").getPublicUrl(settings.logo_path).data.publicUrl
    : null;
  return { settings, logoUrl };
}
