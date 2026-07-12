import { createClient } from "@/lib/supabase/server";
import type {
  Announcement,
  Category,
  Competition,
  Participant,
  Registration,
  School,
  Sensei,
} from "@/lib/types";

/**
 * All public reads live here. Every function returns { data, error } style
 * results already unwrapped — callers render empty/error states off null.
 */

export async function getActiveCompetition(): Promise<Competition | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) return data as Competition;
  // Fall back to the most recent competition of any status so the site
  // still shows something between events.
  const { data: latest } = await supabase
    .from("competitions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (latest as Competition) ?? null;
}

export async function getCategories(competitionId: string): Promise<Category[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId)
    .order("name");
  return (data as Category[]) ?? [];
}

export async function getPublishedAnnouncements(limit = 10): Promise<Announcement[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("*")
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Announcement[]) ?? [];
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Announcement) ?? null;
}

export interface ParticipantFilters {
  categoryId?: string;
  schoolId?: string;
  page?: number;
  pageSize?: number;
}

export interface ConfirmedRegistration extends Registration {
  participant: Participant | null;
  category: Pick<Category, "id" | "name"> | null;
}

export async function getConfirmedRegistrations(
  competitionId: string,
  filters: ParticipantFilters = {},
): Promise<{ rows: ConfirmedRegistration[]; total: number }> {
  const supabase = await createClient();
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("registrations")
    .select(
      "*, participant:participants(*, school:schools(id,name,state), sensei:senseis(id,name,rank)), category:categories(id,name)",
      { count: "exact" },
    )
    .eq("competition_id", competitionId)
    .eq("payment_status", "paid")
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  const { data, count } = await query;
  let rows = (data as unknown as ConfirmedRegistration[]) ?? [];
  if (filters.schoolId) {
    rows = rows.filter((r) => r.participant?.school_id === filters.schoolId);
  }
  return { rows, total: count ?? rows.length };
}

export async function getSchools(): Promise<School[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("schools").select("*").order("name");
  return (data as School[]) ?? [];
}

export async function getSenseis(): Promise<Sensei[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("senseis")
    .select("*, school:schools(id,name)")
    .order("name");
  return (data as unknown as Sensei[]) ?? [];
}

/** True when the schema hasn't been applied yet — used to show a setup notice. */
export async function schemaReady(): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.from("competitions").select("id").limit(1);
  return !error;
}
