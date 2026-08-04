"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_ISSUE_SCREENSHOTS,
  SCREEN_SPECS,
  STATUSES,
  VIEW_TYPES,
  viewTypeLabel,
  screenSpecLabel,
} from "@/lib/issue-reports";
import {
  notifyStaffIssueReport,
  sendAdminTelegramDM,
  sendTelegramGroupMessage,
  sendIssueReportEmail,
} from "@/lib/notify";

const STAFF_ROLES = ["admin", "organizer", "staff", "customer_support"];

export interface IssueActionState {
  ok?: string;
  error?: string;
}

async function requireStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, ok: false as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, approved, full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  const ok = Boolean(profile?.approved) && STAFF_ROLES.includes((profile?.role as string) ?? "");
  return { user, ok, name: (profile?.full_name as string | null) ?? user.email ?? "Staff" };
}

/** Files a participant's technical issue report. Screenshots are uploaded
 * to the reporter's own folder in the private issue-screenshots bucket
 * (matching the RLS policy), then the row records their paths in order. */
export async function submitIssueReport(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before submitting a report." };

  const text = (key: string) => (formData.get(key) as string | null)?.trim() ?? "";
  const subject = text("subject");
  const page = text("page");
  const section = text("section");
  const whatWrong = text("what_wrong");
  const viewType = text("view_type");
  const deviceName = text("device_name");
  const screenSpec = text("screen_spec");
  const screenSpecOther = text("screen_spec_other");
  const expectedResult = text("expected_result");

  // Every field on the form is required, so name the FIRST missing one
  // rather than a generic "fill in the form" — on a long form that's the
  // difference between fixing it in one pass and hunting.
  const required: Array<[string, string]> = [
    [subject, "Subject that needs fixing"],
    [page, "At which page"],
    [section, "At which section"],
    [whatWrong, "What is wrong on your device"],
    [viewType, "Type of view that has the issue"],
    [deviceName, "What device you are using"],
    [screenSpec, "Your screen specification"],
    [expectedResult, "What you expect the result to be after the fix"],
  ];
  const missing = required.find(([value]) => !value);
  if (missing) return { error: `Please fill in: ${missing[1]}.` };

  if (!VIEW_TYPES.includes(viewType as (typeof VIEW_TYPES)[number])) {
    return { error: "Please choose a valid type of view." };
  }
  if (!SCREEN_SPECS.includes(screenSpec)) {
    return { error: "Please choose a valid screen specification." };
  }
  if (screenSpec === "other" && !screenSpecOther) {
    return { error: "Please state your screen size (height × width), since your device isn't in the list." };
  }

  const files = formData
    .getAll("screenshots")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_ISSUE_SCREENSHOTS) {
    return { error: `Please attach at most ${MAX_ISSUE_SCREENSHOTS} screenshots (you attached ${files.length}).` };
  }

  const screenshotPaths: string[] = [];
  for (const [index, file] of files.entries()) {
    const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    // The leading auth.uid() folder is what the bucket's insert policy
    // checks, so this shape is load-bearing, not just tidy.
    const path = `${user.id}/${Date.now()}-${index}.${ext}`;
    const { error } = await supabase.storage
      .from("issue-screenshots")
      .upload(path, file, { contentType: file.type || "image/png", upsert: false });
    if (error) {
      return { error: `Could not upload screenshot ${index + 1}: ${error.message}` };
    }
    screenshotPaths.push(path);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", user.id)
    .maybeSingle();
  const reporterName = (profile?.full_name as string | null) || user.email || "Participant";

  const { data: inserted, error: insertError } = await supabase
    .from("issue_reports")
    .insert({
      reporter_user_id: user.id,
      reporter_email: (profile?.email as string | null) ?? user.email ?? null,
      reporter_name: reporterName,
      subject,
      page,
      section,
      what_wrong: whatWrong,
      view_type: viewType,
      device_name: deviceName,
      screen_spec: screenSpec,
      screen_spec_other: screenSpec === "other" ? screenSpecOther : null,
      expected_result: expectedResult,
      screenshot_paths: screenshotPaths,
    })
    .select("id")
    .single();

  if (insertError) return { error: `Could not save your report: ${insertError.message}` };

  // Deliberately after the insert and deliberately not awaited for its
  // result: the report is already safely saved, so a Telegram or email
  // outage must not turn a successful submission into an error message.
  await notifyStaffIssueReport({
    reportId: (inserted?.id as string) ?? "",
    reporterName,
    subject,
    page,
    section,
    viewTypeLabel: viewTypeLabel(viewType),
    deviceName,
    screenSpec: screenSpecLabel(screenSpec, screenSpecOther),
    screenshotCount: screenshotPaths.length,
  }).catch(() => {});

  revalidatePath("/account");
  revalidatePath("/admin/issue-reports");
  return {
    ok: "Thank you — your report has been sent to the Admin, Organizer and Participant Support team.",
  };
}

/** Staff triage: status and internal notes. */
export async function updateIssueReport(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const { ok } = await requireStaff();
  if (!ok) return { error: "You don't have permission to update issue reports." };

  const id = (formData.get("id") as string | null)?.trim();
  const status = (formData.get("status") as string | null)?.trim() ?? "";
  const staffNotes = (formData.get("staff_notes") as string | null)?.trim() ?? "";
  if (!id) return { error: "Missing report id." };
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return { error: "Please choose a valid status." };
  }

  const { error } = await createAdminClient()
    .from("issue_reports")
    .update({ status, staff_notes: staffNotes || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: `Could not save: ${error.message}` };

  revalidatePath("/admin/issue-reports");
  return { ok: "Saved." };
}

/** Sends a staff-composed message about a report on one channel, and
 * records it either way — a failed send stays visible in the history
 * with its error rather than disappearing. */
export async function sendIssueReportMessage(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const staff = await requireStaff();
  if (!staff.ok) return { error: "You don't have permission to send messages." };

  const reportId = (formData.get("report_id") as string | null)?.trim();
  const channel = (formData.get("channel") as string | null)?.trim() ?? "";
  const body = (formData.get("body") as string | null)?.trim() ?? "";
  const subject = (formData.get("subject") as string | null)?.trim() ?? "";
  const groupChatId = (formData.get("group_chat_id") as string | null)?.trim() ?? "";
  if (!reportId) return { error: "Missing report id." };
  if (!body) return { error: "Please write a message before sending." };
  if (!["telegram_dm", "telegram_group", "email"].includes(channel)) {
    return { error: "Unknown message channel." };
  }

  const admin = createAdminClient();
  const { data: report } = await admin
    .from("issue_reports")
    .select("reporter_user_id, reporter_email, subject")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { error: "That report no longer exists." };

  let result: { ok: boolean; error?: string };
  if (channel === "telegram_dm") {
    const { data: reporterProfile } = await admin
      .from("profiles")
      .select("telegram_chat_id")
      .eq("user_id", report.reporter_user_id as string)
      .maybeSingle();
    const chatId = (reporterProfile?.telegram_chat_id as string | null) ?? null;
    result = chatId
      ? await sendAdminTelegramDM(chatId, body)
      : { ok: false, error: "This participant hasn't connected Telegram, so a DM can't reach them." };
  } else if (channel === "telegram_group") {
    result = groupChatId
      ? await sendTelegramGroupMessage(groupChatId, body)
      : { ok: false, error: "Please enter the Telegram group chat id to notify." };
  } else {
    const to = (report.reporter_email as string | null) ?? "";
    result = to
      ? await sendIssueReportEmail(
          to,
          subject || `Re: ${(report.subject as string) ?? "your reported issue"}`,
          body,
        )
      : { ok: false, error: "This participant has no email address on file." };
  }

  await admin.from("issue_report_messages").insert({
    report_id: reportId,
    channel,
    subject: channel === "email" ? subject || null : null,
    body,
    sent_by: staff.user?.id ?? null,
    sent_by_name: staff.name ?? null,
    ok: result.ok,
    error: result.error ?? null,
  });

  revalidatePath("/admin/issue-reports");
  return result.ok ? { ok: "Message sent and saved." } : { error: result.error ?? "Could not send the message." };
}
