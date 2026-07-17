import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { updateCommunityStatus, saveReferee, deleteReferee, createInvitationCode, linkRefereeAccount, bulkUploadReferees } from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";

export const dynamic = "force-dynamic";

interface Referee {
  id: string; full_name: string; ic_passport: string; date_of_birth: string | null;
  gender: string | null; karate_rank: string | null; judging_experience_count: number | null;
  school: string | null;
  email: string | null; phone: string | null; home_address: string | null;
  city_town: string | null; postcode: string | null; home_country: string | null;
  bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null;
  certificate_path: string | null; international_certificate_paths: string[] | null;
  invitation_code: string | null;
  user_id: string | null;
  payment_status: string; status: string; created_at: string;
}

function StatusButtons({
  table, id, field, current, options,
}: {
  table: string; id: string; field: string; current: string; options: string[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <form key={o} action={updateCommunityStatus}>
          <input type="hidden" name="table" value={table} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="field" value={field} />
          <input type="hidden" name="value" value={o} />
          <input type="hidden" name="return_to" value="/admin/referees" />
          <button
            disabled={o === current}
            className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
              o === current
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {o.replace("_", " ")}
          </button>
        </form>
      ))}
    </div>
  );
}

export default async function AdminReferees({
  searchParams,
}: {
  searchParams: Promise<{ editref?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Referees / Judges" active="/admin/referees">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const { data: referees } = await supabase.from("referees").select("*").order("created_at", { ascending: false });
  const refereeList = (referees as Referee[]) ?? [];
  const editing = params.editref ? refereeList.find((r) => r.id === params.editref) : undefined;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isAdminTier = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");

  const competitions = await getAllCompetitions();
  const refereeUserIds = refereeList.map((r) => r.user_id).filter((id): id is string => !!id);
  const { data: refereeLogins } =
    refereeUserIds.length > 0
      ? await supabase
          .from("profiles")
          .select("user_id, sign_in_count, sign_in_limit, sign_in_competition_id, sign_in_valid_from, sign_in_valid_until")
          .in("user_id", refereeUserIds)
      : { data: [] };
  const loginByUserId = new Map((refereeLogins ?? []).map((p) => [p.user_id as string, p]));

  const certPaths = [
    ...refereeList.map((r) => r.certificate_path),
    ...refereeList.flatMap((r) => r.international_certificate_paths ?? []),
  ].filter(Boolean) as string[];
  const certUrls = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) certUrls.set(s.path, s.signedUrl);
  }

  return (
    <AdminShell title="Referees / Judges" active="/admin/referees" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-8">
        <CsvUploadForm
          action={bulkUploadReferees}
          templateHref="/referees-template.csv"
          entityLabel="referee"
          note="Certificates can't be uploaded via CSV — add one later via Edit."
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit Referee/Judge" : "Add Referee/Judge"}</h2>
          <Card>
            {!editing && (
              <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Referee / Judge invitation code
                </p>
                <form action={createInvitationCode} className="mt-2 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="role" value="referee" />
                  <input type="hidden" name="return_to" value="/admin/referees" />
                  <div>
                    <label htmlFor="ref_code_note" className={adminLabel}>Note (optional)</label>
                    <input id="ref_code_note" name="note" className={adminInput} placeholder="e.g. July intake" />
                  </div>
                  <button type="submit" className={adminBtnSecondary}>Generate unlimited-use code</button>
                </form>
                <p className="mt-1 text-xs text-neutral-400">
                  Waives the USD 100 deposit for anyone who signs up with the code — unlimited uses. Manage
                  or revoke codes in Admin → Accounts → Invitation codes.
                </p>
              </div>
            )}
            <form action={saveReferee} className="space-y-4">
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
                  <label htmlFor="date_of_birth" className={adminLabel}>Date of birth *</label>
                  <input id="date_of_birth" name="date_of_birth" type="date" required defaultValue={editing?.date_of_birth ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="gender" className={adminLabel}>Gender *</label>
                  <select id="gender" name="gender" required defaultValue={editing?.gender ?? ""} className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="karate_rank" className={adminLabel}>Karate rank *</label>
                  <input id="karate_rank" name="karate_rank" required defaultValue={editing?.karate_rank ?? ""} className={adminInput} placeholder="e.g. Godan" />
                </div>
                <div>
                  <label htmlFor="judging_experience_count" className={adminLabel}>
                    No. of times judging Kata competition *
                  </label>
                  <input id="judging_experience_count" name="judging_experience_count" type="number" min="0" step="1" required defaultValue={editing?.judging_experience_count ?? ""} className={adminInput} />
                </div>
                <div className="sm:col-span-2">
                  <CertificateField
                    required
                    currentUrl={editing?.certificate_path ? certUrls.get(editing.certificate_path) : undefined}
                  />
                </div>
                <div>
                  <label htmlFor="school" className={adminLabel}>School / organisation *</label>
                  <input id="school" name="school" required defaultValue={editing?.school ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="email" className={adminLabel}>Email *</label>
                  <input id="email" name="email" type="email" required defaultValue={editing?.email ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="phone" className={adminLabel}>Mobile / WhatsApp *</label>
                  <input id="phone" name="phone" required defaultValue={editing?.phone ?? ""} className={adminInput} placeholder="+60…" />
                </div>
                <div>
                  <label htmlFor="invitation_code" className={adminLabel}>Invitation code</label>
                  <input id="invitation_code" name="invitation_code" defaultValue={editing?.invitation_code ?? ""} className={adminInput} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>Home address *</label>
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
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Bank details — deposit return &amp; referee/judge reward *
                </p>
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
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add Referee/Judge"}</button>
                {editing && (
                  <Link href="/admin/referees" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
          {editing && (
            <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Login account</p>
              {editing.user_id ? (
                <p className="mt-1 text-xs text-green-700">
                  Linked — commission calculations use this referee&apos;s actual judging activity.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-neutral-400">
                    Not linked yet. Auto-links at sign-up if they use the same email as above — if
                    they signed in with a different email, enter it here to link manually.
                  </p>
                  <form action={linkRefereeAccount} className="mt-2 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={editing.id} />
                    <div>
                      <label htmlFor="login_email" className={adminLabel}>Their sign-in email</label>
                      <input id="login_email" name="login_email" type="email" className={adminInput} placeholder="name@example.com" />
                    </div>
                    <button type="submit" className={adminBtnSecondary}>Link account</button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">Referees / Judges — USD 100 deposit</h2>
          {refereeList.length === 0 ? (
            <EmptyState>No referee registrations yet.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="referees"
              columns={[
                { key: "reference_id", label: "Reference ID" },
                { key: "full_name", label: "Name" },
                { key: "ic_passport", label: "IC / Passport" },
                { key: "date_of_birth", label: "DOB" },
                { key: "gender", label: "Gender" },
                { key: "karate_rank", label: "Rank" },
                { key: "judging_experience_count", label: "Judging Experience" },
                { key: "school", label: "School" },
                { key: "location", label: "Location" },
                { key: "contact", label: "Contact" },
                { key: "bank", label: "Bank" },
                { key: "certificates", label: "Certificates" },
                { key: "invitation_code", label: "Invitation Code" },
                { key: "deposit", label: "Deposit" },
                { key: "approval", label: "Approval" },
                ...(isAdminTier ? [{ key: "sign_in_control", label: "Sign-in Control" }] : []),
                { key: "actions", label: "Actions" },
              ]}
              csvColumns={[
                { key: "reference_id", label: "Reference ID" },
                { key: "full_name", label: "Name" },
                { key: "ic_passport", label: "IC / Passport" },
                { key: "date_of_birth", label: "DOB" },
                { key: "gender", label: "Gender" },
                { key: "karate_rank", label: "Rank" },
                { key: "judging_experience_count", label: "Judging Experience" },
                { key: "school", label: "School" },
                { key: "home_address", label: "Home Address" },
                { key: "city_town", label: "City / Town" },
                { key: "postcode", label: "Postcode" },
                { key: "home_country", label: "Country" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "bank_name", label: "Bank Name" },
                { key: "bank_account_no", label: "Bank Account No" },
                { key: "bank_account_name", label: "Bank Account Holder Name" },
                { key: "invitation_code", label: "Invitation Code" },
                { key: "payment_status", label: "Deposit Status" },
                { key: "status", label: "Approval Status" },
              ]}
              rows={refereeList.map((r) => ({
                id: r.id,
                reference_id: r.id.slice(0, 8).toUpperCase(),
                full_name: r.full_name,
                ic_passport: r.ic_passport,
                date_of_birth: formatDate(r.date_of_birth),
                gender: r.gender ?? "",
                karate_rank: r.karate_rank ?? "",
                judging_experience_count: String(r.judging_experience_count ?? 0),
                school: r.school ?? "",
                location: [r.home_address, r.city_town, r.postcode, r.home_country].filter(Boolean).join(", "),
                contact: [r.email, r.phone].filter(Boolean).join(" · "),
                bank: [r.bank_name, r.bank_account_no].filter(Boolean).join(" · "),
                home_address: r.home_address ?? "",
                city_town: r.city_town ?? "",
                postcode: r.postcode ?? "",
                home_country: r.home_country ?? "",
                email: r.email ?? "",
                phone: r.phone ?? "",
                bank_name: r.bank_name ?? "",
                bank_account_no: r.bank_account_no ?? "",
                bank_account_name: r.bank_account_name ?? "",
                payment_status: r.payment_status,
                status: r.status,
                certificates: (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {r.certificate_path && certUrls.get(r.certificate_path) ? (
                      <a href={certUrls.get(r.certificate_path)} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-green-700 underline underline-offset-2">Rank cert</a>
                    ) : (
                      <span className="text-red-500">None</span>
                    )}
                    {(r.international_certificate_paths ?? []).map((path, i) => (
                      certUrls.get(path) ? (
                        <a key={path} href={certUrls.get(path)} target="_blank" rel="noopener noreferrer"
                          className="font-semibold text-blue-700 underline underline-offset-2">
                          Intl. {i + 1}
                        </a>
                      ) : null
                    ))}
                  </div>
                ),
                invitation_code: r.invitation_code ?? "",
                deposit: (
                  <StatusButtons table="referees" id={r.id} field="payment_status" current={r.payment_status}
                    options={["pending", "paid", "waived", "refunded", "forfeited"]} />
                ),
                approval: (
                  <StatusButtons table="referees" id={r.id} field="status" current={r.status}
                    options={["pending", "approved", "rejected"]} />
                ),
                ...(isAdminTier
                  ? {
                      sign_in_control: (
                        <SignInControlBox
                          userId={r.user_id}
                          signInCount={loginByUserId.get(r.user_id ?? "")?.sign_in_count ?? 0}
                          signInLimit={loginByUserId.get(r.user_id ?? "")?.sign_in_limit ?? null}
                          signInCompetitionId={loginByUserId.get(r.user_id ?? "")?.sign_in_competition_id ?? null}
                          signInValidFrom={loginByUserId.get(r.user_id ?? "")?.sign_in_valid_from ?? null}
                          signInValidUntil={loginByUserId.get(r.user_id ?? "")?.sign_in_valid_until ?? null}
                          competitions={competitions}
                          returnTo="/admin/referees"
                        />
                      ),
                    }
                  : {}),
                actions: (
                  <div className="flex gap-1.5">
                    <Link
                      href={`/admin/referees?editref=${r.id}`}
                      className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                    <form action={deleteReferee}>
                      <input type="hidden" name="id" value={r.id} />
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
