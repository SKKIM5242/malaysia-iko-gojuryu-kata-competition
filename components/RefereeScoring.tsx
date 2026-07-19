"use client";

import { useMemo, useState } from "react";
import { submitScore } from "@/app/actions/account";
import { CategoryName } from "@/components/ui";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";
import { SCORING_CRITERIA, TOTAL_MAX, splitEvenly } from "@/lib/scoring-rubric";
import { splitCategoryName } from "@/lib/division";

export interface ScoringItem {
  videoId: string;
  participantName: string;
  participantCountry: string | null;
  categoryName: string | null;
  competitionName: string | null;
  playbackUrl: string | null;
  existingScore: number | null;
}

/** The official rubric table, matching "SCORE TABLE 2 WITH FORMULA.xlsx"
 * exactly: No. / Criteria / Score range (0–1 ×5, 0–3 ×2) / score column,
 * ending in the Total Score (0–10) row and the sheet's "0 = Disqualified"
 * rule. `readOnly` renders values only (admin detail view + Score Sheet
 * 1's self-populated rows). */
export function RubricTable({
  values,
  onChange,
  readOnly,
}: {
  values: number[];
  onChange?: (i: number, raw: string) => void;
  readOnly?: boolean;
}) {
  const total = useMemo(() => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10, [values]);
  const disqualifying = total === 0;
  const overMax = total > TOTAL_MAX;
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-2 py-1.5">No.</th>
              <th className="px-2 py-1.5">Criteria</th>
              <th className="px-2 py-1.5">Score</th>
              <th className="px-2 py-1.5">{readOnly ? "Points" : "Your score"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {SCORING_CRITERIA.map((c, i) => (
              <tr key={c.label}>
                <td className="px-2 py-1.5 text-neutral-400">{i + 1}.</td>
                <td className="px-2 py-1.5">{c.label}</td>
                <td className="px-2 py-1.5 text-neutral-400">0–{c.max}</td>
                <td className="px-2 py-1.5">
                  {readOnly ? (
                    <span className="font-semibold text-neutral-800">{(values[i] ?? 0).toFixed(2)}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={c.max}
                      step={0.1}
                      value={values[i]}
                      onChange={(e) => onChange?.(i, e.target.value)}
                      className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    />
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-neutral-50 font-semibold">
              <td colSpan={2} className="px-2 py-2 text-right">Total Score</td>
              <td className="px-2 py-2 text-neutral-400">0–{TOTAL_MAX}</td>
              <td className={`px-2 py-2 ${disqualifying || overMax ? "text-red-700" : "text-neutral-900"}`}>
                {total.toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {overMax && (
        <p className="mt-2 text-xs font-semibold text-red-700">
          Total Score cannot exceed {TOTAL_MAX} — lower one or more rows before submitting.
        </p>
      )}
      {disqualifying && (
        <p className="mt-2 text-xs font-semibold text-red-700">
          0 = Disqualified — this participant will not be announced as a winner, regardless of the
          other judges&apos; scores.
        </p>
      )}
    </>
  );
}

/** One judging session, exactly as instructed: chooser first (Score Sheet
 * 1 or 2, both straight from the Excel), then two floating windows — the
 * recording on one half and the chosen sheet on the other (side-by-side
 * in landscape, stacked in portrait). Sheet 1 is the spreadsheet's
 * "Sensei Just Input a No. to Self-Populate" mode: one Total (0–10) and
 * every criterion row fills itself with total÷7. Sheet 2 is row-by-row
 * entry. Closing the sheet (✕ top right) expands the video to full
 * screen; when the recording ends the score board pops back up to score
 * and save. The Sheet 1 / Sheet 2 buttons on the recording window switch
 * sheets mid-session. Closing the video window ends the session. */
export function ScoreSession({
  item,
  onExit,
  allowAdvancedControls = false,
}: {
  item: ScoringItem;
  onExit: () => void;
  allowAdvancedControls?: boolean;
}) {
  const [sheet, setSheet] = useState<1 | 2 | null>(null);
  const [scoreOpen, setScoreOpen] = useState(true);
  const [saved, setSaved] = useState(item.existingScore != null);
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<number[]>(() => splitEvenly(item.existingScore));
  const [quickTotal, setQuickTotal] = useState<string>(
    item.existingScore != null ? String(item.existingScore) : "",
  );

  const rowTotal = useMemo(() => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10, [values]);
  const sheet1Total = quickTotal === "" ? null : Math.max(0, Math.min(TOTAL_MAX, Number(quickTotal) || 0));
  const sheet1Values = useMemo(() => splitEvenly(sheet1Total), [sheet1Total]);

  function setCriterion(i: number, raw: string) {
    const n = Math.max(0, Math.min(SCORING_CRITERIA[i].max, Number(raw) || 0));
    setValues((v) => v.map((x, idx) => (idx === i ? n : x)));
    setSaved(false);
  }

  function pickSheet(n: 1 | 2) {
    setSheet(n);
    setScoreOpen(true);
  }

  if (sheet === null) {
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4" onClick={onExit}>
        <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <p className="font-bold text-neutral-900">Which score sheet do you prefer?</p>
          <p className="mt-1 text-xs text-neutral-500">
            Both are the official table from the organizer&apos;s spreadsheet. The recording and
            your chosen sheet open side by side — on iPad or phone, rotate to landscape for the
            side-by-side view (portrait stacks them top and bottom).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => pickSheet(1)}
              className="rounded-lg border-2 border-neutral-300 p-4 text-left hover:border-red-700 hover:bg-red-50"
            >
              <p className="font-bold text-neutral-900">Score Sheet 1</p>
              <p className="mt-1 text-xs text-neutral-500">
                Input one Total Score (0–{TOTAL_MAX}) — every criteria row self-populates, exactly
                like the spreadsheet&apos;s &quot;input a No. to self-populate&quot; column.
              </p>
            </button>
            <button
              type="button"
              onClick={() => pickSheet(2)}
              className="rounded-lg border-2 border-neutral-300 p-4 text-left hover:border-red-700 hover:bg-red-50"
            >
              <p className="font-bold text-neutral-900">Score Sheet 2</p>
              <p className="mt-1 text-xs text-neutral-500">
                Score each of the 7 criteria row by row (0–1 and 0–3 ranges) — the Total computes
                itself, capped at {TOTAL_MAX}.
              </p>
            </button>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="mt-4 text-sm font-semibold text-neutral-500 hover:text-neutral-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const submitBlocked = sheet === 2 ? rowTotal > TOTAL_MAX : sheet1Total == null;
  const submittedScore = sheet === 2 ? rowTotal : (sheet1Total ?? 0);
  const submittedCriteria = sheet === 2 ? values : sheet1Values;

  const scoreForm = (
    <form
      action={async (formData) => {
        setPending(true);
        await submitScore(formData);
        setPending(false);
        setSaved(true);
      }}
      className="p-4"
    >
      <input type="hidden" name="video_id" value={item.videoId} />
      <input type="hidden" name="score" value={submittedScore} />
      {submittedCriteria.map((v, i) => (
        <input key={i} type="hidden" name="criteria" value={v} />
      ))}
      {sheet === 2 ? (
        <RubricTable values={values} onChange={setCriterion} />
      ) : (
        <>
          <RubricTable values={sheet1Values} readOnly />
          <div className="mt-3 rounded-md border-2 border-red-200 bg-red-50 p-3">
            <label htmlFor={`quick_${item.videoId}`} className="mb-1 block text-sm font-bold text-neutral-800">
              Just input one Total Score (0–{TOTAL_MAX}) — the rows above self-populate
            </label>
            <input
              id={`quick_${item.videoId}`}
              name="quick_total_display"
              type="number"
              min={0}
              max={TOTAL_MAX}
              step={0.1}
              required
              value={quickTotal}
              onChange={(e) => {
                setQuickTotal(e.target.value);
                setSaved(false);
              }}
              className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-lg font-bold"
            />
            {sheet1Total === 0 && quickTotal !== "" && (
              <p className="mt-2 text-xs font-semibold text-red-700">0 = Disqualified.</p>
            )}
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        Submitting is final — scores cannot be appealed or changed once judging closes.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || submitBlocked}
          className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : saved ? "Update score" : "Submit score"}
        </button>
        {saved && <span className="text-xs font-semibold text-green-700">✔ Score saved</span>}
      </div>
    </form>
  );

  const sheetSwitchButtons = (
    <div className="mr-1 flex items-center gap-1" data-no-drag>
      {([1, 2] as const).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => pickSheet(n)}
          className={`rounded px-2 py-0.5 text-[11px] font-bold ${
            sheet === n && scoreOpen
              ? "bg-red-700 text-white"
              : "bg-white text-neutral-600 ring-1 ring-neutral-300 hover:bg-neutral-100"
          }`}
          title={`Open Score Sheet ${n}`}
        >
          Sheet {n}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <FloatingWindow
        title={`Watch Recording — ${item.participantName}`}
        onClose={onExit}
        initial={scoreOpen ? "first-half" : "max"}
        headerExtra={sheetSwitchButtons}
      >
        <div className="flex h-full flex-col bg-black">
          {item.playbackUrl ? (
            <LockedVideo
              src={item.playbackUrl}
              autoPlay
              allowAdvancedControls={allowAdvancedControls}
              onEnded={() => setScoreOpen(true)}
            />
          ) : (
            <p className="p-6 text-sm text-neutral-300">Video not available.</p>
          )}
        </div>
      </FloatingWindow>
      {scoreOpen && (
        <FloatingWindow
          title={`Score Sheet ${sheet} — ${item.participantName}`}
          onClose={() => setScoreOpen(false)}
          initial="second-half"
        >
          <div className="border-b border-neutral-100 px-4 pt-3 pb-2">
            <p className="font-bold text-neutral-900">{item.participantName}</p>
            <p className="text-xs text-neutral-500">
              {item.participantCountry ?? "—"} · <CategoryName name={item.categoryName} />
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              Close this sheet (✕) to finish watching first — it pops back up the moment the
              recording ends. Switch sheets with the Sheet 1 / Sheet 2 buttons on the recording
              window.
            </p>
          </div>
          {scoreForm}
        </FloatingWindow>
      )}
    </>
  );
}

/** "Watch recording" that scores: for anyone allowed to score this video
 * it opens the full ScoreSession (sheet chooser → dual windows); for
 * view-only staff it opens a plain video window. Used on the Judging page
 * and the admin Score Recordings page. */
export function ScoreSessionButton({
  item,
  canScore,
  allowAdvancedControls = false,
  label = "Watch recording",
}: {
  item: ScoringItem;
  canScore: boolean;
  allowAdvancedControls?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!item.playbackUrl) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        {label}
      </button>
      {open &&
        (canScore ? (
          <ScoreSession item={item} onExit={() => setOpen(false)} allowAdvancedControls={allowAdvancedControls} />
        ) : (
          <FloatingWindow title={`Watch Recording — ${item.participantName}`} onClose={() => setOpen(false)}>
            <div className="flex h-full flex-col bg-black">
              <LockedVideo src={item.playbackUrl} autoPlay allowAdvancedControls={allowAdvancedControls} />
            </div>
          </FloatingWindow>
        ))}
    </>
  );
}

function ScoreRow({ item }: { item: ScoringItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-neutral-900">{item.participantName}</p>
          <p className="text-xs text-neutral-500">
            {item.participantCountry ?? "—"} · <CategoryName name={item.categoryName} />
            {item.competitionName ? ` · ${item.competitionName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.existingScore != null && (
            <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
              Total {item.existingScore.toFixed(1)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
          >
            {item.existingScore != null ? "Update score" : "Score this recording"}
          </button>
        </div>
      </div>
      {open && <ScoreSession item={item} onExit={() => setOpen(false)} />}
    </div>
  );
}

const ALL = "All";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs font-semibold text-neutral-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm font-normal text-neutral-800"
      >
        <option value={ALL}>{ALL}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export default function RefereeScoring({
  refereeName,
  refereeCountry,
  items,
}: {
  refereeName: string;
  refereeCountry: string | null;
  items: ScoringItem[];
}) {
  const [tier, setTier] = useState(ALL);
  const [kata, setKata] = useState(ALL);
  const [belt, setBelt] = useState(ALL);
  const [age, setAge] = useState(ALL);
  const [sex, setSex] = useState(ALL);

  const opts = useMemo(() => {
    const tiers = new Set<string>();
    const katas = new Set<string>();
    const belts = new Set<string>();
    const ages = new Set<string>();
    const sexes = new Set<string>();
    for (const it of items) {
      if (it.competitionName) tiers.add(it.competitionName);
      const p = splitCategoryName(it.categoryName);
      if (p.kata) katas.add(p.kata);
      if (p.belt) belts.add(p.belt);
      if (p.age) ages.add(p.age);
      if (p.sex) sexes.add(p.sex);
    }
    return {
      tiers: [...tiers].sort(),
      katas: [...katas].sort(),
      belts: [...belts].sort(),
      ages: [...ages].sort(),
      sexes: [...sexes].sort(),
    };
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((it) => {
        const p = splitCategoryName(it.categoryName);
        if (tier !== ALL && it.competitionName !== tier) return false;
        if (kata !== ALL && p.kata !== kata) return false;
        if (belt !== ALL && p.belt !== belt) return false;
        if (age !== ALL && p.age !== age) return false;
        if (sex !== ALL && p.sex !== sex) return false;
        return true;
      }),
    [items, tier, kata, belt, age, sex],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
        Signed in as Referee/Judge <strong>{refereeName}</strong>
        {refereeCountry ? ` (${refereeCountry})` : ""}. Only the recordings assigned to you by the
        organizer are listed (and filterable) below — to browse the whole competition, use the
        Kata Arena instead. Your score is final once submitted — no appeal is available. Click
        &quot;Score this recording&quot; to choose Score Sheet 1 or 2 — works the same on laptop,
        desktop, tablet, or phone (rotate to landscape for the side-by-side view).
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3">
          <FilterSelect label="Competition Tier" value={tier} options={opts.tiers} onChange={setTier} />
          <FilterSelect label="Kata" value={kata} options={opts.katas} onChange={setKata} />
          <FilterSelect label="Belt Division" value={belt} options={opts.belts} onChange={setBelt} />
          <FilterSelect label="Age" value={age} options={opts.ages} onChange={setAge} />
          <FilterSelect label="Sex / Mix" value={sex} options={opts.sexes} onChange={setSex} />
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-neutral-500">
          No participants assigned to you yet. Check back once the organizer assigns recordings for
          you to judge.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-neutral-500">
          None of your assigned recordings match these filters.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => (
            <ScoreRow key={item.videoId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
