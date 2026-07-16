import Link from "next/link";
import { getSchools, schemaReady } from "@/lib/data";
import { saveSchool, deleteSchool, createInvitationCode, bulkUploadSchools } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";

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
        <CsvUploadForm
          action={bulkUploadSchools}
          templateHref="/schools-template.csv"
          entityLabel="school"
        />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit school" : "Add school"}</h2>
          <Card>
            {!editing && (
              <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  School / Dojo invitation code
                </p>
                <form action={createInvitationCode} className="mt-2 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="role" value="school" />
                  <input type="hidden" name="return_to" value="/admin/schools" />
                  <div>
                    <label htmlFor="school_code_note" className={adminLabel}>Note (optional)</label>
                    <input id="school_code_note" name="note" className={adminInput} placeholder="e.g. Regional dojos" />
                  </div>
                  <button type="submit" className={adminBtnSecondary}>Generate unlimited-use code</button>
                </form>
                <p className="mt-1 text-xs text-neutral-400">
                  Shared with Senseis / Coaches too. Manage or revoke codes in Admin → Accounts → Invitation codes.
                </p>
              </div>
            )}
            <form action={saveSchool} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="name" className={adminLabel}>Dojo / club name *</label>
                <input id="name" name="name" required defaultValue={editing?.name ?? ""} className={adminInput} />
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-700">Person in-charge / Chief Instructor</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="contact_title" className={adminLabel}>Title *</label>
                    <select id="contact_title" name="contact_title" required defaultValue={editing?.contact_title ?? ""} className={adminInput}>
                      <option value="" disabled>Select</option>
                      <option value="Mr.">Mr.</option>
                      <option value="Ms.">Ms.</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="contact_name" className={adminLabel}>Name *</label>
                    <input id="contact_name" name="contact_name" required defaultValue={editing?.contact_name ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="contact_karate_title" className={adminLabel}>Karate title *</label>
                    <select id="contact_karate_title" name="contact_karate_title" required defaultValue={editing?.contact_karate_title ?? ""} className={adminInput}>
                      <option value="" disabled>Select</option>
                      <option value="Hanshi">Hanshi</option>
                      <option value="Shihan">Shihan</option>
                      <option value="Sensei">Sensei</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="contact_rank" className={adminLabel}>Rank in karate-do *</label>
                    <input id="contact_rank" name="contact_rank" required defaultValue={editing?.contact_rank ?? ""} className={adminInput} placeholder="e.g. Godan" />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>School/dojo/club address *</label>
                  <input id="home_address" name="home_address" required defaultValue={editing?.home_address ?? ""} className={adminInput} />
                </div>
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
                  <label htmlFor="city_town" className={adminLabel}>City / Town *</label>
                  <input id="city_town" name="city_town" required defaultValue={editing?.city_town ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="postcode" className={adminLabel}>Postcode *</label>
                  <input id="postcode" name="postcode" required defaultValue={editing?.postcode ?? ""} className={adminInput} placeholder="e.g. 50000" />
                </div>
                <div>
                  <label htmlFor="home_country" className={adminLabel}>Country *</label>
                  <input id="home_country" name="home_country" required defaultValue={editing?.home_country ?? (editing ? "" : "Malaysia")} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="email" className={adminLabel}>Email address *</label>
                  <input id="email" name="email" type="email" required defaultValue={editing?.email ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="phone" className={adminLabel}>Mobile phone *</label>
                  <input id="phone" name="phone" type="tel" required defaultValue={editing?.phone ?? ""} className={adminInput} placeholder="+60…" />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details *</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="bank_name" className={adminLabel}>Bank name *</label>
                    <input id="bank_name" name="bank_name" required defaultValue={editing?.bank_name ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="bank_account_no" className={adminLabel}>Account no. *</label>
                    <input id="bank_account_no" name="bank_account_no" required defaultValue={editing?.bank_account_no ?? ""} className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="bank_account_name" className={adminLabel}>Account holder name *</label>
                    <input id="bank_account_name" name="bank_account_name" required defaultValue={editing?.bank_account_name ?? ""} className={adminInput} />
                  </div>
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
            <FilterableTable
              rowKey="id"
              downloadName="schools"
              columns={[
                { key: "name", label: "Name" },
                { key: "state", label: "State" },
                { key: "person_in_charge", label: "Person in-charge" },
                { key: "location", label: "Location" },
                { key: "contact", label: "Contact" },
                { key: "bank", label: "Bank" },
                { key: "actions", label: "Actions" },
              ]}
              rows={schools.map((s) => ({
                id: s.id,
                name: s.name,
                state: s.state ?? "",
                person_in_charge: [s.contact_title, s.contact_name].filter(Boolean).join(" ") +
                  (s.contact_karate_title ? ` (${s.contact_karate_title}${s.contact_rank ? ` — ${s.contact_rank}` : ""})` : ""),
                location: [s.home_address, s.city_town, s.postcode, s.home_country].filter(Boolean).join(", "),
                contact: [s.email, s.phone].filter(Boolean).join(" · "),
                bank: [s.bank_name, s.bank_account_no, s.bank_account_name].filter(Boolean).join(" · "),
                actions: (
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
                ),
              }))}
            />
          )}
        </div>
      </div>
    </AdminShell>
  );
}
