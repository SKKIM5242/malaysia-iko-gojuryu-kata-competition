import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { updateCommunityStatus, createStaffAccount, bulkUploadSupport, clockIn, clockOut } from "@/app/actions/admin";
import { getOpenShift, getAllShifts } from "@/lib/support-shifts";
import { AdminShell, Card, CertificateField, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";

export const dynamic = "force-dynamic";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}

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
  const isCustomerSupport = myProfile?.role === "customer_support";
  const isAdminTier = ["admin", "organizer", "staff", "customer_support"].includes(myProfile?.role ?? "");

  const [openShift, allShifts] = await Promise.all([
    isCustomerSupport && user ? getOpenShift(user.id) : Promise.resolve(null),
    isAdminTier ? getAllShifts() : Promise.resolve([]),
  ]);

  const competitions = canCreate ? await getAllCompetitions() : [];
  const { data: supportProfiles } = canCreate
    ? await supabase
        .from("profiles")
        .select("user_id, full_name, email, sign_in_count, sign_in_limit, sign_in_competition_id, sign_in_valid_from, sign_in_valid_until")
        .eq("role", "customer_support")
    : { data: [] };

  const { data: apps } = await supabase
    .from("staff_applications")
    .select("*")
    .eq("role_requested", "customer_support")
    .order("created_at", { ascending: false });
  const applications = (apps as StaffApp[]) ?? [];

  return (
    <AdminShell title="Customer Support" active="/admin/support" flash={{ ok: params.ok, error: params.error }}>
      {isCustomerSupport && (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Your Shift</h2>
          <Card>
            <p className="mb-3 text-xs text-neutral-400">
              Clock in/out here even when your work was replying via the Telegram assistant or
              community groups — there's no other way to log that time. Paid at USD 8/hour.
            </p>
            {openShift ? (
              <form action={clockOut} className="space-y-3">
                <input type="hidden" name="id" value={openShift.id} />
                <p className="text-sm text-neutral-700">
                  Clocked in since <strong>{formatDateTime(openShift.clockInAt)}</strong>
                </p>
                <div>
                  <label htmlFor="task_summary" className={adminLabel}>Task summary (optional)</label>
                  <textarea
                    id="task_summary"
                    name="task_summary"
                    rows={2}
                    className={adminInput}
                    placeholder="e.g. Answered 6 participant queries on Telegram about recording issues"
                  />
                </div>
                <button type="submit" className={adminBtn}>Clock out</button>
              </form>
            ) : (
              <form action={clockIn}>
                <button type="submit" className={adminBtnSecondary}>Clock in</button>
              </form>
            )}
          </Card>
        </div>
      )}

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
          <h2 className="mb-3 text-lg font-bold">Create A Customer Support Account</h2>
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
                  <label htmlFor="cs_date_of_birth" className={adminLabel}>Date of birth *</label>
                  <input id="cs_date_of_birth" name="date_of_birth" type="date" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_gender" className={adminLabel}>Gender *</label>
                  <select id="cs_gender" name="gender" required defaultValue="" className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cs_belt_rank" className={adminLabel}>Belt rank (if applicable)</label>
                  <input id="cs_belt_rank" name="belt_rank" className={adminInput} placeholder="e.g. 3rd Kyu" />
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-1 text-xs text-neutral-400">Latest rank certificate (if applicable)</p>
                  <CertificateField />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cs_home_address" className={adminLabel}>Home address *</label>
                  <input id="cs_home_address" name="home_address" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_city_town" className={adminLabel}>City / Town *</label>
                  <input id="cs_city_town" name="city_town" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_postcode" className={adminLabel}>Postcode *</label>
                  <input id="cs_postcode" name="postcode" required className={adminInput} placeholder="e.g. 50000" />
                </div>
                <div>
                  <label htmlFor="cs_country" className={adminLabel}>Country *</label>
                  <input id="cs_country" name="country" required defaultValue="Malaysia" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_phone" className={adminLabel}>Mobile phone *</label>
                  <input id="cs_phone" name="phone" type="tel" required className={adminInput} placeholder="+60…" />
                </div>
                <div>
                  <label htmlFor="cs_invitation_code" className={adminLabel}>Invitation code (optional)</label>
                  <input id="cs_invitation_code" name="invitation_code" className={adminInput} />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details *</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cs_bank_name" className={adminLabel}>Bank name *</label>
                    <input id="cs_bank_name" name="bank_name" required className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="cs_bank_account_no" className={adminLabel}>Account no. *</label>
                    <input id="cs_bank_account_no" name="bank_account_no" required className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="cs_bank_account_name" className={adminLabel}>Account holder name *</label>
                    <input id="cs_bank_account_name" name="bank_account_name" required className={adminInput} />
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

      <h2 className="mb-3 text-lg font-bold">Customer Support Applications</h2>
      {applications.length === 0 ? (
        <EmptyState>No applications yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="customer-support-applications"
          columns={[
            { key: "reference_id", label: "Reference ID" },
            { key: "full_name", label: "Name" },
            { key: "contact", label: "Contact" },
            { key: "message", label: "Message" },
            { key: "status", label: "Status" },
          ]}
          csvColumns={[
            { key: "reference_id", label: "Reference ID" },
            { key: "full_name", label: "Name" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
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

      {isAdminTier && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Shift Log — USD 8/Hour</h2>
          {allShifts.length === 0 ? (
            <EmptyState>No shifts logged yet.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="support-shifts"
              columns={[
                { key: "name", label: "Name" },
                { key: "clock_in", label: "Clock In" },
                { key: "clock_out", label: "Clock Out" },
                { key: "hours", label: "Hours" },
                { key: "pay", label: "Pay (USD)" },
                { key: "task_summary", label: "Task Summary" },
              ]}
              rows={allShifts.map((s) => ({
                id: s.id,
                name: s.userName,
                clock_in: formatDateTime(s.clockInAt),
                clock_out: s.clockOutAt ? formatDateTime(s.clockOutAt) : "— still clocked in —",
                hours: s.hours != null ? s.hours.toFixed(2) : "",
                pay: s.payUsd != null ? `$${s.payUsd.toFixed(2)}` : "",
                task_summary: s.taskSummary ?? "",
              }))}
            />
          )}
        </div>
      )}

      {canCreate && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Sign-In Control (Admin/Organizer Only)</h2>
          {(supportProfiles ?? []).length === 0 ? (
            <EmptyState>No Customer Support logins yet.</EmptyState>
          ) : (
            <div className="space-y-2">
              {(supportProfiles ?? []).map((p) => (
                <div key={p.user_id} className="rounded-md border border-neutral-200 p-3">
                  <p className="mb-2 font-semibold text-neutral-900">{p.full_name ?? p.email ?? p.user_id}</p>
                  <SignInControlBox
                    userId={p.user_id}
                    signInCount={p.sign_in_count ?? 0}
                    signInLimit={p.sign_in_limit ?? null}
                    signInCompetitionId={p.sign_in_competition_id ?? null}
                    signInValidFrom={p.sign_in_valid_from ?? null}
                    signInValidUntil={p.sign_in_valid_until ?? null}
                    competitions={competitions}
                    returnTo="/admin/support"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminShell>
  );
}
