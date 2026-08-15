"use client";

import { useActionState, useMemo, useState } from "react";
import type { Category } from "@/lib/types";
import { kataBaseOf, kataBases } from "@/lib/division";
import {
  addRefereeExclusion, addRefereeExclusions, removeRefereeExclusion,
  traceParticipantForExclusion, traceSchoolForExclusion, traceSenseiForExclusion,
  type TraceParticipantState, type ParticipantTraceMatch,
} from "@/app/actions/admin";
import { adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin-styles";
import { shortTierName } from "@/lib/invitation-codes";

const BELT_LABELS: Record<string, string> = { kyu: "Color/Kyu Belt", dan: "Black Belt & Dan", open: "Open" };
const traceInitial: TraceParticipantState = { ok: false };

interface ExistingExclusion {
  id: string;
  categoryId: string;
  categoryName: string;
}

type TraceAction = (prev: TraceParticipantState, formData: FormData) => Promise<TraceParticipantState>;

/** One trace box (by participant / school / sensei name). Ticking a match
 * here doesn't add it immediately — it feeds the parent's shared `selected`
 * batch (via onToggle) so matches picked from different searches, or
 * different trace boxes, can all be added together with one click. */
function TraceBox({
  label, name, placeholder, action, selected, onToggle, onSelectAll,
}: {
  label: string;
  name: string;
  placeholder: string;
  action: TraceAction;
  selected: Map<string, string>;
  onToggle: (categoryId: string, display: string) => void;
  onSelectAll: (matches: ParticipantTraceMatch[]) => void;
}) {
  const [state, formAction, pending] = useActionState(action, traceInitial);
  const matches = state.matches ?? [];
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor={name} className={adminLabel}>{label}</label>
          <textarea
            id={name} name="name" rows={2} className={`${adminInput} resize-y`}
            placeholder={`${placeholder} — paste several, one per line or comma-separated, no limit`}
          />
        </div>
        <button type="submit" disabled={pending} className={adminBtnSecondary}>
          {pending ? "Tracing…" : "Trace"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      {matches.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => onSelectAll(matches)}
            className="mt-2 text-xs font-semibold text-red-700 underline underline-offset-2"
          >
            Select all
          </button>
          <div className="mt-1.5 space-y-1">
            {matches.map((m) => (
              <label
                key={m.registrationId}
                className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2.5 py-1.5 text-xs hover:bg-neutral-50"
              >
                <span className="min-w-0 break-words">
                  <span className="font-semibold">{m.participantName}</span> — {m.categoryName}
                </span>
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={selected.has(m.categoryId)}
                  onChange={() => onToggle(m.categoryId, `${m.participantName} — ${m.categoryName}`)}
                />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
  // categoryId -> display label. A Map (not just a Set) so the "Selected"
  // summary below still shows what was picked even after the trace box that
  // surfaced it has moved on to a different search.
  const [selected, setSelected] = useState<Map<string, string>>(new Map());

  function toggleSelected(catId: string, display: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(catId)) next.delete(catId);
      else next.set(catId, display);
      return next;
    });
  }

  // A separate path from toggleSelected (not a loop of individual toggles)
  // — a school/sensei trace can easily surface the SAME categoryId twice
  // (two students under one category), and composing "select all" out of
  // add-or-remove toggles would net-cancel a repeated id back to
  // unselected. This only ever adds, in one state update.
  function selectAllMatches(matches: ParticipantTraceMatch[]) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const m of matches) {
        if (!next.has(m.categoryId)) next.set(m.categoryId, `${m.participantName} — ${m.categoryName}`);
      }
      return next;
    });
  }

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

  const resolvedName = categories.find((c) => c.id === categoryId)?.name ?? "";

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
        Conflict-of-interest exclusions
      </p>
      <p className="text-xs text-neutral-500">
        Categories this judge must never be assigned to — e.g. they them self participate to
        compete or their own child or student&apos;s category. Auto-assign and manual assignment
        both respect this list.
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

      <TraceBox
        label="Trace by participant name" name="trace_participant" placeholder="e.g. Ahmad bin Ali"
        action={traceParticipantForExclusion} selected={selected} onToggle={toggleSelected} onSelectAll={selectAllMatches}
      />
      <TraceBox
        label="Trace by School / Dojo name" name="trace_school" placeholder="e.g. Shotokan Dojo KL"
        action={traceSchoolForExclusion} selected={selected} onToggle={toggleSelected} onSelectAll={selectAllMatches}
      />
      <TraceBox
        label="Trace by Sensei name" name="trace_sensei" placeholder="e.g. Sensei Tan"
        action={traceSenseiForExclusion} selected={selected} onToggle={toggleSelected} onSelectAll={selectAllMatches}
      />

      {selected.size > 0 && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Selected ({selected.size})
          </p>
          <div className="mt-1.5 space-y-1">
            {[...selected.entries()].map(([id, display]) => (
              <div key={id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 break-words">{display}</span>
                <button
                  type="button"
                  onClick={() => toggleSelected(id, display)}
                  className="shrink-0 font-semibold text-red-600 hover:underline"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <form action={addRefereeExclusions} className="mt-2">
            <input type="hidden" name="referee_id" value={refereeId} />
            {[...selected.keys()].map((id) => (
              <input key={id} type="hidden" name="category_ids" value={id} />
            ))}
            <button type="submit" className={adminBtn}>
              Add {selected.size} ticked to exclusions
            </button>
          </form>
        </div>
      )}

      <p className="text-xs text-neutral-400">— or select the 4 fields manually below —</p>

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
    </div>
  );
}
