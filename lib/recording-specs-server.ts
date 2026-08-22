import { createAdminClient } from "@/lib/supabase/admin";
import { toAppliedSpec, type AppliedSpecMap, type SpecId } from "@/lib/recording-specs";

/**
 * The specs an organizer has switched on, for the pages that render a
 * recorder to hand down.
 *
 * Service-role rather than the cookie-bound client: a participant about to
 * record has to know which settings to use, and the row is not theirs to
 * read under a stricter policy. Nothing sensitive lives here — it is three
 * rows of resolution and bitrate.
 *
 * Never throws. A missing table (before the migration lands) or a failed
 * query returns an empty map, and every recorder falls back to the code
 * default rather than refusing to record.
 */
export async function getAppliedSpecs(): Promise<AppliedSpecMap> {
  try {
    const { data } = await createAdminClient()
      .from("recording_specs")
      .select("id, resolution, fps, video_kbps, audio_kbps, applied")
      .eq("applied", true);
    const out: AppliedSpecMap = {};
    for (const row of data ?? []) {
      const spec = toAppliedSpec({
        resolution: row.resolution as string,
        fps: row.fps as number,
        videoKbps: row.video_kbps as number,
        audioKbps: row.audio_kbps as number,
      });
      if (spec) out[row.id as SpecId] = spec;
    }
    return out;
  } catch {
    return {};
  }
}
