import { createClient } from "@/lib/supabase/server";
import type { SiteAppearance } from "@/lib/site-appearance";

/** Fetches the singleton row (always exists — inserted by migration 0112)
 * plus the logo's public URL, if one's been uploaded. Read by SiteHeader/
 * SiteFooter on every public page and by the admin Site Appearance form.
 * Kept out of lib/site-appearance.ts on purpose — see that file's header
 * comment for why. */
export async function getSiteAppearance(): Promise<{ settings: SiteAppearance | null; logoUrl: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.from("site_appearance").select("*").eq("id", true).maybeSingle();
  const settings = (data as SiteAppearance | null) ?? null;
  const logoUrl = settings?.logo_path
    ? supabase.storage.from("branding").getPublicUrl(settings.logo_path).data.publicUrl
    : null;
  return { settings, logoUrl };
}
