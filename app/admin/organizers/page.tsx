import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { updateCommunityStatus, createStaffAccount, bulkUploadOrganizers } from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import InvitationCodeForm from "@/components/InvitationCodeForm";

export const dynamic = "force-dynamic";

interface StaffApp {
  id: string; full_name: string; email: string | null; phone: string | null;
  role_requested: string; message: string | null; status: string; created_at: string;
}

export default async function AdminOrganizers({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Admin / Organizer" active="/admin/organizers">
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
  const isSuperAdmin = myProfile?.role === "admin";

  const { data: apps } = await supabase
    .from("staff_applications")
    .select("*")
    .in("role_requested", ["admin", "organizer"])
    .order("created_at", { ascending: false });
  const applications = (apps as StaffApp[]) ?? [];

  return (
    <AdminShell title="Admin / Organizer" active="/admin/organizers" flash={{ ok: params.ok, error: params.error }}>
      {isSuperAdmin ? (
        <div className="mb-8">
          <div className="mb-6">
            <CsvUploadForm
              action={bulkUploadOrganizers}
              templateHref="/organizers-template.csv"
              entityLabel="account"
              note="Each row creates a real login instantly and emails a temporary password — max 200 rows per upload."
            />
          </div>
          <h2 className="mb-3 text-lg font-bold">Create An Admin / Organizer Account</h2>
          <Card>
            <form action={createStaffAccount} className="space-y-4">
              <input type="hidden" name="role" value="organizer" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="org_full_name" className={adminLabel}>Full name *</label>
                  <input id="org_full_name" name="full_name" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="org_email" className={adminLabel}>Email *</label>
                  <input id="org_email" name="email" type="email" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="org_ic_passport" className={adminLabel}>IC / Passport *</label>
                  <input id="org_ic_passport" name="ic_passport" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="org_date_of_birth" className={adminLabel}>Date of birth *</label>
                  <input id="org_date_of_birth" name="date_of_birth" type="date" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="org_gender" className={adminLabel}>Gender *</label>
                  <select id="org_gender" name="gender" required defaultValue="" className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="org_belt_rank" className={adminLabel}>Belt rank (if applicable)</label>
                  <input id="org_belt_rank" name="belt_rank" className={adminInput} placeholder="e.g. 3rd Kyu" />
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-1 text-xs text-neutral-400">Latest rank certificate (if applicable)</p>
                  <CertificateField />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="org_home_address" className={adminLabel}>Home address *</label>
                  <input id="org_home_address" name="home_address" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="org_city_town" className={adminLabel}>City / Town *</label>
                  <input id="org_city_town" name="city_town" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="org_postcode" className={adminLabel}>Postcode *</label>
                  <input id="org_postcode" name="postcode" required className={adminInput} placeholder="e.g. 50000" />
                </div>
                <div>
                  <label htmlFor="org_country" className={adminLabel}>Country *</label>
                  <input id="org_country" name="country" required defaultValue="Malaysia" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="org_phone" className={adminLabel}>Mobile phone *</label>
                  <input id="org_phone" name="phone" type="tel" required className={adminInput} placeholder="+60…" />
                </div>
                <div>
                  <label htmlFor="org_invitation_code" className={adminLabel}>Invitation code (optional)</label>
                  <input id="org_invitation_code" name="invitation_code" className={adminInput} />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details *</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="org_bank_name" className={adminLabel}>Bank name *</label>
                    <input id="org_bank_name" name="bank_name" required className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="org_bank_account_no" className={adminLabel}>Account no. *</label>
                    <input id="org_bank_account_no" name="bank_account_no" required className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="org_bank_account_name" className={adminLabel}>Account holder name *</label>
                    <input id="org_bank_account_name" name="bank_account_name" required className={adminInput} />
                  </div>
                </div>
              </div>
              <div>
                <button type="submit" className={adminBtn}>Create Organizer account</button>
                <p className="mt-2 text-xs text-neutral-400">
                  Creates a real login instantly (no application or approval step) and emails them a
                  temporary password. Only the Super Admin can create Organizer accounts.
                </p>
              </div>
            </form>
          </Card>
        </div>
      ) : (
        <p className="mb-8 text-sm text-neutral-500">
          Only the Super Admin can create new Admin / Organizer accounts directly.
        </p>
      )}

      <h2 className="mb-3 text-lg font-bold">Admin / Organizer Applications</h2>
      {applications.length === 0 ? (
        <EmptyState>No applications yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="organizer-applications"
          columns={[
            { key: "reference_id", label: "Reference ID" },
            { key: "full_name", label: "Name" },
            { key: "contact", label: "Contact" },
            { key: "role_requested", label: "Role requested" },
            { key: "message", label: "Message" },
            { key: "status", label: "Status" },
          ]}
          csvColumns={[
            { key: "reference_id", label: "Reference ID" },
            { key: "full_name", label: "Name" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "role_requested", label: "Role requested" },
            { key: "message", label: "Message" },
            { key: "status_text", label: "Status" },
          ]}
          rows={applications.map((s) => ({
            id: s.id,
            reference_id: s.id.slice(0, 8).toUpperCase(),
            full_name: s.full_name,
            contact: [s.email, s.phone].filter(Boolean).join(" · "),
            email: s.email ?? "",
            phone: s.phone ?? "",
            role_requested: s.role_requested.replace("_", " "),
            message: s.message ?? "",
            status_text: s.status,
            status: (
              <div className="flex flex-wrap gap-1">
                {["pending", "approved", "rejected"].map((o) => (
                  <form key={o} action={updateCommunityStatus}>
                    <input type="hidden" name="table" value="staff_applications" />
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="field" value="status" />
                    <input type="hidden" name="value" value={o} />
                    <input type="hidden" name="return_to" value="/admin/organizers" />
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
        Approving an application here does not create a login by itself — use the &quot;Create an Admin /
        Organizer account&quot; form above (Super Admin only) to actually grant access.
      </p>
      {isSuperAdmin && (
        <div className="mt-8">
          <InvitationCodeForm
            role="organizer"
            returnTo="/admin/organizers"
            title="Admin / Organizer Invitation Code"
            idPrefix="org_code"
          />
        </div>
      )}
    </AdminShell>
  );
}
