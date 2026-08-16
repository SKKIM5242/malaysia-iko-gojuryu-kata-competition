import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { SetupNotice } from "@/components/ui";
import IssueReportRow, {
  type IssueMessageView,
  type TelegramGroupChoice,
} from "@/components/IssueReportRow";
import {
  listTelegramGroups,
  telegramCategoryForRole,
  telegramGroupChatId,
} from "@/lib/telegram";
import {
  ISSUE_REPORT_NOTE,
  issueTypeLabel,
  screenSpecLabel,
  statusLabel,
  viewTypeLabel,
} from "@/lib/issue-reports";

export const dynamic = "force-dynamic";

const STAFF_ROLES = ["admin", "organizer", "staff", "customer_support"];

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  in_progress: "bg-amber-100 text-amber-900",
  resolved: "bg-green-100 text-green-800",
  cannot_fix: "bg-neutral-200 text-neutral-700",
};

export default async function AdminIssueReports() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Issue Reports" active="/admin/issue-reports">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role, approved").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const canView =
    Boolean(myProfile?.approved) && STAFF_ROLES.includes((myProfile?.role as string) ?? "");

  if (!canView) {
    return (
      <AdminShell title="Issue Reports" active="/admin/issue-reports">
        <p className="text-sm text-neutral-500">You don&apos;t have access to this page.</p>
      </AdminShell>
    );
  }

  const admin = createAdminClient();
  const { data: reports } = await admin
    .from("issue_reports")
    .select("*")
    .order("created_at", { ascending: false });
  const rows = reports ?? [];

  // Staff pick a group by name; the chat id is derived from the member link
  // the organizer already maintains, so nobody has to paste a raw id.
  const groups: TelegramGroupChoice[] = (await listTelegramGroups()).map((g) => ({
    category: g.category,
    label: g.label,
    canSend: telegramGroupChatId(g.memberUrl) !== null,
  }));

  // Default the group picker to the one the REPORTER's own account sits in
  // — a participant's issue belongs in the Participants group, not
  // wherever the staff member happens to be.
  const reporterIds = rows
    .map((r) => r.reporter_user_id as string | null)
    .filter((id): id is string => Boolean(id));
  const { data: reporterProfiles } = reporterIds.length
    ? await admin.from("profiles").select("user_id, role").in("user_id", reporterIds)
    : { data: [] };
  const roleByUser = new Map(
    (reporterProfiles ?? []).map((p) => [p.user_id as string, (p.role as string | null) ?? null]),
  );

  const { data: allMessages } = rows.length
    ? await admin
        .from("issue_report_messages")
        .select("*")
        .in(
          "report_id",
          rows.map((r) => r.id as string),
        )
        .order("created_at", { ascending: false })
    : { data: [] };

  // One signed URL per screenshot, batched per report. The bucket is
  // private, so these are the only way to render the images here.
  const urlsByReport = new Map<string, string[]>();
  await Promise.all(
    rows.map(async (r) => {
      const paths = (r.screenshot_paths as string[] | null) ?? [];
      if (paths.length === 0) {
        urlsByReport.set(r.id as string, []);
        return;
      }
      const { data: signed } = await admin.storage.from("issue-screenshots").createSignedUrls(paths, 3600);
      urlsByReport.set(
        r.id as string,
        (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => Boolean(u)),
      );
    }),
  );

  const messagesByReport = new Map<string, IssueMessageView[]>();
  for (const m of allMessages ?? []) {
    const list = messagesByReport.get(m.report_id as string) ?? [];
    list.push({
      id: m.id as string,
      channel: m.channel as string,
      subject: (m.subject as string | null) ?? null,
      targetLabel: (m.target_label as string | null) ?? null,
      body: m.body as string,
      sentByName: (m.sent_by_name as string | null) ?? null,
      ok: Boolean(m.ok),
      error: (m.error as string | null) ?? null,
      createdAt: m.created_at as string,
    });
    messagesByReport.set(m.report_id as string, list);
  }

  return (
    <AdminShell title="Issue Reports" active="/admin/issue-reports">
      <div className="space-y-4">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {ISSUE_REPORT_NOTE}
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No issue reports have been filed yet.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.id as string} className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-neutral-900">{r.subject as string}</h3>
                    <p className="text-xs text-neutral-500">
                      {(r.reporter_name as string | null) ?? "Unknown"}
                      {r.reporter_email ? ` · ${r.reporter_email as string}` : ""} ·{" "}
                      {new Date(r.created_at as string).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                      STATUS_STYLES[r.status as string] ?? "bg-neutral-200 text-neutral-700"
                    }`}
                  >
                    {statusLabel(r.status as string)}
                  </span>
                </div>

                <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="inline font-semibold text-neutral-600">Type: </dt>
                    <dd className="inline text-neutral-800">{issueTypeLabel(r.issue_type as string)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-neutral-600">Page: </dt>
                    <dd className="inline text-neutral-800">{r.page as string}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-neutral-600">Section: </dt>
                    <dd className="inline text-neutral-800">{r.section as string}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-neutral-600">View: </dt>
                    <dd className="inline text-neutral-800">{viewTypeLabel(r.view_type as string)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-neutral-600">Device: </dt>
                    <dd className="inline text-neutral-800">{r.device_name as string}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="inline font-semibold text-neutral-600">Screen: </dt>
                    <dd className="inline text-neutral-800">
                      {screenSpecLabel(r.screen_spec as string, (r.screen_spec_other as string | null) ?? null)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3">
                  <IssueReportRow
                    report={{
                      id: r.id as string,
                      subject: r.subject as string,
                      status: r.status as string,
                      staffNotes: (r.staff_notes as string | null) ?? null,
                      reporterName: (r.reporter_name as string | null) ?? null,
                      reporterEmail: (r.reporter_email as string | null) ?? null,
                      expectedResult: r.expected_result as string,
                      whatWrong: r.what_wrong as string,
                    }}
                    messages={messagesByReport.get(r.id as string) ?? []}
                    screenshotUrls={urlsByReport.get(r.id as string) ?? []}
                    groups={groups}
                    defaultGroupCategory={telegramCategoryForRole(
                      roleByUser.get((r.reporter_user_id as string | null) ?? "") ?? null,
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
