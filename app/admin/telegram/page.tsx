import { schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { SetupNotice, EmptyState } from "@/components/ui";
import { listTelegramGroups } from "@/lib/telegram";
import { saveTelegramGroup, deleteTelegramGroup } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

const RETURN_TO = "/admin/telegram";
const TEMPLATE = "64px minmax(100px,1fr) minmax(160px,1.6fr) minmax(220px,2.2fr) 128px";

export default async function AdminTelegramLinks({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Telegram Groups" active="/admin/telegram">
        <SetupNotice />
      </AdminShell>
    );
  }

  const groups = await listTelegramGroups();
  const cellInput = "w-full rounded-md border border-neutral-300 px-2 py-1 text-xs";
  const gridHeaderCell = "px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500";

  return (
    <AdminShell title="Telegram Groups" active="/admin/telegram" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-6 text-sm text-neutral-500">
        Every registration category&apos;s dedicated Telegram group in one place — add, edit, or
        delete groups directly here instead of changing a Vercel environment variable. Admin/
        Organizer/Staff accounts get full access here since they moderate or judge across the whole
        competition — participants only see their own category&apos;s group, from their{" "}
        <code className="rounded bg-neutral-100 px-1">/account</code> page.
      </p>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <div style={{ minWidth: 700 }}>
          <div
            className="grid items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2"
            style={{ gridTemplateColumns: TEMPLATE }}
          >
            <span className={gridHeaderCell}>Order</span>
            <span className={gridHeaderCell}>Category</span>
            <span className={gridHeaderCell}>Label</span>
            <span className={gridHeaderCell}>Invite link</span>
            <span className={gridHeaderCell}>Actions</span>
          </div>

          <form
            action={saveTelegramGroup}
            className="grid items-center gap-2 border-b border-neutral-100 px-3 py-2"
            style={{ gridTemplateColumns: TEMPLATE }}
          >
            <input type="hidden" name="return_to" value={RETURN_TO} />
            <input name="sort_order" type="number" placeholder="No." className={cellInput} />
            <input name="category" required placeholder="e.g. sponsor" className={cellInput} />
            <input name="label" required placeholder="Display label *" className={cellInput} />
            <input name="url" required type="url" placeholder="https://t.me/+... *" className={cellInput} />
            <button className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-semibold text-white hover:bg-neutral-700">
              Add group
            </button>
          </form>

          <div className="divide-y divide-neutral-100">
            {groups.map((g) => (
              <form
                key={g.id}
                action={saveTelegramGroup}
                className="grid items-center gap-2 px-3 py-2"
                style={{ gridTemplateColumns: TEMPLATE }}
              >
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="category" value={g.category} />
                <input type="hidden" name="return_to" value={RETURN_TO} />
                <input name="sort_order" type="number" defaultValue={g.sortOrder} className={cellInput} />
                <span
                  className="truncate rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] text-neutral-500"
                  title={g.category}
                >
                  {g.category}
                </span>
                <input name="label" required defaultValue={g.label} className={cellInput} />
                <input name="url" required type="url" defaultValue={g.url} className={cellInput} />
                <span className="flex gap-1.5">
                  <button className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                    Save
                  </button>
                  <button
                    formAction={deleteTelegramGroup}
                    className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </span>
              </form>
            ))}
          </div>
        </div>
      </div>
      {groups.length === 0 && <EmptyState>No Telegram groups yet — add one above.</EmptyState>}
    </AdminShell>
  );
}
