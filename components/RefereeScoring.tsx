"use client";

import { useMemo, useState } from "react";
import { submitScore } from "@/app/actions/account";
import { CategoryName } from "@/components/ui";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";
import ReasonPicker from "@/components/ReasonPicker";
import {
  SHEET1_CRITERIA,
  SHEET2_CRITERIA,
  TOTAL_MAX,
  OTHER_DISQUALIFICATION_REASON,
  splitCapped,
  splitSheet1,
  type RubricCriterion,
} from "@/lib/scoring-rubric";
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

/** The official rubric table, matching the two sheets of "SCORE TABLE 2
 * WITH FORMULA - Referee or Judges to choose one to use only.xlsx": No. /
 * Criteria / Score range / score column, ending in the Total Score (0–10)
 * row and the sheet's "Disqualify = 0" rule. Pass `rubric` to render
 * Score Sheet 1's 10 rows (0–1 each) instead of the default 7-row Score
 * Sheet 2. `readOnly` renders values only (admin detail views). */
export function RubricTable({
  values,
  onChange,
  readOnly,
  rubric = SHEET2_CRITERIA,
  dense,
}: {
  values: number[];
  onChange?: (i: number, raw: string) => void;
  readOnly?: boolean;
  rubric?: RubricCriterion[];
  /** Shrinks row height (~40%) for space-constrained read-only views like
   * Full View's 3-judge-tables-side-by-side layout. */
  dense?: boolean;
}) {
  const total = useMemo(() => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10, [values]);
  const disqualifying = total === 0;
  const overMax = total > TOTAL_MAX;
  const cellPad = dense ? "px-2 py-0.5" : "px-2 py-1.5";
  const totalPad = dense ? "px-2 py-1" : "px-2 py-2";
  const textSize = dense ? "text-xs" : "text-sm";
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className={`w-full min-w-[420px] text-left ${textSize}`}>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className={cellPad}>No.</th>
              <th className={cellPad}>Criteria</th>
              <th className={cellPad}>Score</th>
              <th className={cellPad}>{readOnly ? "Points" : "Your score"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rubric.map((c, i) => (
              <tr key={c.label}>
                <td className={`${cellPad} text-neutral-400`}>{i + 1}.</td>
                <td className={cellPad}>{c.label}</td>
                <td className={`${cellPad} text-neutral-400`}>0–{c.max}</td>
                <td className={cellPad}>
                  {readOnly ? (
                    <span className="font-semibold text-neutral-800">{(values[i] ?? 0).toFixed(2)}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={c.max}
                      step={0.01}
                      value={values[i]}
                      onChange={(e) => onChange?.(i, e.target.value)}
                      className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    />
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-neutral-50 font-semibold">
              <td colSpan={2} className={`${totalPad} text-right`}>Total Score</td>
              <td className={`${totalPad} text-neutral-400`}>0–{TOTAL_MAX}</td>
              <td className={`${totalPad} ${disqualifying || overMax ? "text-red-700" : "text-neutral-900"}`}>
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
 * 1 or 2, both straight from the Excel — the referee/judge chooses which
 * one to use), then two floating windows — the recording on one half and
 * the chosen sheet on the other (side-by-side in landscape, stacked in
 * portrait). Sheet 1 scores 10 criteria row by row, 0–1 each. Sheet 2 is
 * the spreadsheet's "Just Input a No. to Self-Populated on Average then
 * readjust accordingly" mode: one Total (0–10) fills the 7 rows — items
 * 1–5 capped at 1 each, the rest split equally into items 6–7 — and every
 * row stays editable so the judge can readjust. Closing the sheet (✕ top
 * right) expands the video to full screen; when the recording ends the
 * score board pops back up to score and save. The Sheet 1 / Sheet 2
 * buttons on the recording window switch sheets mid-session. Closing the
 * video window ends the session. */
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
  const [sheet1Values, setSheet1Values] = useState<number[]>(() => splitSheet1(item.existingScore));
  const [sheet2Values, setSheet2Values] = useState<number[]>(() => splitCapped(item.existingScore));
  const [sheet1QuickTotal, setSheet1QuickTotal] = useState<string>(
    item.existingScore != null ? String(item.existingScore) : "",
  );
  const [quickTotal, setQuickTotal] = useState<string>(
    item.existingScore != null ? String(item.existingScore) : "",
  );
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const finalReason = (reason === OTHER_DISQUALIFICATION_REASON ? customReason : reason).trim();

  const sheet1Total = useMemo(
    () => Math.round(sheet1Values.reduce((a, b) => a + b, 0) * 10) / 10,
    [sheet1Values],
  );
  const sheet2Total = useMemo(
    () => Math.round(sheet2Values.reduce((a, b) => a + b, 0) * 10) / 10,
    [sheet2Values],
  );

  /** A hand-adjusted row overrides Sheet 1's self-population; its Total
   * box resyncs to the new row sum (1 decimal place). */
  function setSheet1Criterion(i: number, raw: string) {
    const n = Math.max(0, Math.min(SHEET1_CRITERIA[i].max, Number(raw) || 0));
    setSheet1Values((v) => {
      const next = v.map((x, idx) => (idx === i ? n : x));
      setSheet1QuickTotal(String(Math.round(next.reduce((a, b) => a + b, 0) * 10) / 10));
      return next;
    });
    setSaved(false);
  }

  function setSheet1Quick(raw: string) {
    setSheet1QuickTotal(raw);
    if (raw !== "") {
      const t = Math.max(0, Math.min(TOTAL_MAX, Number(raw) || 0));
      setSheet1Values(splitSheet1(t));
    }
    setSaved(false);
  }

  /** A hand-adjusted row overrides the self-population; the Total box
   * resyncs to the new row sum so what the judge sees is what's saved. */
  function setSheet2Criterion(i: number, raw: string) {
    const n = Math.max(0, Math.min(SHEET2_CRITERIA[i].max, Number(raw) || 0));
    setSheet2Values((v) => {
      const next = v.map((x, idx) => (idx === i ? n : x));
      setQuickTotal(String(Math.round(next.reduce((a, b) => a + b, 0) * 10) / 10));
      return next;
    });
    setSaved(false);
  }

  function setSheet2QuickTotal(raw: string) {
    setQuickTotal(raw);
    if (raw !== "") {
      const t = Math.max(0, Math.min(TOTAL_MAX, Number(raw) || 0));
      setSheet2Values(splitCapped(t));
    }
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
                10 criteria (Stances, Techniques, Focus, Speed, Balance, …), 0–1 each — input one
                Total Score (0–{TOTAL_MAX}) to self-populate all rows, then readjust any row if
                you wish.
              </p>
            </button>
            <button
              type="button"
              onClick={() => pickSheet(2)}
              className="rounded-lg border-2 border-neutral-300 p-4 text-left hover:border-red-700 hover:bg-red-50"
            >
              <p className="font-bold text-neutral-900">Score Sheet 2</p>
              <p className="mt-1 text-xs text-neutral-500">
                Input one Total Score (0–{TOTAL_MAX}) — the 7 criteria self-populate (items 1–5
                max 1 each, the rest split into items 6–7), then readjust any row if you wish.
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

  const submittedScore = sheet === 1 ? sheet1Total : sheet2Total;
  const submittedCriteria = sheet === 1 ? sheet1Values : sheet2Values;
  const submitBlocked =
    submittedScore > TOTAL_MAX ||
    (sheet === 1 ? sheet1QuickTotal === "" : quickTotal === "") ||
    (submittedScore === 0 && !finalReason);

  const disqualificationReasonBox = (
    <div className="mt-2 rounded-md border-2 border-red-300 bg-red-50 p-3">
      <p className="text-xs font-semibold text-red-700">
        0 = Disqualified — this participant will not be announced as a winner. A reason is required.
      </p>
      <label className="mb-1 mt-2 block text-xs font-bold text-neutral-700">Reason *</label>
      <ReasonPicker
        reason={reason}
        customReason={customReason}
        onReasonChange={setReason}
        onCustomReasonChange={setCustomReason}
      />
    </div>
  );

  const scoreForm = (
    <form
      action={async (formData) => {
        setPending(true);
        await submitScore(formData);
        setPending(false);
        setSaved(true);
      }}
      onKeyDown={(e) => {
        // Submitting is final, so never let a stray Enter in a score box
        // submit the sheet — only the Submit button may.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
      className="p-4"
    >
      <input type="hidden" name="video_id" value={item.videoId} />
      <input type="hidden" name="score" value={submittedScore} />
      {submittedScore === 0 && <input type="hidden" name="reason" value={finalReason} />}
      {submittedCriteria.map((v, i) => (
        <input key={i} type="hidden" name="criteria" value={v} />
      ))}
      {sheet === 1 ? (
        <>
          <div className="mb-3 rounded-md border-2 border-red-200 bg-red-50 p-3">
            <label htmlFor={`quick1_${item.videoId}`} className="mb-1 block text-sm font-bold text-neutral-800">
              Just input one Total Score (0–{TOTAL_MAX}) — the rows below self-populate
            </label>
            <input
              id={`quick1_${item.videoId}`}
              name="quick_total_display"
              type="number"
              min={0}
              max={TOTAL_MAX}
              step={0.1}
              required
              value={sheet1QuickTotal}
              onChange={(e) => setSheet1Quick(e.target.value)}
              className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-lg font-bold"
            />
            <p className="mt-2 text-xs text-neutral-600">
              Self-population fills items 1–10 up to their 0–1 maximum, at 2 decimal points; the
              Total Score keeps to 1 decimal point. <strong>Not happy with the self-population?
              Adjust any row below yourself</strong> — the Total resyncs to your adjusted rows.
            </p>
            {sheet1Total === 0 && sheet1QuickTotal !== "" && disqualificationReasonBox}
          </div>
          <RubricTable rubric={SHEET1_CRITERIA} values={sheet1Values} onChange={setSheet1Criterion} />
        </>
      ) : (
        <>
          <div className="mb-3 rounded-md border-2 border-red-200 bg-red-50 p-3">
            <label htmlFor={`quick_${item.videoId}`} className="mb-1 block text-sm font-bold text-neutral-800">
              Just input one Total Score (0–{TOTAL_MAX}) — the rows below self-populate
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
              onChange={(e) => setSheet2QuickTotal(e.target.value)}
              className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-lg font-bold"
            />
            <p className="mt-2 text-xs text-neutral-600">
              Self-population fills items 1–5 up to their 0–1 maximum and splits the rest equally
              between items 6 and 7. <strong>Not happy with the self-population? Adjust any row
              below yourself</strong> — the Total resyncs to your adjusted rows.
            </p>
            {sheet2Total === 0 && quickTotal !== "" && disqualificationReasonBox}
          </div>
          <RubricTable values={sheet2Values} onChange={setSheet2Criterion} />
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
