import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { updateCommunityStatus, createStaffAccount, bulkUploadSupport } from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";

export const dynamic = "force-dynamic";

interface StaffApp {
  id: string; full_name: string; email: string | null; phone: string | null;
  role_requested: string; message: string | null; status: string; created_at: string;
}

export default async function AdminSupport({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Customer Support" active="/admin/support">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const canCreate = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");

  const { data: apps } = await supabase
    .from("staff_applications")
    .select("*")
    .eq("role_requested", "customer_support")
    .order("created_at", { ascending: false });
  const applications = (apps as StaffApp[]) ?? [];

  return (
    <AdminShell title="Customer Support" active="/admin/support" flash={{ ok: params.ok, error: params.error }}>
      {canCreate && (
        <div className="mb-8">
          <div className="mb-6">
            <CsvUploadForm
              action={bulkUploadSupport}
              templateHref="/support-template.csv"
              entityLabel="account"
              note="Each row creates a real login instantly and emails a temporary password — max 200 rows per upload."
            />
          </div>
          <h2 className="mb-3 text-lg font-bold">Create a Customer Support account</h2>
          <Card>
            <form action={createStaffAccount} className="space-y-4">
              <input type="hidden" name="role" value="customer_support" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cs_full_name" className={adminLabel}>Full name *</label>
                  <input id="cs_full_name" name="full_name" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_email" className={adminLabel}>Email *</label>
                  <input id="cs_email" name="email" type="email" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_ic_passport" className={adminLabel}>IC / Passport *</label>
                  <input id="cs_ic_passport" name="ic_passport" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_date_of_birth" className={adminLabel}>Date of birth</label>
                  <input id="cs_date_of_birth" name="date_of_birth" type="date" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_gender" className={adminLabel}>Gender</label>
                  <select id="cs_gender" name="gender" defaultValue="" className={adminInput}>
                    <option value="">— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cs_belt_rank" className={adminLabel}>Belt rank (if applicable)</label>
                  <input id="cs_belt_rank" name="belt_rank" className={adminInput} placeholder="e.g. 3rd Kyu" />
                </div>
                <div className="sm:col-span-2">
                  <CertificateField />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cs_home_address" className={adminLabel}>Home address</label>
                  <input id="cs_home_address" name="home_address" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_city_town" className={adminLabel}>City / Town</label>
                  <input id="cs_city_town" name="city_town" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_country" className={adminLabel}>Country</label>
                  <input id="cs_country" name="country" defaultValue="Malaysia" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_phone" className={adminLabel}>Mobile phone</label>
                  <input id="cs_phone" name="phone" type="tel" className={adminInput} placeholder="+60…" />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cs_bank_name" className={adminLabel}>Bank name</label>
                    <input id="cs_bank_name" name="bank_name" className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="cs_bank_account_no" className={adminLabel}>Account no.</label>
                    <input id="cs_bank_account_no" name="bank_account_no" className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="cs_bank_account_name" className={adminLabel}>Account holder name</label>
                    <input id="cs_bank_account_name" name="bank_account_name" className={adminInput} />
                  </div>
                </div>
              </div>
              <div>
                <button type="submit" className={adminBtn}>Create Customer Support account</button>
                <p className="mt-2 text-xs text-neutral-400">
                  Creates a real login instantly and emails them a temporary password. Customer Support
                  accounts can view/edit Registrations and Participants (no delete), generate invitation
                  codes, and merge categories on Competitions — nothing else.
                </p>
              </div>
            </form>
          </Card>
        </div>
      )}

      <h2 className="mb-3 text-lg font-bold">Customer Support applications</h2>
      {applications.length === 0 ? (
        <EmptyState>No applications yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="customer-support-applications"
          columns={[
            { key: "full_name", label: "Name" },
            { key: "contact", label: "Contact" },
            { key: "message", label: "Message" },
            { key: "status", label: "Status" },
          ]}
          rows={applications.map((s) => ({
            id: s.id,
            full_name: s.full_name,
            contact: [s.email, s.phone].filter(Boolean).join(" · "),
            message: s.message ?? "",
            status: (
              <div className="flex flex-wrap gap-1">
                {["pending", "approved", "rejected"].map((o) => (
                  <form key={o} action={updateCommunityStatus}>
                    <input type="hidden" name="table" value="staff_applications" />
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="field" value="status" />
                    <input type="hidden" name="value" value={o} />
                    <input type="hidden" name="return_to" value="/admin/support" />
                    <button
                      disabled={o === s.status}
                      className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
                        o === s.status
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      {o}
                    </button>
                  </form>
                ))}
              </div>
            ),
          }))}
        />
      )}
      <p className="mt-4 text-xs text-neutral-400">
        Approving an application here does not create a login by itself — use the &quot;Create a Customer
        Support account&quot; form above to actually grant access.
      </p>
    </AdminShell>
  );
}
