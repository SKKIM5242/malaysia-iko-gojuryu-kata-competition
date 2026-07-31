import { shortTierName } from "@/lib/invitation-codes";
import { formatUSD } from "@/components/ui";

/** "Kata Competition Tier(s) they'll participate in" — three tier dropdowns
 * in one row, Tier 1 required and Tier 2/3 optional. Mirrors the same
 * 3-slot pattern already used for Participant Support's
 * support_tier_1_id/2_id/3_id (see CommunityForms.tsx and
 * StaffAccountEditForm.tsx) so School, Sensei, and Referee use one
 * consistent UI instead of a different one per role.
 *
 * This is declared intent captured at registration time, independent of
 * whichever single tier the record actually PAYS its one-time fee under
 * (that stays on TierSelect / registration_competition_id). It does not
 * change what anyone is charged. */
export default function TierSlotsField({
  competitions,
  idPrefix,
  names,
  values,
  heading = "Kata Competition Tier(s) you'll participate in",
  helperNote,
  inputCls,
  labelCls,
}: {
  competitions: Array<{ id: string; name: string; fee: number | null }>;
  idPrefix: string;
  names: readonly [string, string, string];
  values?: [string | null | undefined, string | null | undefined, string | null | undefined];
  heading?: string;
  helperNote: string;
  inputCls: string;
  labelCls: string;
}) {
  return (
    <div className="sm:col-span-2 rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <p className={`text-sm font-bold text-neutral-800`}>
        {heading} <span className="font-normal text-neutral-400">(Tier 1 required, up to 3)</span>
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {names.map((name, i) => {
          const id = `${idPrefix}${name}`;
          const required = i === 0;
          return (
            <div key={name}>
              <label htmlFor={id} className={labelCls}>
                Tier {i + 1} {required ? "*" : ""}
              </label>
              <select
                id={id}
                name={name}
                required={required}
                defaultValue={values?.[i] ?? ""}
                className={inputCls}
              >
                <option value="" disabled={required}>— None —</option>
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {shortTierName(c.name)} ({formatUSD(c.fee)})
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-neutral-400">{helperNote}</p>
    </div>
  );
}
