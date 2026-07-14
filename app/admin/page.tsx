import Link from "next/link";
import { getAdminCounts, getRecentAuditLogs } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import { AdminShell, Card } from "@/components/admin";
import { SetupNotice } from "@/components/ui";

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
    ["Customer Support applications", counts.staffApplications.customerSupport, "/admin/support"],
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

      <h2 className="mt-10 mb-3 text-lg font-bold">Recent activity</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-neutral-500">No audit log entries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Table</th>
                <th className="px-4 py-2.5">Record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-neutral-500">
                    {new Date(l.created_at).toLocaleString("en-MY")}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{l.action}</td>
                  <td className="px-4 py-2.5">{l.table_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-neutral-400">
                    {l.record_id?.slice(0, 8) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
