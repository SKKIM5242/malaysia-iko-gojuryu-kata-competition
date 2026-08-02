import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions, getStaffAccountRecords } from "@/lib/admin-data";
import { updateCommunityStatus, createStaffAccount, deleteStaffAccount, bulkUploadOrganizers } from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
import InvitationCodeRunField from "@/components/InvitationCodeRunField";
import StaffAccountEditForm from "@/components/StaffAccountEditForm";
import { NoCommaInput } from "@/components/NoCommaAddressField";
import DateOfBirthField from "@/components/DateOfBirthField";
import IbanInput from "@/components/IbanInput";
import IbanConfirmCheckbox from "@/components/IbanConfirmCheckbox";
import BankDetailsNote from "@/components/BankDetailsNote";
import BankAccountNameField from "@/components/BankAccountNameField";
import { IBAN_CSV_NOTE } from "@/lib/bank";

export const dynamic = "force-dynamic";

interface StaffApp {
  id: string; full_name: string; email: string | null; phone: string | null;
  role_requested: string; message: string | null; status: string; created_at: string;
}

export default async function AdminOrganizers({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; editcode?: string; ok?: string; error?: string }>;
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
  const isOrganizerTier = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");
  const myUserId = user?.id ?? null;

  const { data: apps } = await supabase
    .from("staff_applications")
    .select("*")
    .in("role_requested", ["admin", "organizer"])
    .order("created_at", { ascending: false });
  const applications = (apps as StaffApp[]) ?? [];
  const competitions = await getAllCompetitions();
  const staffAccounts = isOrganizerTier
    ? (await getStaffAccountRecords()).filter(
        (s) => s.role !== "customer_support" && (isSuperAdmin || s.role !== "admin"),
      )
    : [];
  const editingAccount = params.edit ? staffAccounts.find((s) => s.user_id === params.edit) : undefined;

  return (
    <AdminShell title="Admin / Organizer" active="/admin/organizers" flash={{ ok: params.ok, error: params.error }}>
      {isSuperAdmin && (
        <div className="mb-6">
          <CsvUploadForm
            action={bulkUploadOrganizers}
            templateHref="/organizers-template.csv"
            entityLabel="account"
            note={`Each row creates a real login instantly and emails a temporary password — max 200 rows per upload. Dates use DD/MM/YYYY format. ${IBAN_CSV_NOTE}`}
          />
        </div>
      )}
      {isOrganizerTier ? (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Create An Organizer Account</h2>
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
                  <label htmlFor="org_date_of_birth" className={adminLabel}>Date of Birth: DD/MM/YYYY *</label>
                  <DateOfBirthField id="org_date_of_birth" name="date_of_birth" className={adminInput} />
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
                  <label htmlFor="org_home_address" className={adminLabel}>
                    Home address *{" "}
                    <span className="font-normal text-neutral-400">(no comma &quot;,&quot; allowed in the box)</span>
                  </label>
                  <NoCommaInput id="org_home_address" className={adminInput} />
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
                  <InvitationCodeRunField
                    id="org_invitation_code"
                    role="organizer"
                    competitions={competitions}
                  />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details *</p>
                <BankDetailsNote />
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="org_bank_name" className={adminLabel}>Bank name *</label>
                    <input id="org_bank_name" name="bank_name" required className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="org_bank_account_no" className={adminLabel}>International Bank Account No. (IBAN/SWIFT/BIC/ACH) *</label>
                    <IbanInput id="org_bank_account_no" name="bank_account_no" required className={adminInput} />
                    <IbanConfirmCheckbox id="bank_account_no_confirmed" />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="bank_account_name" className={adminLabel}>Bank account holder name *</label>
                    <BankAccountNameField
                      id="bank_account_name"
                      fullNameFieldId="org_full_name"
                      className={adminInput}
                    />
                  </div>
                </div>
              </div>
              <div>
                <button type="submit" className={adminBtn}>Create Organizer account</button>
                <p className="mt-2 text-xs text-neutral-400">
                  Creates a real login instantly (no application or approval step) and emails them a
                  temporary password. Admin and Organizer can create Organizer accounts — creating a
                  new Admin account still requires the Supabase dashboard.
                </p>
              </div>
            </form>
          </Card>
        </div>
      ) : (
        <p className="mb-8 text-sm text-neutral-500">
          Only Admin and Organizer can create new Organizer accounts directly.
        </p>
      )}

      {isOrganizerTier && (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-bold">
            {editingAccount ? `Edit ${editingAccount.full_name ?? "Account"}` : "Admin / Organizer Accounts"}
          </h2>
          {editingAccount ? (
            <StaffAccountEditForm
              account={editingAccount}
              competitions={competitions}
              returnTo="/admin/organizers"
              showSupportFields={false}
            />
          ) : staffAccounts.length === 0 ? (
            <EmptyState>No Admin / Organizer accounts yet — create one above.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="user_id"
              downloadName="admin-organizer-accounts"
              columns={[
                { key: "full_name", label: "Name" },
                { key: "reference_id", label: "Reference ID" },
                { key: "role", label: "Role" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "country", label: "Country" },
                { key: "approved", label: "Status" },
                { key: "actions", label: "Actions" },
              ]}
              rows={staffAccounts.map((s) => ({
                user_id: s.user_id,
                reference_id: s.user_id.slice(0, 8).toUpperCase(),
                full_name: s.full_name ?? "",
                role: s.role === "staff" ? "Admin / Organizer (legacy)" : s.role === "admin" ? "Super Admin" : "Organizer",
                email: s.email ?? "",
                phone: s.phone ?? "",
                country: s.country ?? "",
                approved: s.approved ? "Approved" : "Pending",
                actions: (
                  <div key="actions" className="flex gap-1.5">
                    <Link
                      href={`/admin/organizers?edit=${s.user_id}`}
                      className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                    {s.user_id !== myUserId && (
                      <form action={deleteStaffAccount}>
                        <input type="hidden" name="user_id" value={s.user_id} />
                        <input type="hidden" name="return_to" value="/admin/organizers" />
                        <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    )}
                  </div>
                ),
              }))}
            />
          )}
          <p className="mt-2 text-xs text-neutral-400">
            Deleting removes the login entirely — the account can&apos;t sign in again. Admin and
            Organizer can create, edit, and delete an Organizer login; only the Super Admin can
            touch an Admin account. You can&apos;t delete your own account, and the last remaining
            Super Admin can&apos;t be deleted either.
          </p>
        </div>
      )}

      <h2 className="mb-3 text-lg font-bold">Admin / Organizer Applications</h2>
      {applications.length === 0 ? (
        <EmptyState>No applications yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="organizer-applications"
          columns={[
            { key: "full_name", label: "Name" },
            { key: "reference_id", label: "Reference ID" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "role_requested", label: "Role requested" },
            { key: "message", label: "Message" },
            { key: "status", label: "Status" },
          ]}
          csvColumns={[
            { key: "full_name", label: "Name" },
            { key: "reference_id", label: "Reference ID" },
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
            email: s.email ?? "",
            phone: s.phone ?? "",
            role_requested: s.role_requested.replace("_", " "),
            message: s.message ?? "",
            status_text: s.status,
            status: (
              <div key="status" className="flex flex-wrap gap-1">
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
        Approving an application here does not create a login by itself — use the &quot;Create An
        Organizer Account&quot; form above (Admin/Organizer) to actually grant access.
      </p>
      {isOrganizerTier && (
        <div className="mt-8 space-y-6">
          <InvitationCodeForm
            role="organizer"
            returnTo="/admin/organizers"
            title="Admin / Organizer Invitation Code"
            idPrefix="org_code"
            codeExample="IKO-ORGANIZER-TIER-USD10-2026-00001"
            competitions={competitions}
          />
          <InvitationCodeList
            role="organizer"
            returnTo="/admin/organizers"
            codeExample="IKO-ORGANIZER-TIER-USD10-2026-00001"
            competitions={competitions}
            editingId={params.editcode}
          />
        </div>
      )}
    </AdminShell>
  );
}
