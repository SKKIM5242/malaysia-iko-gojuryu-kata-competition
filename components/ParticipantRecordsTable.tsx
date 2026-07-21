"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CategoryName, formatDate } from "@/components/ui";
import VideoWatchButton from "@/components/VideoWatchButton";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import AdminVideoUploadForm from "@/components/AdminVideoUploadForm";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
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
  email: string;
  phone: string;
  school: string;
  sensei: string;
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
  { key: "email", label: "Email", width: 180 },
  { key: "phone", label: "Phone", width: 130 },
  { key: "school", label: "School", width: 160 },
  { key: "sensei", label: "Sensei", width: 160 },
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

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Showing {filtered.length} of {rows.length} successful registrations. Type in any column&apos;s filter
          box to narrow the list — filters combine (AND). Drag a column&apos;s right edge to resize it.
        </p>
        <DownloadCsvButton rows={csvRows} filename="participants" />
      </div>
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
              {COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  className={`relative select-none px-3 py-2.5 whitespace-nowrap ${
                    i === 0 ? "sticky left-0 z-10 border-r border-neutral-200 bg-neutral-50" : ""
                  }`}
                >
                  <span className="block overflow-hidden text-ellipsis pr-2">{c.label}</span>
                  <span
                    onMouseDown={(e) => handleResizeStart(e, c.key, c.width)}
                    title="Drag to resize this column"
                    className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                  />
                </th>
              ))}
              {EXTRA_COLUMNS.map((c) => (
                <th key={c.key} className="relative select-none px-3 py-2.5 whitespace-nowrap">
                  <span className="block overflow-hidden text-ellipsis pr-2">{c.label}</span>
                  <span
                    onMouseDown={(e) => handleResizeStart(e, c.key, c.width)}
                    title="Drag to resize this column"
                    className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                  />
                </th>
              ))}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {COLUMNS.map((c, i) => (
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
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 3} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.registrationId} className="group hover:bg-neutral-50">
                  <td
                    className="sticky left-0 z-10 truncate border-r border-neutral-200 bg-white px-3 py-2 font-medium group-hover:bg-neutral-50"
                    title={row.fullName}
                  >
                    {row.fullName}
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-xs" title={row.registrationId}>
                    {row.registrationId.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="truncate px-3 py-2" title={row.competition}>
                    {row.competition}
                  </td>
                  <td className="truncate px-3 py-2" title={row.category}>
                    <CategoryName name={row.category} />
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-xs" title={row.icPassport}>{row.icPassport}</td>
                  <td className="truncate px-3 py-2" title={row.dateOfBirth}>{row.dateOfBirth}</td>
                  <td className="truncate px-3 py-2 capitalize" title={row.gender}>{row.gender}</td>
                  <td className="truncate px-3 py-2" title={row.beltRank}>{row.beltRank || "—"}</td>
                  <td className="truncate px-3 py-2 text-xs" title={row.rankConfirmation}>{row.rankConfirmation || "—"}</td>
                  <td className="truncate px-3 py-2" title={row.homeAddress}>
                    {row.homeAddress || "—"}
                  </td>
                  <td className="truncate px-3 py-2" title={row.country}>{row.country || "—"}</td>
                  <td className="truncate px-3 py-2" title={row.cityTown}>{row.cityTown || "—"}</td>
                  <td className="truncate px-3 py-2 text-xs" title={row.email}>{row.email || "—"}</td>
                  <td className="truncate px-3 py-2 text-xs" title={row.phone}>{row.phone || "—"}</td>
                  <td className="truncate px-3 py-2" title={row.school}>
                    {row.school || "—"}
                  </td>
                  <td className="truncate px-3 py-2" title={row.sensei}>
                    {row.sensei || "—"}
                  </td>
                  <td className="truncate px-3 py-2 text-xs" title={row.bankName}>{row.bankName || "—"}</td>
                  <td className="truncate px-3 py-2 text-xs" title={row.bankAccountNo}>{row.bankAccountNo || "—"}</td>
                  <td className="truncate px-3 py-2 text-xs" title={row.bankAccountName}>
                    {row.bankAccountName || "—"}
                  </td>
                  <td className="truncate px-3 py-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        row.recordingStatus === "Submitted"
                          ? "border-green-300 bg-green-50 text-green-800"
                          : "border-amber-300 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {row.recordingStatus}
                    </span>
                  </td>
                  <td className="truncate px-3 py-2 text-xs" title={row.recordingDate}>{row.recordingDate || "—"}</td>
                  <td className="truncate px-3 py-2 text-xs" title={row.attempts}>{row.attempts}</td>
                  <td className="px-3 py-2">
                    {row.certificateUrl ? (
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
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1.5">
                      {row.videoUrl ? (
                        <VideoWatchButton url={row.videoUrl} />
                      ) : (
                        !isAdmin && <span className="text-xs text-neutral-400">—</span>
                      )}
                      {isAdmin && <AdminVideoUploadForm registrationId={row.registrationId} />}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <SlotStatusCell row={row} canManage={canManageSlot} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DualScrollBox>
    </div>
  );
}
