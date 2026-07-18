import { createInvitationCode, updateInvitationCode } from "@/app/actions/admin";
import { Card, adminBtn, adminInput, adminLabel } from "@/components/admin";

export const ROLE_LABELS: Record<string, string> = {
  school: "School / Dojo / Club",
  sensei: "Sensei / Shihan / Hanshi",
  participant: "Participant",
  referee: "Referee / Judge",
  audience: "Audience / Spectator",
  customer_support: "Customer Services Support",
  organizer: "Organizer",
  admin: "Admin",
  staff: "Admin / Organizer / Customer Support (legacy)",
  any: "Either",
};

export interface InvitationCodeRow {
  id: string;
  code: string;
  role: string;
  note: string | null;
  max_uses: number | null;
  email: string | null;
  valid_from: string | null;
  valid_until: string | null;
  sign_in_limit: number | null;
  competition_id: string | null;
}

/** Full-featured invitation-code creator/editor, shared by every admin
 * listing page and the central Admin → Accounts → Invitation codes tab.
 * Every field is required except Note — the organiser's explicit
 * instruction after being told this removes the old "unlimited shared
 * code" shortcut; every code is now a deliberate, fully-specified,
 * single-purpose, competition-scoped grant. Pass a fixed `role` to lock
 * the role (per-page forms); omit it to show the role dropdown (the
 * central Accounts page). Pass `editing` to switch into edit mode. */
export default function InvitationCodeForm({
  role,
  roleOptions,
  returnTo,
  title = "New Invitation Code",
  idPrefix,
  codeExample,
  competitions,
  editing,
  onCancelHref,
}: {
  role?: string;
  /** Restricts the role dropdown to a subset of roles (ignored when `role` is
   * set). Omit to show every role. */
  roleOptions?: string[];
  returnTo: string;
  title?: string;
  idPrefix: string;
  codeExample: string;
  competitions: Array<{ id: string; name: string }>;
  editing?: InvitationCodeRow;
  onCancelHref?: string;
}) {
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">{editing ? `Edit Code ${editing.code}` : title}</h2>
      <form action={editing ? updateInvitationCode : createInvitationCode} className="space-y-4">
        <input type="hidden" name="return_to" value={returnTo} />
        {editing && <input type="hidden" name="id" value={editing.id} />}
        {role && <input type="hidden" name="role" value={role} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}_code`} className={adminLabel}>Code *</label>
            <input
              id={`${idPrefix}_code`}
              name="code"
              required
              defaultValue={editing?.code ?? ""}
              className={adminInput}
              placeholder={`e.g. ${codeExample}`}
            />
          </div>
          {role ? (
            <div>
              <label className={adminLabel}>Role</label>
              <p className={`${adminInput} bg-neutral-50 text-neutral-500`}>{ROLE_LABELS[role] ?? role}</p>
            </div>
          ) : (
            <div>
              <label htmlFor={`${idPrefix}_role`} className={adminLabel}>Role *</label>
              <select
                id={`${idPrefix}_role`}
                name="role"
                required
                defaultValue={editing?.role ?? "referee"}
                className={adminInput}
              >
                {Object.entries(ROLE_LABELS)
                  .filter(([value]) => !roleOptions || roleOptions.includes(value))
                  .map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
              </select>
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}_max_uses`} className={adminLabel}>Max uses *</label>
            <input
              id={`${idPrefix}_max_uses`}
              name="max_uses"
              type="number"
              min="1"
              required
              defaultValue={editing?.max_uses ?? ""}
              className={adminInput}
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_note`} className={adminLabel}>Note</label>
            <input
              id={`${idPrefix}_note`}
              name="note"
              defaultValue={editing?.note ?? ""}
              className={adminInput}
              placeholder="e.g. July intake"
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${idPrefix}_email`} className={adminLabel}>Email *</label>
          <input
            id={`${idPrefix}_email`}
            name="email"
            type="email"
            required
            defaultValue={editing?.email ?? ""}
            className={adminInput}
            placeholder="e.g. jane@example.com"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}_competition_id`} className={adminLabel}>Competition *</label>
          <select
            id={`${idPrefix}_competition_id`}
            name="competition_id"
            required
            defaultValue={editing?.competition_id ?? ""}
            className={adminInput}
          >
            <option value="" disabled>Select competition</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={`${idPrefix}_valid_from`} className={adminLabel}>Valid from *</label>
            <input
              id={`${idPrefix}_valid_from`}
              name="valid_from"
              type="date"
              required
              defaultValue={editing?.valid_from ?? ""}
              className={adminInput}
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_valid_until`} className={adminLabel}>Valid until *</label>
            <input
              id={`${idPrefix}_valid_until`}
              name="valid_until"
              type="date"
              required
              defaultValue={editing?.valid_until ?? ""}
              className={adminInput}
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_sign_in_limit`} className={adminLabel}>Sign-in limit *</label>
            <input
              id={`${idPrefix}_sign_in_limit`}
              name="sign_in_limit"
              type="number"
              min="1"
              required
              defaultValue={editing?.sign_in_limit ?? ""}
              className={adminInput}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Create code"}</button>
          {editing && onCancelHref && (
            <a href={onCancelHref} className="text-sm font-semibold text-neutral-500 hover:text-neutral-700">
              Cancel
            </a>
          )}
        </div>
        <p className="text-xs text-neutral-400">
          Every field is required except Note. The code activates instantly at public sign-up —
          only for the Competition selected above — and copies Valid from/until and Sign-in limit
          onto the resulting account as its own sign-in window/cap. Email binds the code to one
          address; Max uses caps total redemptions.
        </p>
      </form>
    </Card>
  );
}
