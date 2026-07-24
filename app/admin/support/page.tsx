import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import {
  updateCommunityStatus, createStaffAccount, bulkUploadSupport, clockIn, clockOut,
  saveSupportTicket, deleteSupportTicket, toggleTicketComplaint,
} from "@/app/actions/admin";
import Link from "next/link";
import { getAllTelegramLinks } from "@/lib/telegram";
import { getOpenShift, getAllShifts } from "@/lib/support-shifts";
import { AdminShell, Card, CertificateField, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatUSD, formatDateTime } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";
import { NoCommaInput } from "@/components/NoCommaAddressField";
import DateOfBirthField from "@/components/DateOfBirthField";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
import IbanInput from "@/components/IbanInput";
import { IBAN_CSV_NOTE } from "@/lib/bank";
import { EDUCATION_LEVELS, SPOKEN_LANGUAGES } from "@/lib/reference-data";

export const dynamic = "force-dynamic";

interface StaffApp {
  id: string; full_name: string; short_name: string | null; email: string | null; phone: string | null;
  role_requested: string; message: string | null; status: string; created_at: string;
  support_tier_1_id: string | null; support_tier_2_id: string | null; support_tier_3_id: string | null;
}

export default async function AdminSupport({
  searchParams,
}: {
  searchParams: Promise<{ editcode?: string; editticket?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Participant Support" active="/admin/support">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const canCreate = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");
  const canBulkUpload = ["admin", "organizer"].includes(myProfile?.role ?? "");
  const isCustomerSupport = myProfile?.role === "customer_support";
  const isAdminTier = ["admin", "organizer", "staff", "customer_support"].includes(myProfile?.role ?? "");

  const [openShift, allShifts] = await Promise.all([
    isCustomerSupport && user ? getOpenShift(user.id) : Promise.resolve(null),
    isAdminTier ? getAllShifts() : Promise.resolve([]),
  ]);

  const competitions = await getAllCompetitions();
  const { data: supportProfiles } =
    canCreate || isCustomerSupport
      ? await supabase
          .from("profiles")
          .select("user_id, full_name, short_name, email, sign_in_count, sign_in_limit, sign_in_competition_id, sign_in_valid_from, sign_in_valid_until")
          .eq("role", "customer_support")
      : { data: [] };

  // ── Per-resolved-ticket bounty: 10% of total PAID participant fees is the
  // pool, shared by weighted resolved tickets (advance 3 : intermediate 2 :
  // general 1). Own-school answers don't count; each complaint is -1 USD.
  const TICKET_WEIGHTS: Record<string, number> = { advance: 3, intermediate: 2, general: 1 };
  const [{ data: ticketsData }, { data: paidRegs }] = await Promise.all([
    supabase.from("support_tickets").select("*").order("created_at", { ascending: false }),
    supabase
      .from("registrations")
      .select("competition:competitions(registration_fee_usd)")
      .eq("payment_status", "paid"),
  ]);
  const tickets = ticketsData ?? [];
  const editingTicket = params.editticket ? tickets.find((t) => t.id === params.editticket) : undefined;
  const totalPaidFees = ((paidRegs as unknown as Array<{ competition: { registration_fee_usd: number | null } | null }>) ?? [])
    .reduce((sum, r) => sum + Number(r.competition?.registration_fee_usd ?? 0), 0);
  const rewardPool = totalPaidFees * 0.1;
  const supportName = new Map(
    (supportProfiles ?? []).map((p) => [p.user_id as string, (p.full_name as string) || (p.email as string) || p.user_id.slice(0, 8)]),
  );
  const perSupporter = new Map<string, { weighted: number; complaints: number }>();
  let totalWeighted = 0;
  for (const t of tickets) {
    if (!t.answered_by) continue;
    const entry = perSupporter.get(t.answered_by) ?? { weighted: 0, complaints: 0 };
    if (t.status === "resolved" && !t.own_school) {
      const w = TICKET_WEIGHTS[t.category] ?? 1;
      entry.weighted += w;
      totalWeighted += w;
    }
    if (t.complaint) entry.complaints += 1;
    perSupporter.set(t.answered_by, entry);
  }
  const telegramGroups = getAllTelegramLinks();

  const { data: apps } = await supabase
    .from("staff_applications")
    .select("*")
    .eq("role_requested", "customer_support")
    .order("created_at", { ascending: false });
  const applications = (apps as StaffApp[]) ?? [];

  return (
    <AdminShell title="Participant Support" active="/admin/support" flash={{ ok: params.ok, error: params.error }}>
      {isCustomerSupport && (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Your Shift</h2>
          <Card>
            <p className="mb-3 text-xs text-neutral-400">
              Clock in/out here even when your work was replying via the Telegram assistant or
              community groups — there's no other way to log that time. The organizer's reward
              scheme for support work will be announced separately.
            </p>
            {openShift ? (
              <form action={clockOut} className="space-y-3">
                <input type="hidden" name="id" value={openShift.id} />
                <p className="text-sm text-neutral-700">
                  Clocked in since <strong>{formatDateTime(openShift.clockInAt)}</strong>
                </p>
                <div>
                  <label htmlFor="task_summary" className={adminLabel}>Task summary (optional)</label>
                  <textarea
                    id="task_summary"
                    name="task_summary"
                    rows={2}
                    className={adminInput}
                    placeholder="e.g. Answered 6 participant queries on Telegram about recording issues"
                  />
                </div>
                <button type="submit" className={adminBtn}>Clock out</button>
              </form>
            ) : (
              <form action={clockIn}>
                <button type="submit" className={adminBtnSecondary}>Clock in</button>
              </form>
            )}
          </Card>
        </div>
      )}

      {canCreate && (
        <div className="mb-8">
          {canBulkUpload && (
            <div className="mb-6">
              <CsvUploadForm
                action={bulkUploadSupport}
                templateHref="/support-template.csv"
                entityLabel="account"
                note={`Each row creates a real login instantly and emails a temporary password — max 200 rows per upload. ${IBAN_CSV_NOTE}`}
              />
            </div>
          )}
          <h2 className="mb-3 text-lg font-bold">Create A Participant Support Account</h2>
          <Card>
            <form action={createStaffAccount} className="space-y-4">
              <input type="hidden" name="role" value="customer_support" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cs_full_name" className={adminLabel}>Full name *</label>
                  <input id="cs_full_name" name="full_name" required className={adminInput} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cs_short_name" className={adminLabel}>My short name or initial *</label>
                  <input id="cs_short_name" name="short_name" required className={adminInput} placeholder="e.g. Amy / KSK" />
                  <p className="mt-1 text-xs text-neutral-400">
                    Note: To earn a 10% cut of Audience sign-ins made under your recommendation for
                    the competition tier you&apos;re in charge of, from 1 August 2026 to 31 January
                    2027 — subject to the organizer&apos;s approval based on the competition tier.
                    Payout by 28 February 2027.
                  </p>
                </div>
                <div>
                  <label htmlFor="cs_email" className={adminLabel}>Email *</label>
                  <input id="cs_email" name="email" type="email" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_ic_passport" className={adminLabel}>IC / Passport *</label>
                  <input id="cs_ic_passport" name="ic_passport" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_date_of_birth" className={adminLabel}>Date of Birth: DD/MM/YYYY *</label>
                  <DateOfBirthField id="cs_date_of_birth" name="date_of_birth" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_gender" className={adminLabel}>Gender *</label>
                  <select id="cs_gender" name="gender" required defaultValue="" className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cs_belt_rank" className={adminLabel}>Belt rank (if applicable)</label>
                  <input id="cs_belt_rank" name="belt_rank" className={adminInput} placeholder="e.g. 3rd Kyu" />
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-1 text-xs text-neutral-400">Latest rank certificate (if applicable)</p>
                  <CertificateField />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cs_home_address" className={adminLabel}>
                    Home address *{" "}
                    <span className="font-normal text-neutral-400">(no comma &quot;,&quot; allowed in the box)</span>
                  </label>
                  <NoCommaInput id="cs_home_address" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_city_town" className={adminLabel}>City / Town *</label>
                  <input id="cs_city_town" name="city_town" required className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_postcode" className={adminLabel}>Postcode *</label>
                  <input id="cs_postcode" name="postcode" required className={adminInput} placeholder="e.g. 50000" />
                </div>
                <div>
                  <label htmlFor="cs_country" className={adminLabel}>Country *</label>
                  <input id="cs_country" name="country" required defaultValue="Malaysia" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_phone" className={adminLabel}>Mobile phone *</label>
                  <input id="cs_phone" name="phone" type="tel" required className={adminInput} placeholder="+60…" />
                </div>
                <div>
                  <label htmlFor="cs_invitation_code" className={adminLabel}>Invitation code (optional)</label>
                  <input id="cs_invitation_code" name="invitation_code" className={adminInput} />
                </div>
                <div>
                  <label htmlFor="cs_referral_source" className={adminLabel}>Referral (optional)</label>
                  <input id="cs_referral_source" name="referral_source" className={adminInput} placeholder="e.g. a friend's name" />
                </div>
                <div>
                  <label htmlFor="cs_highest_education" className={adminLabel}>Highest Education Attended *</label>
                  <select id="cs_highest_education" name="highest_education" required defaultValue="" className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    {EDUCATION_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>{lvl}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cs_languages_count" className={adminLabel}>
                    How many languages can they speak, read, and write? *
                  </label>
                  <input id="cs_languages_count" name="languages_count" type="number" min={0} max={20} required className={adminInput} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cs_languages" className={adminLabel}>
                    Which languages? <span className="font-normal text-neutral-400">(ctrl/cmd-click to select more than one)</span>
                  </label>
                  <select id="cs_languages" name="languages" multiple size={6} className={adminInput}>
                    {SPOKEN_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Kata Competition Tier(s) they&apos;ll support{" "}
                  <span className="font-normal text-neutral-400 normal-case">(optional, up to 3)</span>
                </p>
                <div className="mt-2 grid gap-4 sm:grid-cols-3">
                  {(["support_tier_1_id", "support_tier_2_id", "support_tier_3_id"] as const).map((name, i) => (
                    <div key={name}>
                      <label htmlFor={`cs_${name}`} className={adminLabel}>Tier {i + 1}</label>
                      <select id={`cs_${name}`} name={name} defaultValue="" className={adminInput}>
                        <option value="">— None —</option>
                        {competitions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({formatUSD(c.registration_fee_usd)})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details *</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cs_bank_name" className={adminLabel}>Bank name *</label>
                    <input id="cs_bank_name" name="bank_name" required className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="cs_bank_account_no" className={adminLabel}>International Bank Account No. (IBAN) *</label>
                    <IbanInput id="cs_bank_account_no" name="bank_account_no" required className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="cs_bank_account_name" className={adminLabel}>Account holder name *</label>
                    <input id="cs_bank_account_name" name="bank_account_name" required className={adminInput} />
                  </div>
                </div>
              </div>
              <div>
                <button type="submit" className={adminBtn}>Create Participant Support account</button>
                <p className="mt-2 text-xs text-neutral-400">
                  Creates a real login instantly and emails them a temporary password. Participant Support
                  accounts can view/edit Registrations and Participants (no delete), generate invitation
                  codes, and merge categories on Competitions — nothing else.
                </p>
              </div>
            </form>
          </Card>
        </div>
      )}

      <h2 className="mb-3 text-lg font-bold">Participant Support Applications</h2>
      {applications.length === 0 ? (
        <EmptyState>No applications yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="customer-support-applications"
          columns={[
            { key: "full_name", label: "Name" },
            { key: "short_name", label: "Short Name" },
            { key: "reference_id", label: "Reference ID" },
            { key: "contact", label: "Contact" },
            ...competitions.map((c) => ({ key: `tier_${c.id}`, label: `Tier ${formatUSD(c.registration_fee_usd)}` })),
            { key: "message", label: "Message" },
            { key: "status", label: "Status" },
          ]}
          csvColumns={[
            { key: "full_name", label: "Name" },
            { key: "short_name", label: "Short Name" },
            { key: "reference_id", label: "Reference ID" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            ...competitions.map((c) => ({ key: `tier_${c.id}`, label: `Tier ${formatUSD(c.registration_fee_usd)}` })),
            { key: "message", label: "Message" },
            { key: "status_text", label: "Status" },
          ]}
          rows={applications.map((s) => ({
            id: s.id,
            reference_id: s.id.slice(0, 8).toUpperCase(),
            full_name: s.full_name,
            short_name: s.short_name ?? "",
            contact: [s.email, s.phone].filter(Boolean).join(" · "),
            email: s.email ?? "",
            phone: s.phone ?? "",
            ...Object.fromEntries(
              competitions.map((c) => [
                `tier_${c.id}`,
                [s.support_tier_1_id, s.support_tier_2_id, s.support_tier_3_id].includes(c.id) ? "✓" : "",
              ]),
            ),
            message: s.message ?? "",
            status_text: s.status,
            status: (
              <div className="flex flex-wrap gap-1">
                {["pending", "approved", "rejected"].map((o) => (
                  <form key={o} action={updateCommunityStatus}>
                    <input type="hidden" name="table" value="staff_applications" />
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="field" value="status" />
                    <input type="hidden" name="value" value={o} />
                    <input type="hidden" name="return_to" value="/admin/support" />
                    <button
                      disabled={o === s.status}
                      className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
                        o === s.status
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      {o}
                    </button>
                  </form>
                ))}
              </div>
            ),
          }))}
        />
      )}
      <p className="mt-4 text-xs text-neutral-400">
        Approving an application here does not create a login by itself — use the &quot;Create a Customer
        Support account&quot; form above to actually grant access.
      </p>

      {isAdminTier && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Shift Log</h2>
          {allShifts.length === 0 ? (
            <EmptyState>No shifts logged yet.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="support-shifts"
              columns={[
                { key: "name", label: "Name" },
                { key: "clock_in", label: "Clock In" },
                { key: "clock_out", label: "Clock Out" },
                { key: "hours", label: "Hours" },
                { key: "task_summary", label: "Task Summary" },
              ]}
              rows={allShifts.map((s) => ({
                id: s.id,
                name: s.userName,
                clock_in: formatDateTime(s.clockInAt),
                clock_out: s.clockOutAt ? formatDateTime(s.clockOutAt) : "— still clocked in —",
                hours: s.hours != null ? s.hours.toFixed(2) : "",
                task_summary: s.taskSummary ?? "",
              }))}
            />
          )}
        </div>
      )}

      {isAdminTier && (
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-bold">Support Tickets — Per-Resolved-Ticket Bounty</h2>
          <p className="text-sm text-neutral-500">
            Copy each question from its Telegram topic into a ticket (answer it back in the same
            group), classify it Advance / Intermediate / General, and mark it resolved. The reward
            pool is <strong>10% of total paid participant fees</strong>, shared by weighted
            resolved tickets (Advance 3 : Intermediate 2 : General 1). Answers to your own school
            or your own students don&apos;t count, and every complaint received is −1 USD.
          </p>
          <Card>
            <form action={saveSupportTicket} className="space-y-4">
              {editingTicket && <input type="hidden" name="id" value={editingTicket.id} />}
              <div>
                <label htmlFor="ticket_question" className={adminLabel}>
                  {editingTicket ? "Edit Question / Issue *" : "Question / Issue (copied from Telegram) *"}
                </label>
                <textarea
                  id="ticket_question"
                  name="question"
                  rows={2}
                  required
                  defaultValue={editingTicket?.question ?? ""}
                  className={adminInput}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ticket_group" className={adminLabel}>Telegram group</label>
                  <select id="ticket_group" name="telegram_group" defaultValue={editingTicket?.telegram_group ?? ""} className={adminInput}>
                    <option value="">— Not from Telegram —</option>
                    {telegramGroups.map((g) => (
                      <option key={g.category} value={g.label}>{g.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ticket_category" className={adminLabel}>Classification *</label>
                  <select id="ticket_category" name="category" required defaultValue={editingTicket?.category ?? "general"} className={adminInput}>
                    <option value="general">General issue / question (weight 1)</option>
                    <option value="intermediate">Intermediate (weight 2)</option>
                    <option value="advance">Advance (weight 3)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ticket_answered_by" className={adminLabel}>Answered by</label>
                  <select id="ticket_answered_by" name="answered_by" defaultValue={editingTicket?.answered_by ?? ""} className={adminInput}>
                    <option value="">— Not answered yet —</option>
                    {(supportProfiles ?? []).map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {(p.full_name as string) || (p.email as string) || p.user_id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ticket_status" className={adminLabel}>Status *</label>
                  <select id="ticket_status" name="status" required defaultValue={editingTicket?.status ?? "open"} className={adminInput}>
                    <option value="open">Open</option>
                    <option value="resolved">Resolved (counts toward the pool)</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="ticket_answer" className={adminLabel}>Answer (also sent to the Telegram group)</label>
                <textarea id="ticket_answer" name="answer" rows={2} defaultValue={editingTicket?.answer ?? ""} className={adminInput} />
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  name="own_school"
                  defaultChecked={editingTicket?.own_school ?? false}
                  className="h-4 w-4 rounded border-neutral-300 accent-red-700"
                />
                From the supporter&apos;s own school / own student (does not count toward the pool)
              </label>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editingTicket ? "Save changes" : "Log ticket"}</button>
                {editingTicket && (
                  <Link href="/admin/support" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
          {tickets.length === 0 ? (
            <EmptyState>No tickets logged yet.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="support-tickets"
              stickyColumns={2}
              firstColumnWidth={56}
              columns={[
                { key: "no", label: "No." },
                { key: "question", label: "Question / Issue" },
                { key: "category", label: "Class" },
                { key: "group", label: "Telegram Group" },
                { key: "answered_by", label: "Answered By" },
                { key: "status", label: "Status" },
                { key: "own_school", label: "Own School" },
                { key: "complaint", label: "Complaint (−1 USD)" },
                { key: "actions", label: "Actions" },
              ]}
              csvColumns={[
                { key: "no", label: "No." },
                { key: "question", label: "Question" },
                { key: "category", label: "Class" },
                { key: "group", label: "Telegram Group" },
                { key: "answered_by", label: "Answered By" },
                { key: "status", label: "Status" },
                { key: "own_school", label: "Own School" },
                { key: "complaint", label: "Complaint" },
              ]}
              rows={tickets.map((t, i) => ({
                id: t.id,
                no: String(i + 1),
                question: t.question,
                category: t.category,
                group: t.telegram_group ?? "",
                answered_by: t.answered_by ? (supportName.get(t.answered_by) ?? t.answered_by.slice(0, 8)) : "",
                status: t.status,
                own_school: t.own_school ? "Yes (not counted)" : "No",
                complaint: (
                  <form action={toggleTicketComplaint}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="complaint" value={(!t.complaint).toString()} />
                    <button
                      className={`rounded px-2.5 py-1 text-xs font-semibold ${
                        t.complaint
                          ? "bg-red-600 text-white hover:bg-red-500"
                          : "border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      {t.complaint ? "Complaint −1 USD" : "Record complaint"}
                    </button>
                  </form>
                ),
                actions: (
                  <div className="flex gap-1.5">
                    <Link
                      href={`/admin/support?editticket=${t.id}`}
                      className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                    {canCreate && (
                      <form action={deleteSupportTicket}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    )}
                  </div>
                ),
              }))}
            />
          )}
          <Card>
            <h3 className="font-bold text-neutral-900">Reward Pool</h3>
            {canCreate && (
              <p className="mt-1 text-sm text-neutral-600">
                Total paid participant fees: <strong>{formatUSD(totalPaidFees)}</strong> → pool (10%):{" "}
                <strong>{formatUSD(rewardPool)}</strong>
              </p>
            )}
            {perSupporter.size === 0 ? (
              <p className="mt-2 text-sm text-neutral-400">No resolved tickets attributed yet.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-neutral-700">
                {[...perSupporter.entries()].map(([uid, s]) => {
                  const share = totalWeighted > 0 ? (rewardPool * s.weighted) / totalWeighted : 0;
                  const payout = share - s.complaints;
                  return (
                    <li key={uid} className="flex flex-wrap justify-between gap-2 rounded border border-neutral-100 bg-neutral-50 px-3 py-1.5">
                      <span>{supportName.get(uid) ?? uid.slice(0, 8)}</span>
                      <span>
                        weighted {s.weighted}
                        {s.complaints > 0 && <span className="text-red-600"> · {s.complaints} complaint(s) −{s.complaints} USD</span>}
                        {" → "}
                        <strong>{formatUSD(Math.max(0, payout))}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {canCreate && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Sign-In Control (Admin/Organizer Only)</h2>
          {(supportProfiles ?? []).length === 0 ? (
            <EmptyState>No Participant Support logins yet.</EmptyState>
          ) : (
            <div className="space-y-2">
              {(supportProfiles ?? []).map((p) => (
                <div key={p.user_id} className="rounded-md border border-neutral-200 p-3">
                  <p className="mb-2 font-semibold text-neutral-900">
                    {p.full_name ?? p.email ?? p.user_id}
                    {p.short_name && <span className="font-normal text-neutral-400"> — {p.short_name}</span>}
                  </p>
                  <SignInControlBox
                    userId={p.user_id}
                    signInCount={p.sign_in_count ?? 0}
                    signInLimit={p.sign_in_limit ?? null}
                    signInCompetitionId={p.sign_in_competition_id ?? null}
                    signInValidFrom={p.sign_in_valid_from ?? null}
                    signInValidUntil={p.sign_in_valid_until ?? null}
                    competitions={competitions}
                    returnTo="/admin/support"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {canCreate && (
        <div className="mt-8 space-y-6">
          <InvitationCodeForm
            role="customer_support"
            returnTo="/admin/support"
            title="Participant Support Invitation Code"
            idPrefix="support_code"
            codeExample="IKO-SUPPORT-2026"
            competitions={competitions}
          />
          <InvitationCodeList
            role="customer_support"
            returnTo="/admin/support"
            codeExample="IKO-SUPPORT-2026"
            competitions={competitions}
            editingId={params.editcode}
          />
        </div>
      )}
    </AdminShell>
  );
}
