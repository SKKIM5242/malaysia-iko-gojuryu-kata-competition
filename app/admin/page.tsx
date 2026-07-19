import Link from "next/link";
import { getAdminCounts, getRecentAuditLogs } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import { AdminShell, Card } from "@/components/admin";
import { SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Dashboard" active="/admin">
        <SetupNotice />
      </AdminShell>
    );
  }

  const [counts, logs] = await Promise.all([getAdminCounts(), getRecentAuditLogs(10)]);

  // "Who did it" column — resolve each audit row's actor to their signed-in
  // name and email address.
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter((id): id is string => !!id))];
  const { data: actorProfiles } =
    actorIds.length > 0
      ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", actorIds)
      : { data: [] };
  const actorLabel = new Map(
    (actorProfiles ?? []).map((p) => [
      p.user_id as string,
      [p.full_name, p.email].filter(Boolean).join(" — ") || (p.user_id as string).slice(0, 8),
    ]),
  );

  const stats: Array<[string, number, string]> = [
    ["Pending payments", counts.registrations.pending, "/admin/registrations?status=pending"],
    ["Paid registrations", counts.registrations.paid, "/admin/registrations?status=paid"],
    ["Rejected", counts.registrations.rejected, "/admin/registrations?status=rejected"],
    ["Total registrations", counts.registrations.total, "/admin/registrations"],
    ["Participants", counts.participants, "/admin/participants"],
    ["Referees / Judges", counts.referees, "/admin/referees"],
    ["Audience / Spectators", counts.audiences, "/admin/audience"],
    ["Schools", counts.schools, "/admin/schools"],
    ["Senseis", counts.senseis, "/admin/senseis"],
    ["Admin / Organizer applications", counts.staffApplications.organizer, "/admin/organizers"],
    ["Participant Support applications", counts.staffApplications.customerSupport, "/admin/support"],
    ["Announcements", counts.announcements, "/admin/announcements"],
  ];

  return (
    <AdminShell title="Dashboard" active="/admin">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, href]) => (
          <Link key={label} href={href}>
            <Card>
              <p className="text-3xl font-bold text-neutral-900">{value}</p>
              <p className="mt-1 text-sm text-neutral-500">{label}</p>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mt-10 mb-3 text-lg font-bold">Recent Activity</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-neutral-500">No audit log entries yet.</p>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="recent-activity"
          columns={[
            { key: "when", label: "When" },
            { key: "action", label: "Action" },
            { key: "by", label: "By (Name — Email)" },
            { key: "table", label: "Table" },
            { key: "record", label: "Record" },
          ]}
          rows={logs.map((l) => ({
            id: l.id,
            action: l.action,
            when: new Date(l.created_at).toLocaleString("en-MY"),
            by: l.actor_id ? (actorLabel.get(l.actor_id) ?? l.actor_id.slice(0, 8)) : "System / public",
            table: l.table_name,
            record: l.record_id?.slice(0, 8) ?? "—",
          }))}
        />
      )}
    </AdminShell>
  );
}
