import { createAdminClient } from "@/lib/supabase/admin";
import { kataFamilyOf } from "@/lib/kata-families";
import { kataBaseOf } from "@/lib/division";

export interface AutoAssignOutcome {
  videoId: string;
  refereeUserId: string;
}

/**
 * Fills judge slots (up to the competition's judges_required) for exactly
 * the given videos, picking the least-loaded eligible referee each time —
 * eligible meaning approved with a linked login, whose kata_families
 * (empty = every family) includes the video's family, and who isn't
 * excluded from the video's exact category (see referee_category_exclusions,
 * migration 0124). "Least-loaded" is measured across every video in the
 * competition, not just the ones passed in here, so a single
 * just-submitted video and a full manual catch-up run balance load the
 * same way. Existing assignments are left alone — this only fills gaps.
 *
 * Two callers, two different authorisation models, so the actual write is
 * left to the caller: autoAssignReferees (app/actions/admin.ts) runs as
 * the clicking admin/organizer/referee via assign_referee, which still
 * enforces a referee may only assign themselves; submitKataVideo's
 * automatic per-submission trigger (app/actions/account.ts) runs as the
 * system itself via system_assign_referee (migration 0125), since there's
 * no human actor to check there. Every READ below goes through the
 * service-role client regardless of which caller this is, specifically so
 * a referee-tier caller of the manual button still sees every OTHER
 * referee's kata_families/exclusions — referee_category_exclusions' own
 * RLS (migration 0124) only lets a referee read their own row, which would
 * otherwise silently under-filter the pool for that one caller.
 */
export async function autoAssignForVideos(
  competitionId: string,
  targetVideoIds: string[],
  assign: (videoId: string, refereeUserId: string) => PromiseLike<{ error: { message?: string } | null }>,
): Promise<AutoAssignOutcome[]> {
  if (targetVideoIds.length === 0) return [];
  const supabase = createAdminClient();

  const { data: competition } = await supabase
    .from("competitions")
    .select("judges_required")
    .eq("id", competitionId)
    .maybeSingle();
  if (!competition) return [];
  const needed = competition.judges_required ?? 3;

  // Every video in the competition — both for resolving each target
  // video's own family, and for load-balancing across the WHOLE
  // competition rather than just the (possibly single) target video.
  const { data: regs } = await supabase
    .from("registrations")
    .select("id, category_id")
    .eq("competition_id", competitionId);
  const regIds = (regs ?? []).map((r) => r.id as string);
  const categoryIdByReg = new Map((regs ?? []).map((r) => [r.id as string, r.category_id as string | null]));
  const { data: allVideos } =
    regIds.length > 0
      ? await supabase.from("kata_videos").select("id, registration_id").in("registration_id", regIds)
      : { data: [] as Array<{ id: string; registration_id: string }> };
  const allVideoIds = (allVideos ?? []).map((v) => v.id as string);
  const allVideoIdSet = new Set(allVideoIds);
  const categoryIdByVideo = new Map(
    (allVideos ?? []).map((v) => [v.id as string, categoryIdByReg.get(v.registration_id as string) ?? null]),
  );
  const distinctCategoryIds = [...new Set([...categoryIdByVideo.values()].filter((id): id is string => !!id))];
  const { data: videoCategories } =
    distinctCategoryIds.length > 0
      ? await supabase.from("categories").select("id, name").in("id", distinctCategoryIds)
      : { data: [] as Array<{ id: string; name: string }> };
  const familyByCategoryId = new Map(
    (videoCategories ?? []).map((c) => [c.id as string, kataFamilyOf(kataBaseOf(c.name as string))]),
  );

  const { data: referees } = await supabase
    .from("referees")
    .select("id, user_id, kata_families")
    .eq("status", "approved")
    .not("user_id", "is", null);
  const refereeIds = [...new Set((referees ?? []).map((r) => r.user_id as string))];
  if (refereeIds.length === 0) return [];

  const familiesByUser = new Map<string, Set<string>>();
  for (const r of referees ?? []) {
    const uid = r.user_id as string;
    const fams = familiesByUser.get(uid) ?? new Set<string>();
    for (const f of (r.kata_families as string[] | null) ?? []) fams.add(f);
    familiesByUser.set(uid, fams);
  }
  const refereeRowIds = (referees ?? []).map((r) => r.id as string);
  const { data: exclusionsData } =
    refereeRowIds.length > 0
      ? await supabase.from("referee_category_exclusions").select("referee_id, category_id").in("referee_id", refereeRowIds)
      : { data: [] as Array<{ referee_id: string; category_id: string }> };
  const rowIdToUser = new Map((referees ?? []).map((r) => [r.id as string, r.user_id as string]));
  const excludedCategoriesByUser = new Map<string, Set<string>>();
  for (const e of exclusionsData ?? []) {
    const uid = rowIdToUser.get(e.referee_id as string);
    if (!uid) continue;
    const set = excludedCategoriesByUser.get(uid) ?? new Set<string>();
    set.add(e.category_id as string);
    excludedCategoriesByUser.set(uid, set);
  }

  const { data: existing } =
    allVideoIds.length > 0
      ? await supabase.from("referee_assignments").select("video_id, referee_user_id").in("video_id", allVideoIds)
      : { data: [] as Array<{ video_id: string; referee_user_id: string }> };
  const assignedByVideo = new Map<string, Set<string>>();
  const loadByReferee = new Map<string, number>(refereeIds.map((id) => [id, 0]));
  for (const a of existing ?? []) {
    const set = assignedByVideo.get(a.video_id) ?? new Set<string>();
    set.add(a.referee_user_id);
    assignedByVideo.set(a.video_id, set);
    loadByReferee.set(a.referee_user_id, (loadByReferee.get(a.referee_user_id) ?? 0) + 1);
  }

  // Randomise so a shortage of referees doesn't systematically starve
  // whichever videos happen to sort last.
  const targets = targetVideoIds.filter((id) => allVideoIdSet.has(id));
  const shuffledVideos = [...targets].sort(() => Math.random() - 0.5);
  const newAssignments: AutoAssignOutcome[] = [];

  for (const videoId of shuffledVideos) {
    const already = assignedByVideo.get(videoId) ?? new Set<string>();
    let slotsLeft = needed - already.size;
    const videoCategoryId = categoryIdByVideo.get(videoId) ?? null;
    const videoFamily = videoCategoryId ? (familyByCategoryId.get(videoCategoryId) ?? null) : null;
    while (slotsLeft > 0) {
      const eligible = refereeIds.filter((id) => {
        if (already.has(id)) return false;
        const fams = familiesByUser.get(id);
        if (fams && fams.size > 0 && videoFamily && !fams.has(videoFamily)) return false;
        const excluded = excludedCategoriesByUser.get(id);
        if (excluded && videoCategoryId && excluded.has(videoCategoryId)) return false;
        return true;
      });
      if (eligible.length === 0) break;
      const minLoad = Math.min(...eligible.map((id) => loadByReferee.get(id) ?? 0));
      const candidates = eligible.filter((id) => (loadByReferee.get(id) ?? 0) === minLoad);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const { error } = await assign(videoId, pick);
      if (!error) {
        already.add(pick);
        loadByReferee.set(pick, (loadByReferee.get(pick) ?? 0) + 1);
        newAssignments.push({ videoId, refereeUserId: pick });
      }
      slotsLeft--;
    }
    assignedByVideo.set(videoId, already);
  }

  return newAssignments;
}
