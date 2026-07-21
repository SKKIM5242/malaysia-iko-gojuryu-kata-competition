import { createClient } from "@/lib/supabase/server";
import type {
  Announcement,
  AuditLog,
  Competition,
  Participant,
  PaymentStatus,
  Registration,
  School,
  Sensei,
} from "@/lib/types";

export interface RefereeRecord {
  id: string; full_name: string; ic_passport: string; date_of_birth: string | null;
  gender: string | null; karate_rank: string | null; judging_experience_count: number | null;
  school: string | null; email: string | null; phone: string | null; home_address: string | null;
  city_town: string | null; home_country: string | null;
  bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null;
  certificate_path: string | null; invitation_code: string | null;
  payment_status: string; status: string; created_at: string;
  certificateUrl: string | null;
}

export interface AudienceRecord {
  id: string; full_name: string; email: string | null; phone: string | null;
  home_country: string | null; invitation_code: string | null;
  payment_status: string; created_at: string;
}

export interface StaffAccountRecord {
  user_id: string; role: string; full_name: string | null; country: string | null;
  email: string | null; approved: boolean; created_at: string;
}

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

/** Every competition, cheapest tier first (USD 10, USD 100, USD 200, ...) so
 * every tier dropdown and competition-grouped section across the admin site
 * lists them in the same order as the public registration page. Competitions
 * with no fee set sort last; ties fall back to newest first. */
export async function getAllCompetitions(): Promise<Competition[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitions")
    .select("*")
    .order("registration_fee_usd", { ascending: true, nullsFirst: false })
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
  maxAttempts: number;
  videoCreatedAt: string | null;
  videoUrl: string | null;
  certificateUrl: string | null;
  slotStatus: "active" | "unslotted" | "forfeited" | "given_up";
  slotStatusNote: string | null;
  slotStatusChangedBy: string | null;
  slotStatusChangedAt: string | null;
}

/** One row per paid (or slot-actioned) registration, joining participant
 * details, assigned category, submitted-kata-video status, re-record
 * attempt count, and slot status — the dataset behind the admin Participant
 * Records page. Forfeited registrations stay visible so staff can review
 * and clean them up rather than disappearing from the list. */
export async function getParticipantRecords(): Promise<ParticipantRecord[]> {
  const supabase = await createClient();
  const { data: regs } = await supabase
    .from("registrations")
    .select(
      "id, slot_status, slot_status_note, slot_status_changed_by, slot_status_changed_at, participant:participants(*, school:schools(id,name,state), sensei:senseis(id,name,rank), bank:participant_bank_details(bank_name,bank_account_no,bank_account_name)), category:categories(id,name), competition:competitions(id,name)",
    )
    .in("payment_status", ["paid", "forfeited"])
    .order("created_at", { ascending: false });
  const regList =
    (regs as unknown as Array<{
      id: string;
      slot_status: "active" | "unslotted" | "forfeited" | "given_up";
      slot_status_note: string | null;
      slot_status_changed_by: string | null;
      slot_status_changed_at: string | null;
      participant: Participant | null;
      category: { id: string; name: string } | null;
      competition: { id: string; name: string } | null;
    }>) ?? [];
  if (regList.length === 0) return [];

  const regIds = regList.map((r) => r.id);
  const changedByIds = [...new Set(regList.map((r) => r.slot_status_changed_by).filter((id): id is string => !!id))];
  const [{ data: videos }, { data: profiles }, { data: changedByProfiles }] = await Promise.all([
    supabase.from("kata_videos").select("registration_id, storage_path, created_at").in("registration_id", regIds),
    supabase.from("profiles").select("registration_id, record_attempts, bonus_record_attempts").in("registration_id", regIds),
    changedByIds.length > 0
      ? supabase.from("profiles").select("user_id, full_name, email").in("user_id", changedByIds)
      : Promise.resolve({ data: [] }),
  ]);
  const videoByReg = new Map(
    (videos ?? []).map((v) => [v.registration_id as string, { storagePath: v.storage_path as string, createdAt: v.created_at as string }]),
  );
  const attemptsByReg = new Map((profiles ?? []).map((p) => [p.registration_id as string, p.record_attempts as number]));
  const maxAttemptsByReg = new Map(
    (profiles ?? []).map((p) => [p.registration_id as string, 3 + (p.bonus_record_attempts as number ?? 0)]),
  );
  const nameByChangedBy = new Map(
    (changedByProfiles ?? []).map((p) => [p.user_id as string, (p.full_name as string) || (p.email as string) || (p.user_id as string)]),
  );

  const paths = [...videoByReg.values()].map((v) => v.storagePath);
  const signedUrlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedUrlByPath.set(s.path, s.signedUrl);
    }
  }

  const certPaths = regList.map((r) => r.participant?.certificate_path).filter((p): p is string => !!p);
  const certUrlByPath = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signedCerts } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signedCerts ?? []) {
      if (s.path && s.signedUrl) certUrlByPath.set(s.path, s.signedUrl);
    }
  }

  return regList
    .filter((r) => r.participant)
    .map((r) => {
      const video = videoByReg.get(r.id);
      const certPath = r.participant?.certificate_path;
      return {
        registrationId: r.id,
        competitionName: r.competition?.name ?? null,
        categoryName: r.category?.name ?? null,
        participant: r.participant as Participant,
        recordAttempts: attemptsByReg.get(r.id) ?? 0,
        maxAttempts: maxAttemptsByReg.get(r.id) ?? 3,
        videoCreatedAt: video?.createdAt ?? null,
        videoUrl: video ? (signedUrlByPath.get(video.storagePath) ?? null) : null,
        certificateUrl: certPath ? (certUrlByPath.get(certPath) ?? null) : null,
        slotStatus: r.slot_status ?? "active",
        slotStatusNote: r.slot_status_note,
        slotStatusChangedBy: r.slot_status_changed_by ? (nameByChangedBy.get(r.slot_status_changed_by) ?? r.slot_status_changed_by) : null,
        slotStatusChangedAt: r.slot_status_changed_at,
      };
    });
}

export async function getRefereeRecords(): Promise<RefereeRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("referees").select("*").order("created_at", { ascending: false });
  const referees = (data as Omit<RefereeRecord, "certificateUrl">[]) ?? [];
  const certPaths = referees.map((r) => r.certificate_path).filter((p): p is string => !!p);
  const certUrlByPath = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) certUrlByPath.set(s.path, s.signedUrl);
    }
  }
  return referees.map((r) => ({
    ...r,
    certificateUrl: r.certificate_path ? (certUrlByPath.get(r.certificate_path) ?? null) : null,
  }));
}

export async function getAudienceRecords(): Promise<AudienceRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("audiences").select("*").order("created_at", { ascending: false });
  return (data as AudienceRecord[]) ?? [];
}

export async function getSchoolRecords(): Promise<School[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("schools").select("*").order("created_at", { ascending: false });
  return (data as School[]) ?? [];
}

export interface SenseiRecord extends Sensei {
  certificateUrl: string | null;
}

export async function getSenseiRecords(): Promise<SenseiRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("senseis")
    .select("*, school:schools(id,name)")
    .order("created_at", { ascending: false });
  const senseis = (data as Sensei[]) ?? [];
  const certPaths = senseis.map((s) => s.certificate_path).filter((p): p is string => !!p);
  const certUrlByPath = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) certUrlByPath.set(s.path, s.signedUrl);
    }
  }
  return senseis.map((s) => ({
    ...s,
    certificateUrl: s.certificate_path ? (certUrlByPath.get(s.certificate_path) ?? null) : null,
  }));
}

/**
 * A School/Sensei's own USD sign-in fee follows "the Competition tier fee
 * of a single participant" — but a school/sensei can have students spread
 * across several tiers, so this takes the HIGHEST tier fee among their own
 * registered participants (regardless of that registration's own payment
 * status — the tier is what matters, not whether that one participant has
 * paid yet). Returns 0 for a school/sensei with no participants yet.
 */
export async function getSchoolSenseiTierFees(): Promise<{
  schoolFees: Map<string, number>;
  senseiFees: Map<string, number>;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("participants")
    .select("school_id, sensei_id, registrations(competition:competitions(registration_fee_usd))");
  const rows =
    (data as unknown as Array<{
      school_id: string | null;
      sensei_id: string | null;
      registrations: Array<{ competition: { registration_fee_usd: number | null } | null }> | null;
    }>) ?? [];

  const schoolFees = new Map<string, number>();
  const senseiFees = new Map<string, number>();
  for (const r of rows) {
    const fees = (r.registrations ?? [])
      .map((reg) => Number(reg.competition?.registration_fee_usd ?? 0))
      .filter((f) => f > 0);
    if (fees.length === 0) continue;
    const maxFee = Math.max(...fees);
    if (r.school_id) schoolFees.set(r.school_id, Math.max(schoolFees.get(r.school_id) ?? 0, maxFee));
    if (r.sensei_id) senseiFees.set(r.sensei_id, Math.max(senseiFees.get(r.sensei_id) ?? 0, maxFee));
  }
  return { schoolFees, senseiFees };
}

/** Login accounts for the three roles without their own community
 * registration table — Admin/Organizer and Participant Support are created
 * directly (see app/actions/admin.ts createStaffAccount). */
export async function getStaffAccountRecords(): Promise<StaffAccountRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("user_id, role, full_name, country, email, approved, created_at")
    .in("role", ["admin", "organizer", "staff", "customer_support"])
    .order("created_at", { ascending: false });
  return (data as StaffAccountRecord[]) ?? [];
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
