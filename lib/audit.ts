import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only audit trail — written on every state-changing action
 * (see docs/SECURITY.md). Failures are swallowed so an audit hiccup
 * never blocks the underlying action; the action itself is the source
 * of truth.
 */
export async function writeAudit(
  supabase: SupabaseClient,
  entry: {
    table_name: string;
    record_id: string | null;
    action: string;
    old_value?: unknown;
    new_value?: unknown;
    actor_id?: string | null;
  },
) {
  try {
    await supabase.from("audit_logs").insert({
      table_name: entry.table_name,
      record_id: entry.record_id,
      action: entry.action,
      old_value: entry.old_value ?? null,
      new_value: entry.new_value ?? null,
      actor_id: entry.actor_id ?? null,
    });
  } catch {
    // never block the primary action on audit failure
  }
}
