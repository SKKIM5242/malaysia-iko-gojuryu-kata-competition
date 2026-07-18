import { createClient } from "@/lib/supabase/server";

const HOURLY_RATE_USD = 8;

export interface SupportShift {
  id: string;
  userId: string;
  userName: string;
  clockInAt: string;
  clockOutAt: string | null;
  taskSummary: string | null;
  hours: number | null;
  payUsd: number | null;
}

function hoursBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  return (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
}

/** The signed-in user's own currently-open shift, if any — used to switch
 * the Clock In button to a Clock Out + task summary form. */
export async function getOpenShift(userId: string): Promise<SupportShift | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_shifts")
    .select("id, user_id, clock_in_at, clock_out_at, task_summary")
    .eq("user_id", userId)
    .is("clock_out_at", null)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id, userId: data.user_id, userName: "",
    clockInAt: data.clock_in_at, clockOutAt: data.clock_out_at, taskSummary: data.task_summary,
    hours: null, payUsd: null,
  };
}

/** Every Participant Support member's full shift history, most recent first —
 * RLS already restricts this query to admin-tier viewers only. */
export async function getAllShifts(): Promise<SupportShift[]> {
  const supabase = await createClient();
  const { data: shifts } = await supabase
    .from("support_shifts")
    .select("id, user_id, clock_in_at, clock_out_at, task_summary")
    .order("clock_in_at", { ascending: false });
  const rows = shifts ?? [];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", userIds);
  const nameByUser = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, (p.full_name as string) || (p.email as string) || p.user_id as string]),
  );

  return rows.map((r) => {
    const hours = hoursBetween(r.clock_in_at as string, r.clock_out_at as string | null);
    return {
      id: r.id as string,
      userId: r.user_id as string,
      userName: nameByUser.get(r.user_id as string) ?? (r.user_id as string).slice(0, 8),
      clockInAt: r.clock_in_at as string,
      clockOutAt: r.clock_out_at as string | null,
      taskSummary: r.task_summary as string | null,
      hours,
      payUsd: hours != null ? hours * HOURLY_RATE_USD : null,
    };
  });
}
