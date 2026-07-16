import Link from "next/link";
import { getSchools, getSenseis, schemaReady } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { saveSensei, deleteSensei, createInvitationCode, generateRecordInvitationCode, bulkUploadSenseis } from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";

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

  // Signed links (1h) for certificate photos in the private bucket
  const certPaths = senseis.map((s) => s.certificate_path).filter(Boolean) as string[];
  const certUrls = new Map<string, string>();
  if (certPaths.length > 0) {
    const supabase = await createClient();
    const { data: signed } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) certUrls.set(s.path, s.signedUrl);
    }
  }

  return (
    <AdminShell title="Senseis" active="/admin/senseis" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-8">
        <CsvUploadForm
          action={bulkUploadSenseis}
          templateHref="/senseis-template.csv"
          entityLabel="sensei"
          note="School name must match an existing school exactly. Certificates can't be uploaded via CSV — add one later via Edit."
        />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit sensei" : "Add sensei"}</h2>
          <Card>
            {!editing && (
              <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Sensei / Coach invitation code
                </p>
                <form action={createInvitationCode} className="mt-2 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="role" value="school" />
                  <input type="hidden" name="return_to" value="/admin/senseis" />
                  <div>
                    <label htmlFor="sensei_code_note" className={adminLabel}>Note (optional)</label>
                    <input id="sensei_code_note" name="note" className={adminInput} placeholder="e.g. Visiting instructors" />
                  </div>
                  <button type="submit" className={adminBtnSecondary}>Generate unlimited-use code</button>
                </form>
                <p className="mt-1 text-xs text-neutral-400">
                  Shared with Schools / Dojos too. Manage or revoke codes in Admin → Accounts → Invitation codes.
                </p>
              </div>
            )}
            {editing && (
              <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Personal invitation code for this sensei
                </p>
                <form action={generateRecordInvitationCode} className="mt-2">
                  <input type="hidden" name="role" value="sensei" />
                  <input type="hidden" name="id" value={editing.id} />
                  <input type="hidden" name="return_to" value="/admin/senseis" />
                  <button type="submit" className={adminBtnSecondary}>
                    {editing.invitation_code ? "Regenerate personal code" : "Generate personal code"}
                  </button>
                </form>
                <p className="mt-1 text-xs text-neutral-400">
                  {editing.invitation_code
                    ? `Current code: ${editing.invitation_code} — bound to ${editing.email}, single use.`
                    : `Single-use, bound only to ${editing.email || "this sensei's email"} — for signing in with this specific sensei's access, not a shared code.`}
                </p>
              </div>
            )}
            <form action={saveSensei} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="name" className={adminLabel}>Name *</label>
                <input id="name" name="name" required defaultValue={editing?.name ?? ""} className={adminInput} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ic_passport" className={adminLabel}>IC / Passport *</label>
                  <input id="ic_passport" name="ic_passport" required defaultValue={editing?.ic_passport ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="date_of_birth" className={adminLabel}>Date of birth *</label>
                  <input id="date_of_birth" name="date_of_birth" type="date" required defaultValue={editing?.date_of_birth ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="rank" className={adminLabel}>Rank *</label>
                  <input id="rank" name="rank" required defaultValue={editing?.rank ?? ""} className={adminInput} placeholder="e.g. Godan" />
                </div>
                <div>
                  <label htmlFor="gender" className={adminLabel}>Sex *</label>
                  <select id="gender" name="gender" required defaultValue={editing?.gender ?? ""} className={adminInput}>
                    <option value="" disabled>Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <CertificateField
                    required
                    currentUrl={editing?.certificate_path ? certUrls.get(editing.certificate_path) : undefined}
                  />
                </div>
                <div>
                  <label htmlFor="school_id" className={adminLabel}>School *</label>
                  <select id="school_id" name="school_id" required defaultValue={editing?.school_id ?? ""} className={adminInput}>
                    <option value="" disabled>Select school</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>Personal Home Address *</label>
                  <input id="home_address" name="home_address" required defaultValue={editing?.home_address ?? ""} className={adminInput} />
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
                  <label htmlFor="home_country" className={adminLabel}>Home country *</label>
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
                <div>
                  <label htmlFor="invitation_code" className={adminLabel}>Invitation code (optional)</label>
                  <input id="invitation_code" name="invitation_code" defaultValue={editing?.invitation_code ?? ""} className={adminInput} />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Personal Bank Details *</p>
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
            <FilterableTable
              rowKey="id"
              downloadName="senseis"
              columns={[
                { key: "reference_id", label: "Reference ID" },
                { key: "name", label: "Name" },
                { key: "ic_passport", label: "IC / Passport" },
                { key: "date_of_birth", label: "DOB" },
                { key: "rank", label: "Rank" },
                { key: "gender", label: "Sex" },
                { key: "certificate", label: "Certificate" },
                { key: "location", label: "Location" },
                { key: "contact", label: "Contact" },
                { key: "bank", label: "Payout Bank" },
                { key: "school", label: "School" },
                { key: "actions", label: "Actions" },
              ]}
              csvColumns={[
                { key: "reference_id", label: "Reference ID" },
                { key: "name", label: "Name" },
                { key: "ic_passport", label: "IC / Passport" },
                { key: "date_of_birth", label: "DOB" },
                { key: "rank", label: "Rank" },
                { key: "gender", label: "Sex" },
                { key: "home_address", label: "Home Address" },
                { key: "city_town", label: "City / Town" },
                { key: "postcode", label: "Postcode" },
                { key: "home_country", label: "Country" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "bank_name", label: "Bank Name" },
                { key: "bank_account_no", label: "Bank Account No" },
                { key: "bank_account_name", label: "Bank Account Holder Name" },
                { key: "school", label: "School" },
              ]}
              rows={senseis.map((s) => ({
                id: s.id,
                reference_id: s.id.slice(0, 8).toUpperCase(),
                name: s.name,
                ic_passport: s.ic_passport ?? "",
                date_of_birth: formatDate(s.date_of_birth),
                rank: s.rank ?? "",
                gender: s.gender ?? "",
                certificate:
                  s.certificate_path && certUrls.get(s.certificate_path) ? (
                    <a
                      href={certUrls.get(s.certificate_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-green-700 underline underline-offset-2"
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  ),
                location: [s.home_address, s.city_town, s.postcode, s.home_country].filter(Boolean).join(", "),
                contact: [s.email, s.phone].filter(Boolean).join(" · "),
                bank: [s.bank_name, s.bank_account_no, s.bank_account_name].filter(Boolean).join(" · "),
                home_address: s.home_address ?? "",
                city_town: s.city_town ?? "",
                postcode: s.postcode ?? "",
                home_country: s.home_country ?? "",
                email: s.email ?? "",
                phone: s.phone ?? "",
                bank_name: s.bank_name ?? "",
                bank_account_no: s.bank_account_no ?? "",
                bank_account_name: s.bank_account_name ?? "",
                school: s.school?.name ?? "",
                actions: (
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
                ),
              }))}
            />
          )}
        </div>
      </div>
    </AdminShell>
  );
}
