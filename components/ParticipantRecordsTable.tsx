"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { CategoryName, formatDate } from "@/components/ui";
import VideoWatchButton from "@/components/VideoWatchButton";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import AdminVideoUploadForm from "@/components/AdminVideoUploadForm";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls, isClosed, CLOSED_SIZE } from "@/lib/useGridControls";
import { updateRegistrationSlotStatus } from "@/app/actions/admin";

export type SlotStatus = "active" | "unslotted" | "forfeited" | "given_up";

export interface ParticipantRecordRow {
  registrationId: string;
  competition: string;
  category: string;
  fullName: string;
  icPassport: string;
  dateOfBirth: string;
  gender: string;
  beltRank: string;
  rankConfirmation: string;
  certificateUrl: string | null;
  homeAddress: string;
  country: string;
  cityTown: string;
  postcode: string;
  email: string;
  phone: string;
  school: string;
  sensei: string;
  invitationCode: string;
  referralSource: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  recordingStatus: "Submitted" | "Not submitted";
  recordingDate: string;
  attempts: string;
  videoUrl: string | null;
  slotStatus: SlotStatus;
  slotStatusNote: string | null;
  slotStatusChangedBy: string | null;
  slotStatusChangedAt: string | null;
}

const SLOT_STATUS_BADGE: Record<SlotStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-neutral-200 bg-neutral-50 text-neutral-500" },
  unslotted: { label: "Unslotted (by organiser)", cls: "border-orange-300 bg-orange-50 text-orange-800" },
  forfeited: { label: "Forfeited (by organiser)", cls: "border-red-300 bg-red-50 text-red-800" },
  given_up: { label: "Given up (by participant)", cls: "border-neutral-400 bg-neutral-100 text-neutral-700" },
};

function SlotStatusCell({ row, canManage }: { row: ParticipantRecordRow; canManage: boolean }) {
  const badge = SLOT_STATUS_BADGE[row.slotStatus];
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
      {row.slotStatusChangedBy && (
        <span className="text-[10px] text-neutral-400">
          by {row.slotStatusChangedBy}
          {row.slotStatusChangedAt ? ` · ${formatDate(row.slotStatusChangedAt)}` : ""}
        </span>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-1">
          {row.slotStatus !== "unslotted" && (
            <form action={updateRegistrationSlotStatus}>
              <input type="hidden" name="registration_id" value={row.registrationId} />
              <input type="hidden" name="slot_status" value="unslotted" />
              <input type="hidden" name="return_to" value="/admin/records" />
              <button type="submit" className="rounded border border-orange-300 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 hover:bg-orange-50">
                Unslot
              </button>
            </form>
          )}
          {row.slotStatus !== "forfeited" && (
            <form action={updateRegistrationSlotStatus}>
              <input type="hidden" name="registration_id" value={row.registrationId} />
              <input type="hidden" name="slot_status" value="forfeited" />
              <input type="hidden" name="return_to" value="/admin/records" />
              <button type="submit" className="rounded border border-red-300 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50">
                Forfeited
              </button>
            </form>
          )}
          {row.slotStatus !== "given_up" && (
            <form action={updateRegistrationSlotStatus}>
              <input type="hidden" name="registration_id" value={row.registrationId} />
              <input type="hidden" name="slot_status" value="given_up" />
              <input type="hidden" name="return_to" value="/admin/records" />
              <button type="submit" className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50">
                Give Up
              </button>
            </form>
          )}
          {row.slotStatus !== "active" && (
            <form action={updateRegistrationSlotStatus}>
              <input type="hidden" name="registration_id" value={row.registrationId} />
              <input type="hidden" name="slot_status" value="active" />
              <input type="hidden" name="return_to" value="/admin/records" />
              <button type="submit" className="rounded border border-green-300 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 hover:bg-green-50">
                Reset
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const COLUMNS: Array<{ key: keyof ParticipantRecordRow; label: string; width: number }> = [
  { key: "fullName", label: "Full Name", width: 200 },
  { key: "registrationId", label: "Reference ID", width: 110 },
  { key: "competition", label: "Tier", width: 170 },
  { key: "category", label: "Category", width: 240 },
  { key: "icPassport", label: "IC / Passport", width: 130 },
  { key: "dateOfBirth", label: "DOB", width: 100 },
  { key: "gender", label: "Gender", width: 90 },
  { key: "beltRank", label: "Belt", width: 130 },
  { key: "rankConfirmation", label: "Rank Confirmation", width: 150 },
  { key: "homeAddress", label: "Home Address", width: 220 },
  { key: "country", label: "Country", width: 110 },
  { key: "cityTown", label: "City/Town", width: 120 },
  { key: "postcode", label: "Postcode", width: 100 },
  { key: "email", label: "Email", width: 180 },
  { key: "phone", label: "Phone", width: 130 },
  { key: "school", label: "School", width: 160 },
  { key: "sensei", label: "Sensei", width: 160 },
  { key: "invitationCode", label: "Invitation Code", width: 140 },
  { key: "referralSource", label: "Referral", width: 160 },
  { key: "bankName", label: "Bank Name", width: 140 },
  { key: "bankAccountNo", label: "Bank Account No", width: 150 },
  { key: "bankAccountName", label: "Bank Account Holder Name", width: 200 },
  { key: "recordingStatus", label: "Recording Status", width: 130 },
  { key: "recordingDate", label: "Recording Date", width: 130 },
  { key: "attempts", label: "Re-record Attempts", width: 90 },
];

/** The 3 trailing columns rendered outside `ParticipantRecordRow` (rich
 * JSX, not a single field) — same resize treatment as every other column. */
const EXTRA_COLUMNS: Array<{ key: string; label: string; width: number }> = [
  { key: "certificate", label: "Certificate", width: 100 },
  { key: "recording", label: "Recording", width: 170 },
  { key: "slotStatus", label: "Slot Status", width: 240 },
];


function standardCell(
  c: (typeof COLUMNS)[number],
  row: ParticipantRecordRow,
): { className: string; title?: string; content: ReactNode } {
  switch (c.key) {
    case "fullName":
      return { className: "font-medium", title: row.fullName, content: row.fullName };
    case "registrationId":
      return { className: "font-mono text-xs", title: row.registrationId, content: row.registrationId.slice(0, 8).toUpperCase() };
    case "competition":
      return { className: "", title: row.competition, content: row.competition };
    case "category":
      return { className: "", title: row.category, content: <CategoryName name={row.category} /> };
    case "icPassport":
      return { className: "font-mono text-xs", title: row.icPassport, content: row.icPassport };
    case "dateOfBirth":
      return { className: "", title: row.dateOfBirth, content: row.dateOfBirth };
    case "gender":
      return { className: "capitalize", title: row.gender, content: row.gender };
    case "beltRank":
      return { className: "", title: row.beltRank, content: row.beltRank || "—" };
    case "rankConfirmation":
      return { className: "text-xs", title: row.rankConfirmation, content: row.rankConfirmation || "—" };
    case "homeAddress":
      return { className: "", title: row.homeAddress, content: row.homeAddress || "—" };
    case "country":
      return { className: "", title: row.country, content: row.country || "—" };
    case "cityTown":
      return { className: "", title: row.cityTown, content: row.cityTown || "—" };
    case "postcode":
      return { className: "", title: row.postcode, content: row.postcode || "—" };
    case "email":
      return { className: "text-xs", title: row.email, content: row.email || "—" };
    case "phone":
      return { className: "text-xs", title: row.phone, content: row.phone || "—" };
    case "school":
      return { className: "", title: row.school, content: row.school || "—" };
    case "sensei":
      return { className: "", title: row.sensei, content: row.sensei || "—" };
    case "invitationCode":
      return { className: "text-xs", title: row.invitationCode, content: row.invitationCode || "—" };
    case "referralSource":
      return { className: "text-xs", title: row.referralSource, content: row.referralSource || "—" };
    case "bankName":
      return { className: "text-xs", title: row.bankName, content: row.bankName || "—" };
    case "bankAccountNo":
      return { className: "text-xs", title: row.bankAccountNo, content: row.bankAccountNo || "—" };
    case "bankAccountName":
      return { className: "text-xs", title: row.bankAccountName, content: row.bankAccountName || "—" };
    case "recordingStatus":
      return {
        className: "",
        content: (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
              row.recordingStatus === "Submitted"
                ? "border-green-300 bg-green-50 text-green-800"
                : "border-amber-300 bg-amber-50 text-amber-800"
            }`}
          >
            {row.recordingStatus}
          </span>
        ),
      };
    case "recordingDate":
      return { className: "text-xs", title: row.recordingDate, content: row.recordingDate || "—" };
    case "attempts":
      return { className: "text-xs", title: row.attempts, content: row.attempts };
    default:
      return { className: "", content: null };
  }
}

function extraCell(key: string, row: ParticipantRecordRow, isAdmin: boolean, canManageSlot: boolean): ReactNode {
  switch (key) {
    case "certificate":
      return row.certificateUrl ? (
        <a
          href={row.certificateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          View
        </a>
      ) : (
        <span className="text-xs text-neutral-400">—</span>
      );
    case "recording":
      return (
        <div className="flex flex-col items-start gap-1.5">
          {row.videoUrl ? <VideoWatchButton url={row.videoUrl} /> : !isAdmin && <span className="text-xs text-neutral-400">—</span>}
          {isAdmin && <AdminVideoUploadForm registrationId={row.registrationId} />}
        </div>
      );
    case "slotStatus":
      return <SlotStatusCell row={row} canManage={canManageSlot} />;
  }
  return null;
}

export default function ParticipantRecordsTable({
  rows,
  isAdmin = false,
  canManageSlot = false,
}: {
  rows: ParticipantRecordRow[];
  isAdmin?: boolean;
  canManageSlot?: boolean;
}) {
  const [filters, setFilters] = useState<Partial<Record<keyof ParticipantRecordRow, Set<string>>>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);

  const toggleColSelect = useCallback((key: string) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(CLOSED_SIZE, r.startWidth + (e.clientX - r.startX));
    setColWidths((prev) => {
      const updated = { ...prev, [r.key]: next };
      if (next <= CLOSED_SIZE + 1 && selectedCols.has(r.key) && selectedCols.size > 1) {
        for (const key of selectedCols) {
          if (key !== r.key) updated[key] = CLOSED_SIZE;
        }
      }
      return updated;
    });
  }, [selectedCols]);

  const handleUp = useCallback(() => {
    resizingRef.current = null;
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", handleUp);
  }, [handleMove]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, key: string, fallback: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key, startX: e.clientX, startWidth: widthOf(key, fallback) };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [widthOf, handleMove, handleUp],
  );

  const resetClosedCols = useCallback(() => {
    setColWidths((prev) => {
      const next: Record<string, number> = {};
      for (const [key, w] of Object.entries(prev)) {
        if (!isClosed(w, w)) next[key] = w;
      }
      return next;
    });
  }, []);

  const renderHeaderCell = (key: string, label: string, width: number, sticky: boolean) => {
    const closed = isClosed(width, width);
    const selected = selectedCols.has(key);
    return (
      <th
        key={key}
        className={`relative select-none whitespace-nowrap ${sticky ? `sticky left-0 z-10 border-r border-neutral-200` : ""} ${
          closed ? "bg-red-600 p-0" : `px-3 py-2.5 ${selected ? "bg-sky-100" : sticky ? "bg-neutral-50" : ""}`
        }`}
      >
        {!closed && (
          <span
            onClick={() => toggleColSelect(key)}
            title="Click to select/highlight this column"
            className="block cursor-pointer overflow-hidden text-ellipsis pr-2"
          >
            {label}
          </span>
        )}
        <span
          onMouseDown={(e) => handleResizeStart(e, key, width)}
          title={closed ? "Drag to reopen this column" : "Drag to resize (or close) this column"}
          className={`absolute right-0 top-0 z-10 h-full cursor-col-resize touch-none select-none ${
            closed ? "w-full bg-red-600 hover:bg-red-700" : "w-2 hover:bg-red-300 active:bg-red-500"
          }`}
        />
      </th>
    );
  };

  const uniqueValues = useMemo(() => {
    const map: Partial<Record<keyof ParticipantRecordRow, string[]>> = {};
    for (const c of COLUMNS) {
      const seen = new Set<string>();
      const values: string[] = [];
      for (const row of rows) {
        const text = String(row[c.key] ?? "");
        if (!seen.has(text)) {
          seen.add(text);
          values.push(text);
        }
      }
      map[c.key] = values;
    }
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v && v.size > 0);
    if (active.length === 0) return rows;
    return rows.filter((row) =>
      active.every(([key, values]) =>
        (values as Set<string>).has(String(row[key as keyof ParticipantRecordRow] ?? "")),
      ),
    );
  }, [rows, filters]);

  const csvRows = useMemo(
    () =>
      filtered.map((row) => {
        const out: Record<string, string> = {};
        for (const c of COLUMNS) out[c.label] = String(row[c.key] ?? "");
        return out;
      }),
    [filtered],
  );

  const closedColCount = useMemo(
    () =>
      [...COLUMNS, ...EXTRA_COLUMNS].filter((c) => isClosed(widthOf(c.key, c.width), widthOf(c.key, c.width))).length,
    [widthOf],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Showing {filtered.length} of {rows.length} successful registrations. Type in any column&apos;s filter
          box to narrow the list — filters combine (AND). Click a column&apos;s label (or a row&apos;s leading
          cell) to select/highlight it. Drag a column&apos;s right edge (or a row&apos;s bottom edge) to resize
          it, all the way to close it down to a red bar.
        </p>
        <DownloadCsvButton rows={csvRows} filename="participants" />
      </div>
      {(closedColCount > 0 || grid.closedRowCount > 0) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          <span>
            {closedColCount > 0 && `${closedColCount} column${closedColCount === 1 ? "" : "s"} closed`}
            {closedColCount > 0 && grid.closedRowCount > 0 && " · "}
            {grid.closedRowCount > 0 && `${grid.closedRowCount} row${grid.closedRowCount === 1 ? "" : "s"} closed`}
          </span>
          <button
            type="button"
            onClick={() => {
              resetClosedCols();
              grid.resetClosedRows();
            }}
            title="Reopen every closed column and row"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white hover:bg-red-700"
          >
            ×
          </button>
        </div>
      )}
      <DualScrollBox>
        <table
          className="text-left text-sm"
          style={{
            tableLayout: "fixed",
            width:
              COLUMNS.reduce((sum, c) => sum + widthOf(c.key, c.width), 0) +
              EXTRA_COLUMNS.reduce((sum, c) => sum + widthOf(c.key, c.width), 0),
          }}
        >
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
            {EXTRA_COLUMNS.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {COLUMNS.map((c, i) => renderHeaderCell(c.key, c.label, widthOf(c.key, c.width), i === 0))}
              {EXTRA_COLUMNS.map((c) => renderHeaderCell(c.key, c.label, widthOf(c.key, c.width), false))}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {COLUMNS.map((c, i) => {
                const closed = isClosed(widthOf(c.key, c.width), widthOf(c.key, c.width));
                const selected = selectedCols.has(c.key);
                const bg = closed ? "bg-red-600" : selected ? "bg-sky-50" : "bg-white";
                return (
                  <th
                    key={c.key}
                    className={`${closed ? "p-0" : "px-2 py-1.5"} ${bg} ${
                      i === 0 ? "sticky left-0 z-10 border-r border-neutral-200" : ""
                    }`}
                  >
                    {!closed && (
                      <ColumnFilterDropdown
                        values={uniqueValues[c.key] ?? []}
                        selected={filters[c.key] ?? new Set()}
                        onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                      />
                    )}
                  </th>
                );
              })}
              {EXTRA_COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-1.5" />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + EXTRA_COLUMNS.length} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const rowHeight = grid.rowHeights[row.registrationId];
                const rowClosed = rowHeight != null && rowHeight <= CLOSED_SIZE + 1;
                const rowSelected = grid.selectedRows.has(row.registrationId);
                return (
                  <tr
                    key={row.registrationId}
                    className={`group hover:bg-neutral-50 ${!rowClosed && rowSelected ? "bg-sky-50" : ""} ${grid.rowSizeClass(row.registrationId)}`}
                    style={grid.rowSizeStyle(row.registrationId)}
                  >
                    {COLUMNS.map((c, i) => {
                      const width = widthOf(c.key, c.width);
                      const colClosed = isClosed(width, width);
                      const colSelected = selectedCols.has(c.key);
                      const closed = colClosed || rowClosed;
                      const { className, title, content } = standardCell(c, row);
                      const isHandle = i === 0;
                      const highlighted = colSelected || rowSelected;
                      const cellBg = colClosed
                        ? "bg-red-600"
                        : highlighted
                          ? "bg-sky-50"
                          : isHandle
                            ? "bg-white group-hover:bg-neutral-50"
                            : "";
                      return (
                        <td
                          key={c.key}
                          className={`${closed ? "p-0" : `truncate px-3 py-2 ${className}`} ${
                            isHandle ? `relative sticky left-0 z-10 border-r border-neutral-200 ${!closed ? "cursor-pointer select-none" : ""}` : ""
                          } ${cellBg}`}
                          title={isHandle && !closed ? "Click to select/highlight this row" : !closed ? title : undefined}
                          onClick={isHandle && !closed ? () => grid.toggleRowSelect(row.registrationId) : undefined}
                        >
                          {!closed && content}
                          {isHandle && (
                            <span
                              onMouseDown={(e) => grid.handleRowResizeStart(e, row.registrationId, rowHeight ?? 36)}
                              onClick={(e) => e.stopPropagation()}
                              title={rowClosed ? "Drag to reopen this row" : "Drag to resize (or close) this row"}
                              className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                            />
                          )}
                        </td>
                      );
                    })}
                    {EXTRA_COLUMNS.map((c) => {
                      const width = widthOf(c.key, c.width);
                      const colClosed = isClosed(width, width);
                      const closed = colClosed || rowClosed;
                      return (
                        <td key={c.key} className={closed ? `p-0 ${colClosed ? "bg-red-600" : ""}` : "px-3 py-2"}>
                          {!closed && extraCell(c.key, row, isAdmin, canManageSlot)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </DualScrollBox>
    </div>
  );
}
