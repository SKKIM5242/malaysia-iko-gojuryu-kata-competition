/**
 * Public-facing comparison of what each paid registration actually gets —
 * shown on the Registration hub so every registrant can see, before
 * paying, how their access compares to the other roles. Kept in sync with
 * the real route gating (see lib/access-matrix.ts for the admin-side
 * version of the same facts).
 */
import AccessComparisonTableView from "@/components/AccessComparisonTableView";

const ROWS: Array<{ what: string; cells: [string, string, string, string, string, string, string] }> = [
  {
    what: "Fee",
    cells: [
      "Tier fee per kata event (USD 10 / 100 / 200)",
      "One-time tier fee (USD 10 / 100 / 200)",
      "One-time tier fee (USD 10 / 100 / 200)",
      "USD 100 deposit per competition tier",
      "USD 10 / 100 / 200 per competition tier, per sign-in",
      "By application",
      "By application",
    ],
  },
  {
    what: "Kata Arena",
    cells: [
      "Own competition tier",
      "Own school's students only — their tier & kata events (all recordings once Winners are announced)",
      "Own students only — their tier & kata events (all recordings once Winners are announced)",
      "All recordings",
      "All recordings",
      "All recordings",
      "All recordings",
    ],
  },
  {
    what: "Judge-by-judge scores",
    cells: [
      "Round status + total only",
      "Round status + total only",
      "Round status + total only",
      "Every judge's score",
      "Only after Winners are finalized",
      "Every judge's score + detail",
      "Every judge's score",
    ],
  },
  {
    what: "Record & submit kata / viewing scope",
    cells: [
      "Record & submission or recording of own event(s) (all events once Winners are announced)",
      "View own students' events only (all events once Winners are announced)",
      "View own students' events only (all events once Winners are announced)",
      "View all events",
      "View all events",
      "View all events",
      "View all events",
    ],
  },
  {
    what: "Score recordings",
    cells: ["No", "No", "No", "Assigned recordings", "No", "Any recording (override)", "No"],
  },
  {
    what: "Judging area (assignments, workload, Full View)",
    cells: ["No", "No", "No", "Yes", "No", "Yes — full control", "Yes — view only"],
  },
  {
    what: "Admin panel listings",
    cells: ["No", "No", "No", "View", "No", "Full control", "View + payments + codes"],
  },
  {
    what: "Commission",
    cells: [
      "—",
      "10% of student fees at 10+ participants",
      "10% of student fees at 10+ participants",
      "10% per judged student",
      "—",
      "—",
      "—",
    ],
  },
  {
    what: "Telegram groups",
    cells: ["Own category", "School group", "School group", "All groups", "Audience group", "All groups", "All groups"],
  },
  {
    what: "Sign-in allowance per competition tier",
    cells: [
      "Unlimited per competition tier once fee paid (own recording)",
      "Unlimited per competition tier once fee paid (own school's recordings only)",
      "Unlimited per competition tier once fee paid (own participants only)",
      "Unlimited once approved",
      "Paid per sign-in, per competition tier (USD 10 / 100 / 200)",
      "Unlimited",
      "Unlimited once approved",
    ],
  },
];

/** The code's built-in rows, used to seed the editable
 * access_comparison_rows table and as the fallback while it's empty. */
export const DEFAULT_COMPARISON_ROWS = ROWS;

export interface ComparisonRow {
  id?: string;
  what: string;
  cells: [string, string, string, string, string, string, string];
}

/** DB-backed since the organizer can now edit this table from the admin
 * Content page — falls back to the built-in rows while the table is
 * empty. */
export default async function AccessComparisonTable() {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data } = await supabase.from("access_comparison_rows").select("*").order("position");
  const rows: ComparisonRow[] =
    data && data.length > 0
      ? data.map((r) => ({
          id: r.id,
          what: r.what,
          cells: [r.participant, r.school, r.sensei, r.referee, r.audience, r.organizer, r.support],
        }))
      : ROWS;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-neutral-900">What Your Payment Unlocks — Access Comparison</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Every registration type side by side, so you can see exactly what you get for your fee.
      </p>
      <div className="mt-4">
        <AccessComparisonTableView rows={rows} />
      </div>
      <p className="mt-3 text-xs text-neutral-400">
        Why does Participant Support get view access that Schools, Senseis, Participants, Audience,
        and Referees don&apos;t? Because they are the help desk: to answer a registrant&apos;s or
        referee&apos;s question they must be able to see the same screens the person asking is
        looking at — payments, registrations, and judging status. They can look things up and mark
        payments, but they can&apos;t score, delete records, or change the competition setup.
      </p>
    </div>
  );
}
