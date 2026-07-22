import Link from "next/link";
import { getAllParticipants, getAllCompetitions } from "@/lib/admin-data";
import { getSchools, getSenseis, schemaReady } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { saveParticipant, deleteParticipant, bulkUploadParticipants } from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDOB } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
import DobAgeField from "@/components/DobAgeField";
import { NoCommaInput } from "@/components/NoCommaAddressField";
import { ageAt } from "@/lib/division";

export const dynamic = "force-dynamic";

export default async function AdminParticipants({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; editcode?: string; ok?: string; error?: string }>;
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

  const [participants, schools, senseis, competitions] = await Promise.all([
    getAllParticipants(),
    getSchools(),
    getSenseis(),
    getAllCompetitions(),
  ]);
  const editing = params.edit ? participants.find((p) => p.id === params.edit) : undefined;

  const supabase = await createClient();
  // Signed links (1h) for certificate photos in the private bucket
  const certPaths = participants.map((p) => p.certificate_path).filter(Boolean) as string[];
  const certUrls = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("certificates")
      .createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) certUrls.set(s.path, s.signedUrl);
    }
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isCustomerSupport = myProfile?.role === "customer_support";
  const isReferee = myProfile?.role === "referee";
  const canDelete = !isCustomerSupport && !isReferee;
  const canBulkUpload = ["admin", "organizer"].includes(myProfile?.role ?? "");

  return (
    <AdminShell
      title="Participants"
      active="/admin/participants"
      flash={{ ok: params.ok, error: params.error }}
    >
      {canBulkUpload && (
        <div className="mb-8">
          <CsvUploadForm
            action={bulkUploadParticipants}
            templateHref="/participants-template.csv"
            entityLabel="participant"
            note="School and sensei names must match existing records exactly. Certificates can't be uploaded via CSV — add one later via Edit."
          />
        </div>
      )}
      <div className="space-y-8">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit Participant" : "Add Participant"}</h2>
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
                <DobAgeField defaultValue={editing?.date_of_birth ?? ""} />
                <div>
                  <label htmlFor="gender" className={adminLabel}>Gender *</label>
                  <select id="gender" name="gender" required defaultValue={editing?.gender ?? ""} className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="belt_rank" className={adminLabel}>Latest Belt rank *</label>
                  <input id="belt_rank" name="belt_rank" required defaultValue={editing?.belt_rank ?? ""} className={adminInput} placeholder="e.g. 3rd Kyu" />
                </div>
                <div>
                  <label htmlFor="rank_confirmation" className={adminLabel}>Rank confirmation *</label>
                  <select id="rank_confirmation" name="rank_confirmation" required defaultValue={editing?.rank_confirmation ?? ""} className={adminInput}>
                    <option value="" disabled>—</option>
                    <option value="sensei_confirmed">Sensei Confirmed</option>
                    <option value="certificate_uploaded">Certificate Uploaded</option>
                    <option value="pending_confirmation">Pending Confirmation</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <CertificateField
                    currentUrl={editing?.certificate_path ? certUrls.get(editing.certificate_path) : undefined}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>
                    Home address *{" "}
                    <span className="font-normal text-neutral-400">(no comma &quot;,&quot; allowed in the box)</span>
                  </label>
                  <NoCommaInput id="home_address" defaultValue={editing?.home_address ?? ""} className={adminInput} />
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
                  <label htmlFor="school_id" className={adminLabel}>School *</label>
                  <select id="school_id" name="school_id" required defaultValue={editing?.school_id ?? ""} className={adminInput}>
                    <option value="" disabled>Select school</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sensei_id" className={adminLabel}>Sensei *</label>
                  <select id="sensei_id" name="sensei_id" required defaultValue={editing?.sensei_id ?? ""} className={adminInput}>
                    <option value="" disabled>Select sensei</option>
                    {senseis.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="invitation_code" className={adminLabel}>Invitation code (optional)</label>
                  <input id="invitation_code" name="invitation_code" defaultValue={editing?.invitation_code ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="referral_source" className={adminLabel}>Referral (optional)</label>
                  <input id="referral_source" name="referral_source" defaultValue={editing?.referral_source ?? ""} className={adminInput} placeholder="e.g. a friend's name" />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Reward payout bank details *
                </p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="bank_name" className={adminLabel}>Bank name *</label>
                    <input id="bank_name" name="bank_name" required defaultValue={editing?.bank?.bank_name ?? ""} className={adminInput} placeholder="e.g. Maybank" />
                  </div>
                  <div>
                    <label htmlFor="bank_account_no" className={adminLabel}>Account no. *</label>
                    <input id="bank_account_no" name="bank_account_no" required defaultValue={editing?.bank?.bank_account_no ?? ""} className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="bank_account_name" className={adminLabel}>Account holder name *</label>
                    <input id="bank_account_name" name="bank_account_name" required defaultValue={editing?.bank?.bank_account_name ?? ""} className={adminInput} />
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

        <div>
          <h2 className="mb-3 text-lg font-bold">All Participants</h2>
          {participants.length === 0 ? (
            <EmptyState>No participants yet.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="participants"
              columns={[
                { key: "full_name", label: "Name" },
                { key: "ic_passport", label: "IC / Passport" },
                { key: "date_of_birth", label: "DOB" },
                { key: "age", label: "Age" },
                { key: "belt_rank", label: "Belt" },
                { key: "rank_status", label: "Rank status" },
                { key: "home_country", label: "Country" },
                { key: "school", label: "School" },
                { key: "bank", label: "Payout bank" },
                { key: "actions", label: "Actions" },
              ]}
              csvColumns={[
                { key: "full_name", label: "Name" },
                { key: "ic_passport", label: "IC / Passport" },
                { key: "date_of_birth", label: "DOB" },
                { key: "age", label: "Age" },
                { key: "belt_rank", label: "Belt" },
                { key: "home_country", label: "Country" },
                { key: "school", label: "School" },
                { key: "bank_name", label: "Bank Name" },
                { key: "bank_account_no", label: "Bank Account No" },
                { key: "bank_account_name", label: "Bank Account Holder Name" },
              ]}
              rows={participants.map((p) => ({
                id: p.id,
                full_name: p.full_name,
                ic_passport: p.ic_passport,
                date_of_birth: formatDOB(p.date_of_birth),
                age: p.date_of_birth ? ageAt(p.date_of_birth, null) : "",
                belt_rank: p.belt_rank ?? "",
                rank_status:
                  p.certificate_path && certUrls.get(p.certificate_path) ? (
                    <a
                      href={certUrls.get(p.certificate_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-green-700 underline underline-offset-2"
                    >
                      View certificate
                    </a>
                  ) : p.rank_confirmation === "sensei_confirmed" ? (
                    <span className="font-semibold text-green-700">Sensei confirmed</span>
                  ) : p.rank_confirmation === "pending_confirmation" ? (
                    <span className="text-amber-600">Pending</span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  ),
                home_country: p.home_country ?? "",
                school: p.school?.name ?? "",
                bank: p.bank ? `${p.bank.bank_name} · ${p.bank.bank_account_no}` : "",
                bank_name: p.bank?.bank_name ?? "",
                bank_account_no: p.bank?.bank_account_no ?? "",
                bank_account_name: p.bank?.bank_account_name ?? "",
                actions: (
                  <div className="flex gap-1.5">
                    <Link
                      href={`/admin/participants?edit=${p.id}`}
                      className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                    {canDelete && (
                      <form action={deleteParticipant}>
                        <input type="hidden" name="id" value={p.id} />
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
        </div>
      </div>
      <div className="mt-8 space-y-6">
        <InvitationCodeForm
          role="participant"
          returnTo="/admin/participants"
          title="Participant Invitation Code"
          idPrefix="participant_code"
          codeExample="IKO-PARTICIPANT-2026"
          competitions={competitions}
        />
        <InvitationCodeList
          role="participant"
          returnTo="/admin/participants"
          codeExample="IKO-PARTICIPANT-2026"
          competitions={competitions}
          editingId={params.editcode}
        />
      </div>
    </AdminShell>
  );
}
