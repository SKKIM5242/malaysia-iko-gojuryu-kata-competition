"use client";

import { useEffect, useMemo, useState } from "react";
import { ageAt, beltGroup, genderCode, kataBaseOf, kataBases as allKataBasesOf } from "@/lib/division";
import { shortTierName } from "@/lib/invitation-codes";
import { formatUSD } from "@/components/ui";
import type { Category, Competition } from "@/lib/types";

/** Per-tier 1st/2nd/3rd kata picks, keyed by that tier's competition id.
 * Every tier is optional — a registrant may enter one tier or all of them. */
export type TierKatas = [string, string, string];

/** The "Kata events" block: one column per competition tier, each with a
 * read-only tier label and three kata-event selects.
 *
 * Extracted so the public participant form and the admin Add Participant
 * form render the identical control from one source, including the
 * eligibility rules — which must agree with resolveCategory() server-side or
 * a pick would be offered and then rejected on submit.
 *
 * Submits as kata_<tierIndex>_<1|2|3>, matching what both server actions
 * already parse. */
export default function KataEventPicker({
  competitions,
  categoriesByCompetition,
  categoryTakenByCompetition,
  dateOfBirth,
  beltRank,
  gender,
  inputCls,
  defaultTierKatas,
}: {
  competitions: Competition[];
  categoriesByCompetition: Record<string, Category[]>;
  categoryTakenByCompetition: Record<string, Record<string, number>>;
  dateOfBirth: string;
  beltRank: string;
  gender: string;
  inputCls: string;
  defaultTierKatas?: Record<string, TierKatas>;
}) {
  const [tierKatas, setTierKatas] = useState<Record<string, TierKatas>>(
    () =>
      defaultTierKatas ??
      Object.fromEntries(competitions.map((c) => [c.id, ["", "", ""] as TierKatas])),
  );

  const detailsComplete = !!dateOfBirth && !!beltRank && !!gender;

  const setTierKata = (competitionId: string, slot: 0 | 1 | 2, value: string) =>
    setTierKatas((prev) => {
      const current = prev[competitionId] ?? (["", "", ""] as TierKatas);
      const next: TierKatas = [...current] as TierKatas;
      next[slot] = value;
      // Clearing a pick clears the ones after it, so a gap can't be left
      // behind (2nd chosen with no 1st).
      if (!value) for (let i = slot + 1; i < 3; i++) next[i] = "";
      return { ...prev, [competitionId]: next };
    });

  // Only kata events with a matching, non-full sub-category for the belt
  // rank / date of birth / gender entered so far -- resolveCategory()
  // server-side applies the same rules. Computed per tier since each tier
  // has its own category set and its own remaining room.
  const eligibleByTier = useMemo(() => {
    const result: Record<string, string[]> = {};
    if (!detailsComplete || Number.isNaN(Date.parse(dateOfBirth))) {
      for (const c of competitions) result[c.id] = [];
      return result;
    }
    const grp = beltGroup(beltRank);
    const genderVal = genderCode(gender);
    for (const c of competitions) {
      const categories = categoriesByCompetition[c.id] ?? [];
      const categoryTaken = categoryTakenByCompetition[c.id] ?? {};
      const age = ageAt(dateOfBirth, c.event_date);
      const matching = categories.filter(
        (cat) =>
          cat.belt_group === grp &&
          cat.gender === genderVal &&
          cat.age_min != null &&
          cat.age_max != null &&
          age >= cat.age_min &&
          age <= cat.age_max &&
          (cat.max_participants == null || (categoryTaken[cat.id] ?? 0) < cat.max_participants),
      );
      const bases = new Set(matching.map((cat) => kataBaseOf(cat.name)));
      result[c.id] = allKataBasesOf(categories).filter((k) => bases.has(k));
    }
    return result;
  }, [detailsComplete, dateOfBirth, gender, beltRank, competitions, categoriesByCompetition, categoryTakenByCompetition]);

  // Drop picks that stopped being eligible (belt/DOB/gender edited) or that
  // became a duplicate inside the same tier.
  useEffect(() => {
    setTierKatas((prev) => {
      let changed = false;
      const next: Record<string, TierKatas> = { ...prev };
      for (const c of competitions) {
        const eligible = eligibleByTier[c.id] ?? [];
        const current = prev[c.id] ?? (["", "", ""] as TierKatas);
        const fixed: TierKatas = ["", "", ""];
        const seen = new Set<string>();
        for (let i = 0; i < 3; i++) {
          const v = current[i];
          if (v && eligible.includes(v) && !seen.has(v)) {
            fixed[i] = v;
            seen.add(v);
          }
        }
        if (fixed.some((v, i) => v !== current[i])) changed = true;
        next[c.id] = fixed;
      }
      return changed ? next : prev;
    });
  }, [eligibleByTier, competitions]);

  const tierEventCounts = competitions.map((c) => (tierKatas[c.id] ?? ["", "", ""]).filter(Boolean).length);
  const totalEvents = tierEventCounts.reduce((sum, n) => sum + n, 0);
  const totalFee = competitions.reduce(
    (sum, c, i) => sum + (tierEventCounts[i] ?? 0) * Number(c.registration_fee_usd ?? 0),
    0,
  );

  return (
    <div>
      <p className="mb-2 text-sm font-bold text-neutral-800">
        Kata event{competitions.length > 1 ? "s" : ""} *{" "}
        <span className="font-normal text-neutral-400">
          {competitions.length > 1
            ? "— pick a kata in whichever tier(s) to register for; every tier below is optional, register for just one or as many as you like"
            : ""}
        </span>
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {competitions.map((c, i) => {
          const katas = tierKatas[c.id] ?? ["", "", ""];
          const eligible = eligibleByTier[c.id] ?? [];
          const eligible2 = eligible.filter((k) => k !== katas[0]);
          const eligible3 = eligible.filter((k) => k !== katas[0] && k !== katas[1]);
          return (
            <div key={c.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <label className="mb-1 block text-xs font-medium text-neutral-700">
                Competition Tier (optional)
              </label>
              <input
                readOnly
                value={`${shortTierName(c.name)} — ${formatUSD(c.registration_fee_usd)}/event`}
                className="mb-3 w-full rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1.5 text-xs text-neutral-600"
              />

              <label htmlFor={`kata_${i}_1`} className="mb-1 block text-xs font-medium text-neutral-700">
                1st Kata event (optional)
              </label>
              <select
                id={`kata_${i}_1`}
                name={`kata_${i}_1`}
                className={`${inputCls} mb-2 text-sm`}
                value={katas[0]}
                onChange={(e) => setTierKata(c.id, 0, e.target.value)}
                disabled={!detailsComplete}
              >
                <option value="">
                  {!detailsComplete
                    ? "Fill in belt rank, date of birth & gender first"
                    : eligible.length === 0
                      ? "No kata currently available for this belt / age / gender"
                      : "— None — skip this tier —"}
                </option>
                {eligible.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>

              <label htmlFor={`kata_${i}_2`} className="mb-1 block text-xs font-medium text-neutral-700">
                2nd Kata event (optional)
              </label>
              <select
                id={`kata_${i}_2`}
                name={`kata_${i}_2`}
                className={`${inputCls} mb-2 text-sm`}
                value={katas[1]}
                onChange={(e) => setTierKata(c.id, 1, e.target.value)}
                disabled={!detailsComplete || !katas[0]}
              >
                <option value="">— None —</option>
                {eligible2.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>

              <label htmlFor={`kata_${i}_3`} className="mb-1 block text-xs font-medium text-neutral-700">
                3rd Kata event (optional)
              </label>
              <select
                id={`kata_${i}_3`}
                name={`kata_${i}_3`}
                className={`${inputCls} text-sm`}
                value={katas[2]}
                onChange={(e) => setTierKata(c.id, 2, e.target.value)}
                disabled={!detailsComplete || !katas[1]}
              >
                <option value="">— None —</option>
                {eligible3.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Only shows kata events with an open sub-category matching the belt rank (Color/Kyu Belt or
        Black Belt &amp; Dan Holders), age group (4–14, 15–40, 41–65, 66–99) and gender — and that
        still has room.
      </p>
      {detailsComplete && totalEvents > 0 && (
        <p className="mt-2 text-sm font-semibold text-neutral-700">
          {totalEvents} kata event{totalEvents === 1 ? "" : "s"} across{" "}
          {tierEventCounts.filter((n) => n > 0).length} tier
          {tierEventCounts.filter((n) => n > 0).length === 1 ? "" : "s"} — total fee{" "}
          {formatUSD(totalFee)}.
        </p>
      )}
    </div>
  );
}
