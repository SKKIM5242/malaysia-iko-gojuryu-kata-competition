/**
 * Hand-maintained snapshot of the ACTUAL access rules in this codebase —
 * not a config table, since permissions here are enforced in code
 * (lib/supabase/middleware.ts route allow-lists + guard functions at the
 * top of app/actions/admin.ts), not in the database. Whoever changes a
 * guard function or a middleware allow-list should update this file (and
 * republish the Access Matrix announcement) in the same change.
 *
 * Legend: "Full" = create/edit/delete all allowed; "View only" = page/data
 * reachable but write actions rejected; "Blocked" = action rejected or page
 * unreachable.
 */

export interface AccessRow {
  resource: string;
  admin: string;
  organizer: string;
  customerSupport: string;
  referee: string;
  note?: string;
}

export const ACCESS_MATRIX: AccessRow[] = [
  {
    resource: "Schools",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "saveSchool/deleteSchool carry no role guard — any approved staff-tier role can add, edit, or delete.",
  },
  {
    resource: "Senseis",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "saveSensei/deleteSensei carry no role guard.",
  },
  {
    resource: "Referees / Judges (roster)",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "saveReferee/deleteReferee carry no role guard.",
  },
  {
    resource: "Audience / Spectators",
    admin: "Edit payment status", organizer: "Edit payment status",
    customerSupport: "Edit payment status", referee: "Edit payment status",
    note: "No add/delete action exists yet — audience records are created only by self-registration.",
  },
  {
    resource: "Participants",
    admin: "Full", organizer: "Full",
    customerSupport: "Edit — cannot delete", referee: "Edit — cannot delete",
    note: "deleteParticipant blocks Customer Support and Referee (blockCustomerSupport/blockReferee). saveParticipant (edit) has no guard, so Referee can currently edit participant records — narrower than the \"view only\" intent noted in its own code comment.",
  },
  {
    resource: "Registrations (payment status)",
    admin: "Full", organizer: "Full",
    customerSupport: "Edit — cannot delete", referee: "View only",
    note: "updatePaymentStatus blocks Referee; deleteRegistration blocks Customer Support and Referee.",
  },
  {
    resource: "Competitions",
    admin: "Full", organizer: "Full", customerSupport: "Blocked", referee: "Blocked",
    note: "saveCompetition requires requireCompetitionManager (admin/organizer/staff only).",
  },
  {
    resource: "Categories (incl. Merge to Mix)",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "saveCategory/deleteCategory/mergeCategoryToMix carry no role guard — category-level access is intentionally open to all four.",
  },
  {
    resource: "Announcements",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "No role guard on save/publish/delete/reorder.",
  },
  {
    resource: "Judging Arena (assign referees, set judges-required)",
    admin: "Full", organizer: "Full", customerSupport: "View only", referee: "Full",
    note: "assignRefereeToVideo/unassignRefereeFromVideo/setJudgesRequired/autoAssignReferees require requireJudgingManager (admin/organizer/staff/referee). Customer Support can still watch recordings and see workload, not configure.",
  },
  {
    resource: "Kata video scoring — submit/edit a score",
    admin: "Full — any recording", organizer: "Full — any recording",
    customerSupport: "Blocked (cannot submit a score)", referee: "Own assigned videos only",
    note: "This row is about SUBMITTING a score, not viewing one — see \"Kata video scoring — view scores\" below for that. Referee scoring is unchanged, enforced by DB RLS (scores_referee_upsert). Admin/Organizer/Staff get an additive override policy (scores_manager_upsert) letting them score any recording as themselves, auto-self-assigning via assign_referee() so they show up correctly wherever assignment drives display.",
  },
  {
    resource: "Kata video scoring — view scores",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "Every role can see every recording's individual judge scores and round status (green/red + total once fully judged) on both Kata Arena and this Judging Arena page — opened to everyone in migration 0044 (scores_select_all_authenticated). Customer Support has always had this; only submitting a score is restricted (see the row above).",
  },
  {
    resource: "Kata recording playback",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "Fixed in migration 0029 — previously no storage.objects SELECT policy existed for the kata-videos bucket, so nobody (including Admin) could actually load a recording.",
  },
  {
    resource: "Organizer / Admin account creation",
    admin: "Full", organizer: "Blocked", customerSupport: "Blocked", referee: "Blocked",
    note: "createStaffAccount(role=organizer) requires actorRole === admin.",
  },
  {
    resource: "Customer Support account creation",
    admin: "Full", organizer: "Full", customerSupport: "Blocked", referee: "Blocked",
    note: "createStaffAccount(role=customer_support) allows admin, organizer, or staff.",
  },
  {
    resource: "Accounts page (approvals, invitation codes)",
    admin: "Full", organizer: "Blocked (route)", customerSupport: "Blocked (route)", referee: "Blocked (route)",
    note: "/admin/accounts stays restricted to Admin at the route level — the only page excluded from the otherwise-shared full nav.",
  },
  {
    resource: "CSV bulk upload — Schools / Senseis / Referees / Audience",
    admin: "Full", organizer: "Full", customerSupport: "Full", referee: "Full",
    note: "Mirrors the single-record actions above (no extra guard).",
  },
  {
    resource: "CSV bulk upload — Organizer / Support accounts",
    admin: "Full", organizer: "Support only", customerSupport: "Blocked", referee: "Blocked",
    note: "Same authorization as single-account creation, checked per-upload.",
  },
];

/** Renders the matrix as a Markdown table for the Announcements body. */
export function accessMatrixToMarkdown(generatedAt: string): string {
  const header = "| Resource | Admin | Organizer / Staff | Customer Support | Referee / Judge |\n" +
    "|---|---|---|---|---|";
  const rows = ACCESS_MATRIX.map(
    (r) => `| ${r.resource} | ${r.admin} | ${r.organizer} | ${r.customerSupport} | ${r.referee} |`,
  );
  const notes = ACCESS_MATRIX.filter((r) => r.note)
    .map((r) => `- **${r.resource}**: ${r.note}`)
    .join("\n");
  return [
    `_Snapshot as of ${generatedAt}. Reflects the actual route gating and server-action guards in the codebase — republish this announcement whenever access rules change._`,
    "",
    header,
    ...rows,
    "",
    "**Notes**",
    notes,
  ].join("\n");
}
