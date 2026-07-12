import Link from "next/link";
import { getAllParticipants } from "@/lib/admin-data";
import { getSchools, getSenseis, schemaReady } from "@/lib/data";
import { saveParticipant, deleteParticipant } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminParticipants({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Participants" active="/admin/participants">
        <SetupNotice />
      </AdminShell>
    );
  }

  const [participants, schools, senseis] = await Promise.all([
    getAllParticipants(),
    getSchools(),
    getSenseis(),
  ]);
  const editing = params.edit ? participants.find((p) => p.id === params.edit) : undefined;

  return (
    <AdminShell
      title="Participants"
      active="/admin/participants"
      flash={{ ok: params.ok, error: params.error }}
    >
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit participant" : "Add participant"}</h2>
          <Card>
            <form action={saveParticipant} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="full_name" className={adminLabel}>Full name *</label>
                <input id="full_name" name="full_name" required defaultValue={editing?.full_name ?? ""} className={adminInput} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ic_passport" className={adminLabel}>IC / Passport *</label>
                  <input id="ic_passport" name="ic_passport" required defaultValue={editing?.ic_passport ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="date_of_birth" className={adminLabel}>Date of birth</label>
                  <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={editing?.date_of_birth ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="gender" className={adminLabel}>Gender</label>
                  <select id="gender" name="gender" defaultValue={editing?.gender ?? ""} className={adminInput}>
                    <option value="">— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="belt_rank" className={adminLabel}>Belt rank</label>
                  <input id="belt_rank" name="belt_rank" defaultValue={editing?.belt_rank ?? ""} className={adminInput} placeholder="e.g. 3rd Kyu" />
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
                <div>
                  <label htmlFor="sensei_id" className={adminLabel}>Sensei</label>
                  <select id="sensei_id" name="sensei_id" defaultValue={editing?.sensei_id ?? ""} className={adminInput}>
                    <option value="">— None —</option>
                    {senseis.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Reward payout bank details
                </p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="bank_name" className={adminLabel}>Bank name</label>
                    <input id="bank_name" name="bank_name" defaultValue={editing?.bank?.bank_name ?? ""} className={adminInput} placeholder="e.g. Maybank" />
                  </div>
                  <div>
                    <label htmlFor="bank_account_no" className={adminLabel}>Account no.</label>
                    <input id="bank_account_no" name="bank_account_no" defaultValue={editing?.bank?.bank_account_no ?? ""} className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="bank_account_name" className={adminLabel}>Account holder name</label>
                    <input id="bank_account_name" name="bank_account_name" defaultValue={editing?.bank?.bank_account_name ?? ""} className={adminInput} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add participant"}</button>
                {editing && (
                  <Link href="/admin/participants" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <h2 className="mb-3 text-lg font-bold">All participants</h2>
          {participants.length === 0 ? (
            <EmptyState>No participants yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">IC / Passport</th>
                    <th className="px-4 py-3">DOB</th>
                    <th className="px-4 py-3">Belt</th>
                    <th className="px-4 py-3">School</th>
                    <th className="px-4 py-3">Payout bank</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {participants.map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium">{p.full_name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{p.ic_passport}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.date_of_birth)}</td>
                      <td className="px-4 py-3">{p.belt_rank ?? "—"}</td>
                      <td className="max-w-[180px] truncate px-4 py-3" title={p.school?.name ?? undefined}>
                        {p.school?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.bank ? (
                          <span title={p.bank.bank_account_name}>
                            {p.bank.bank_name}
                            <span className="block font-mono text-neutral-500">{p.bank.bank_account_no}</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <Link
                            href={`/admin/participants?edit=${p.id}`}
                            className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                          >
                            Edit
                          </Link>
                          <form action={deleteParticipant}>
                            <input type="hidden" name="id" value={p.id} />
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
