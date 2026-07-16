"use client";

import { useMemo, useState } from "react";
import { CategoryName } from "@/components/ui";
import VideoWatchButton from "@/components/VideoWatchButton";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import AdminVideoUploadForm from "@/components/AdminVideoUploadForm";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";

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
  bank: string;
  recordingStatus: "Submitted" | "Not submitted";
  recordingDate: string;
  attempts: string;
  videoUrl: string | null;
}

const COLUMNS: Array<{ key: keyof ParticipantRecordRow; label: string }> = [
  { key: "registrationId", label: "Reference ID" },
  { key: "competition", label: "Tier" },
  { key: "category", label: "Category" },
  { key: "fullName", label: "Full Name" },
  { key: "icPassport", label: "IC / Passport" },
  { key: "dateOfBirth", label: "DOB" },
  { key: "gender", label: "Gender" },
  { key: "beltRank", label: "Belt" },
  { key: "rankConfirmation", label: "Rank Confirmation" },
  { key: "homeAddress", label: "Home Address" },
  { key: "country", label: "Country" },
  { key: "cityTown", label: "City/Town" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "school", label: "School" },
  { key: "sensei", label: "Sensei" },
  { key: "bank", label: "Payout Bank" },
  { key: "recordingStatus", label: "Recording Status" },
  { key: "recordingDate", label: "Recording Date" },
  { key: "attempts", label: "Re-record Attempts" },
];

export default function ParticipantRecordsTable({
  rows,
  isAdmin = false,
}: {
  rows: ParticipantRecordRow[];
  isAdmin?: boolean;
}) {
  const [filters, setFilters] = useState<Partial<Record<keyof ParticipantRecordRow, Set<string>>>>({});

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
          box to narrow the list — filters combine (AND).
        </p>
        <DownloadCsvButton rows={csvRows} filename="participants" />
      </div>
      <DualScrollBox>
        <table className="w-full min-w-[2200px] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2.5 whitespace-nowrap">Certificate</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Recording</th>
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-1.5">
                  <ColumnFilterDropdown
                    values={uniqueValues[c.key] ?? []}
                    selected={filters[c.key] ?? new Set()}
                    onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                  />
                </th>
              ))}
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.registrationId} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 font-mono text-xs" title={row.registrationId}>
                    {row.registrationId.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2" title={row.competition}>
                    {row.competition}
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2" title={row.category}>
                    <CategoryName name={row.category} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{row.fullName}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.icPassport}</td>
                  <td className="whitespace-nowrap px-3 py-2">{row.dateOfBirth}</td>
                  <td className="whitespace-nowrap px-3 py-2 capitalize">{row.gender}</td>
                  <td className="whitespace-nowrap px-3 py-2">{row.beltRank || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.rankConfirmation || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{row.country || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{row.cityTown || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.email || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.phone || "—"}</td>
                  <td className="max-w-[160px] truncate px-3 py-2" title={row.school}>
                    {row.school || "—"}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2" title={row.sensei}>
                    {row.sensei || "—"}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-xs" title={row.bank}>
                    {row.bank || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
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
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.recordingDate || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{row.attempts}</td>
                  <td className="whitespace-nowrap px-3 py-2">
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
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex flex-col items-start gap-1.5">
                      {row.videoUrl ? (
                        <VideoWatchButton url={row.videoUrl} />
                      ) : (
                        !isAdmin && <span className="text-xs text-neutral-400">—</span>
                      )}
                      {isAdmin && <AdminVideoUploadForm registrationId={row.registrationId} />}
                    </div>
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
