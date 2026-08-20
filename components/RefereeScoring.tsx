"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitScore } from "@/app/actions/account";
import { CategoryName } from "@/components/ui";
import FloatingWindow from "@/components/FloatingWindow";
import LockedVideo from "@/components/LockedVideo";
import ReasonPicker from "@/components/ReasonPicker";
import { useTableInteractions } from "@/lib/useTableInteractions";
import TableInteractionOverlays from "@/components/TableInteractionOverlays";
import {
  SHEET1_CRITERIA,
  SHEET2_CRITERIA,
  TOTAL_MAX,
  OTHER_DISQUALIFICATION_REASON,
  DEDUCTION_OPTIONS,
  splitCapped,
  splitSheet1,
  scoreAfterDeductions,
  sumDeductions,
  needsDoubleReview,
  round2,
  emptyDeductions,
  type RubricCriterion,
} from "@/lib/scoring-rubric";
import { splitCategoryName } from "@/lib/division";
import { sortKataNames } from "@/lib/kata-families";
import { shortTierName } from "@/lib/invitation-codes";

export interface ScoringItem {
  videoId: string;
  participantName: string;
  participantCountry: string | null;
  categoryName: string | null;
  competitionName: string | null;
  playbackUrl: string | null;
  existingScore: number | null;
}

const RESIZE_MIN = 44;

/** The official rubric table, matching the two sheets of "SCORE TABLE 2
 * WITH FORMULA - Referee or Judges to choose one to use only.xlsx": No. /
 * Criteria / [5 "Reduce Score System" deduction columns] / Score range /
 * score column, ending in the Total Score (0–10) row and the sheet's
 * "Disqualify = 0" rule. Pass `rubric` to render Score Sheet 1's 10 rows
 * (0–1 each) instead of the default 7-row Score Sheet 2. `readOnly`
 * renders values only (admin detail views) — there, the 5 deduction
 * columns start collapsed and only expand on click/touch, since a review
 * popup rarely needs them and screen space is tight (especially Full
 * View's 3-judges-side-by-side layout).
 *
 * The editable table also gets the same column/row drag-reorder, column
 * resize, and cell-select + copy/fill-copy functions as every other admin
 * table in the app — reordering is display-only (each row/column keeps
 * its real data via a stable key), so it can never corrupt what actually
 * gets submitted. Deliberately NOT included: resizing/closing a column or
 * row down to nothing — fine on a data-browsing admin table, but a judge
 * accidentally hiding their own Score input mid-session is a real
 * problem, not just a cosmetic one. */
export function RubricTable({
  values,
  onChange,
  readOnly,
  rubric = SHEET2_CRITERIA,
  dense,
  deductions,
  onDeductionToggle,
  canToggleDeductions,
}: {
  values: number[];
  onChange?: (i: number, raw: string) => void;
  readOnly?: boolean;
  rubric?: RubricCriterion[];
  /** Shrinks row height (~40%) for space-constrained read-only views like
   * Full View's 3-judge-tables-side-by-side layout. */
  dense?: boolean;
  /** One boolean[] of DEDUCTION_OPTIONS.length per criterion row — which
   * "Reduce Score System" boxes are ticked. Optional so old scores
   * (submitted before this existed) still render fine with nothing ticked. */
  deductions?: (boolean[] | null | undefined)[] | null;
  onDeductionToggle?: (row: number, col: number) => void;
  /** Read-only views only: gates the Show/Hide toggle for the 5 real
   * deduction columns, and the row-6/7 double-review note — per the
   * organizer's explicit instruction, Admin/Super Admin/Organizer/
   * Referee-Judge only, everyone else (including public /winners
   * visitors) still sees the collapsed per-row deduction total but never
   * gets a way to expand it. Ignored when !readOnly, since the editable
   * live-scoring table is only ever reached by an already-authorized
   * scorer. */
  canToggleDeductions?: boolean;
}) {
  const total = useMemo(() => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10, [values]);
  const disqualifying = total === 0;
  const overMax = total > TOTAL_MAX;
  // py-1 rather than py-1.5: across ten rubric rows that alone is ~20px, and
  // the sheet is fighting for every row it can show without a scroll.
  const cellPad = dense ? "px-1 py-0.5" : "px-2 py-1";
  const totalPad = dense ? "px-2 py-1" : "px-2 py-2";
  const textSize = dense ? "text-xs" : "text-sm";
  // Score Sheet 2's seven labels ("Neat appearance of uniform and person",
  // "Execution of techniques (sharpness)") run roughly twice as long as Sheet
  // 1's, so at the same face they wrapped to three lines each and pushed
  // Submit below the fold. One step down buys back a whole row.
  const longLabels = rubric.length === SHEET2_CRITERIA.length;
  const rowKey = useCallback((c: RubricCriterion) => c.label, []);

  // Read-only: the 5 deduction columns start collapsed (a single "Show
  // deductions" toggle column) and expand on click/touch.
  const [dedExpanded, setDedExpanded] = useState(false);

  // Editable-only Excel-like functions. Always call the hooks (rules of
  // hooks) but only wire them up when !readOnly.
  const t = useTableInteractions({
    onFill: onChange
      ? (value, targets) => {
          for (const target of targets) {
            if (target.col !== "your_score") continue;
            const i = rubric.findIndex((c) => c.label === target.row);
            if (i === -1) continue;
            onChange(i, value);
          }
        }
      : undefined,
  });
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);
  const handleResizeMove = useCallback((e: PointerEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(RESIZE_MIN, r.startWidth + (e.clientX - r.startX));
    setColWidths((prev) => ({ ...prev, [r.key]: next }));
  }, []);
  const handleResizeUp = useCallback(() => {
    resizingRef.current = null;
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", handleResizeUp);
  }, [handleResizeMove]);
  const handleResizeStart = useCallback(
    (e: React.PointerEvent, key: string, fallback: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key, startX: e.clientX, startWidth: widthOf(key, fallback) };
      window.addEventListener("pointermove", handleResizeMove);
      window.addEventListener("pointerup", handleResizeUp);
    },
    [widthOf, handleResizeMove, handleResizeUp],
  );

  // The editable table used to lay out at a HARD 584px (30 + 210 + 5x44 + 46
  // + 78), so any container narrower than that -- a phone, a tablet, a
  // snapped half-window -- grew a horizontal scrollbar and a judge had to
  // swipe sideways to reach Your Score. Now every column except Criteria
  // takes a small fixed width and CRITERIA IS LEFT WITHOUT ONE, so with
  // table-layout:fixed + width:100% the browser hands it every pixel the
  // others didn't use. No measuring, no ResizeObserver, no reflow after
  // hydration: the table is simply always exactly as wide as its container,
  // whatever that turns out to be. A wide window puts the labels on one
  // line; a phone wraps them; neither ever puts a column out of reach.
  const size = { no: 24, ded: 32, score: 36, yourScore: 46 };
  // The narrow columns can't afford cellPad's px-2 (16px of the 24px "No."
  // column would have been padding, and "10." then bled over the Criteria
  // label beside it). Their content is 3-5 characters wide, so they get
  // their own padding and keep essentially all of their width for text.
  const padFor = (key: string) =>
    key === "no" || key === "score_range" ? "px-0.5 py-1" : key.startsWith("ded") ? "px-0 py-1" : cellPad;
  // The floor Criteria may not shrink past. Below this the wrapper scrolls
  // rather than squeezing the labels to one word per line -- only reachable
  // on a container under ~370px, i.e. narrower than any phone in portrait.
  const CRITERIA_MIN = 88;
  const fixedTotal = size.no + DEDUCTION_OPTIONS.length * size.ded + size.score + size.yourScore;
  const baseColumns = [
    { key: "no", label: "No.", width: size.no },
    // 210 is only the fallback used once a judge has hand-resized something
    // (see userResized below); untouched, this column has no width at all.
    { key: "criteria", label: "Criteria", width: 210 },
    ...DEDUCTION_OPTIONS.map((opt, i) => ({ key: `ded${i}`, label: opt.label, width: size.ded, amount: opt.amount })),
    { key: "score_range", label: "Score", width: size.score },
    // 78 -> 48: the box only ever has to show "0.00" now that hand-typed
    // values are rounded to 2dp, and the 30px it gives back goes to Criteria.
    { key: "your_score", label: readOnly ? "Points" : "Your score", width: size.yourScore },
  ];
  // Dragging any column edge switches the table back to the old
  // sum-of-pixel-widths layout, so a deliberate resize behaves exactly as it
  // always did (including growing past the container and scrolling) instead
  // of being silently re-absorbed by the 100% auto-fit.
  const userResized = Object.keys(colWidths).length > 0;
  const orderedColumns = readOnly ? baseColumns : t.orderColumnKeys(baseColumns.map((c) => c.key)).map((k) => baseColumns.find((c) => c.key === k)!).filter(Boolean);
  const orderedRows = readOnly ? rubric : t.orderRowKeys(rubric.map(rowKey)).map((k) => rubric.find((c) => rowKey(c) === k)).filter((c): c is RubricCriterion => !!c);

  function headerCell(c: (typeof baseColumns)[number]) {
    if (c.key === "criteria") {
      return (
        <span className="flex flex-col items-start gap-1">
          <span>Criteria</span>
          {readOnly && !dense && canToggleDeductions && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDedExpanded((v) => !v);
              }}
              className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold normal-case text-neutral-600 hover:bg-neutral-50"
              title={dedExpanded ? "Click or touch to hide the 5 deduction columns" : "Click or touch to show the 5 deduction columns"}
            >
              {dedExpanded ? "✕ Hide deductions" : "▸ Show deductions"}
            </button>
          )}
        </span>
      );
    }
    if (c.key === "score_range") return <span className="text-[9px] @[420px]:text-[10px]">Score</span>;
    if (c.key === "your_score") return c.label;
    if (c.key === "no") return <span className="text-[9px] @[420px]:text-[10px]">No.</span>;
    return (
      <span className="block text-center text-[8px] leading-none @[420px]:text-[9px]">
        <span className="block">{c.label}</span>
        <span className="block font-normal normal-case text-red-500">-{(c as { amount: number }).amount}</span>
      </span>
    );
  }

  function cellContent(c: RubricCriterion, i: number, colKey: string) {
    const rk = rowKey(c);
    const dedIndex = colKey.startsWith("ded") ? Number(colKey.slice(3)) : -1;
    if (dedIndex >= 0) {
      const checked = deductions?.[i]?.[dedIndex] ?? false;
      return (
        <input
          type="checkbox"
          checked={checked}
          disabled={readOnly}
          onChange={() => onDeductionToggle?.(i, dedIndex)}
          className="h-4 w-4 rounded border-neutral-300 accent-red-700 disabled:opacity-70"
          aria-label={`${c.label} — ${DEDUCTION_OPTIONS[dedIndex].label} ${DEDUCTION_OPTIONS[dedIndex].amount}`}
        />
      );
    }
    if (colKey === "no")
      return <span className="whitespace-nowrap text-[11px] text-neutral-400 @[420px]:text-sm">{i + 1}.</span>;
    if (colKey === "criteria") {
      // Dropped in FULL VIEW only, on the organizer's instruction -- there it
      // repeated down every Score Sheet 2 panel in a three-across layout with
      // no room to spare, and nobody reading a finished score can act on it.
      // `dense` is the reliable tell: it is passed only by FullViewButton,
      // never by ScoreDetailButton, so that modal keeps the warning exactly
      // as before, and so does a judge filling in their own score sheet.
      const showDoubleReview = needsDoubleReview(c.max) && (!readOnly || canToggleDeductions) && !dense;
      return (
        <span className="flex flex-col">
          <span
            className={
              // Below ~420px of table (a phone in portrait) the labels drop a
              // step so "Conformance: Consistence in the performance of the
              // KIHON" costs three lines instead of four. Sheet 2's seven
              // labels run about twice as long as Sheet 1's, so they keep the
              // smaller face until there is a lot more room.
              longLabels
                ? "text-[11px] leading-snug @[560px]:text-sm"
                : "text-[11px] leading-snug @[420px]:text-sm"
            }
          >
            {c.label}
          </span>
          {showDoubleReview && (
            <span className="mt-0.5 block text-[10px] font-normal normal-case text-amber-700">
              ⚠ Subtracts from 2.5, not 0–{c.max} — double-check this row.
            </span>
          )}
        </span>
      );
    }
    if (colKey === "score_range")
      return <span className="whitespace-nowrap text-[11px] text-neutral-400 @[420px]:text-sm">0–{c.max}</span>;
    // your_score
    if (readOnly) {
      return <span className="font-semibold text-neutral-800">{(values[i] ?? 0).toFixed(2)}</span>;
    }
    return (
      <input
        type="number"
        min={0}
        max={c.max}
        step={0.01}
        value={values[i]}
        onChange={(e) => onChange?.(i, e.target.value)}
        onFocus={() => t.selectCell(rk, "your_score")}
        onContextMenu={t.getContextMenuHandler(String(values[i] ?? 0))}
        className="w-full rounded-md border border-neutral-300 px-1 py-0.5 text-sm"
      />
    );
  }

  if (readOnly) {
    // Full View's 3-judges-side-by-side layout (dense) has no room for the
    // Deductions column at all, even collapsed to its 1-column summary —
    // dropped outright there rather than forced to scroll (dense is only
    // ever passed from FullViewButton, never from the wider ScoreDetailButton
    // view, which keeps its collapse/expand toggle as before).
    const canExpand = !dense && dedExpanded && canToggleDeductions;
    const visibleCols = dense
      ? [baseColumns[0], baseColumns[1], baseColumns[baseColumns.length - 2], baseColumns[baseColumns.length - 1]]
      : canExpand
        ? baseColumns
        : [baseColumns[0], baseColumns[1], { key: "ded_toggle", label: "Deductions", width: 90 }, baseColumns[baseColumns.length - 2], baseColumns[baseColumns.length - 1]];
    return (
      <>
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className={`w-full ${dense ? "table-fixed" : "min-w-[420px]"} text-left ${textSize}`}>
            {dense && (
              // table-fixed + explicit % widths so the table always fits its
              // Full View column (no forced min-width) instead of scrolling
              // — Criteria gets the most room and is the only cell that
              // wraps; the others (No./Score/Points) are short enough not to.
              <colgroup>
                <col style={{ width: "10%" }} />
                <col style={{ width: "48%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "26%" }} />
              </colgroup>
            )}
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                {visibleCols.map((c) =>
                  c.key === "ded_toggle" ? (
                    <th key={c.key} className={cellPad}>Deductions</th>
                  ) : (
                    <th key={c.key} className={cellPad}>{headerCell(c)}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rubric.map((c, i) => (
                <tr key={c.label} className={needsDoubleReview(c.max) && canToggleDeductions ? "bg-yellow-50" : ""}>
                  {visibleCols.map((col) =>
                    col.key === "ded_toggle" ? (
                      <td key={col.key} className={`${cellPad} text-center`}>
                        {(() => {
                          const sum = sumDeductions(deductions?.[i]);
                          return sum > 0 ? (
                            <span className="font-semibold text-red-700">-{sum.toFixed(2)}</span>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          );
                        })()}
                      </td>
                    ) : (
                      <td key={col.key} className={`${cellPad} ${col.key === "criteria" ? "whitespace-normal break-words" : ""}`}>
                        {cellContent(c, i, col.key)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
              <tr className="bg-neutral-50 font-semibold">
                <td colSpan={visibleCols.length - 2} className={`${totalPad} text-right`}>Total Score</td>
                <td className={`${totalPad} text-neutral-400`}>0–{TOTAL_MAX}</td>
                <td className={`${totalPad} ${disqualifying || overMax ? "text-red-700" : "text-neutral-900"}`}>
                  {total.toFixed(2)}
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

  return (
    <>
      {/* These instructions used to sit here as their own paragraph, directly
          above the rows a judge has to reach. They describe optional
          conveniences -- reordering, resizing, copy-down -- none of which is
          needed to score, so they moved onto the table as a tooltip and gave
          their height back to the rubric. */}
      <div
        // @container: everything below sizes itself against THIS box, not the
        // viewport. The sheet lives inside a draggable/snappable window, so a
        // viewport media query says nothing useful about how much room it
        // actually has -- a phone in portrait and a half-snapped desktop
        // window are the same problem and now get the same answer.
        className="@container overflow-x-auto rounded-md border border-neutral-200"
        title="Drag a column label or row No. to reorder, a column's right edge to resize. Select Your Score then drag its blue corner to copy that value down; right-click a value to copy it to the clipboard."
      >
        <table
          className={`text-left ${textSize}`}
          style={
            userResized
              ? { tableLayout: "fixed", width: orderedColumns.reduce((sum, c) => sum + widthOf(c.key, c.width), 0) }
              : { tableLayout: "fixed", width: "100%", minWidth: fixedTotal + CRITERIA_MIN }
          }
        >
          <colgroup>
            {orderedColumns.map((c) =>
              !userResized && c.key === "criteria" ? (
                // Deliberately width-less: the one column that absorbs
                // whatever the fixed ones leave over.
                <col key={c.key} />
              ) : (
                <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
              ),
            )}
          </colgroup>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
            <tr>
              {orderedColumns.map((c) => (
                <th key={c.key} data-col-order-key={c.key} className={`relative ${padFor(c.key)}`}>
                  <span
                    onPointerDown={t.getColHeaderDownHandler(c.key, () => {})}
                    className="block cursor-pointer select-none pr-1"
                    title="Drag to reorder"
                  >
                    {headerCell(c)}
                  </span>
                  <span
                    onPointerDown={(e) => handleResizeStart(e, c.key, c.width)}
                    title="Drag to resize"
                    className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {orderedRows.map((c) => {
              const i = rubric.indexOf(c);
              const rk = rowKey(c);
              return (
                <tr key={rk} data-row-order-key={rk} className={needsDoubleReview(c.max) ? "bg-yellow-50" : ""}>
                  {orderedColumns.map((col, colIdx) => {
                    const isHandle = colIdx === 0;
                    const isTextCell = col.key === "criteria" || col.key === "score_range";
                    const cellKey = `${rk}:${col.key}`;
                    const isCellSelected = isTextCell && t.isCellSelected(rk, col.key);
                    const isFillPreview = isTextCell && t.isFillPreview(rk, col.key);
                    const isScoreSelected = col.key === "your_score" && t.isCellSelected(rk, "your_score");
                    return (
                      <td
                        key={col.key}
                        data-cell-row={rk}
                        data-cell-col={col.key}
                        onPointerDown={isHandle ? t.getRowHandleDownHandler(rk, () => {}) : undefined}
                        onClick={isTextCell ? () => t.selectCell(rk, col.key) : undefined}
                        onContextMenu={
                          isTextCell
                            ? t.getContextMenuHandler(col.key === "criteria" ? c.label : `0–${c.max}`)
                            : undefined
                        }
                        className={`relative ${padFor(col.key)} ${isHandle ? "cursor-pointer select-none" : ""} ${
                          col.key === "criteria" ? "whitespace-normal break-words" : ""
                        } ${isCellSelected || isScoreSelected ? "ring-2 ring-inset ring-blue-500" : ""} ${
                          isFillPreview ? "outline outline-2 -outline-offset-2 outline-blue-300" : ""
                        }`}
                      >
                        {cellContent(c, i, col.key)}
                        {isCellSelected && (
                          <span
                            onPointerDown={t.getFillHandleDownHandler(rk, col.key, col.key === "criteria" ? c.label : `0–${c.max}`)}
                            title="Drag to copy this value into other cells"
                            className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-crosshair rounded-sm border border-white bg-blue-600"
                          />
                        )}
                        {isScoreSelected && (
                          <span
                            onPointerDown={t.getFillHandleDownHandler(rk, "your_score", String(values[i] ?? 0))}
                            title="Drag to copy this score into other rows"
                            className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-crosshair rounded-sm border border-white bg-blue-600"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="bg-neutral-50 font-semibold">
              <td colSpan={orderedColumns.length - 2} className={`${totalPad} text-right`}>Total Score</td>
              <td className={`${totalPad} whitespace-nowrap text-neutral-400`}>0–{TOTAL_MAX}</td>
              <td className={`${totalPad} ${disqualifying || overMax ? "text-red-700" : "text-neutral-900"}`}>
                {total.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <TableInteractionOverlays t={t} />
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
}: {
  item: ScoringItem;
  onExit: () => void;
}) {
  const [sheet, setSheet] = useState<1 | 2 | null>(null);
  const [scoreOpen, setScoreOpen] = useState(true);
  const [saved, setSaved] = useState(item.existingScore != null);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();
  const [sheet1Values, setSheet1Values] = useState<number[]>(() => splitSheet1(item.existingScore));
  const [sheet2Values, setSheet2Values] = useState<number[]>(() => splitCapped(item.existingScore));
  // "Reduce Score System" deduction checkboxes — always start unticked,
  // same as sheet1Values/sheet2Values starting from an even-split estimate
  // rather than restoring a previous session's exact per-row entries.
  const [sheet1Deductions, setSheet1Deductions] = useState<boolean[][]>(() => emptyDeductions(SHEET1_CRITERIA));
  const [sheet2Deductions, setSheet2Deductions] = useState<boolean[][]>(() => emptyDeductions(SHEET2_CRITERIA));
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
    // round2: every other path into this array (splitSheet1, splitCapped,
    // scoreAfterDeductions) already keeps 2dp. A hand-typed value -- or the
    // number spinner stepping off a non-aligned figure -- was the one way a
    // 0.988 could reach the column, and the column then had to be wide
    // enough to show it. Clamped here so "0.00" is the widest it can be.
    const n = round2(Math.max(0, Math.min(SHEET1_CRITERIA[i].max, Number(raw) || 0)));
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
    const n = round2(Math.max(0, Math.min(SHEET2_CRITERIA[i].max, Number(raw) || 0)));
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

  /** Toggling a deduction box recomputes that row's score from its base
   * (1, or 2.5 for Sheet 1's uniform rows / Sheet 2's rows 1–5; 2.5 for
   * Sheet 2's rows 6–7) minus every ticked box on that row — same
   * resync-the-Total behavior as hand-adjusting a row directly. */
  function toggleSheet1Deduction(row: number, col: number) {
    const nextDeductions = sheet1Deductions.map((r, i) => (i === row ? r.map((v, j) => (j === col ? !v : v)) : r));
    setSheet1Deductions(nextDeductions);
    const newRowScore = scoreAfterDeductions(SHEET1_CRITERIA[row].max, nextDeductions[row]);
    const nextValues = sheet1Values.map((x, idx) => (idx === row ? newRowScore : x));
    setSheet1Values(nextValues);
    setSheet1QuickTotal(String(Math.round(nextValues.reduce((a, b) => a + b, 0) * 10) / 10));
    setSaved(false);
  }

  function toggleSheet2Deduction(row: number, col: number) {
    const nextDeductions = sheet2Deductions.map((r, i) => (i === row ? r.map((v, j) => (j === col ? !v : v)) : r));
    setSheet2Deductions(nextDeductions);
    const newRowScore = scoreAfterDeductions(SHEET2_CRITERIA[row].max, nextDeductions[row]);
    const nextValues = sheet2Values.map((x, idx) => (idx === row ? newRowScore : x));
    setSheet2Values(nextValues);
    setQuickTotal(String(Math.round(nextValues.reduce((a, b) => a + b, 0) * 10) / 10));
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
        const result = await submitScore(formData);
        setPending(false);
        if (!result?.ok) {
          // Stay open with everything the judge entered still on screen --
          // closing here would throw a whole score sheet away on a failure
          // they never saw.
          setSaveError(result?.error ?? "The score could not be saved — please try again.");
          return;
        }
        setSaveError(null);
        setSaved(true);
        // Show the tick briefly, then close BOTH windows (this sheet and the
        // recording beside it) and refresh whatever page is underneath --
        // Judging, Score Recordings or Kata Arena -- so the row shows the new
        // total instead of the state it had before scoring.
        setTimeout(() => {
          router.refresh();
          onExit();
        }, 700);
      }}
      onKeyDown={(e) => {
        // Submitting is final, so never let a stray Enter in a score box
        // submit the sheet — only the Submit button may.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
      className="p-2"
    >
      <input type="hidden" name="video_id" value={item.videoId} />
      <input type="hidden" name="score" value={submittedScore} />
      {submittedScore === 0 && <input type="hidden" name="reason" value={finalReason} />}
      {submittedCriteria.map((v, i) => (
        <input key={i} type="hidden" name="criteria" value={v} />
      ))}
      <input
        type="hidden"
        name="deductions"
        value={JSON.stringify(sheet === 1 ? sheet1Deductions : sheet2Deductions)}
      />
      {sheet === 1 ? (
        <>
          <div className="mb-2 rounded-md border-2 border-red-200 bg-red-50 p-2">
            {/* Label beside the box, not above it -- stacked they cost two
                rows of height before a single criterion is visible. */}
            <div className="flex items-center gap-2">
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
                className="w-24 shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-lg font-bold"
              />
              <label htmlFor={`quick1_${item.videoId}`} className="text-sm font-bold leading-tight text-neutral-800">
                Just input one Total Score (0–{TOTAL_MAX}) — the rows below self-populate
              </label>
            </div>
            <p className="mt-1 text-[11px] leading-tight text-neutral-600">
              Self-population fills items 1–10 up to their 0–1 maximum, at 2 decimal points; the
              Total Score keeps to 1 decimal point. <strong>Not happy with the self-population?
              Adjust any row below yourself</strong> — the Total resyncs to your adjusted rows.
            </p>
            {sheet1Total === 0 && sheet1QuickTotal !== "" && disqualificationReasonBox}
          </div>
          <RubricTable
            rubric={SHEET1_CRITERIA}
            values={sheet1Values}
            onChange={setSheet1Criterion}
            deductions={sheet1Deductions}
            onDeductionToggle={toggleSheet1Deduction}
          />
        </>
      ) : (
        <>
          <div className="mb-2 rounded-md border-2 border-red-200 bg-red-50 p-2">
            <div className="flex items-center gap-2">
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
                className="w-24 shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-lg font-bold"
              />
              <label htmlFor={`quick_${item.videoId}`} className="text-sm font-bold leading-tight text-neutral-800">
                Just input one Total Score (0–{TOTAL_MAX}) — the rows below self-populate
              </label>
            </div>
            <p className="mt-1 text-[11px] leading-tight text-neutral-600">
              Self-population fills items 1–5 up to their 0–1 maximum and splits the rest equally
              between items 6 and 7. <strong>Not happy with the self-population? Adjust any row
              below yourself</strong> — the Total resyncs to your adjusted rows.
            </p>
            {sheet2Total === 0 && quickTotal !== "" && disqualificationReasonBox}
          </div>
          <RubricTable
            values={sheet2Values}
            onChange={setSheet2Criterion}
            deductions={sheet2Deductions}
            onDeductionToggle={toggleSheet2Deduction}
          />
        </>
      )}
      <p className="mt-1.5 text-[11px] leading-tight text-neutral-400">
        Submitting is final — scores cannot be appealed or changed once judging closes.
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || submitBlocked}
          className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : saved ? "Update score" : "Submit score"}
        </button>
        {saved && !saveError && (
          <span className="text-xs font-semibold text-green-700">✔ Score saved — closing…</span>
        )}
      </div>
      {saveError && (
        <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
          {saveError}
        </p>
      )}
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
          {/* Every line here is leading-tight and the padding is halved: this
              header sits above the rubric and each row it costs is a rubric
              row pushed below the fold. The standing hint is one line now
              instead of three -- it explains controls that are visible on
              screen anyway. */}
          <div className="border-b border-neutral-100 px-3 pb-1 pt-1.5">
            <p className="font-bold leading-tight text-neutral-900">{item.participantName}</p>
            <p className="text-xs leading-tight text-neutral-500">
              {item.participantCountry ?? "—"} · <CategoryName name={item.categoryName} />
            </p>
            {/* The line that used to explain ✕ and the Sheet 1 / Sheet 2
                buttons is gone: all three are labelled and on screen, and the
                row it cost is a rubric row the judge would otherwise have to
                scroll to. */}
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
  label = "Watch recording",
}: {
  item: ScoringItem;
  canScore: boolean;
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
          <ScoreSession item={item} onExit={() => setOpen(false)} />
        ) : (
          <FloatingWindow title={`Watch Recording — ${item.participantName}`} onClose={() => setOpen(false)} initial="max">
            <div className="flex h-full flex-col bg-black">
              <LockedVideo src={item.playbackUrl} autoPlay />
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
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-neutral-900">{item.participantName}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
        >
          {item.existingScore != null ? "Update score" : "Score this recording"}
        </button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {item.participantCountry ?? "—"} · <CategoryName name={item.categoryName} />
      </p>
      {item.competitionName && <p className="text-xs text-neutral-500">{item.competitionName}</p>}
      {item.existingScore != null && (
        <div className="mt-2 flex justify-end">
          <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
            Total {item.existingScore.toFixed(2)}
          </span>
        </div>
      )}
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
  renderOption,
  widthClass = "w-44",
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  /** Shown in the dropdown in place of the raw value. The value itself is
   * still what gets filtered on, so this only changes what a judge reads --
   * used by Competition Tier, whose stored name is the full
   * "Malaysia Open Virtual Karate-do Kata Competition 2026 - USD 10 Tier"
   * and wrapped to three lines in the iPhone picker. */
  renderOption?: (o: string) => string;
  widthClass?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs font-semibold text-neutral-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`truncate rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm font-normal text-neutral-800 ${widthClass}`}
      >
        <option value={ALL}>{ALL}</option>
        {options.map((o) => (
          <option key={o} value={o}>{renderOption ? renderOption(o) : o}</option>
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
      // Canonical 1-24 order, matching the Kata Categories page, rather than
      // alphabetical -- see sortKataNames().
      katas: sortKataNames([...katas]),
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
        Signed in as Judge <strong>{refereeName}</strong>
        {refereeCountry ? ` (${refereeCountry})` : ""}. Only the recordings assigned to you by the
        organizer are listed (and filterable) below — to browse the whole competition, use the
        Kata Arena instead. Your score is final once submitted — no appeal is available. Click
        &quot;Score this recording&quot; to choose Score Sheet 1 or 2 — works the same on laptop,
        desktop, tablet, or phone (rotate to landscape for the side-by-side view).
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3">
          <FilterSelect
            label="Competition Tier"
            value={tier}
            options={opts.tiers}
            onChange={setTier}
            renderOption={shortTierName}
            widthClass="w-36"
          />
          <FilterSelect label="Kata" value={kata} options={opts.katas} onChange={setKata} widthClass="w-52" />
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
