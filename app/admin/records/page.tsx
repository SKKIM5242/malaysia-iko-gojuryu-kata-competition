import { schemaReady } from "@/lib/data";
import { getParticipantRecords } from "@/lib/admin-data";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import ParticipantRecordsTable, { type ParticipantRecordRow } from "@/components/ParticipantRecordsTable";

export const dynamic = "force-dynamic";
const MAX_ATTEMPTS = 3;

export default async function AdminParticipantRecords() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Participant Records" active="/admin/records">
        <SetupNotice />
      </AdminShell>
    );
  }

  const records = await getParticipantRecords();

  const rows: ParticipantRecordRow[] = records.map((r) => ({
    registrationId: r.registrationId,
    competition: r.competitionName ?? "—",
    category: r.categoryName ?? "—",
    fullName: r.participant.full_name,
    icPassport: r.participant.ic_passport,
    dateOfBirth: formatDate(r.participant.date_of_birth),
    gender: r.participant.gender ?? "—",
    beltRank: r.participant.belt_rank ?? "",
    rankConfirmation: r.participant.rank_confirmation ?? "",
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

  return (
    <AdminShell title="Participant Records" active="/admin/records">
      <p className="mb-6 text-sm text-neutral-500">
        Every successfully paid registration in one table — full registration details, assigned kata
        category, kata video submission status with date, and re-record attempts used. Recordings play
        in-page for Admin/Organizer, Referee/Judge, and Customer Support here, on{" "}
        <a href="/kata-arena" className="underline">Kata Arena</a>, and on{" "}
        <a href="/admin/judging" className="underline">Judging</a>. Participants and Audience accounts
        continue watching only via Kata Arena, per its existing access rules.
      </p>
      {rows.length === 0 ? (
        <EmptyState>No successful registrations yet.</EmptyState>
      ) : (
        <ParticipantRecordsTable rows={rows} />
      )}
    </AdminShell>
  );
}
