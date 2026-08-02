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
    note: "deleteParticipant blocks Participant Support and Referee (blockCustomerSupport/blockReferee). saveParticipant (edit) has no guard, so Referee can currently edit participant records — narrower than the \"view only\" intent noted in its own code comment.",
  },
  {
    resource: "Registrations (payment status)",
    admin: "Full", organizer: "Full",
    customerSupport: "Edit — cannot delete", referee: "View only",
    note: "updatePaymentStatus blocks Referee; deleteRegistration blocks Participant Support and Referee.",
  },
  {
    resource: "Competitions",
    admin: "Full", organizer: "Full", customerSupport: "Blocked", referee: "Blocked",
    note: "saveCompetition requires requireCompetitionManager (admin/organizer/staff only).",
  },
  {
    resource: "Categories (incl. Merge to Mix)",
    admin: "Full", organizer: "Full", customerSupport: "View only", referee: "View only",
    note: "The merge/add/edit/delete UI is hidden from Participant Support and Referee on both /admin/competitions (canManageCompetition) and /kata-categories (canManageKata) — admin/organizer/staff only. But saveCategory/deleteCategory/mergeCategoryToMix/mergeAdjacentKata themselves still carry no server-side role guard, so this is enforced only by hiding the buttons, not by the actions rejecting the request — worth closing with a real guard.",
  },
  {
    resource: "Announcements",
    admin: "Full", organizer: "Full", customerSupport: "Blocked", referee: "Blocked",
    note: "saveAnnouncement/toggleAnnouncement/moveAnnouncement/deleteAnnouncement all require requireContentManager (admin/organizer/staff only). The New/Edit/Delete/Publish/Reorder controls render for Participant Support and Referee anyway, so they see the form and buttons but every submission comes back \"Only Admin / Organizer can manage announcements.\" — the UI should hide these for them instead of letting the action reject.",
  },
  {
    resource: "Judging Arena (assign referees, set judges-required)",
    admin: "Full", organizer: "Full", customerSupport: "View only", referee: "Full",
    note: "assignRefereeToVideo/unassignRefereeFromVideo/setJudgesRequired/autoAssignReferees require requireJudgingManager (admin/organizer/staff/referee). Participant Support can still watch recordings and see workload, not configure.",
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
    note: "Every role can see every recording's individual judge scores and round status (green/red + total once fully judged) on both Kata Arena and this Judging Arena page — opened to everyone in migration 0044 (scores_select_all_authenticated). Participant Support has always had this; only submitting a score is restricted (see the row above).",
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
    resource: "Participant Support account creation",
    admin: "Full", organizer: "Full", customerSupport: "Blocked", referee: "Blocked",
    note: "createStaffAccount(role=customer_support) allows admin, organizer, or staff.",
  },
  {
    resource: "Accounts page (approvals, invitation codes)",
    admin: "Full", organizer: "Blocked (route)", customerSupport: "Blocked (route)", referee: "Blocked (route)",
    note: "/admin/accounts stays restricted to Admin at the route level — the only page excluded from the otherwise-shared full nav.",
  },
  {
    resource: "Email Verifications page",
    admin: "Full", organizer: "Blocked (route)", customerSupport: "Blocked (route)", referee: "Blocked (route)",
    note: "/admin/email-verifications is Admin-only at the route level, same as Accounts — it can manually mark an account verified, bypassing the sign-in gate.",
  },
  {
    resource: "CSV bulk upload — Schools / Senseis / Referees / Audience / Participants / Announcements / Invitation Codes / Content reference tables",
    admin: "Full", organizer: "Full", customerSupport: "Blocked", referee: "Blocked",
    note: "Every one of these bulk-upload actions calls the shared bulkUploadRoleError guard, which restricts to admin/organizer only — Participant Support and Referee are rejected. This is narrower than the single-record Add/Edit/Delete forms next to each uploader (see their own rows above), which stay open to all four.",
  },
  {
    resource: "CSV bulk upload — Organizer / Support accounts",
    admin: "Full", organizer: "Support only", customerSupport: "Blocked", referee: "Blocked",
    note: "Same authorization as single-account creation, checked per-upload.",
  },
];

/** Intro text shown above the interactive table on the published Access
 * Matrix announcement (see app/announcements/[slug]/page.tsx, which
 * special-cases this announcement to render the same adjustable/filterable
 * FilterableTable used on /admin/accounts, reading the live
 * access_matrix_rows table rather than a frozen snapshot — so it's always
 * current and there's no separate table/notes text to keep in sync. */
export function accessMatrixAnnouncementIntro(generatedAt: string): string {
  // Single asterisk, not underscore — the tiny Markdown renderer (lib/markdown.tsx)
  // only recognises *italic* and **bold**, not _italic_.
  return `*Snapshot as of ${generatedAt}. Reflects the actual route gating and server-action guards in the codebase. The table below always shows the current rules — edit rows on the Content page and they update here automatically.*`;
}

export interface AccessMatrixDbRow {
  resource: string;
  admin: string;
  organizer: string;
  customer_support: string;
  referee: string;
  note: string | null;
}

/** Editable rows (managed on the Content page) win; the code's built-in
 * snapshot is the fallback while the table is empty — shared by the admin
 * Access Matrix tab and the published announcement's interactive table. */
export function accessMatrixRowsFromDb(dbRows: AccessMatrixDbRow[] | null): AccessRow[] {
  if (dbRows && dbRows.length > 0) {
    return dbRows.map((r) => ({
      resource: r.resource,
      admin: r.admin,
      organizer: r.organizer,
      customerSupport: r.customer_support,
      referee: r.referee,
      note: r.note ?? undefined,
    }));
  }
  return ACCESS_MATRIX;
}
