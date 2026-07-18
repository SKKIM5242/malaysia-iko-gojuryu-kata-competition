import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import {
  saveStudent, deleteStudent, bulkUploadStudents, saveFeePlan, deleteFeePlan, enrollStudent,
  updateEnrollmentStatus, generateDueInvoices, createManualInvoice, updateInvoiceStatus,
  generateInvoicePaymentLink,
} from "@/app/actions/classes";
import { paymentsEnabled } from "@/lib/payments";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import type { ClassEnrollment, ClassInvoice, FeePlan, Student } from "@/lib/types";
import { WORLD_CURRENCIES } from "@/lib/reference-data";

export const dynamic = "force-dynamic";

const TABS = [
  ["students", "Students"],
  ["plans", "Fee plans"],
  ["enrollments", "Enrollments"],
  ["invoices", "Invoices"],
] as const;

function fmtMoney(n: number | null | undefined, currency: string): string {
  return n == null ? "set per invoice" : `${currency} ${Number(n).toFixed(2)}`;
}

const INTERVAL_LABEL: Record<string, string> = {
  yearly: "Yearly",
  monthly: "Monthly",
  bimonthly: "Bi-monthly",
  quarterly: "Quarterly",
  daily: "Daily",
  transaction: "Per Transaction",
  occurrence: "Per Occurrence",
  request: "Per Request",
  order: "Per Order",
  service: "Per Service",
};

const KIND_LABEL: Record<string, string> = {
  membership_yearly: "Membership (yearly)",
  training_monthly: "Training fee",
  grading: "Grading fee",
  hourly_charge: "Hourly charge",
  service_charge: "Service Charge",
};

const APPLIES_TO_OPTIONS = [
  "Competition Participant",
  "Competition School",
  "Competition Referee/Judge",
  "Competition Support",
  "Coach/Sensei/Master",
] as const;

export default async function AdminClasses({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; edit?: string; ok?: string; error?: string; status?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.some(([t]) => t === params.tab) ? params.tab! : "students";
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Class Billing" active="/admin/classes">
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
  const canBulkUpload = ["admin", "organizer"].includes(myProfile?.role ?? "");

  const [{ data: studentsData }, { data: plansData }] = await Promise.all([
    supabase.from("students").select("*").order("full_name"),
    supabase.from("fee_plans").select("*").order("created_at"),
  ]);
  const students = (studentsData as Student[]) ?? [];
  const plans = (plansData as FeePlan[]) ?? [];

  let enrollments: ClassEnrollment[] = [];
  if (tab === "enrollments") {
    const { data } = await supabase
      .from("class_enrollments")
      .select("*, student:students(id, full_name, category), fee_plan:fee_plans(id, name, kind, amount_myr, currency, billing_interval)")
      .order("created_at", { ascending: false });
    enrollments = (data as unknown as ClassEnrollment[]) ?? [];
  }

  let invoices: ClassInvoice[] = [];
  const invoiceFilter = ["unpaid", "paid", "void"].includes(params.status ?? "") ? params.status : undefined;
  if (tab === "invoices") {
    let q = supabase
      .from("class_invoices")
      .select("*, student:students(id, full_name, phone), fee_plan:fee_plans(id, name, kind)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (invoiceFilter) q = q.eq("status", invoiceFilter);
    const { data } = await q;
    invoices = (data as unknown as ClassInvoice[]) ?? [];
  }

  const editingStudent = tab === "students" && params.edit ? students.find((s) => s.id === params.edit) : undefined;
  const editingPlan = tab === "plans" && params.edit ? plans.find((p) => p.id === params.edit) : undefined;
  // Grouped by currency, not summed together — mixing currencies into one
  // number would be meaningless once plans/invoices can use different ones.
  const unpaidByCurrency = new Map<string, number>();
  for (const i of invoices) {
    if (i.status !== "unpaid") continue;
    const cur = i.currency || "MYR";
    unpaidByCurrency.set(cur, (unpaidByCurrency.get(cur) ?? 0) + Number(i.amount_myr));
  }

  return (
    <AdminShell title="Class Billing" active="/admin/classes" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={`/admin/classes?tab=${t}`}
            className={`rounded-full border px-4 py-1.5 ${
              tab === t
                ? "border-red-700 bg-red-700 font-semibold text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "students" && canBulkUpload && (
        <div className="mb-8">
          <CsvUploadForm
            action={bulkUploadStudents}
            templateHref="/students-template.csv"
            entityLabel="student"
          />
        </div>
      )}
      {tab === "students" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-bold">{editingStudent ? "Edit Student" : "Add Student"}</h2>
            <Card>
              <form action={saveStudent} className="space-y-4">
                {editingStudent && <input type="hidden" name="id" value={editingStudent.id} />}
                <div>
                  <label htmlFor="full_name" className={adminLabel}>Full name *</label>
                  <input id="full_name" name="full_name" required defaultValue={editingStudent?.full_name ?? ""} className={adminInput} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="category" className={adminLabel}>Fee category *</label>
                    <select id="category" name="category" defaultValue={editingStudent?.category ?? "student"} className={adminInput}>
                      <option value="student">Student (RM 800/mo plan)</option>
                      <option value="adult">Adult (RM 900/mo plan)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="status" className={adminLabel}>Status</label>
                    <select id="status" name="status" defaultValue={editingStudent?.status ?? "active"} className={adminInput}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive (not billed)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ic_passport" className={adminLabel}>IC / Passport</label>
                    <input id="ic_passport" name="ic_passport" defaultValue={editingStudent?.ic_passport ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="date_of_birth" className={adminLabel}>Date of birth</label>
                    <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={editingStudent?.date_of_birth ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="gender" className={adminLabel}>Gender</label>
                    <select id="gender" name="gender" defaultValue={editingStudent?.gender ?? ""} className={adminInput}>
                      <option value="">— Select —</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="join_date" className={adminLabel}>Join date</label>
                    <input id="join_date" name="join_date" type="date" defaultValue={editingStudent?.join_date ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="email" className={adminLabel}>Email</label>
                    <input id="email" name="email" type="email" defaultValue={editingStudent?.email ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="phone" className={adminLabel}>Mobile phone</label>
                    <input id="phone" name="phone" type="tel" defaultValue={editingStudent?.phone ?? ""} className={adminInput} placeholder="+60…" />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="home_address" className={adminLabel}>Home address</label>
                    <input id="home_address" name="home_address" defaultValue={editingStudent?.home_address ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="city_town" className={adminLabel}>City / Town</label>
                    <input id="city_town" name="city_town" defaultValue={editingStudent?.city_town ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="home_country" className={adminLabel}>Home country</label>
                    <input id="home_country" name="home_country" defaultValue={editingStudent?.home_country ?? (editingStudent ? "" : "Malaysia")} className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="notes" className={adminLabel}>Notes</label>
                    <textarea id="notes" name="notes" rows={2} defaultValue={editingStudent?.notes ?? ""} className={adminInput} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className={adminBtn}>{editingStudent ? "Save changes" : "Add student"}</button>
                  {editingStudent && (
                    <Link href="/admin/classes?tab=students" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                      Cancel
                    </Link>
                  )}
                </div>
              </form>
            </Card>
          </div>
          <div>
            <h2 className="mb-3 text-lg font-bold">All Students ({students.length})</h2>
            {students.length === 0 ? (
              <EmptyState>No students yet — add your first student on the left.</EmptyState>
            ) : (
              <FilterableTable
                rowKey="id"
                downloadName="students"
                columns={[
                  { key: "name", label: "Name" },
                  { key: "category", label: "Category" },
                  { key: "status", label: "Status" },
                  { key: "contact", label: "Contact" },
                  { key: "actions", label: "Actions" },
                ]}
                csvColumns={[
                  { key: "name", label: "Name" },
                  { key: "category", label: "Category" },
                  { key: "status_text", label: "Status" },
                  { key: "email", label: "Email" },
                  { key: "phone", label: "Phone" },
                ]}
                rows={students.map((s) => ({
                  id: s.id,
                  name: s.full_name,
                  category: s.category,
                  status: (
                    <span className={s.status === "active" ? "font-semibold text-green-700" : "text-neutral-400"}>
                      {s.status}
                    </span>
                  ),
                  status_text: s.status,
                  contact: (
                    <>
                      {s.email ?? "—"}
                      {s.phone && <span className="block text-neutral-500">{s.phone}</span>}
                    </>
                  ),
                  email: s.email ?? "",
                  phone: s.phone ?? "",
                  actions: (
                    <div className="flex gap-1.5">
                      <Link href={`/admin/classes?tab=students&edit=${s.id}`} className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                        Edit
                      </Link>
                      <form action={deleteStudent}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        </div>
      )}

      {tab === "plans" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-bold">{editingPlan ? "Edit Fee Plan" : "New Fee Plan"}</h2>
            <Card>
              <form action={saveFeePlan} className="space-y-4">
                {editingPlan && <input type="hidden" name="id" value={editingPlan.id} />}
                <div>
                  <label htmlFor="plan_name" className={adminLabel}>Plan name *</label>
                  <input id="plan_name" name="name" required defaultValue={editingPlan?.name ?? ""} className={adminInput} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="kind" className={adminLabel}>Type</label>
                    <select id="kind" name="kind" defaultValue={editingPlan?.kind ?? "training_monthly"} className={adminInput}>
                      <option value="membership_yearly">Membership (yearly)</option>
                      <option value="training_monthly">Training fee</option>
                      <option value="grading">Grading fee</option>
                      <option value="hourly_charge">Hourly charge</option>
                      <option value="service_charge">Service Charge</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="billing_interval" className={adminLabel}>Billing interval</label>
                    <select id="billing_interval" name="billing_interval" defaultValue={editingPlan?.billing_interval ?? "monthly"} className={adminInput}>
                      <option value="yearly">Yearly</option>
                      <option value="monthly">Monthly</option>
                      <option value="bimonthly">Bi-monthly (every 2 months)</option>
                      <option value="quarterly">Quarterly (every 3 months)</option>
                      <option value="daily">Daily</option>
                      <option value="transaction">Per Transaction</option>
                      <option value="occurrence">Per Occurrence</option>
                      <option value="request">Per Request</option>
                      <option value="order">Per Order</option>
                      <option value="service">Per Service</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="amount_myr" className={adminLabel}>
                      Amount <span className="font-normal text-neutral-400">(blank = set per invoice)</span>
                    </label>
                    <input id="amount_myr" name="amount_myr" type="number" step="0.01" min="0" defaultValue={editingPlan?.amount_myr ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="currency" className={adminLabel}>Currency</label>
                    <select id="currency" name="currency" defaultValue={editingPlan?.currency ?? "MYR"} className={adminInput}>
                      {WORLD_CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="audience" className={adminLabel}>Class Audience</label>
                    <select id="audience" name="audience" defaultValue={editingPlan?.audience ?? "all"} className={adminInput}>
                      <option value="all">All</option>
                      <option value="student">Students</option>
                      <option value="adult">Adults</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className={adminLabel}>
                    Applies to <span className="font-normal text-neutral-400">(optional — competition-side roles)</span>
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {APPLIES_TO_OPTIONS.map((opt) => (
                      <label key={opt} className="flex items-center gap-2 text-sm text-neutral-700">
                        <input
                          type="checkbox"
                          name="applies_to"
                          value={opt}
                          defaultChecked={editingPlan?.applies_to?.includes(opt) ?? false}
                          className="h-4 w-4 rounded border-neutral-300 accent-red-700"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                  <input type="checkbox" name="active" defaultChecked={editingPlan?.active ?? true} className="h-4 w-4 rounded border-neutral-300 accent-red-700" />
                  Active
                </label>
                <div className="flex gap-2">
                  <button type="submit" className={adminBtn}>{editingPlan ? "Save changes" : "Create plan"}</button>
                  {editingPlan && (
                    <Link href="/admin/classes?tab=plans" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                      Cancel
                    </Link>
                  )}
                </div>
              </form>
            </Card>
          </div>
          <div>
            <h2 className="mb-3 text-lg font-bold">All Fee Plans</h2>
            <div className="space-y-3">
              {plans.map((p) => (
                <Card key={p.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-neutral-900">
                        {p.name}{" "}
                        {!p.active && <span className="text-xs font-semibold text-neutral-400">(inactive)</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-neutral-500">
                        {KIND_LABEL[p.kind] ?? p.kind} · {fmtMoney(p.amount_myr, p.currency)} ·{" "}
                        {INTERVAL_LABEL[p.billing_interval] ?? p.billing_interval} ·{" "}
                        {p.audience === "all" ? "everyone" : `${p.audience}s`}
                        {p.applies_to?.length > 0 && <> · {p.applies_to.join(", ")}</>}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Link href={`/admin/classes?tab=plans&edit=${p.id}`} className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                        Edit
                      </Link>
                      <form action={deleteFeePlan}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="rounded border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "enrollments" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-bold">Enroll A Student</h2>
            <Card>
              <form action={enrollStudent} className="space-y-4">
                <div>
                  <label htmlFor="student_id" className={adminLabel}>Student *</label>
                  <select id="student_id" name="student_id" required defaultValue="" className={adminInput}>
                    <option value="" disabled>Select student</option>
                    {students.filter((s) => s.status === "active").map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name} ({s.category})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="fee_plan_id" className={adminLabel}>Fee plan *</label>
                  <select id="fee_plan_id" name="fee_plan_id" required defaultValue="" className={adminInput}>
                    <option value="" disabled>Select plan</option>
                    {plans.filter((p) => p.active).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({KIND_LABEL[p.kind] ?? p.kind}) — {fmtMoney(p.amount_myr, p.currency)} /{" "}
                        {(INTERVAL_LABEL[p.billing_interval] ?? p.billing_interval).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="start_date" className={adminLabel}>First billing date</label>
                  <input id="start_date" name="start_date" type="date" className={adminInput} />
                </div>
                <button type="submit" className={adminBtn}>Enroll</button>
                <p className="text-xs text-neutral-400">
                  Recurring invoices are created from the Invoices tab (“Generate due invoices”) each
                  time billing comes around — yearly, monthly, bi-monthly or quarterly per plan.
                </p>
              </form>
            </Card>
          </div>
          <div>
            <h2 className="mb-3 text-lg font-bold">All Enrollments ({enrollments.length})</h2>
            {enrollments.length === 0 ? (
              <EmptyState>No enrollments yet.</EmptyState>
            ) : (
              <FilterableTable
                rowKey="id"
                downloadName="enrollments"
                columns={[
                  { key: "student", label: "Student" },
                  { key: "plan", label: "Plan" },
                  { key: "next_billing", label: "Next billing" },
                  { key: "status", label: "Status" },
                  { key: "actions", label: "Actions" },
                ]}
                csvColumns={[
                  { key: "student", label: "Student" },
                  { key: "plan", label: "Plan" },
                  { key: "next_billing", label: "Next Billing" },
                  { key: "status_text", label: "Status" },
                ]}
                rows={enrollments.map((e) => ({
                  id: e.id,
                  student: e.student?.full_name ?? "—",
                  plan: e.fee_plan?.name ?? "—",
                  next_billing: formatDate(e.next_billing_date),
                  status: (
                    <span className={e.status === "active" ? "font-semibold text-green-700" : e.status === "paused" ? "text-amber-600" : "text-neutral-400"}>
                      {e.status}
                    </span>
                  ),
                  status_text: e.status,
                  actions: (
                    <div className="flex flex-wrap gap-1.5">
                      {e.status !== "active" && (
                        <form action={updateEnrollmentStatus}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="status" value="active" />
                          <button className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-500">Activate</button>
                        </form>
                      )}
                      {e.status === "active" && (
                        <form action={updateEnrollmentStatus}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="status" value="paused" />
                          <button className="rounded bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-500">Pause</button>
                        </form>
                      )}
                      {e.status !== "cancelled" && (
                        <form action={updateEnrollmentStatus}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="status" value="cancelled" />
                          <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Cancel</button>
                        </form>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        </div>
      )}

      {tab === "invoices" && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <form action={generateDueInvoices}>
              <button className={adminBtn}>Generate due invoices</button>
            </form>
            <div className="flex gap-2 text-sm">
              {["all", "unpaid", "paid", "void"].map((s) => (
                <Link
                  key={s}
                  href={s === "all" ? "/admin/classes?tab=invoices" : `/admin/classes?tab=invoices&status=${s}`}
                  className={`rounded-full border px-3 py-1 capitalize ${
                    (s === "all" && !invoiceFilter) || s === invoiceFilter
                      ? "border-neutral-900 bg-neutral-900 font-semibold text-white"
                      : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {s}
                </Link>
              ))}
            </div>
            <span className="text-sm text-neutral-500">
              Unpaid total (shown):{" "}
              <strong>
                {unpaidByCurrency.size === 0
                  ? "0.00"
                  : [...unpaidByCurrency.entries()].map(([cur, amt]) => `${cur} ${amt.toFixed(2)}`).join(" + ")}
              </strong>
            </span>
          </div>

          <div className="grid gap-8 lg:grid-cols-3">
            <div>
              <h2 className="mb-3 text-lg font-bold">Manual Invoice</h2>
              <Card>
                <form action={createManualInvoice} className="space-y-4">
                  <div>
                    <label htmlFor="inv_student" className={adminLabel}>Student *</label>
                    <select id="inv_student" name="student_id" required defaultValue="" className={adminInput}>
                      <option value="" disabled>Select student</option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="inv_plan" className={adminLabel}>Fee plan (optional)</label>
                    <select id="inv_plan" name="fee_plan_id" defaultValue="" className={adminInput}>
                      <option value="">— None (custom) —</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({KIND_LABEL[p.kind] ?? p.kind})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="inv_desc" className={adminLabel}>Description *</label>
                    <input id="inv_desc" name="description" required className={adminInput} placeholder="e.g. Grading fee — June 2026 grading" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="inv_amount" className={adminLabel}>Amount *</label>
                      <input id="inv_amount" name="amount_myr" type="number" step="0.01" min="0.01" required className={adminInput} />
                    </div>
                    <div>
                      <label htmlFor="inv_currency" className={adminLabel}>Currency</label>
                      <select id="inv_currency" name="currency" defaultValue="MYR" className={adminInput}>
                        {WORLD_CURRENCIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="inv_due" className={adminLabel}>Due date</label>
                      <input id="inv_due" name="due_date" type="date" className={adminInput} />
                    </div>
                  </div>
                  <button type="submit" className={adminBtn}>Create invoice</button>
                  <p className="text-xs text-neutral-400">
                    Use this for grading fees (amount varies per grading) and one-off charges like uniforms.
                  </p>
                </form>
              </Card>
            </div>

            <div className="lg:col-span-2">
              <h2 className="mb-3 text-lg font-bold">Invoices ({invoices.length})</h2>
              {invoices.length === 0 ? (
                <EmptyState>
                  No invoices{invoiceFilter ? ` with status "${invoiceFilter}"` : ""} yet. Enroll students,
                  then click “Generate due invoices”.
                </EmptyState>
              ) : (
                <FilterableTable
                  rowKey="id"
                  downloadName="invoices"
                  columns={[
                    { key: "student", label: "Student" },
                    { key: "description", label: "Description" },
                    { key: "amount", label: "Amount" },
                    { key: "due", label: "Due" },
                    { key: "status", label: "Status" },
                    { key: "actions", label: "Actions" },
                  ]}
                  csvColumns={[
                    { key: "student", label: "Student" },
                    { key: "description", label: "Description" },
                    { key: "amount", label: "Amount" },
                    { key: "due", label: "Due" },
                    { key: "status_text", label: "Status" },
                  ]}
                  rows={invoices.map((inv) => ({
                    id: inv.id,
                    student: inv.student?.full_name ?? "—",
                    description: inv.description,
                    amount: `${inv.currency || "MYR"} ${Number(inv.amount_myr).toFixed(2)}`,
                    due: inv.due_date ? formatDate(inv.due_date) : "—",
                    status: (
                      <span
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${
                          inv.status === "paid"
                            ? "border-green-300 bg-green-100 text-green-800"
                            : inv.status === "void"
                              ? "border-neutral-300 bg-neutral-100 text-neutral-500"
                              : "border-amber-300 bg-amber-100 text-amber-800"
                        }`}
                      >
                        {inv.status}
                      </span>
                    ),
                    status_text: inv.status,
                    actions: (
                      <div className="flex flex-wrap gap-1.5">
                        {inv.status === "unpaid" && paymentsEnabled() && (
                          inv.checkout_url ? (
                            <a
                              href={inv.checkout_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-neutral-700"
                              title="Open the Stripe payment page — copy this link and send it to the payer"
                            >
                              Payment link ↗
                            </a>
                          ) : (
                            <form action={generateInvoicePaymentLink}>
                              <input type="hidden" name="id" value={inv.id} />
                              <button className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-neutral-700">
                                Get payment link
                              </button>
                            </form>
                          )
                        )}
                        {inv.status !== "paid" && (
                          <form action={updateInvoiceStatus}>
                            <input type="hidden" name="id" value={inv.id} />
                            <input type="hidden" name="status" value="paid" />
                            <button className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-500">
                              Mark Paid
                            </button>
                          </form>
                        )}
                        {inv.status === "paid" && (
                          <form action={updateInvoiceStatus}>
                            <input type="hidden" name="id" value={inv.id} />
                            <input type="hidden" name="status" value="unpaid" />
                            <button className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                              Set Unpaid
                            </button>
                          </form>
                        )}
                        {inv.status !== "void" && (
                          <form action={updateInvoiceStatus}>
                            <input type="hidden" name="id" value={inv.id} />
                            <input type="hidden" name="status" value="void" />
                            <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                              Void
                            </button>
                          </form>
                        )}
                      </div>
                    ),
                  }))}
                />
              )}
              <p className="mt-3 text-xs text-neutral-400">
                “Generate due invoices” bills every active enrollment whose billing date has arrived and
                schedules the next cycle (yearly / monthly / bi-monthly / quarterly). When your Stripe
                secret key is added, these invoices can be charged online automatically.
              </p>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
