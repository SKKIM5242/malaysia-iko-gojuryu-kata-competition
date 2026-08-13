"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDate } from "@/components/ui";
import VideoWatchButton from "@/components/VideoWatchButton";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import AdminVideoUploadForm from "@/components/AdminVideoUploadForm";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import DualScrollBox from "@/components/DualScrollBox";
import { useGridControls, isClosed, CLOSED_SIZE } from "@/lib/useGridControls";
import { useTableInteractions } from "@/lib/useTableInteractions";
import TableInteractionOverlays from "@/components/TableInteractionOverlays";
import { updateRegistrationSlotStatus, updateRegistrationCategory, linkRegistrationToAccount, unlinkRegistrationFromAccount, resendRegistrationConfirmation } from "@/app/actions/admin";

export type SlotStatus = "active" | "unslotted" | "forfeited" | "given_up";

/** One choosable category within a competition, for the per-row editor. */
export interface CategoryChoice {
  id: string;
  name: string;
  kata: string;
  belt: string;
  gender: string;
  age: string;
}

export interface ParticipantRecordRow {
  registrationId: string;
  competition: string;
  /** The four parts of the assigned category name, split out so each gets
   * its own sortable, filterable, individually-resizable column — the
   * single "Category" column crammed all four into one 240px cell. The
   * whole name is kept for the CSV export and the edit control. */
  category: string;
  categoryId: string | null;
  competitionId: string | null;
  kataName: string;
  beltGroup: string;
  genderGroup: string;
  ageGroup: string;
  fullName: string;
  icPassport: string;
  dateOfBirth: string;
  age: string;
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
  linkedAccountEmail: string | null;
}

const SLOT_STATUS_BADGE: Record<SlotStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-neutral-200 bg-neutral-50 text-neutral-500" },
  unslotted: { label: "Unslotted (by organiser)", cls: "border-orange-300 bg-orange-50 text-orange-800" },
  forfeited: { label: "Forfeited (by organiser)", cls: "border-red-300 bg-red-50 text-red-800" },
  given_up: { label: "Given up (by participant)", cls: "border-neutral-400 bg-neutral-100 text-neutral-700" },
};

/** Short, plain-text form of each slot status for the CSV export — same
 * wording as the action buttons (Active/Unslot/Forfeited/Give Up) rather
 * than the longer on-screen badge text. */
const SLOT_STATUS_CSV_LABEL: Record<SlotStatus, string> = {
  active: "Active",
  unslotted: "Unslot",
  forfeited: "Forfeited",
  given_up: "Give Up",
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
              <button
                type="submit"
                title="Set this registration's slot status back to Active"
                className="rounded border border-green-300 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 hover:bg-green-50"
              >
                Active
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
  { key: "kataName", label: "Kata Name", width: 150 },
  { key: "beltGroup", label: "Belt Group", width: 150 },
  { key: "genderGroup", label: "Gender Group", width: 110 },
  { key: "ageGroup", label: "Age Group", width: 120 },
  { key: "icPassport", label: "IC / Passport", width: 130 },
  { key: "dateOfBirth", label: "DOB", width: 100 },
  { key: "age", label: "Age", width: 70 },
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
  { key: "bankAccountNo", label: "International Bank Account No. (IBAN)", width: 220 },
  { key: "bankAccountName", label: "Bank Account Holder Name", width: 200 },
  { key: "recordingStatus", label: "Recording Status", width: 130 },
  { key: "recordingDate", label: "Recording Date", width: 130 },
  { key: "attempts", label: "Re-record Attempts", width: 90 },
];

/** The trailing columns rendered outside `ParticipantRecordRow` (rich
 * JSX, not a single field) — same resize treatment as every other column. */
const EXTRA_COLUMNS: Array<{ key: string; label: string; width: number }> = [
  { key: "categoryEdit", label: "Category Edit / Save", width: 210 },
  { key: "certificate", label: "Certificate", width: 100 },
  { key: "recording", label: "Recording", width: 170 },
  { key: "accountLink", label: "Account Link", width: 190 },
  { key: "slotStatus", label: "Slot Status", width: 240 },
  { key: "resendEmail", label: "Confirmation Email", width: 150 },
];

/** COLUMNS + EXTRA_COLUMNS as one reorderable list — "standard" columns
 * are plain text (eligible for cell-select/copy), "extra" ones are rich
 * JSX (reorderable like any column, but not cell-select/copy eligible). */
type AnyColumn = { key: string; label: string; width: number; kind: "standard" | "extra" };
const ALL_COLUMNS: AnyColumn[] = [
  ...COLUMNS.map((c) => ({ key: c.key as string, label: c.label, width: c.width, kind: "standard" as const })),
  ...EXTRA_COLUMNS.map((c) => ({ ...c, kind: "extra" as const })),
];
const COL_BY_KEY = new Map(ALL_COLUMNS.map((c) => [c.key, c]));
const STANDARD_BY_KEY = new Map(COLUMNS.map((c) => [c.key as string, c]));


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
    case "kataName":
      return { className: "font-medium", title: row.category, content: row.kataName || "—" };
    case "beltGroup":
      return { className: "text-xs", title: row.beltGroup, content: row.beltGroup || "—" };
    case "genderGroup":
      return { className: "text-xs", title: row.genderGroup, content: row.genderGroup || "—" };
    case "ageGroup":
      return { className: "text-xs", title: row.ageGroup, content: row.ageGroup || "—" };
    case "icPassport":
      return { className: "font-mono text-xs", title: row.icPassport, content: row.icPassport };
    case "dateOfBirth":
      return { className: "", title: row.dateOfBirth, content: row.dateOfBirth };
    case "age":
      return { className: "", title: row.age, content: row.age };
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

/** Edit / Save for the four category columns, for Admin / Organizer /
 * Participant Support only.
 *
 * It is one <select> rather than four editable cells because the four
 * columns are not four independent fields — they are one `categories` row
 * whose name is parsed on " — ". Free-typing "Sanchin" into a Kata cell
 * would produce a category matching no real category, and the registration
 * would vanish from its own division listing and from judging. Choosing an
 * existing category cannot do that, and the server re-checks that the
 * chosen one belongs to the same competition tier. */
function CategoryEditCell({
  row,
  canEditCategory,
  choices,
}: {
  row: ParticipantRecordRow;
  canEditCategory: boolean;
  choices: CategoryChoice[];
}) {
  const [editing, setEditing] = useState(false);

  if (!canEditCategory) return <span className="text-xs text-neutral-400">—</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        ✏️ Edit
      </button>
    );
  }

  if (choices.length === 0) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="text-[11px] text-neutral-500">
          No other categories exist in this tier yet — add them on Kata Categories first.
        </span>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <form action={updateRegistrationCategory} className="flex flex-col items-start gap-1">
      <input type="hidden" name="registration_id" value={row.registrationId} />
      <input type="hidden" name="return_to" value="/admin/records" />
      <select
        name="category_id"
        defaultValue={row.categoryId ?? ""}
        className="w-full rounded border border-neutral-300 px-1.5 py-1 text-[11px]"
      >
        <option value="">— pick a category —</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.kata} · {c.belt} · {c.gender} · {c.age}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-neutral-700"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded border border-neutral-300 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function extraCell(
  key: string,
  row: ParticipantRecordRow,
  isAdmin: boolean,
  canManageSlot: boolean,
  canLinkAccount: boolean,
  canResendEmail: boolean,
  canEditCategory: boolean,
  categoryChoices: Record<string, CategoryChoice[]>,
): ReactNode {
  switch (key) {
    case "categoryEdit":
      return (
        <CategoryEditCell
          row={row}
          canEditCategory={canEditCategory}
          choices={row.competitionId ? (categoryChoices[row.competitionId] ?? []) : []}
        />
      );
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
    case "accountLink":
      return <AccountLinkCell row={row} canLinkAccount={canLinkAccount} />;
    case "slotStatus":
      return <SlotStatusCell row={row} canManage={canManageSlot} />;
    case "resendEmail":
      return <ResendEmailCell row={row} canResendEmail={canResendEmail} />;
  }
  return null;
}

/** Whether this registration is claimed by a login account yet — a
 * participant can't record until it is, whether they self-linked (My
 * Account → Link Your Paid Registration) or staff linked it for them here.
 * The "Link to account" button covers the case where self-linking failed
 * (typo'd reference ID, signed up with a different email, payment status
 * got out of sync, etc.) without needing a manual database fix. */
function AccountLinkCell({ row, canLinkAccount }: { row: ParticipantRecordRow; canLinkAccount: boolean }) {
  if (row.linkedAccountEmail) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-green-700" title={`Linked to ${row.linkedAccountEmail}`}>
          ✅ {row.linkedAccountEmail}
        </span>
        {canLinkAccount && (
          <form action={unlinkRegistrationFromAccount}>
            <input type="hidden" name="registration_id" value={row.registrationId} />
            <input type="hidden" name="return_to" value="/admin/records" />
            <button
              type="submit"
              title={`Unlink ${row.linkedAccountEmail} from this registration — frees that account up to be linked to a different registration instead`}
              onClick={(e) => {
                if (!window.confirm(`Unlink ${row.linkedAccountEmail} from this registration?\n\nThey won't be able to sign in and see this recording until it's re-linked.`)) {
                  e.preventDefault();
                }
              }}
              className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
            >
              Unlink
            </button>
          </form>
        )}
      </span>
    );
  }
  if (!canLinkAccount) {
    return <span className="text-xs text-neutral-400">Not linked</span>;
  }
  return (
    <form action={linkRegistrationToAccount}>
      <input type="hidden" name="registration_id" value={row.registrationId} />
      <input type="hidden" name="return_to" value="/admin/records" />
      <button
        type="submit"
        title={`Link this registration to whichever account is signed up with ${row.email || "the participant's email"}`}
        className="rounded border border-blue-300 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
      >
        Link to account
      </button>
    </form>
  );
}

/** Manual re-send for when the automatic confirmation never arrived (email
 * provider misconfiguration, participant lost it, etc.) — sends one email
 * for this single registration, rebuilt from its current data. */
function ResendEmailCell({ row, canResendEmail }: { row: ParticipantRecordRow; canResendEmail: boolean }) {
  if (!row.email) {
    return <span className="text-xs text-neutral-400">No email on file</span>;
  }
  if (!canResendEmail) {
    return <span className="text-xs text-neutral-400">—</span>;
  }
  return (
    <form action={resendRegistrationConfirmation}>
      <input type="hidden" name="registration_id" value={row.registrationId} />
      <input type="hidden" name="return_to" value="/admin/records" />
      <button
        type="submit"
        title={`Resend the registration confirmation email to ${row.email}`}
        className="rounded border border-blue-300 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
      >
        Resend confirmation
      </button>
    </form>
  );
}

export default function ParticipantRecordsTable({
  rows,
  isAdmin = false,
  canManageSlot = false,
  canLinkAccount = false,
  canResendEmail = false,
  canEditCategory = false,
  categoryChoices = {},
}: {
  rows: ParticipantRecordRow[];
  isAdmin?: boolean;
  canManageSlot?: boolean;
  canLinkAccount?: boolean;
  canResendEmail?: boolean;
  /** Admin / Organizer / Participant Support only — the same tier the
   * server action enforces. Referees are deliberately excluded: moving a
   * competitor between divisions changes who they are judged against. */
  canEditCategory?: boolean;
  /** Selectable categories keyed by competition id, so the editor only
   * ever offers categories from that registration's own tier. */
  categoryChoices?: Record<string, CategoryChoice[]>;
}) {
  const [filters, setFilters] = useState<Partial<Record<keyof ParticipantRecordRow, Set<string>>>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const grid = useGridControls();
  const t = useTableInteractions();

  const widthOf = useCallback((key: string, fallback: number) => colWidths[key] ?? fallback, [colWidths]);

  const toggleColSelect = useCallback((key: string) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Pointer Events (not mouse-only) so dragging a column's resize handle
  // works with a mouse, a finger, or a stylus alike — plain mouse events
  // silently don't fire during a touch drag on mobile/tablet.
  const handleMove = useCallback((e: PointerEvent) => {
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
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  }, [handleMove]);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, key: string, fallback: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { key, startX: e.clientX, startWidth: widthOf(key, fallback) };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
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
        data-col-order-key={key}
        className={`relative select-none whitespace-nowrap ${sticky ? `sticky left-0 z-10 border-r border-neutral-200` : ""} ${
          closed ? "bg-red-600 p-0" : `px-3 py-2.5 ${selected ? "bg-sky-100" : sticky ? "bg-neutral-50" : ""}`
        }`}
      >
        {!closed && (
          <span
            onPointerDown={t.getColHeaderDownHandler(key, () => toggleColSelect(key))}
            title="Click to select/highlight this column — drag to reorder"
            className="block cursor-pointer overflow-hidden text-ellipsis pr-2"
          >
            {label}
          </span>
        )}
        <span
          onPointerDown={(e) => handleResizeStart(e, key, width)}
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
        // The on-screen "Reference ID" column truncates+uppercases the raw
        // UUID (see standardCell's "registrationId" case) — the export must
        // match it, not the full underlying id used internally for actions.
        out["Reference ID"] = row.registrationId.slice(0, 8).toUpperCase();
        out["Account Link"] = row.linkedAccountEmail ?? "Not linked";
        out["Slot Status"] = SLOT_STATUS_CSV_LABEL[row.slotStatus];
        return out;
      }),
    [filtered],
  );

  const closedColCount = useMemo(
    () =>
      [...COLUMNS, ...EXTRA_COLUMNS].filter((c) => isClosed(widthOf(c.key, c.width), widthOf(c.key, c.width))).length,
    [widthOf],
  );

  const orderedColumns = t
    .orderColumnKeys(ALL_COLUMNS.map((c) => c.key))
    .map((k) => COL_BY_KEY.get(k))
    .filter((c): c is AnyColumn => !!c);

  const orderedRows = (() => {
    const keys = t.orderRowKeys(filtered.map((r) => r.registrationId));
    const byKey = new Map(filtered.map((r) => [r.registrationId, r]));
    return keys.map((k) => byKey.get(k)).filter((r): r is ParticipantRecordRow => !!r);
  })();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Showing {filtered.length} of {rows.length} successful registrations. Type in any column&apos;s filter
          box to narrow the list — filters combine (AND). Click a column&apos;s label (or a row&apos;s leading
          cell) to select/highlight it — drag either one past a neighbor to reorder it. Drag a column&apos;s
          right edge (or a row&apos;s bottom edge) to resize it, all the way to close it down to a red bar.
          Click a cell to select it, then drag its blue corner handle across other cells to copy its value
          into them; right-click any cell to copy its value to the clipboard.
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
            width: orderedColumns.reduce((sum, c) => sum + widthOf(c.key, c.width), 0),
          }}
        >
          <colgroup>
            {orderedColumns.map((c) => (
              <col key={c.key} style={{ width: widthOf(c.key, c.width) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              {orderedColumns.map((c, i) => renderHeaderCell(c.key, c.label, widthOf(c.key, c.width), i === 0))}
            </tr>
            <tr className="border-t border-neutral-200 bg-white normal-case">
              {orderedColumns.map((c, i) => {
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
                    {!closed && c.kind === "standard" && (
                      <ColumnFilterDropdown
                        values={uniqueValues[c.key as keyof ParticipantRecordRow] ?? []}
                        selected={filters[c.key as keyof ParticipantRecordRow] ?? new Set()}
                        onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {orderedRows.length === 0 ? (
              <tr>
                <td colSpan={orderedColumns.length} className="px-3 py-6 text-center text-neutral-400">
                  No records match these filters.
                </td>
              </tr>
            ) : (
              orderedRows.map((row) => {
                const rowHeight = grid.rowHeights[row.registrationId];
                const rowClosed = rowHeight != null && rowHeight <= CLOSED_SIZE + 1;
                const rowSelected = grid.selectedRows.has(row.registrationId);
                return (
                  <tr
                    key={row.registrationId}
                    data-row-order-key={row.registrationId}
                    className={`group hover:bg-neutral-50 ${!rowClosed && rowSelected ? "bg-sky-50" : ""} ${grid.rowSizeClass(row.registrationId)}`}
                    style={grid.rowSizeStyle(row.registrationId)}
                  >
                    {orderedColumns.map((c, i) => {
                      const width = widthOf(c.key, c.width);
                      const colClosed = isClosed(width, width);
                      const colSelected = selectedCols.has(c.key);
                      const closed = colClosed || rowClosed;
                      const isHandle = i === 0;
                      const isStandard = c.kind === "standard";
                      const { className, title, content } = isStandard
                        ? standardCell(STANDARD_BY_KEY.get(c.key)!, row)
                        : { className: "", title: undefined, content: extraCell(c.key, row, isAdmin, canManageSlot, canLinkAccount, canResendEmail, canEditCategory, categoryChoices) };
                      const cellText = isStandard ? String(row[c.key as keyof ParticipantRecordRow] ?? "") : "";
                      const cellKey = `${row.registrationId}:${c.key}`;
                      const isCellSelected = !isHandle && isStandard && t.isCellSelected(row.registrationId, c.key);
                      const isFillPreview = !isHandle && isStandard && t.isFillPreview(row.registrationId, c.key);
                      const displayContent = isStandard && !isHandle ? t.cellValue(row.registrationId, c.key, cellText) || content : content;
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
                          data-cell-row={row.registrationId}
                          data-cell-col={c.key}
                          className={`${closed ? "p-0" : `truncate px-3 py-2 ${className}`} ${
                            isHandle ? `relative sticky left-0 z-10 border-r border-neutral-200 ${!closed ? "cursor-pointer select-none" : ""}` : "relative"
                          } ${cellBg} ${!closed && isCellSelected ? "ring-2 ring-inset ring-blue-500" : ""} ${
                            !closed && isFillPreview ? "outline outline-2 -outline-offset-2 outline-blue-300" : ""
                          }`}
                          title={isHandle && !closed ? "Click to select/highlight this row — drag to reorder" : !closed ? title : undefined}
                          onClick={
                            isHandle
                              ? undefined
                              : !closed && isStandard
                                ? () => t.selectCell(row.registrationId, c.key)
                                : undefined
                          }
                          onContextMenu={
                            !closed && isStandard ? t.getContextMenuHandler(String(displayContent ?? "")) : undefined
                          }
                          onPointerDown={
                            isHandle && !closed ? t.getRowHandleDownHandler(row.registrationId, () => grid.toggleRowSelect(row.registrationId)) : undefined
                          }
                        >
                          {!closed && displayContent}
                          {isHandle && (
                            <span
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                grid.handleRowResizeStart(e, row.registrationId, rowHeight ?? 36);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              title={rowClosed ? "Drag to reopen this row" : "Drag to resize (or close) this row"}
                              className="absolute bottom-0 left-0 right-0 z-10 h-1 cursor-row-resize touch-none select-none hover:bg-red-300 active:bg-red-500"
                            />
                          )}
                          {!isHandle && !closed && isCellSelected && (
                            <span
                              onPointerDown={t.getFillHandleDownHandler(row.registrationId, c.key, String(displayContent ?? ""))}
                              title="Drag to copy this value into other cells"
                              className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-crosshair rounded-sm border border-white bg-blue-600"
                            />
                          )}
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
      <TableInteractionOverlays t={t} />
    </div>
  );
}
