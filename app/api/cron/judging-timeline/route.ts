import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import {
  notifyRefereeAssignment, notifyRefereeUnassigned, notifyWinnersAnnounced, notifyCertificatesPublished,
  notifyParticipantTelegramWelcome, competitionCertificateRecipients,
} from "@/lib/notify";
import { winnersRevealed } from "@/lib/winners";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily enforcement of the published judging timeline (run by Vercel Cron):
 * - Referees have 2 weeks after a competition's registration deadline to
 *   score their assignments. After the 2nd week, any unscored assignment
 *   is RE-ASSIGNED to the least-loaded other eligible referee.
 * - The re-assigned referee gets 1 week. After the 3rd week (their 4th
 *   week overall, before the winner announcement), any still-unscored
 *   assignment is handed to the organizer: it is re-assigned to an
 *   Admin/Organizer account, who scores it via Score Recordings.
 * Only fires between the deadline and the winners announcement, is
 * idempotent day to day, and writes an audit row for every hand-off.
 *
 * Also runs the slot-cleanup pass: any paid, still-"active" registration
 * whose competition deadline has passed with no recording submitted is
 * auto-marked "unslotted" and its payment "forfeited" — freeing the slot
 * and flagging it on the Participant Records page.
 */
export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = Date.now();
  const report: Array<Record<string, unknown>> = [];

  const { data: competitions } = await admin
    .from("competitions")
    .select("id, name, registration_deadline, winners_announce_date, winners_notified_at, certificates_notified_at")
    .not("registration_deadline", "is", null);

  const { data: refereesPool } = await admin
    .from("referees")
    .select("user_id")
    .eq("status", "approved")
    .not("user_id", "is", null);
  const refereeIds = [...new Set((refereesPool ?? []).map((r) => r.user_id as string))];

  const { data: organizerProfiles } = await admin
    .from("profiles")
    .select("user_id")
    .in("role", ["admin", "organizer", "staff"])
    .eq("approved", true);
  const organizerIds = (organizerProfiles ?? []).map((p) => p.user_id as string);

  const slotReport: Array<Record<string, unknown>> = [];
  for (const comp of competitions ?? []) {
    const deadlineMs = new Date(`${comp.registration_deadline}T00:00:00Z`).getTime();
    if (now < deadlineMs) continue;

    const { data: activeRegs } = await admin
      .from("registrations")
      .select("id")
      .eq("competition_id", comp.id)
      .eq("payment_status", "paid")
      .eq("slot_status", "active");
    const activeRegIds = (activeRegs ?? []).map((r) => r.id as string);
    if (activeRegIds.length === 0) continue;

    const { data: submittedVideos } = await admin
      .from("kata_videos")
      .select("registration_id")
      .in("registration_id", activeRegIds);
    const submittedRegIds = new Set((submittedVideos ?? []).map((v) => v.registration_id as string));
    const missingRegIds = activeRegIds.filter((id) => !submittedRegIds.has(id));

    for (const regId of missingRegIds) {
      const { error } = await admin
        .from("registrations")
        .update({
          slot_status: "unslotted",
          slot_status_note: "Auto-unslotted — recording not submitted by the competition deadline; payment forfeited.",
          slot_status_changed_by: null,
          slot_status_changed_at: new Date().toISOString(),
          payment_status: "forfeited",
        })
        .eq("id", regId);
      if (error) continue;
      await writeAudit(admin, {
        table_name: "registrations",
        record_id: regId,
        action: "slot_auto_unslotted_forfeited",
        new_value: { competition: comp.name },
        actor_id: null,
      });
      slotReport.push({ competition: comp.name, registration_id: regId, stage: "auto-unslotted-forfeited" });
    }
  }

  const { data: allAssignments } = await admin
    .from("referee_assignments")
    .select("id, video_id, referee_user_id, created_at");
  const { data: allScores } = await admin.from("video_scores").select("video_id, referee_user_id");
  const scored = new Set((allScores ?? []).map((s) => `${s.video_id}:${s.referee_user_id}`));
  const loadByReferee = new Map<string, number>();
  for (const a of allAssignments ?? []) {
    loadByReferee.set(a.referee_user_id, (loadByReferee.get(a.referee_user_id) ?? 0) + 1);
  }

  for (const comp of competitions ?? []) {
    const deadlineMs = new Date(`${comp.registration_deadline}T00:00:00Z`).getTime();
    const reassignAfter = deadlineMs + 14 * DAY_MS; // end of week 2
    const takeoverAfter = deadlineMs + 21 * DAY_MS; // re-assigned judge's 1 week is up
    if (now < reassignAfter) continue;

    const { data: regs } = await admin.from("registrations").select("id").eq("competition_id", comp.id);
    const regIds = (regs ?? []).map((r) => r.id as string);
    if (regIds.length === 0) continue;
    const { data: videos } = await admin.from("kata_videos").select("id").in("registration_id", regIds);
    const videoIds = new Set((videos ?? []).map((v) => v.id as string));

    for (const a of allAssignments ?? []) {
      if (!videoIds.has(a.video_id)) continue;
      if (scored.has(`${a.video_id}:${a.referee_user_id}`)) continue;
      const assignedMs = new Date(a.created_at).getTime();
      const isOrganizer = organizerIds.includes(a.referee_user_id);
      if (isOrganizer) continue; // already in the organizer-takeover stage

      const alreadyAssigned = new Set(
        (allAssignments ?? []).filter((x) => x.video_id === a.video_id).map((x) => x.referee_user_id),
      );

      // Week 3+: hand to the organizer if the current (re-)assignment has
      // itself had a week; week 2+: re-assign original slow assignments.
      const escalateToOrganizer = now >= takeoverAfter && now - assignedMs >= 7 * DAY_MS;
      const shouldReassign = now - assignedMs >= 14 * DAY_MS;
      if (!escalateToOrganizer && !shouldReassign) continue;

      const pool = escalateToOrganizer
        ? organizerIds.filter((id) => !alreadyAssigned.has(id))
        : refereeIds.filter((id) => id !== a.referee_user_id && !alreadyAssigned.has(id));
      const fallback = escalateToOrganizer
        ? refereeIds.filter((id) => id !== a.referee_user_id && !alreadyAssigned.has(id))
        : organizerIds.filter((id) => !alreadyAssigned.has(id));
      const candidates = pool.length > 0 ? pool : fallback;
      if (candidates.length === 0) continue;
      const pick = candidates.reduce((best, id) =>
        (loadByReferee.get(id) ?? 0) < (loadByReferee.get(best) ?? 0) ? id : best,
      );

      const { error: delErr } = await admin.from("referee_assignments").delete().eq("id", a.id);
      if (delErr) continue;
      const { error: insErr } = await admin
        .from("referee_assignments")
        .insert({ video_id: a.video_id, referee_user_id: pick });
      if (insErr) continue;
      loadByReferee.set(pick, (loadByReferee.get(pick) ?? 0) + 1);
      scored.delete(`${a.video_id}:${a.referee_user_id}`);

      await writeAudit(admin, {
        table_name: "referee_assignments",
        record_id: a.video_id,
        action: escalateToOrganizer ? "judging_timeline_organizer_takeover" : "judging_timeline_reassigned",
        new_value: { competition: comp.name, from: a.referee_user_id, to: pick },
        actor_id: null,
      });
      try {
        const [{ data: newProfile }, { data: oldProfile }, { data: video }] = await Promise.all([
          admin.from("profiles").select("email, full_name, telegram_chat_id").eq("user_id", pick).maybeSingle(),
          admin
            .from("profiles")
            .select("email, full_name, telegram_chat_id")
            .eq("user_id", a.referee_user_id)
            .maybeSingle(),
          admin
            .from("kata_videos")
            .select("participant:participants(full_name), registration:registrations(category:categories(name))")
            .eq("id", a.video_id)
            .maybeSingle(),
        ]);
        const v = video as unknown as {
          participant: { full_name: string } | null;
          registration: { category: { name: string } | null } | null;
        } | null;
        const participantName = v?.participant?.full_name ?? "a participant";
        const categoryName = v?.registration?.category?.name ?? null;
        const reason = escalateToOrganizer
          ? "This recording was handed to the organizer after the extended judging window passed."
          : "This recording was reassigned to another judge after the judging deadline passed.";
        await Promise.allSettled([
          notifyRefereeAssignment({
            refereeEmail: newProfile?.email ?? null,
            refereeName: newProfile?.full_name ?? null,
            refereeTelegramChatId: newProfile?.telegram_chat_id ?? null,
            participantName,
            categoryName,
          }),
          notifyRefereeUnassigned({
            refereeEmail: oldProfile?.email ?? null,
            refereeName: oldProfile?.full_name ?? null,
            refereeTelegramChatId: oldProfile?.telegram_chat_id ?? null,
            participantName,
            categoryName,
            reason,
          }),
        ]);
      } catch {
        // Notification is best-effort — the reassignment itself already stands.
      }
      report.push({
        competition: comp.name,
        video_id: a.video_id,
        stage: escalateToOrganizer ? "organizer-takeover" : "reassigned",
        from: a.referee_user_id,
        to: pick,
      });
    }
  }

  const winnerNotices: Array<Record<string, unknown>> = [];
  const certificateNotices: Array<Record<string, unknown>> = [];
  for (const comp of competitions ?? []) {
    if (!winnersRevealed(comp.registration_deadline, comp.winners_announce_date)) continue;

    if (!comp.winners_notified_at) {
      await notifyWinnersAnnounced(comp.name);
      await admin.from("competitions").update({ winners_notified_at: new Date().toISOString() }).eq("id", comp.id);
      await writeAudit(admin, {
        table_name: "competitions",
        record_id: comp.id,
        action: "winners_announced_notified",
        new_value: { name: comp.name },
        actor_id: null,
      });
      winnerNotices.push({ competition: comp.name });
    }

    // Independent guard from winners_notified_at above — a different
    // message (see lib/notify.ts's notifyCertificatesPublished), so it
    // fires exactly once regardless of whether the manual "Publish All
    // Certificates" button (publishWinnersNow in app/actions/admin.ts)
    // already sent it for this competition.
    if (!comp.certificates_notified_at) {
      try {
        const recipients = await competitionCertificateRecipients(comp.id);
        await notifyCertificatesPublished(comp.name, recipients);
        await admin.from("competitions").update({ certificates_notified_at: new Date().toISOString() }).eq("id", comp.id);
        await writeAudit(admin, {
          table_name: "competitions",
          record_id: comp.id,
          action: "certificates_published_notified",
          new_value: { name: comp.name },
          actor_id: null,
        });
        certificateNotices.push({ competition: comp.name });
      } catch {
        // Best-effort — the winners reveal itself already stands regardless.
      }
    }
  }

  // Telegram welcome DM — same-day best-effort: any paid registration at
  // least 1 hour old whose participant has since connected Telegram (email
  // match, same rule as everywhere else in this app) gets a one-time
  // confirmation DM. Runs once a day alongside everything else above, so
  // this can land anywhere from ~1 hour up to ~24 hours after registration
  // depending on when they signed up relative to this run.
  const telegramWelcomeNotices: Array<Record<string, unknown>> = [];
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const { data: dueRegistrations } = await admin
    .from("registrations")
    .select("id, participant:participants(full_name, email)")
    .eq("payment_status", "paid")
    .is("telegram_welcome_sent_at", null)
    .lte("created_at", oneHourAgo);
  const dueList =
    (dueRegistrations as unknown as Array<{
      id: string;
      participant: { full_name: string; email: string | null } | null;
    }>) ?? [];
  const dueEmails = [
    ...new Set(dueList.map((r) => r.participant?.email?.toLowerCase()).filter((e): e is string => !!e)),
  ];
  const { data: connectedProfiles } =
    dueEmails.length > 0
      ? await admin.from("profiles").select("email, telegram_chat_id").not("telegram_chat_id", "is", null)
      : { data: [] };
  const chatIdByEmail = new Map(
    (connectedProfiles ?? [])
      .filter((p) => p.email && dueEmails.includes((p.email as string).toLowerCase()))
      .map((p) => [(p.email as string).toLowerCase(), p.telegram_chat_id as string]),
  );
  for (const reg of dueList) {
    const email = reg.participant?.email?.toLowerCase();
    const chatId = email ? chatIdByEmail.get(email) : undefined;
    if (!chatId) continue;
    await notifyParticipantTelegramWelcome(chatId, reg.participant?.full_name ?? "there");
    await admin.from("registrations").update({ telegram_welcome_sent_at: new Date().toISOString() }).eq("id", reg.id);
    telegramWelcomeNotices.push({ registration_id: reg.id });
  }

  return NextResponse.json({
    ok: true,
    changed: report.length + slotReport.length,
    report,
    slotReport,
    winnerNotices,
    certificateNotices,
    telegramWelcomeNotices,
  });
}
