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
}

export async function getAdminCounts(): Promise<AdminCounts> {
  const supabase = await createClient();
  const count = async (table: string, filter?: [string, string]) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    const { count: c } = await q;
    return c ?? 0;
  };
  const [total, pending, paid, rejected, participants, schools, senseis, announcements] =
    await Promise.all([
      count("registrations"),
      count("registrations", ["payment_status", "pending"]),
      count("registrations", ["payment_status", "paid"]),
      count("registrations", ["payment_status", "rejected"]),
      count("participants"),
      count("schools"),
      count("senseis"),
      count("announcements"),
    ]);
  return {
    registrations: { total, pending, paid, rejected },
    participants,
    schools,
    senseis,
    announcements,
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

export async function getRecentAuditLogs(limit = 20): Promise<AuditLog[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as AuditLog[]) ?? [];
}
