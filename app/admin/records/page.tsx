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
import { ageAt } from "@/lib/division";
import { markAttemptPurchasePaid, markBulkUploadPaymentPaid, markSubscriptionRenewalFulfilled } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin (owner)",
  organizer: "Organizer",
  staff: "Admin / Organizer",
  customer_support: "Participant Support",
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

export default async function AdminParticipantRecords({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Participant Records" active="/admin/records" flash={{ ok, error }}>
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
  const canManageSlot = ["admin", "organizer", "staff", "referee"].includes(myProfile?.role ?? "");
  const canLinkAccount = ["admin", "organizer", "staff", "customer_support", "referee"].includes(myProfile?.role ?? "");
  const canResendEmail = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");

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
    .select("id, batch_id, sensei_id, school_id, competition_id, participant_count, declared_participants, amount_usd, status, created_at, paid_at")
    .order("created_at", { ascending: false });
  const bulkPaymentList = bulkPayments ?? [];
  const bulkSenseiIds = [...new Set(bulkPaymentList.map((p) => p.sensei_id as string))];
  const bulkSchoolIds = [...new Set(bulkPaymentList.map((p) => p.school_id as string))];
  const bulkCompetitionIds = [...new Set(bulkPaymentList.map((p) => p.competition_id as string))];
  const [{ data: bulkSenseis }, { data: bulkSchools }, { data: bulkCompetitions }] = await Promise.all([
    bulkSenseiIds.length > 0
      ? supabase.from("senseis").select("id, name").in("id", bulkSenseiIds)
      : Promise.resolve({ data: [] }),
    bulkSchoolIds.length > 0
      ? supabase.from("schools").select("id, name").in("id", bulkSchoolIds)
      : Promise.resolve({ data: [] }),
    bulkCompetitionIds.length > 0
      ? supabase.from("competitions").select("id, name").in("id", bulkCompetitionIds)
      : Promise.resolve({ data: [] }),
  ]);
  const senseiNameById = new Map((bulkSenseis ?? []).map((s) => [s.id as string, s.name as string]));
  const schoolNameById = new Map((bulkSchools ?? []).map((s) => [s.id as string, s.name as string]));
  const bulkCompetitionNameById = new Map((bulkCompetitions ?? []).map((c) => [c.id as string, c.name as string]));

  // One enquiry can cover up to 3 tiers at once, sharing a batch_id with
  // one combined bill — group siblings together so admin confirms (or
  // sees) the whole batch as one card, not 3 separate ones.
  const bulkBatches = new Map<string, typeof bulkPaymentList>();
  for (const p of bulkPaymentList) {
    const key = (p.batch_id as string | null) ?? (p.id as string);
    const list = bulkBatches.get(key) ?? [];
    list.push(p);
    bulkBatches.set(key, list);
  }

  // Paid, still-active registrations with no recording submitted yet — a
  // focused chase-up list (name, email, deadline) separate from the full
  // Participants table below, sorted soonest-deadline-first.
  const pendingRecordingRows = participantRecords
    .filter((r) => !r.videoCreatedAt && r.slotStatus === "active")
    .map((r) => {
      const daysLeft = r.registrationDeadline
        ? Math.ceil((new Date(r.registrationDeadline).getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000))
        : null;
      return {
        registrationId: r.registrationId,
        fullName: r.participant.full_name,
        email: r.participant.email ?? "",
        competition: r.competitionName ?? "—",
        deadline: r.registrationDeadline ? formatDate(r.registrationDeadline) : "—",
        deadlineRaw: r.registrationDeadline ?? "",
        daysLeft:
          daysLeft == null
            ? "—"
            : daysLeft < 0
              ? `OVERDUE — ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago`
              : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
      };
    })
    .sort((a, b) => a.deadlineRaw.localeCompare(b.deadlineRaw));

  const participantRows: ParticipantRecordRow[] = participantRecords.map((r) => ({
    registrationId: r.registrationId,
    competition: r.competitionName ?? "—",
    category: r.categoryName ?? "—",
    fullName: r.participant.full_name,
    icPassport: r.participant.ic_passport,
    dateOfBirth: formatDOB(r.participant.date_of_birth),
    age: r.participant.date_of_birth ? String(ageAt(r.participant.date_of_birth, null)) : "—",
    gender: r.participant.gender ?? "—",
    beltRank: r.participant.belt_rank ?? "",
    rankConfirmation: r.participant.rank_confirmation ?? "",
    certificateUrl: r.certificateUrl,
    homeAddress: r.participant.home_address ?? "",
    country: r.participant.home_country ?? "",
    cityTown: r.participant.city_town ?? "",
    postcode: r.participant.postcode ?? "",
    email: r.participant.email ?? "",
    phone: r.participant.phone ?? "",
    school: r.participant.school?.name ?? "",
    sensei: r.participant.sensei?.name ?? "",
    invitationCode: r.participant.invitation_code ?? "",
    referralSource: r.participant.referral_source ?? "",
    bankName: r.participant.bank?.bank_name ?? "",
    bankAccountNo: r.participant.bank?.bank_account_no ?? "",
    bankAccountName: r.participant.bank?.bank_account_name ?? "",
    recordingStatus: r.videoCreatedAt ? "Submitted" : "Not submitted",
    recordingDate: r.videoCreatedAt ? formatDate(r.videoCreatedAt.slice(0, 10)) : "",
    // "2 of 3" rather than "2/3" — the slash form reads as a date (e.g.
    // "2/3") to Excel's CSV auto-import, which silently rewrites it to
    // "2/3/<current year>".
    attempts: `${r.recordAttempts} of ${r.maxAttempts}`,
    videoUrl: r.videoUrl,
    slotStatus: r.slotStatus,
    slotStatusNote: r.slotStatusNote,
    slotStatusChangedBy: r.slotStatusChangedBy,
    slotStatusChangedAt: r.slotStatusChangedAt,
    linkedAccountEmail: r.linkedAccountEmail,
  }));

  const refereeColumns = [
    { key: "full_name", label: "Full Name" },
    { key: "reference_id", label: "Reference ID" },
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
    id: r.id,
    reference_id: r.id.slice(0, 8).toUpperCase(),
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
    { key: "full_name", label: "Full Name" },
    { key: "reference_id", label: "Reference ID" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "home_country", label: "Country" },
    { key: "invitation_code", label: "Invitation Code" },
    { key: "payment_status", label: "Payment Status" },
  ];
  const audienceRows = audiences.map((a) => ({
    id: a.id,
    reference_id: a.id.slice(0, 8).toUpperCase(),
    full_name: a.full_name,
    email: a.email ?? "",
    phone: a.phone ?? "",
    home_country: a.home_country ?? "",
    invitation_code: a.invitation_code ?? "",
    payment_status: a.payment_status,
  }));

  const schoolColumns = [
    { key: "name", label: "School Name" },
    { key: "reference_id", label: "Reference ID" },
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
    id: s.id,
    reference_id: s.id.slice(0, 8).toUpperCase(),
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
    { key: "name", label: "Full Name" },
    { key: "reference_id", label: "Reference ID" },
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
    id: s.id,
    reference_id: s.id.slice(0, 8).toUpperCase(),
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
    { key: "full_name", label: "Full Name" },
    { key: "reference_id", label: "Reference ID" },
    { key: "role", label: "Role" },
    { key: "country", label: "Country" },
    { key: "email", label: "Email" },
    { key: "approved", label: "Status" },
  ];
  const staffRows = staffAccounts.map((s) => ({
    user_id: s.user_id,
    reference_id: s.user_id.slice(0, 8).toUpperCase(),
    full_name: s.full_name ?? "",
    role: ROLE_LABEL[s.role] ?? s.role,
    country: s.country ?? "",
    email: s.email ?? "",
    approved: s.approved ? "Approved" : "Pending",
  }));

  return (
    <AdminShell title="Participant Records" active="/admin/records" flash={{ ok, error }}>
      <p className="mb-6 text-sm text-neutral-500">
        Every registrant type in one place, each with its own filterable table. Recordings and
        certificates play/open in-page for Admin/Organizer, Referee/Judge, and Participant Support here, on{" "}
        <a href="/kata-arena" className="underline">Kata Arena</a>, and on{" "}
        <a href="/admin/judging" className="underline">Judging</a>. Participants and Audience accounts
        continue watching recordings only via Kata Arena, per its existing access rules.
      </p>

      <Section id="pending-recordings" title="Pending Recording Submissions (chase-up list)">
        <p className="mb-3 text-xs text-neutral-400">
          Paid, still-active registrations with no recording submitted yet — sorted by soonest
          deadline first, so overdue ones surface at the top.
        </p>
        {pendingRecordingRows.length === 0 ? (
          <EmptyState>Everyone with a paid, active registration has submitted their recording.</EmptyState>
        ) : (
          <FilterableTable
            rowKey="registrationId"
            downloadName="pending-recording-submissions"
            columns={[
              { key: "fullName", label: "Name" },
              { key: "email", label: "Email" },
              { key: "competition", label: "Tier" },
              { key: "deadline", label: "Deadline" },
              { key: "daysLeft", label: "Time Left" },
            ]}
            rows={pendingRecordingRows.map((r) => ({
              registrationId: r.registrationId,
              fullName: r.fullName,
              email: r.email,
              competition: r.competition,
              deadline: r.deadline,
              daysLeft: r.daysLeft,
            }))}
          />
        )}
      </Section>

      <Section id="participants" title="Participants">
        <p className="mb-3 text-xs text-neutral-400">
          A participant who has not submitted a recording by their competition&apos;s deadline is
          automatically marked Unslotted and their payment Forfeited (checked daily). Admin,
          Organizer, and Referee/Judge accounts can also set or reset Unslot / Forfeited / Give Up
          manually from the Slot Status column, to clean up the list at any time. The Account Link
          column shows whether the participant has actually claimed their registration with a login
          — if they can&apos;t (wrong reference ID, signed up with a different email, etc.), Admin,
          Organizer, Participant Support, or Referee/Judge can link it for them from that column
          instead of asking a developer to fix it manually.
        </p>
        {participantRows.length === 0 ? (
          <EmptyState>No successful registrations yet.</EmptyState>
        ) : (
          <ParticipantRecordsTable
            rows={participantRows}
            isAdmin={isAdmin}
            canManageSlot={canManageSlot}
            canLinkAccount={canLinkAccount}
            canResendEmail={canResendEmail}
          />
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
            {[...bulkBatches.values()].map((rows) => {
              const first = rows[0];
              const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount_usd), 0);
              const allPending = rows.every((r) => r.status === "pending");
              const allConsumed = rows.every((r) => r.status === "consumed");
              const batchKey = (first.batch_id as string | null) ?? (first.id as string);
              return (
                <div key={batchKey} className="rounded-md border border-neutral-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-neutral-900">
                        {senseiNameById.get(first.sensei_id as string) ?? "—"}
                        <span className="font-normal text-neutral-400"> · {schoolNameById.get(first.school_id as string) ?? "—"}</span>
                      </p>
                      <p className="text-xs text-neutral-400">
                        Combined total {formatUSD(totalAmount)} across {rows.length} tier{rows.length === 1 ? "" : "s"} ·{" "}
                        Requested {formatDate((first.created_at as string).slice(0, 10))}
                        {first.paid_at ? ` · Confirmed ${formatDate((first.paid_at as string).slice(0, 10))}` : ""}
                      </p>
                    </div>
                    {allPending ? (
                      <form action={markBulkUploadPaymentPaid}>
                        <input type="hidden" name="id" value={first.id} />
                        <button type="submit" className={adminBtnSecondary}>Confirm payment received</button>
                      </form>
                    ) : (
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          allConsumed
                            ? "border-neutral-300 bg-neutral-50 text-neutral-600"
                            : "border-green-300 bg-green-50 text-green-800"
                        }`}
                      >
                        {allConsumed ? "Fully used" : "Paid — ready to upload"}
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1 border-t border-neutral-100 pt-2">
                    {rows.map((r) => (
                      <li key={r.id as string} className="flex items-center justify-between text-xs text-neutral-500">
                        <span>{bulkCompetitionNameById.get(r.competition_id as string) ?? "—"}</span>
                        <span>
                          {r.declared_participants} participant{r.declared_participants === 1 ? "" : "s"} ·{" "}
                          {r.status === "pending" ? "requested for" : "remaining"} {r.participant_count} event
                          {r.participant_count === 1 ? "" : "s"} · {formatUSD(Number(r.amount_usd))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
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

      <Section id="staff" title="Admin / Organizer / Participant Support">
        {staffRows.length === 0 ? (
          <EmptyState>No staff accounts yet.</EmptyState>
        ) : (
          <FilterableTable columns={staffColumns} rows={staffRows} rowKey="user_id" downloadName="staff-accounts" />
        )}
      </Section>
    </AdminShell>
  );
}
