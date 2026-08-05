"use client";

import { useState } from "react";
import { createInvitationCode, updateInvitationCode, generateSequentialInvitationCode } from "@/app/actions/admin";
import { Card, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin-styles";
import { tierCombinations } from "@/lib/invitation-codes";
import DateField from "@/components/DateField";

export const ROLE_LABELS: Record<string, string> = {
  school: "School / Dojo / Club",
  sensei: "Sensei / Shihan / Hanshi",
  participant: "Participant",
  referee: "Referee / Judge",
  audience: "Audience / Spectator",
  customer_support: "Participant Support",
  organizer: "Organizer",
  admin: "Admin",
  staff: "Admin / Organizer / Participant Support (legacy)",
  any: "Either",
};

export interface InvitationCodeRow {
  id: string;
  code: string;
  role: string;
  note: string | null;
  max_uses: number | null;
  email: string | null;
  phone: string | null;
  valid_from: string | null;
  valid_until: string | null;
  sign_in_limit: number | null;
  competition_id: string | null;
  competition_ids: string[] | null;
}

/** Full-featured invitation-code creator/editor, shared by every admin
 * listing page and the central Admin → Accounts → Invitation codes tab.
 * Every field is required except Note. Pass a fixed `role` to lock the
 * role (per-page forms); omit it to show the role dropdown (the central
 * Accounts page). Pass `editing` to switch into edit mode.
 *
 * The code itself is never typed by hand — Role and Competition Tier come
 * first, then "Run" computes the next systematic code for that exact
 * role+tier combination (IKO-<ROLE>-TIER-<TIER>-2026-<NNNNN>, see
 * lib/invitation-codes.ts) and locks it into the Code field; the only
 * thing left to do after that is Create/Save. Nothing is written to the
 * database until the code is actually submitted, so a number Run
 * generates but the admin never submits is simply shown again to the
 * next person who clicks Run — no separate "unreserve" step needed. */
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
  competitions: Array<{ id: string; name: string; registration_fee_usd: number | null }>;
  editing?: InvitationCodeRow;
  onCancelHref?: string;
}) {
  const [selectedRole, setSelectedRole] = useState(role ?? editing?.role ?? "referee");
  const combos = tierCombinations(competitions);
  const editingCombo = editing?.competition_ids?.length
    ? editing.competition_ids.join(",")
    : editing?.competition_id ?? "";
  const [comboValue, setComboValue] = useState(editingCombo);
  const [code, setCode] = useState(editing?.code ?? "");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function runGenerate() {
    setRunning(true);
    setRunError(null);
    const competitionIds = comboValue ? comboValue.split(",").filter(Boolean) : [];
    const result = await generateSequentialInvitationCode(selectedRole, competitionIds);
    if ("code" in result) setCode(result.code);
    else setRunError(result.error);
    setRunning(false);
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">{editing ? `Edit Code ${editing.code}` : title}</h2>
      <form key={editing?.id ?? "new"} action={editing ? updateInvitationCode : createInvitationCode} className="space-y-4">
        <input type="hidden" name="return_to" value={returnTo} />
        {editing && <input type="hidden" name="id" value={editing.id} />}
        {role && <input type="hidden" name="role" value={role} />}
        <input type="hidden" name="code" value={code} />
        <div className="grid gap-4 sm:grid-cols-2">
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
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
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
          <div>
            <label htmlFor={`${idPrefix}_competition_id`} className={adminLabel}>Competition Tier(s) *</label>
            <select
              id={`${idPrefix}_competition_id`}
              name="competition_ids"
              required
              value={comboValue}
              onChange={(e) => setComboValue(e.target.value)}
              className={adminInput}
            >
              <option value="" disabled>Select competition tier(s)</option>
              {combos.map((c) => (
                <option key={c.competitionIds.join(",")} value={c.competitionIds.join(",")}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${idPrefix}_code`} className={adminLabel}>Code *</label>
          <div className="flex max-w-[65%] items-center gap-2">
            <input
              id={`${idPrefix}_code`}
              readOnly
              value={code}
              placeholder={editing ? undefined : `Click Run — e.g. ${codeExample}`}
              className={`${adminInput} bg-neutral-50 text-neutral-500`}
            />
            {!editing && (
              <button
                type="button"
                onClick={runGenerate}
                disabled={running || !comboValue}
                className={`${adminBtnSecondary} shrink-0 whitespace-nowrap disabled:opacity-50`}
              >
                {running ? "Running…" : "Run"}
              </button>
            )}
          </div>
          {runError && <p className="mt-1 text-xs text-red-700">{runError}</p>}
          {!editing && !runError && (
            <p className="mt-1 text-xs text-neutral-400">
              Pick Role and Competition Tier(s) above, then click Run — the systematic code for that
              exact combination fills in here, ready to reuse if this form isn&apos;t submitted.
            </p>
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
        <div className="grid gap-4 sm:grid-cols-2">
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
            <label htmlFor={`${idPrefix}_phone`} className={adminLabel}>Phone No. (optional)</label>
            <input
              id={`${idPrefix}_phone`}
              name="phone"
              type="tel"
              defaultValue={editing?.phone ?? ""}
              className={adminInput}
              placeholder="+60…"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={`${idPrefix}_valid_from`} className={adminLabel}>Valid from *</label>
            <DateField
              id={`${idPrefix}_valid_from`}
              name="valid_from"
              defaultValueISO={editing?.valid_from ?? ""}
              className={adminInput}
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_valid_until`} className={adminLabel}>Valid until *</label>
            <DateField
              id={`${idPrefix}_valid_until`}
              name="valid_until"
              defaultValueISO={editing?.valid_until ?? ""}
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
          <button type="submit" disabled={!code} className={`${adminBtn} disabled:opacity-50`}>
            {editing ? "Save changes" : "Create code"}
          </button>
          {editing && onCancelHref && (
            <a href={onCancelHref} className="text-sm font-semibold text-neutral-500 hover:text-neutral-700">
              Cancel
            </a>
          )}
        </div>
        <p className="text-xs text-neutral-400">
          Every field is required except Note and Phone No. The code activates instantly at public
          sign-up — granting access across every tier selected above — and copies Valid from/until
          and Sign-in limit onto the resulting account as its own sign-in window/cap. Email binds the
          code to one address; Max uses caps total redemptions. Phone No. is a contact reference
          only — it doesn&apos;t enable a Telegram DM by itself, since the Bot API can only message
          someone who has already started a chat with the bot.
        </p>
      </form>
    </Card>
  );
}
