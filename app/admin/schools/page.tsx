import Link from "next/link";
import { getSchools, schemaReady } from "@/lib/data";
import { saveSchool, deleteSchool, createInvitationCode } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";

export const dynamic = "force-dynamic";

const MALAYSIAN_STATES = [
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka",
  "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang",
  "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu",
];

export default async function AdminSchools({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Schools" active="/admin/schools">
        <SetupNotice />
      </AdminShell>
    );
  }

  const schools = await getSchools();
  const editing = params.edit ? schools.find((s) => s.id === params.edit) : undefined;

  return (
    <AdminShell title="Schools" active="/admin/schools" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">School / Dojo invitation code</h2>
        <Card>
          <form action={createInvitationCode} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="role" value="school" />
            <input type="hidden" name="return_to" value="/admin/schools" />
            <div>
              <label htmlFor="school_code_note" className={adminLabel}>Note (optional)</label>
              <input id="school_code_note" name="note" className={adminInput} placeholder="e.g. Regional dojos" />
            </div>
            <button type="submit" className={adminBtn}>Generate unlimited-use code</button>
          </form>
          <p className="mt-2 text-xs text-neutral-400">
            Shared with Senseis / Coaches too. Manage or deactivate codes in Admin → Accounts → Invitation codes.
          </p>
        </Card>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit school" : "Add school"}</h2>
          <Card>
            <form action={saveSchool} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="name" className={adminLabel}>Dojo / club name *</label>
                <input id="name" name="name" required defaultValue={editing?.name ?? ""} className={adminInput} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="state" className={adminLabel}>State</label>
                  <select id="state" name="state" defaultValue={editing?.state ?? ""} className={adminInput}>
                    <option value="">— Select —</option>
                    {MALAYSIAN_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="affiliation_code" className={adminLabel}>IKO affiliation code</label>
                  <input id="affiliation_code" name="affiliation_code" defaultValue={editing?.affiliation_code ?? ""} className={adminInput} placeholder="e.g. IKO-MY-KL-001" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>Home address</label>
                  <input id="home_address" name="home_address" defaultValue={editing?.home_address ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="city_town" className={adminLabel}>City / Town</label>
                  <input id="city_town" name="city_town" defaultValue={editing?.city_town ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="home_country" className={adminLabel}>Home country</label>
                  <input id="home_country" name="home_country" defaultValue={editing?.home_country ?? (editing ? "" : "Malaysia")} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="email" className={adminLabel}>Email address</label>
                  <input id="email" name="email" type="email" defaultValue={editing?.email ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="phone" className={adminLabel}>Mobile phone</label>
                  <input id="phone" name="phone" type="tel" defaultValue={editing?.phone ?? ""} className={adminInput} placeholder="+60…" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add school"}</button>
                {editing && (
                  <Link href="/admin/schools" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">All schools</h2>
          {schools.length === 0 ? (
            <EmptyState>No schools yet — add one on the left.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {schools.map((s) => (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="max-w-[240px] truncate px-4 py-3 font-medium" title={s.name}>{s.name}</td>
                      <td className="px-4 py-3">{s.state ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.affiliation_code ?? "—"}</td>
                      <td className="px-4 py-3 text-xs" title={[s.home_address, s.city_town].filter(Boolean).join(", ") || undefined}>
                        {s.home_country ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {s.email ?? "—"}
                        {s.phone && <span className="block text-neutral-500">{s.phone}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <Link
                            href={`/admin/schools?edit=${s.id}`}
                            className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                          >
                            Edit
                          </Link>
                          <form action={deleteSchool}>
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
