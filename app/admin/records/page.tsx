import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import {
  getAudienceRecords,
  getParticipantRecords,
  getRefereeRecords,
  getSchoolRecords,
  getSenseiRecords,
  getStaffAccountRecords,
} from "@/lib/admin-data";
import { AdminShell, adminBtnSecondary } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate, formatDOB, formatUSD } from "@/components/ui";
import ParticipantRecordsTable, { type ParticipantRecordRow } from "@/components/ParticipantRecordsTable";
import FilterableTable from "@/components/FilterableTable";
import { markAttemptPurchasePaid, markBulkUploadPaymentPaid, markSubscriptionRenewalFulfilled } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin (owner)",
  organizer: "Organizer",
  staff: "Admin / Organizer",
  customer_support: "Customer Support",
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <details id={id} className="mb-8 rounded-lg border border-neutral-200 bg-white shadow-sm" open>
      <summary className="cursor-pointer px-4 py-3 text-base font-bold text-neutral-900 hover:bg-neutral-50">
        {title}
      </summary>
      <div className="border-t border-neutral-100 p-4">{children}</div>
    </details>
  );
}

/** Builds the cell value server-side (a plain React element, not a
 * callback) — Server Components may pass rendered nodes to Client
 * Components, just never a function. */
function certLink(url: string | null) {
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
    >
      View
    </a>
  ) : (
    <span className="text-xs text-neutral-400">—</span>
  );
}

export default async function AdminParticipantRecords() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Participant Records" active="/admin/records">
        <SetupNotice />
      </AdminShell>
    );
  }

  const [participantRecords, referees, audiences, schools, senseis, staffAccounts] = await Promise.all([
    getParticipantRecords(),
    getRefereeRecords(),
    getAudienceRecords(),
    getSchoolRecords(),
    getSenseiRecords(),
    getStaffAccountRecords(),
  ]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isAdmin = myProfile?.role === "admin";

  const { data: purchases } = await supabase
    .from("attempt_purchases")
    .select("id, user_id, status, created_at, paid_at")
    .order("created_at", { ascending: false });
  const purchaseList = purchases ?? [];
  const purchaseUserIds = [...new Set(purchaseList.map((p) => p.user_id as string))];
  const { data: purchaseProfiles } =
    purchaseUserIds.length > 0
      ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", purchaseUserIds)
      : { data: [] };
  const nameByUserId = new Map(
    (purchaseProfiles ?? []).map((p) => [p.user_id as string, (p.full_name as string) || (p.email as string) || p.user_id as string]),
  );

  const { data: renewals } = await supabase
    .from("subscription_renewals")
    .select("id, user_id, status, created_at, paid_at")
    .order("created_at", { ascending: false });
  const renewalList = renewals ?? [];
  const renewalUserIds = [...new Set(renewalList.map((r) => r.user_id as string))];
  const { data: renewalProfiles } =
    renewalUserIds.length > 0
      ? await supabase.from("profiles").select("user_id, full_name, email, role").in("user_id", renewalUserIds)
      : { data: [] };
  const renewalProfileByUserId = new Map(
    (renewalProfiles ?? []).map((p) => [
      p.user_id as string,
      { name: (p.full_name as string) || (p.email as string) || (p.user_id as string), role: p.role as string },
    ]),
  );

  const { data: bulkPayments } = await supabase
    .from("bulk_upload_payments")
    .select("id, sensei_id, school_id, participant_count, amount_usd, status, created_at, paid_at")
    .order("created_at", { ascending: false });
  const bulkPaymentList = bulkPayments ?? [];
  const bulkSenseiIds = [...new Set(bulkPaymentList.map((p) => p.sensei_id as string))];
  const bulkSchoolIds = [...new Set(bulkPaymentList.map((p) => p.school_id as string))];
  const [{ data: bulkSenseis }, { data: bulkSchools }] = await Promise.all([
    bulkSenseiIds.length > 0
      ? supabase.from("senseis").select("id, name").in("id", bulkSenseiIds)
      : Promise.resolve({ data: [] }),
    bulkSchoolIds.length > 0
      ? supabase.from("schools").select("id, name").in("id", bulkSchoolIds)
      : Promise.resolve({ data: [] }),
  ]);
  const senseiNameById = new Map((bulkSenseis ?? []).map((s) => [s.id as string, s.name as string]));
  const schoolNameById = new Map((bulkSchools ?? []).map((s) => [s.id as string, s.name as string]));

  const participantRows: ParticipantRecordRow[] = participantRecords.map((r) => ({
    registrationId: r.registrationId,
    competition: r.competitionName ?? "—",
    category: r.categoryName ?? "—",
    fullName: r.participant.full_name,
    icPassport: r.participant.ic_passport,
    dateOfBirth: formatDOB(r.participant.date_of_birth),
    gender: r.participant.gender ?? "—",
    beltRank: r.participant.belt_rank ?? "",
    rankConfirmation: r.participant.rank_confirmation ?? "",
    certificateUrl: r.certificateUrl,
    homeAddress: r.participant.home_address ?? "",
    country: r.participant.home_country ?? "",
    cityTown: r.participant.city_town ?? "",
    email: r.participant.email ?? "",
    phone: r.participant.phone ?? "",
    school: r.participant.school?.name ?? "",
    sensei: r.participant.sensei?.name ?? "",
    bankName: r.participant.bank?.bank_name ?? "",
    bankAccountNo: r.participant.bank?.bank_account_no ?? "",
    bankAccountName: r.participant.bank?.bank_account_name ?? "",
    recordingStatus: r.videoCreatedAt ? "Submitted" : "Not submitted",
    recordingDate: r.videoCreatedAt ? formatDate(r.videoCreatedAt.slice(0, 10)) : "",
    attempts: `${r.recordAttempts}/${r.maxAttempts}`,
    videoUrl: r.videoUrl,
  }));

  const refereeColumns = [
    { key: "id", label: "Reference ID" },
    { key: "full_name", label: "Full Name" },
    { key: "ic_passport", label: "IC / Passport" },
    { key: "date_of_birth", label: "DOB" },
    { key: "gender", label: "Gender" },
    { key: "karate_rank", label: "Karate Rank" },
    { key: "judging_experience_count", label: "Judging Experience" },
    { key: "school", label: "School" },
    { key: "home_address", label: "Home Address" },
    { key: "city_town", label: "City/Town" },
    { key: "home_country", label: "Country" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "bank_name", label: "Bank Name" },
    { key: "bank_account_no", label: "Bank Account No" },
    { key: "bank_account_name", label: "Bank Account Holder Name" },
    { key: "certificateUrl", label: "Certificate" },
    { key: "payment_status", label: "Deposit Status" },
    { key: "status", label: "Application Status" },
  ];
  const refereeRows = referees.map((r) => ({
    id: r.id.slice(0, 8).toUpperCase(),
    full_name: r.full_name,
    ic_passport: r.ic_passport,
    date_of_birth: formatDOB(r.date_of_birth),
    gender: r.gender ?? "",
    karate_rank: r.karate_rank ?? "",
    judging_experience_count: r.judging_experience_count != null ? String(r.judging_experience_count) : "",
    school: r.school ?? "",
    home_address: r.home_address ?? "",
    city_town: r.city_town ?? "",
    home_country: r.home_country ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    bank_name: r.bank_name ?? "",
    bank_account_no: r.bank_account_no ?? "",
    bank_account_name: r.bank_account_name ?? "",
    payment_status: r.payment_status,
    status: r.status,
    certificateUrl: certLink(r.certificateUrl),
  }));

  const audienceColumns = [
    { key: "id", label: "Reference ID" },
    { key: "full_name", label: "Full Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "home_country", label: "Country" },
    { key: "invitation_code", label: "Invitation Code" },
    { key: "payment_status", label: "Payment Status" },
  ];
  const audienceRows = audiences.map((a) => ({
    id: a.id.slice(0, 8).toUpperCase(),
    full_name: a.full_name,
    email: a.email ?? "",
    phone: a.phone ?? "",
    home_country: a.home_country ?? "",
    invitation_code: a.invitation_code ?? "",
    payment_status: a.payment_status,
  }));

  const schoolColumns = [
    { key: "id", label: "Reference ID" },
    { key: "name", label: "School Name" },
    { key: "state", label: "State" },
    { key: "contact_title", label: "Contact Title" },
    { key: "contact_name", label: "Contact Name" },
    { key: "contact_karate_title", label: "Contact Karate Title" },
    { key: "contact_rank", label: "Contact Rank" },
    { key: "gender", label: "Gender" },
    { key: "home_address", label: "Home Address" },
    { key: "city_town", label: "City/Town" },
    { key: "home_country", label: "Country" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
  ];
  const schoolRows = schools.map((s) => ({
    id: s.id.slice(0, 8).toUpperCase(),
    name: s.name,
    state: s.state ?? "",
    contact_title: s.contact_title ?? "",
    contact_name: s.contact_name ?? "",
    contact_karate_title: s.contact_karate_title ?? "",
    contact_rank: s.contact_rank ?? "",
    gender: s.gender ?? "",
    home_address: s.home_address ?? "",
    city_town: s.city_town ?? "",
    home_country: s.home_country ?? "",
    email: s.email ?? "",
    phone: s.phone ?? "",
  }));

  const senseiColumns = [
    { key: "id", label: "Reference ID" },
    { key: "name", label: "Full Name" },
    { key: "rank", label: "Rank" },
    { key: "gender", label: "Gender" },
    { key: "school", label: "School" },
    { key: "home_address", label: "Home Address" },
    { key: "city_town", label: "City/Town" },
    { key: "home_country", label: "Country" },
    { key: "registered_by", label: "Registered By" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "certificateUrl", label: "Certificate" },
  ];
  const senseiRows = senseis.map((s) => ({
    id: s.id.slice(0, 8).toUpperCase(),
    name: s.name,
    rank: s.rank ?? "",
    gender: s.gender ?? "",
    school: s.school?.name ?? "",
    home_address: s.home_address ?? "",
    city_town: s.city_town ?? "",
    home_country: s.home_country ?? "",
    registered_by: s.registered_by ?? "",
    email: s.email ?? "",
    phone: s.phone ?? "",
    certificateUrl: certLink(s.certificateUrl),
  }));

  const staffColumns = [
    { key: "user_id", label: "Reference ID" },
    { key: "full_name", label: "Full Name" },
    { key: "role", label: "Role" },
    { key: "country", label: "Country" },
    { key: "email", label: "Email" },
    { key: "approved", label: "Status" },
  ];
  const staffRows = staffAccounts.map((s) => ({
    user_id: s.user_id.slice(0, 8).toUpperCase(),
    full_name: s.full_name ?? "",
    role: ROLE_LABEL[s.role] ?? s.role,
    country: s.country ?? "",
    email: s.email ?? "",
    approved: s.approved ? "Approved" : "Pending",
  }));

  return (
    <AdminShell title="Participant Records" active="/admin/records">
      <p className="mb-6 text-sm text-neutral-500">
        Every registrant type in one place, each with its own filterable table. Recordings and
        certificates play/open in-page for Admin/Organizer, Referee/Judge, and Customer Support here, on{" "}
        <a href="/kata-arena" className="underline">Kata Arena</a>, and on{" "}
        <a href="/admin/judging" className="underline">Judging</a>. Participants and Audience accounts
        continue watching recordings only via Kata Arena, per its existing access rules.
      </p>

      <Section id="participants" title="Participants">
        {participantRows.length === 0 ? (
          <EmptyState>No successful registrations yet.</EmptyState>
        ) : (
          <ParticipantRecordsTable rows={participantRows} isAdmin={isAdmin} />
        )}
      </Section>

      <Section id="subscription-renewals" title="New Subscription Requests">
        {renewalList.length === 0 ? (
          <EmptyState>No renewal requests yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {renewalList.map((r) => {
              const info = renewalProfileByUserId.get(r.user_id as string);
              return (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-sm"
                >
                  <div>
                    <p className="font-semibold text-neutral-900">
                      {info?.name ?? "—"}
                      <span className="font-normal text-neutral-400"> · {info?.role ?? "—"}</span>
                    </p>
                    <p className="text-xs text-neutral-400">
                      Requested {formatDate((r.created_at as string).slice(0, 10))}
                      {r.paid_at ? ` · Fulfilled ${formatDate((r.paid_at as string).slice(0, 10))}` : ""}
                    </p>
                  </div>
                  {r.status === "pending" ? (
                    <form action={markSubscriptionRenewalFulfilled}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className={adminBtnSecondary}>Mark fulfilled</button>
                    </form>
                  ) : (
                    <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
                      Fulfilled
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-400">
          Fulfil a request by setting the sign-in limit, competition tier, and/or valid date range
          on that person&apos;s own Sign-in Control box (Schools/Senseis/Referees/Audience/Support
          admin pages), then mark it fulfilled here.
        </p>
      </Section>

      <Section id="attempt-purchases" title="Extra Attempt Purchases (USD 10 for 3 more)">
        {purchaseList.length === 0 ? (
          <EmptyState>No purchase requests yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {purchaseList.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-neutral-900">{nameByUserId.get(p.user_id as string)}</p>
                  <p className="text-xs text-neutral-400">
                    Requested {formatDate((p.created_at as string).slice(0, 10))}
                    {p.paid_at ? ` · Confirmed ${formatDate((p.paid_at as string).slice(0, 10))}` : ""}
                  </p>
                </div>
                {p.status === "paid" ? (
                  <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
                    Paid — 3 attempts added
                  </span>
                ) : (
                  <form action={markAttemptPurchasePaid}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className={adminBtnSecondary}>Confirm payment received</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section id="bulk-upload-payments" title="Bulk Upload Payments (Sensei pays before uploading)">
        {bulkPaymentList.length === 0 ? (
          <EmptyState>No bulk upload payment requests yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {bulkPaymentList.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-neutral-900">
                    {senseiNameById.get(p.sensei_id as string) ?? "—"}
                    <span className="font-normal text-neutral-400"> · {schoolNameById.get(p.school_id as string) ?? "—"}</span>
                  </p>
                  <p className="text-xs text-neutral-400">
                    {p.status === "pending" ? "Requested for" : "Remaining balance:"} {p.participant_count}{" "}
                    participant{p.participant_count === 1 ? "" : "s"} · {formatUSD(Number(p.amount_usd))} ·{" "}
                    Requested {formatDate((p.created_at as string).slice(0, 10))}
                    {p.paid_at ? ` · Confirmed ${formatDate((p.paid_at as string).slice(0, 10))}` : ""}
                  </p>
                </div>
                {p.status === "pending" ? (
                  <form action={markBulkUploadPaymentPaid}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className={adminBtnSecondary}>Confirm payment received</button>
                  </form>
                ) : (
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      p.status === "consumed"
                        ? "border-neutral-300 bg-neutral-50 text-neutral-600"
                        : "border-green-300 bg-green-50 text-green-800"
                    }`}
                  >
                    {p.status === "consumed" ? "Fully used" : "Paid — ready to upload"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section id="referees" title="Referees / Judges">
        {refereeRows.length === 0 ? (
          <EmptyState>No referee registrations yet.</EmptyState>
        ) : (
          <FilterableTable columns={refereeColumns} rows={refereeRows} rowKey="id" downloadName="referees" />
        )}
      </Section>

      <Section id="audience" title="Audience / Spectators">
        {audienceRows.length === 0 ? (
          <EmptyState>No audience registrations yet.</EmptyState>
        ) : (
          <FilterableTable columns={audienceColumns} rows={audienceRows} rowKey="id" downloadName="audience" />
        )}
      </Section>

      <Section id="schools" title="Schools / Dojos">
        {schoolRows.length === 0 ? (
          <EmptyState>No schools registered yet.</EmptyState>
        ) : (
          <FilterableTable columns={schoolColumns} rows={schoolRows} rowKey="id" downloadName="schools" />
        )}
      </Section>

      <Section id="senseis" title="Senseis">
        {senseiRows.length === 0 ? (
          <EmptyState>No senseis registered yet.</EmptyState>
        ) : (
          <FilterableTable columns={senseiColumns} rows={senseiRows} rowKey="id" downloadName="senseis" />
        )}
      </Section>

      <Section id="staff" title="Admin / Organizer / Customer Support">
        {staffRows.length === 0 ? (
          <EmptyState>No staff accounts yet.</EmptyState>
        ) : (
          <FilterableTable columns={staffColumns} rows={staffRows} rowKey="user_id" downloadName="staff-accounts" />
        )}
      </Section>
    </AdminShell>
  );
}
