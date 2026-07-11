import Link from "next/link";
import { getSchools, getSenseis, schemaReady } from "@/lib/data";
import { saveSensei, deleteSensei } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminSenseis({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Senseis" active="/admin/senseis">
        <SetupNotice />
      </AdminShell>
    );
  }

  const [senseis, schools] = await Promise.all([getSenseis(), getSchools()]);
  const editing = params.edit ? senseis.find((s) => s.id === params.edit) : undefined;

  return (
    <AdminShell title="Senseis" active="/admin/senseis" flash={{ ok: params.ok, error: params.error }}>
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit sensei" : "Add sensei"}</h2>
          <Card>
            <form action={saveSensei} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="name" className={adminLabel}>Name *</label>
                <input id="name" name="name" required defaultValue={editing?.name ?? ""} className={adminInput} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="rank" className={adminLabel}>Rank</label>
                  <input id="rank" name="rank" defaultValue={editing?.rank ?? ""} className={adminInput} placeholder="e.g. Godan" />
                </div>
                <div>
                  <label htmlFor="school_id" className={adminLabel}>School</label>
                  <select id="school_id" name="school_id" defaultValue={editing?.school_id ?? ""} className={adminInput}>
                    <option value="">— None —</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add sensei"}</button>
                {editing && (
                  <Link href="/admin/senseis" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">All senseis</h2>
          {senseis.length === 0 ? (
            <EmptyState>No senseis yet — add one on the left.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">School</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {senseis.map((s) => (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium">{s.name}</td>
                      <td className="px-4 py-3">{s.rank ?? "—"}</td>
                      <td className="max-w-[220px] truncate px-4 py-3" title={s.school?.name ?? undefined}>
                        {s.school?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <Link
                            href={`/admin/senseis?edit=${s.id}`}
                            className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                          >
                            Edit
                          </Link>
                          <form action={deleteSensei}>
                            <input type="hidden" name="id" value={s.id} />
                            <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
