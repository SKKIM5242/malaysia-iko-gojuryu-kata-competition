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

/**
 * All competitions currently open for registration, cheapest first — there
 * can be several at once (e.g. fee tiers of the same championship). Each
 * card gets its own paid-participant count so the UI can show "closed" the
 * moment a tier hits its cap, ahead of its date deadline if that comes first.
 */
export async function getOpenCompetitions(): Promise<Array<Competition & { paidCount: number }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "open")
    .order("registration_fee_usd", { ascending: true, nullsFirst: true });
  const competitions = (data as Competition[]) ?? [];
  return Promise.all(
    competitions.map(async (c) => {
      const { data: count } = await supabase.rpc("competition_paid_count", { p_competition: c.id });
      return { ...c, paidCount: typeof count === "number" ? count : 0 };
    }),
  );
}

export function isCompetitionOpen(
  competition: Pick<Competition, "status" | "registration_deadline" | "max_participants">,
  paidCount: number,
): boolean {
  if (competition.status !== "open") return false;
  const deadlinePassed =
    competition.registration_deadline != null &&
    new Date(competition.registration_deadline + "T23:59:59") < new Date();
  if (deadlinePassed) return false;
  if (competition.max_participants != null && paidCount >= competition.max_participants) return false;
  return true;
}

export async function getCompetitionById(id: string): Promise<Competition | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("competitions").select("*").eq("id", id).maybeSingle();
  return (data as Competition) ?? null;
}

export async function getCategories(competitionId: string): Promise<Category[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("competition_id", competitionId)
    .order("sort_order")
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
  kataBase?: string;
  schoolId?: string;
  page?: number;
  pageSize?: number;
}

export interface ConfirmedRegistration extends Registration {
  participant: Participant | null;
  category: Pick<Category, "id" | "name"> | null;
}

export async function getConfirmedRegistrations(
  competitionIds: string | string[],
  filters: ParticipantFilters = {},
): Promise<{ rows: ConfirmedRegistration[]; total: number }> {
  const supabase = await createClient();
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  const ids = Array.isArray(competitionIds) ? competitionIds : [competitionIds];
  let query = supabase
    .from("registrations")
    .select(
      "*, participant:participants(*, school:schools(id,name,state), sensei:senseis(id,name,rank)), category:categories(id,name)",
      { count: "exact" },
    )
    .in("competition_id", ids)
    .eq("payment_status", "paid")
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  const { data, count } = await query;
  let rows = (data as unknown as ConfirmedRegistration[]) ?? [];
  if (filters.kataBase) {
    rows = rows.filter((r) => r.category?.name?.startsWith(filters.kataBase!));
  }
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
