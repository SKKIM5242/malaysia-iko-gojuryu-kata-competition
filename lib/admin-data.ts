import { createClient } from "@/lib/supabase/server";
import type {
  Announcement,
  AuditLog,
  Competition,
  Participant,
  PaymentStatus,
  Registration,
} from "@/lib/types";

export interface AdminCounts {
  registrations: { total: number; pending: number; paid: number; rejected: number };
  participants: number;
  schools: number;
  senseis: number;
  announcements: number;
  referees: number;
  audiences: number;
  staffApplications: { organizer: number; customerSupport: number };
}

export async function getAdminCounts(): Promise<AdminCounts> {
  const supabase = await createClient();
  const count = async (table: string, filter?: [string, string]) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    const { count: c } = await q;
    return c ?? 0;
  };
  const [
    total, pending, paid, rejected, participants, schools, senseis, announcements,
    referees, audiences, staffOrganizer, staffSupport,
  ] = await Promise.all([
    count("registrations"),
    count("registrations", ["payment_status", "pending"]),
    count("registrations", ["payment_status", "paid"]),
    count("registrations", ["payment_status", "rejected"]),
    count("participants"),
    count("schools"),
    count("senseis"),
    count("announcements"),
    count("referees"),
    count("audiences"),
    supabase
      .from("staff_applications")
      .select("id", { count: "exact", head: true })
      .in("role_requested", ["admin", "organizer"])
      .then((r) => r.count ?? 0),
    count("staff_applications", ["role_requested", "customer_support"]),
  ]);
  return {
    registrations: { total, pending, paid, rejected },
    participants,
    schools,
    senseis,
    announcements,
    referees,
    audiences,
    staffApplications: { organizer: staffOrganizer, customerSupport: staffSupport },
  };
}

export async function getAllRegistrations(statusFilter?: PaymentStatus): Promise<Registration[]> {
  const supabase = await createClient();
  let q = supabase
    .from("registrations")
    .select(
      "*, participant:participants(*, school:schools(id,name,state), sensei:senseis(id,name,rank)), category:categories(id,name), competition:competitions(id,name)",
    )
    .order("created_at", { ascending: false });
  if (statusFilter) q = q.eq("payment_status", statusFilter);
  const { data } = await q;
  return (data as unknown as Registration[]) ?? [];
}

export async function getAllCompetitions(): Promise<Competition[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitions")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Competition[]) ?? [];
}

export async function getAllAnnouncements(): Promise<Announcement[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  return (data as Announcement[]) ?? [];
}

export async function getAllParticipants(): Promise<Participant[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("participants")
    .select(
      "*, school:schools(id,name,state), sensei:senseis(id,name,rank), bank:participant_bank_details(bank_name,bank_account_no,bank_account_name)",
    )
    .order("created_at", { ascending: false });
  return (data as unknown as Participant[]) ?? [];
}

export interface ParticipantRecord {
  registrationId: string;
  competitionName: string | null;
  categoryName: string | null;
  participant: Participant;
  recordAttempts: number;
  videoCreatedAt: string | null;
  videoUrl: string | null;
}

/** One row per successfully-paid registration, joining participant details,
 * assigned category, submitted-kata-video status, and re-record attempt
 * count — the dataset behind the admin Participant Records page. */
export async function getParticipantRecords(): Promise<ParticipantRecord[]> {
  const supabase = await createClient();
  const { data: regs } = await supabase
    .from("registrations")
    .select(
      "id, participant:participants(*, school:schools(id,name,state), sensei:senseis(id,name,rank), bank:participant_bank_details(bank_name,bank_account_no,bank_account_name)), category:categories(id,name), competition:competitions(id,name)",
    )
    .eq("payment_status", "paid")
    .order("created_at", { ascending: false });
  const regList =
    (regs as unknown as Array<{
      id: string;
      participant: Participant | null;
      category: { id: string; name: string } | null;
      competition: { id: string; name: string } | null;
    }>) ?? [];
  if (regList.length === 0) return [];

  const regIds = regList.map((r) => r.id);
  const [{ data: videos }, { data: profiles }] = await Promise.all([
    supabase.from("kata_videos").select("registration_id, storage_path, created_at").in("registration_id", regIds),
    supabase.from("profiles").select("registration_id, record_attempts").in("registration_id", regIds),
  ]);
  const videoByReg = new Map(
    (videos ?? []).map((v) => [v.registration_id as string, { storagePath: v.storage_path as string, createdAt: v.created_at as string }]),
  );
  const attemptsByReg = new Map((profiles ?? []).map((p) => [p.registration_id as string, p.record_attempts as number]));

  const paths = [...videoByReg.values()].map((v) => v.storagePath);
  const signedUrlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedUrlByPath.set(s.path, s.signedUrl);
    }
  }

  return regList
    .filter((r) => r.participant)
    .map((r) => {
      const video = videoByReg.get(r.id);
      return {
        registrationId: r.id,
        competitionName: r.competition?.name ?? null,
        categoryName: r.category?.name ?? null,
        participant: r.participant as Participant,
        recordAttempts: attemptsByReg.get(r.id) ?? 0,
        videoCreatedAt: video?.createdAt ?? null,
        videoUrl: video ? (signedUrlByPath.get(video.storagePath) ?? null) : null,
      };
    });
}

export async function getRecentAuditLogs(limit = 20): Promise<AuditLog[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as AuditLog[]) ?? [];
}
