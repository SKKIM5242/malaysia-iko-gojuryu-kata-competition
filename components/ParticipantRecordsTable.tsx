"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { CategoryName, formatDate } from "@/components/ui";
import VideoWatchButton from "@/components/VideoWatchButton";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import AdminVideoUploadForm from "@/components/AdminVideoUploadForm";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls } from "@/lib/useGridControls";
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

const MIN_COL_WIDTH = 60;

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
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();

  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);

  const handleMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(MIN_COL_WIDTH, r.startWidth + (e.clientX - r.startX));
    setColWidths((prev) => ({ ...prev, [r.key]: next }));
  }, []);

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

  const visibleColumns = useMemo(() => COLUMNS.filter((c) => !grid.hiddenCols.has(c.key)), [grid.hiddenCols]);
  const visibleExtraColumns = useMemo(() => EXTRA_COLUMNS.filter((c) => !grid.hiddenCols.has(c.key)), [grid.hiddenCols]);

  const renderHeaderCell = (key: string, label: string, width: number, sticky: boolean) => {
    const selected = grid.selectedCols.has(key);
    return (
      <th
        key={key}
        className={`relative select-none px-3 py-2.5 whitespace-nowrap ${
          sticky ? "sticky left-0 z-10 border-r border-neutral-200" : ""
        } ${selected ? "bg-amber-100" : sticky ? "bg-neutral-50" : ""}`}
      >
        <span
          onClick={() => grid.toggleColSelect(key)}
          title="Click to select/highlight this column"
          className="block cursor-pointer overflow-hidden text-ellipsis pr-4"
        >
          {label}
        </span>
        {selected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              grid.hideCol(key);
            }}
            title="Hide this column"
            className="absolute right-2.5 top-1/2 z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white hover:bg-red-700"
          >
            ×
          </button>
        )}
        <span
          onMouseDown={(e) => handleResizeStart(e, key, width)}
          title="Drag to resize this column"
          className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
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

  const displayedRows = useMemo(
    () => filtered.filter((row) => !grid.hiddenRows.has(row.registrationId)),
    [filtered, grid.hiddenRows],
  );

  const csvRows = useMemo(
    () =>
      filtered.map((row) => {
        const out: Record<string, string> = {};
        for (const c of COLUMNS) out[c.label] = String(row[c.key] ?? "");
        return out;
      }),
    [filtered],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Showing {filtered.length} of {rows.length} successful registrations. Type in any column&apos;s filter
          box to narrow the list — filters combine (AND). Drag a column&apos;s right edge to resize it, or
          click a header/row to select and hide it.
        </p>
        <DownloadCsvButton rows={csvRows} filename="participants" />
      </div>
      {(grid.hiddenCols.size > 0 || grid.hiddenRows.size > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          {grid.hiddenCols.size > 0 && (
            <span>
              {grid.hiddenCols.size} column{grid.hiddenCols.size === 1 ? "" : "s"} hidden —{" "}
              <button type="button" onClick={grid.showAllCols} className="font-semibold underline underline-offset-2">
                show all
              </button>
            </span>
          )}
          {grid.hiddenRows.size > 0 && (
            <span>
              {grid.hiddenRows.size} row{grid.hiddenRows.size === 1 ? "" : "s"} hidden —{" "}
              <button type="button" onClick={grid.showAllRows} className="font-semibold underline underline-offset-2">
                show all
              </button>
            </span>
          )}
        </div>
      )}
      <DualScrollBox>
        <table
          className="text-left text-sm"
          style={{
            tableLayout: "fixed",
            width:
              visibleColumns.reduce((sum, c) => sum + widthOf(c.key, c.width), 0) +
              visibleExtraColumns.reduce((sum, c) => sum + widthOf(c.key, c.width), 0),
          }}
        >
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
            {visibleExtraColumns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {visibleColumns.map((c, i) => renderHeaderCell(c.key, c.label, c.width, i === 0))}
              {visibleExtraColumns.map((c) => renderHeaderCell(c.key, c.label, c.width, false))}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {visibleColumns.map((c, i) => (
                <th
                  key={c.key}
                  className={`px-2 py-1.5 ${i === 0 ? "sticky left-0 z-10 border-r border-neutral-200 bg-white" : ""}`}
                >
                  <ColumnFilterDropdown
                    values={uniqueValues[c.key] ?? []}
                    selected={filters[c.key] ?? new Set()}
                    onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                  />
                </th>
              ))}
              {visibleExtraColumns.map((c) => (
                <th key={c.key} className="px-2 py-1.5" />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + visibleExtraColumns.length} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              displayedRows.map((row) => {
                const rowSelected = grid.selectedRows.has(row.registrationId);
                const rowHeight = grid.rowHeights[row.registrationId];
                return (
                  <tr
                    key={row.registrationId}
                    className={`group hover:bg-neutral-50 ${rowSelected ? "bg-amber-50" : ""} ${grid.rowSizeClass(row.registrationId)}`}
                    style={grid.rowSizeStyle(row.registrationId)}
                  >
                    {visibleColumns.map((c, i) => {
                      const { className, title, content } = standardCell(c, row);
                      const isHandle = i === 0;
                      const handleBg = rowSelected ? "bg-amber-50" : "bg-white group-hover:bg-neutral-50";
                      return (
                        <td
                          key={c.key}
                          className={`truncate px-3 py-2 ${className} ${
                            isHandle ? `relative sticky left-0 z-10 cursor-pointer select-none border-r border-neutral-200 ${handleBg}` : ""
                          }`}
                          title={isHandle ? "Click to select/highlight this row" : title}
                          onClick={isHandle ? () => grid.toggleRowSelect(row.registrationId) : undefined}
                        >
                          {content}
                          {isHandle && rowSelected && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                grid.hideRow(row.registrationId);
                              }}
                              title="Hide this row"
                              className="absolute right-1 top-1/2 z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white hover:bg-red-700"
                            >
                              ×
                            </button>
                          )}
                          {isHandle && (
                            <span
                              onMouseDown={(e) => grid.handleRowResizeStart(e, row.registrationId, rowHeight ?? 36)}
                              title="Drag to resize this row"
                              className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                            />
                          )}
                        </td>
                      );
                    })}
                    {visibleExtraColumns.map((c) => (
                      <td key={c.key} className="px-3 py-2">
                        {extraCell(c.key, row, isAdmin, canManageSlot)}
                      </td>
                    ))}
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
