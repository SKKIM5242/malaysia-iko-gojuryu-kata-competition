import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/components/ui";
import { shortTierName } from "@/lib/invitation-codes";

import { PROFILE_ROLE_KEY_LABELS, type ProfileRoleKey } from "@/lib/reference-data";

/** `role` is the organizer's own display label (editable on /admin/content),
 * so it wins; the role_key label is only a fallback for a row saved without
 * one. This used to be a hardcoded lowercase-key map, which stopped matching
 * the moment the labels were renamed. */
function roleLabel(role: string | null, roleKey: string | null): string {
  if (role) return role;
  if (roleKey && roleKey in PROFILE_ROLE_KEY_LABELS) {
    return PROFILE_ROLE_KEY_LABELS[roleKey as ProfileRoleKey];
  }
  return roleKey ?? "—";
}

/** Read-only render of the Sign-in Access Matrix and the Competition Valid
 * Date table — shown to every signed-in viewer on the Account page for
 * transparency about their own sign-in rules. Both tables are edited from
 * the admin panel only (Admin/Organizer, via /admin/content and
 * /admin/competitions respectively) — see saveSignInRoleDefault in
 * app/actions/admin.ts and the existing Competition create/edit form.
 * Uses the service-role client since this renders for every role
 * regardless of what RLS that viewer's own session would otherwise allow. */
export default async function SignInInfoTables({ canManage }: { canManage: boolean }) {
  const admin = createAdminClient();
  const [{ data: roleDefaults }, { data: competitions }] = await Promise.all([
    admin.from("sign_in_role_defaults").select("*").order("sort_order"),
    admin
      .from("competitions")
      .select("id, name, registration_fee_usd, event_date, registration_deadline, default_sign_in_valid_from, default_sign_in_valid_until")
      .order("registration_fee_usd", { ascending: true }),
  ]);

  return (
    <div className="mt-6 space-y-4">
      <details className="rounded-lg border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-neutral-900 hover:bg-neutral-50">
          ▾ Sign-in Access Matrix
        </summary>
        <div className="border-t border-neutral-100 p-4">
          <p className="mb-3 text-xs text-neutral-400">
            Each role&apos;s default sign-in cap and whether its valid window follows a competition
            tier&apos;s dates. If you hold more than one role, your allowances are{" "}
            <strong>added together</strong> (e.g. Referee/Judge + Participant = 1,000 + 250 =
            1,250), and your validity window spans <strong>every</strong> tier you have a paid
            entry in — earliest start date to latest end date. The count and the dates apply{" "}
            <strong>at the same time</strong>: whichever runs out first ends your access. One
            unlimited role makes the whole account unlimited.
            {canManage && (
              <>
                {" "}
                Manage this from{" "}
                <a href="/admin/content" className="underline font-semibold">
                  Admin Panel → Content
                </a>
                .
              </>
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="border-b border-neutral-200 text-neutral-500">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Role</th>
                  <th className="py-1.5 pr-2 font-semibold">Default sign-ins</th>
                  <th className="py-1.5 pr-2 font-semibold">Tier-tied?</th>
                  <th className="py-1.5 pr-2 font-semibold">Validity (start – end)</th>
                  <th className="py-1.5 pr-2 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {(roleDefaults ?? []).map((r) => (
                  <tr key={r.id as string}>
                    <td className="py-1.5 pr-2 font-semibold text-neutral-800">
                      {roleLabel(r.role as string | null, r.role_key as string | null)}
                    </td>
                    <td className="py-1.5 pr-2">
                      {r.default_sign_in_limit == null ? "Unlimited" : String(r.default_sign_in_limit)}
                    </td>
                    <td className="py-1.5 pr-2">{r.tier_tied ? "Yes" : "No"}</td>
                    <td className="py-1.5 pr-2">
                      {r.valid_from || r.valid_until
                        ? `${formatDate(r.valid_from as string | null)} – ${formatDate(r.valid_until as string | null)}`
                        : r.tier_tied
                          ? "Follows tier (see Competition Valid Date table)"
                          : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-neutral-500">{(r.notes as string) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details className="rounded-lg border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-neutral-900 hover:bg-neutral-50">
          ▾ Competition Valid Date Table
        </summary>
        <div className="border-t border-neutral-100 p-4">
          <p className="mb-3 text-xs text-neutral-400">
            Each tier&apos;s recording window (Event date → Registration deadline) and the default
            sign-in valid window for accounts tied to that tier.
            {canManage && (
              <>
                {" "}
                Manage this from{" "}
                <a href="/admin/competitions" className="underline font-semibold">
                  Admin Panel → Competitions
                </a>
                .
              </>
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-neutral-200 text-neutral-500">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Tier</th>
                  <th className="py-1.5 pr-2 font-semibold">Event date</th>
                  <th className="py-1.5 pr-2 font-semibold">Deadline</th>
                  <th className="py-1.5 pr-2 font-semibold">Sign-in valid from</th>
                  <th className="py-1.5 pr-2 font-semibold">Sign-in valid until</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {(competitions ?? []).map((c) => (
                  <tr key={c.id as string}>
                    <td className="py-1.5 pr-2 font-semibold text-neutral-800">{shortTierName(c.name as string)}</td>
                    <td className="py-1.5 pr-2">{formatDate(c.event_date as string)}</td>
                    <td className="py-1.5 pr-2">{formatDate(c.registration_deadline as string)}</td>
                    <td className="py-1.5 pr-2">{formatDate(c.default_sign_in_valid_from as string | null)}</td>
                    <td className="py-1.5 pr-2">{formatDate(c.default_sign_in_valid_until as string | null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
