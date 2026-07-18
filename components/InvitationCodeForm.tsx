import { createInvitationCode } from "@/app/actions/admin";
import { Card, adminBtn, adminInput, adminLabel } from "@/components/admin";

const ROLE_LABELS: Record<string, string> = {
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

/** Full-featured invitation-code creator, shared by every admin listing page
 * and the central Admin → Accounts → Invitation codes tab. Pass a fixed
 * `role` to lock the role (per-page forms); omit it to show the role
 * dropdown (the central Accounts page). */
export default function InvitationCodeForm({
  role,
  returnTo,
  title = "New Invitation Code",
  idPrefix,
}: {
  role?: string;
  returnTo: string;
  title?: string;
  idPrefix: string;
}) {
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      <form action={createInvitationCode} className="space-y-4">
        <input type="hidden" name="return_to" value={returnTo} />
        {role && <input type="hidden" name="role" value={role} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}_code`} className={adminLabel}>
              Custom code <span className="font-normal text-neutral-400">(optional — blank = auto-generated)</span>
            </label>
            <input id={`${idPrefix}_code`} name="code" className={adminInput} placeholder="e.g. IKO-JUDGE-2026" />
          </div>
          {role ? (
            <div>
              <label className={adminLabel}>Role</label>
              <p className={`${adminInput} bg-neutral-50 text-neutral-500`}>{ROLE_LABELS[role] ?? role}</p>
            </div>
          ) : (
            <div>
              <label htmlFor={`${idPrefix}_role`} className={adminLabel}>Role *</label>
              <select id={`${idPrefix}_role`} name="role" required defaultValue="referee" className={adminInput}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}_max_uses`} className={adminLabel}>
              Max uses <span className="font-normal text-neutral-400">(blank = unlimited; forced to 1 if Email is set)</span>
            </label>
            <input id={`${idPrefix}_max_uses`} name="max_uses" type="number" min="1" className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_note`} className={adminLabel}>Note</label>
            <input id={`${idPrefix}_note`} name="note" className={adminInput} placeholder="e.g. July intake" />
          </div>
        </div>
        <div>
          <label htmlFor={`${idPrefix}_email`} className={adminLabel}>
            Email <span className="font-normal text-neutral-400">(optional — binds this code to one address, single-use only)</span>
          </label>
          <input id={`${idPrefix}_email`} name="email" type="email" className={adminInput} placeholder="e.g. jane@example.com" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={`${idPrefix}_valid_from`} className={adminLabel}>Valid from (optional)</label>
            <input id={`${idPrefix}_valid_from`} name="valid_from" type="date" className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_valid_until`} className={adminLabel}>Valid until (optional)</label>
            <input id={`${idPrefix}_valid_until`} name="valid_until" type="date" className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_sign_in_limit`} className={adminLabel}>Sign-in limit (optional)</label>
            <input id={`${idPrefix}_sign_in_limit`} name="sign_in_limit" type="number" min="1" className={adminInput} placeholder="blank = unlimited" />
          </div>
        </div>
        <button type="submit" className={adminBtn}>Create code</button>
        <p className="text-xs text-neutral-400">
          Waives the fee and activates instantly at public sign-up with a valid code, no approval
          step. &quot;Valid from/until&quot; and &quot;Sign-in limit&quot; are copied onto the
          resulting account as its own sign-in window/cap the moment the code is redeemed — leave
          blank for unlimited, no expiry. Manage or revoke any code in Admin → Accounts →
          Invitation codes.
        </p>
      </form>
    </Card>
  );
}
