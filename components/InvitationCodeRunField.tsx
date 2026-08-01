"use client";

import { useState } from "react";
import { generateSequentialInvitationCode } from "@/app/actions/admin";
import { adminInput, adminLabel } from "@/components/admin-styles";
import { tierCombinations } from "@/lib/invitation-codes";

/** The `invitation_code` text field on an Add/Edit record form, with a "Run"
 * button beside it that fills in the next systematic code —
 * IKO-<ROLE>-TIER-<TIER>-2026-<NNNNN>, same counter and same
 * generateSequentialInvitationCode action the Accounts → Invitation codes
 * "Create Code" form uses, so a code run from either place continues the one
 * shared sequence for that role + tier rather than a parallel one.
 *
 * The tier picker here exists only to build the code's prefix, so it is
 * deliberately left unnamed and never submitted with the form — the record
 * being saved has its own tier field(s) elsewhere, and giving this one a name
 * would collide with them (notably `pic_competition_id`, which the separate
 * "Generate personal code" button on the same forms already uses).
 *
 * Run only computes; nothing is written until the form itself is submitted,
 * so a number shown but abandoned is simply handed out again next time. */
export default function InvitationCodeRunField({
  id,
  role,
  competitions,
  defaultValue,
  label = "Invitation code (optional)",
  placeholder,
}: {
  id: string;
  role: string;
  competitions: Array<{ id: string; name: string; registration_fee_usd: number | null }>;
  defaultValue?: string | null;
  label?: string;
  placeholder?: string;
}) {
  const combos = tierCombinations(competitions);
  const [code, setCode] = useState(defaultValue ?? "");
  const [comboValue, setComboValue] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const competitionIds = comboValue ? comboValue.split(",").filter(Boolean) : [];
    const result = await generateSequentialInvitationCode(role, competitionIds);
    if ("code" in result) setCode(result.code);
    else setError(result.error);
    setRunning(false);
  }

  return (
    <div>
      <label htmlFor={id} className={adminLabel}>{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          name="invitation_code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${adminInput} min-w-[16rem] flex-1`}
          placeholder={placeholder}
        />
        <select
          aria-label="Competition tier(s) for the generated code"
          value={comboValue}
          onChange={(e) => setComboValue(e.target.value)}
          className={`${adminInput} w-auto`}
        >
          <option value="">Tier(s) for code…</option>
          {combos.map((c) => (
            <option key={c.competitionIds.join(",")} value={c.competitionIds.join(",")}>{c.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={run}
          disabled={running || !comboValue}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running…" : "Run"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <p className="mt-1 text-xs text-neutral-400">
        Pick tier(s) then click <strong>Run</strong> to fill in the next code for this role and
        combination — the same running sequence as Accounts → Invitation codes. You can also type
        a code by hand. Nothing is reserved until you save this form.
      </p>
    </div>
  );
}
