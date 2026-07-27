import Link from "next/link";
import { getAuditLogsPage } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { AdminShell, adminBtn, adminBtnSecondary } from "@/components/admin";
import { EmptyState, SetupNotice, formatDateTime } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AdminActivityLog({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; offset?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Full Activity Log" active="/admin/activity">
        <SetupNotice />
      </AdminShell>
    );
  }

  const offset = Math.max(0, Number(params.offset ?? 0) || 0);
  const { rows: logs, total } = await getAuditLogsPage({
    limit: PAGE_SIZE,
    offset,
    from: params.from,
    to: params.to,
  });

  // "Who did it" column — resolve each audit row's actor to their signed-in
  // name and email address, same pattern as the Dashboard's preview.
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

  const pageHref = (o: number) => {
    const sp = new URLSearchParams();
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    sp.set("offset", String(o));
    return `/admin/activity?${sp.toString()}`;
  };

  const hasFilter = !!(params.from || params.to);

  return (
    <AdminShell title="Full Activity Log" active="/admin/activity">
      <p className="mb-4 text-sm text-neutral-500">
        Every admin action, {PAGE_SIZE} at a time — narrow the date range below or page through with
        Previous/Next to see more, instead of loading the entire history at once.
      </p>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <div>
          <label htmlFor="from" className="mb-1 block text-xs font-medium text-neutral-600">From</label>
          <input
            id="from" type="date" name="from" defaultValue={params.from ?? ""}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-xs font-medium text-neutral-600">To</label>
          <input
            id="to" type="date" name="to" defaultValue={params.to ?? ""}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          />
        </div>
        <button type="submit" className={adminBtn}>Load</button>
        {hasFilter && (
          <Link href="/admin/activity" className="text-xs text-neutral-500 underline underline-offset-2">
            Clear date range
          </Link>
        )}
      </form>

      {logs.length === 0 ? (
        <EmptyState>No audit log entries{hasFilter ? " in this date range" : ""} yet.</EmptyState>
      ) : (
        <>
          <FilterableTable
            rowKey="id"
            downloadName="activity-log"
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
              when: formatDateTime(l.created_at),
              by: l.actor_id ? (actorLabel.get(l.actor_id) ?? l.actor_id.slice(0, 8)) : "System / public",
              table: l.table_name,
              record: l.record_id?.slice(0, 8) ?? "—",
            }))}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500">
            <span>
              Showing {offset + 1}–{offset + logs.length} of {total}
            </span>
            <div className="flex gap-2">
              {offset > 0 && (
                <Link href={pageHref(Math.max(0, offset - PAGE_SIZE))} className={adminBtnSecondary}>
                  ← Previous
                </Link>
              )}
              {offset + PAGE_SIZE < total && (
                <Link href={pageHref(offset + PAGE_SIZE)} className={adminBtnSecondary}>
                  Next →
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
