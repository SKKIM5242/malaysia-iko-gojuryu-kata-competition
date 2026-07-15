import { schemaReady } from "@/lib/data";
import {
  getAudienceRecords,
  getParticipantRecords,
  getRefereeRecords,
  getSchoolRecords,
  getSenseiRecords,
  getStaffAccountRecords,
} from "@/lib/admin-data";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import ParticipantRecordsTable, { type ParticipantRecordRow } from "@/components/ParticipantRecordsTable";
import FilterableTable from "@/components/FilterableTable";

export const dynamic = "force-dynamic";
const MAX_ATTEMPTS = 3;

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

  const participantRows: ParticipantRecordRow[] = participantRecords.map((r) => ({
    registrationId: r.registrationId,
    competition: r.competitionName ?? "—",
    category: r.categoryName ?? "—",
    fullName: r.participant.full_name,
    icPassport: r.participant.ic_passport,
    dateOfBirth: formatDate(r.participant.date_of_birth),
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
    bank: r.participant.bank
      ? `${r.participant.bank.bank_name} · ${r.participant.bank.bank_account_no} · ${r.participant.bank.bank_account_name}`
      : "",
    recordingStatus: r.videoCreatedAt ? "Submitted" : "Not submitted",
    recordingDate: r.videoCreatedAt ? formatDate(r.videoCreatedAt.slice(0, 10)) : "",
    attempts: `${r.recordAttempts}/${MAX_ATTEMPTS}`,
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
    { key: "bank", label: "Payout Bank" },
    { key: "certificateUrl", label: "Certificate" },
    { key: "payment_status", label: "Deposit Status" },
    { key: "status", label: "Application Status" },
  ];
  const refereeRows = referees.map((r) => ({
    id: r.id.slice(0, 8).toUpperCase(),
    full_name: r.full_name,
    ic_passport: r.ic_passport,
    date_of_birth: formatDate(r.date_of_birth),
    gender: r.gender ?? "",
    karate_rank: r.karate_rank ?? "",
    judging_experience_count: r.judging_experience_count != null ? String(r.judging_experience_count) : "",
    school: r.school ?? "",
    home_address: r.home_address ?? "",
    city_town: r.city_town ?? "",
    home_country: r.home_country ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    bank: r.bank_name ? `${r.bank_name} · ${r.bank_account_no} · ${r.bank_account_name}` : "",
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
          <ParticipantRecordsTable rows={participantRows} />
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
