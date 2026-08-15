"use client";

import { useActionState, useMemo, useState } from "react";
import type { Category } from "@/lib/types";
import { kataBaseOf, kataBases } from "@/lib/division";
import {
  addRefereeExclusion, removeRefereeExclusion, traceParticipantForExclusion,
  type TraceParticipantState,
} from "@/app/actions/admin";
import { adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin-styles";
import { shortTierName } from "@/lib/invitation-codes";
import { MAX_REFEREE_EXCLUSIONS } from "@/lib/reference-data";

const BELT_LABELS: Record<string, string> = { kyu: "Color/Kyu Belt", dan: "Black Belt & Dan" };
const traceInitial: TraceParticipantState = { ok: false };

interface ExistingExclusion {
  id: string;
  categoryId: string;
  categoryName: string;
}

/**
 * Picks one exact category (kata + belt group + gender + age group) a judge
 * must never be assigned to. A flat Kata Name dropdown alone can't identify
 * one row — the same 24 kata are repeated across all 3 fee tiers with
 * different category ids — so Tier is cascade step zero, not an extra field.
 */
export default function RefereeExclusionsPanel({
  refereeId,
  categories,
  competitions,
  existingExclusions,
}: {
  refereeId: string;
  categories: Category[];
  competitions: Array<{ id: string; name: string }>;
  existingExclusions: ExistingExclusion[];
}) {
  const [competitionId, setCompetitionId] = useState("");
  const [kata, setKata] = useState("");
  const [belt, setBelt] = useState("");
  const [gender, setGender] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [traceState, traceAction, tracePending] = useActionState(traceParticipantForExclusion, traceInitial);

  const tierCategories = useMemo(
    () => categories.filter((c) => c.competition_id === competitionId),
    [categories, competitionId],
  );
  const kataOptions = useMemo(() => kataBases(tierCategories), [tierCategories]);
  const kataCategories = useMemo(
    () => tierCategories.filter((c) => kataBaseOf(c.name) === kata),
    [tierCategories, kata],
  );
  const beltOptions = useMemo(
    () => [...new Set(kataCategories.map((c) => c.belt_group).filter((b): b is string => !!b))],
    [kataCategories],
  );
  const beltCategories = useMemo(() => kataCategories.filter((c) => c.belt_group === belt), [kataCategories, belt]);
  const genderOptions = useMemo(
    () => [...new Set(beltCategories.map((c) => c.gender).filter((g): g is string => !!g))],
    [beltCategories],
  );
  const genderCategories = useMemo(
    () => beltCategories.filter((c) => c.gender === gender),
    [beltCategories, gender],
  );
  const ageOptions = useMemo(
    () =>
      genderCategories
        .filter((c) => c.age_min != null && c.age_max != null)
        .sort((a, b) => (a.age_min ?? 0) - (b.age_min ?? 0)),
    [genderCategories],
  );

  const atCap = existingExclusions.length >= MAX_REFEREE_EXCLUSIONS;
  const resolvedName = categories.find((c) => c.id === categoryId)?.name ?? "";

  function applyTraceMatch(matchCategoryId: string) {
    const cat = categories.find((c) => c.id === matchCategoryId);
    if (!cat) return;
    setCompetitionId(cat.competition_id ?? "");
    setKata(kataBaseOf(cat.name));
    setBelt(cat.belt_group ?? "");
    setGender(cat.gender ?? "");
    setCategoryId(cat.id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
          Conflict-of-interest exclusions
        </p>
        <span className="text-xs text-neutral-400">{existingExclusions.length} of {MAX_REFEREE_EXCLUSIONS} used</span>
      </div>
      <p className="text-xs text-neutral-500">
        Categories this judge must never be assigned to — e.g. their own child or student&apos;s
        category. Auto-assign and manual assignment both respect this list.
      </p>

      {existingExclusions.length > 0 && (
        <div className="space-y-1.5">
          {existingExclusions.map((ex) => (
            <form
              key={ex.id}
              action={removeRefereeExclusion}
              className="flex items-center justify-between gap-2 rounded border border-neutral-200 bg-white px-3 py-2 text-xs"
            >
              <span>{ex.categoryName}</span>
              <input type="hidden" name="exclusion_id" value={ex.id} />
              <input type="hidden" name="referee_id" value={refereeId} />
              <button type="submit" className="shrink-0 font-semibold text-red-600 hover:underline">
                Remove
              </button>
            </form>
          ))}
        </div>
      )}

      {atCap ? (
        <p className="text-xs text-amber-600">
          Limit of {MAX_REFEREE_EXCLUSIONS} reached — remove one above to add a different category.
        </p>
      ) : (
        <>
          <div className="rounded-md border border-neutral-200 bg-white p-3">
            <form action={traceAction} className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <label htmlFor="trace_name" className={adminLabel}>Trace by participant name</label>
                <input
                  id="trace_name" name="name"
                  className={adminInput} placeholder="e.g. Ahmad bin Ali"
                />
              </div>
              <button type="submit" disabled={tracePending} className={adminBtnSecondary}>
                {tracePending ? "Tracing…" : "Trace"}
              </button>
            </form>
            {traceState.error && <p className="mt-2 text-xs text-red-600">{traceState.error}</p>}
            {traceState.matches && traceState.matches.length > 0 && (
              <div className="mt-2 space-y-1">
                {traceState.matches.map((m) => (
                  <button
                    key={m.registrationId}
                    type="button"
                    onClick={() => applyTraceMatch(m.categoryId)}
                    className="block w-full rounded border border-neutral-200 px-2.5 py-1.5 text-left text-xs hover:bg-neutral-50"
                  >
                    <span className="font-semibold">{m.participantName}</span> — {m.categoryName}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-neutral-400">— or select the 4 fields manually below —</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="exclusion_tier" className={adminLabel}>Tier</label>
              <select
                id="exclusion_tier" className={adminInput} value={competitionId}
                onChange={(e) => { setCompetitionId(e.target.value); setKata(""); setBelt(""); setGender(""); setCategoryId(""); }}
              >
                <option value="">— Select —</option>
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>{shortTierName(c.name)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exclusion_kata" className={adminLabel}>Kata Name</label>
              <select
                id="exclusion_kata" className={adminInput} value={kata} disabled={!competitionId}
                onChange={(e) => { setKata(e.target.value); setBelt(""); setGender(""); setCategoryId(""); }}
              >
                <option value="">— Select —</option>
                {kataOptions.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exclusion_belt" className={adminLabel}>Belt Group</label>
              <select
                id="exclusion_belt" className={adminInput} value={belt} disabled={!kata}
                onChange={(e) => { setBelt(e.target.value); setGender(""); setCategoryId(""); }}
              >
                <option value="">— Select —</option>
                {beltOptions.map((b) => (
                  <option key={b} value={b}>{BELT_LABELS[b] ?? b}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exclusion_gender" className={adminLabel}>Gender</label>
              <select
                id="exclusion_gender" className={adminInput} value={gender} disabled={!belt}
                onChange={(e) => { setGender(e.target.value); setCategoryId(""); }}
              >
                <option value="">— Select —</option>
                {genderOptions.map((g) => (
                  <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="exclusion_age" className={adminLabel}>Age Group</label>
              <select
                id="exclusion_age" className={adminInput} value={categoryId} disabled={!gender}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">— Select —</option>
                {ageOptions.map((c) => (
                  <option key={c.id} value={c.id}>Age {c.age_min}–{c.age_max}</option>
                ))}
              </select>
            </div>
          </div>

          <form action={addRefereeExclusion} className="flex items-center gap-3">
            <input type="hidden" name="referee_id" value={refereeId} />
            <input type="hidden" name="category_id" value={categoryId} />
            <button type="submit" disabled={!categoryId} className={adminBtn}>Add exclusion</button>
            {categoryId && <span className="text-xs text-neutral-500">{resolvedName}</span>}
          </form>
        </>
      )}
    </div>
  );
}
