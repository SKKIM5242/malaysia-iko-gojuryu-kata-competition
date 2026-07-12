import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import {
  saveStudent, deleteStudent, saveFeePlan, enrollStudent,
  updateEnrollmentStatus, generateDueInvoices, createManualInvoice, updateInvoiceStatus,
} from "@/app/actions/classes";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import type { ClassEnrollment, ClassInvoice, FeePlan, Student } from "@/lib/types";

export const dynamic = "force-dynamic";

const TABS = [
  ["students", "Students"],
  ["plans", "Fee plans"],
  ["enrollments", "Enrollments"],
  ["invoices", "Invoices"],
] as const;

function fmtRM(n: number | null | undefined): string {
  return n == null ? "set per invoice" : `RM ${Number(n).toFixed(2)}`;
}

const INTERVAL_LABEL: Record<string, string> = {
  yearly: "Yearly",
  monthly: "Monthly",
  bimonthly: "Bi-monthly",
  quarterly: "Quarterly",
};

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
      <AdminShell title="Class billing" active="/admin/classes">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
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
      .select("*, student:students(id, full_name, category), fee_plan:fee_plans(id, name, amount_myr, billing_interval)")
      .order("created_at", { ascending: false });
    enrollments = (data as unknown as ClassEnrollment[]) ?? [];
  }

  let invoices: ClassInvoice[] = [];
  const invoiceFilter = ["unpaid", "paid", "void"].includes(params.status ?? "") ? params.status : undefined;
  if (tab === "invoices") {
    let q = supabase
      .from("class_invoices")
      .select("*, student:students(id, full_name, phone), fee_plan:fee_plans(id, name)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (invoiceFilter) q = q.eq("status", invoiceFilter);
    const { data } = await q;
    invoices = (data as unknown as ClassInvoice[]) ?? [];
  }

  const editingStudent = tab === "students" && params.edit ? students.find((s) => s.id === params.edit) : undefined;
  const editingPlan = tab === "plans" && params.edit ? plans.find((p) => p.id === params.edit) : undefined;
  const unpaidTotal = invoices.filter((i) => i.status === "unpaid").reduce((s, i) => s + Number(i.amount_myr), 0);

  return (
    <AdminShell title="Class billing" active="/admin/classes" flash={{ ok: params.ok, error: params.error }}>
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

      {tab === "students" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-bold">{editingStudent ? "Edit student" : "Add student"}</h2>
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
            <h2 className="mb-3 text-lg font-bold">All students ({students.length})</h2>
            {students.length === 0 ? (
              <EmptyState>No students yet — add your first student on the left.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {students.map((s) => (
                      <tr key={s.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium">{s.full_name}</td>
                        <td className="px-4 py-3 capitalize">{s.category}</td>
                        <td className="px-4 py-3">
                          <span className={s.status === "active" ? "font-semibold text-green-700" : "text-neutral-400"}>
                            {s.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {s.email ?? "—"}
                          {s.phone && <span className="block text-neutral-500">{s.phone}</span>}
                        </td>
                        <td className="px-4 py-3">
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "plans" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-bold">{editingPlan ? "Edit fee plan" : "New fee plan"}</h2>
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
                    </select>
                  </div>
                  <div>
                    <label htmlFor="billing_interval" className={adminLabel}>Billing interval</label>
                    <select id="billing_interval" name="billing_interval" defaultValue={editingPlan?.billing_interval ?? "monthly"} className={adminInput}>
                      <option value="yearly">Yearly</option>
                      <option value="monthly">Monthly</option>
                      <option value="bimonthly">Bi-monthly (every 2 months)</option>
                      <option value="quarterly">Quarterly (every 3 months)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="amount_myr" className={adminLabel}>
                      Amount (RM) <span className="font-normal text-neutral-400">(blank = set per invoice)</span>
                    </label>
                    <input id="amount_myr" name="amount_myr" type="number" step="0.01" min="0" defaultValue={editingPlan?.amount_myr ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="audience" className={adminLabel}>Applies to</label>
                    <select id="audience" name="audience" defaultValue={editingPlan?.audience ?? "all"} className={adminInput}>
                      <option value="all">All</option>
                      <option value="student">Students</option>
                      <option value="adult">Adults</option>
                    </select>
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
            <h2 className="mb-3 text-lg font-bold">All fee plans</h2>
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
                        {fmtRM(p.amount_myr)} · {INTERVAL_LABEL[p.billing_interval]} · {p.audience === "all" ? "everyone" : `${p.audience}s`}
                      </p>
                    </div>
                    <Link href={`/admin/classes?tab=plans&edit=${p.id}`} className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                      Edit
                    </Link>
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
            <h2 className="mb-3 text-lg font-bold">Enroll a student</h2>
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
                        {p.name} — {fmtRM(p.amount_myr)} / {INTERVAL_LABEL[p.billing_interval].toLowerCase()}
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
            <h2 className="mb-3 text-lg font-bold">All enrollments ({enrollments.length})</h2>
            {enrollments.length === 0 ? (
              <EmptyState>No enrollments yet.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Next billing</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {enrollments.map((e) => (
                      <tr key={e.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium">{e.student?.full_name ?? "—"}</td>
                        <td className="px-4 py-3 text-xs">{e.fee_plan?.name ?? "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(e.next_billing_date)}</td>
                        <td className="px-4 py-3">
                          <span className={e.status === "active" ? "font-semibold text-green-700" : e.status === "paused" ? "text-amber-600" : "text-neutral-400"}>
                            {e.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              Unpaid total (shown): <strong>RM {unpaidTotal.toFixed(2)}</strong>
            </span>
          </div>

          <div className="grid gap-8 lg:grid-cols-3">
            <div>
              <h2 className="mb-3 text-lg font-bold">Manual invoice</h2>
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
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="inv_desc" className={adminLabel}>Description *</label>
                    <input id="inv_desc" name="description" required className={adminInput} placeholder="e.g. Grading fee — June 2026 grading" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="inv_amount" className={adminLabel}>Amount (RM) *</label>
                      <input id="inv_amount" name="amount_myr" type="number" step="0.01" min="0.01" required className={adminInput} />
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
                <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-4 py-3">Student</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Due</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-neutral-50">
                          <td className="px-4 py-3 font-medium">{inv.student?.full_name ?? "—"}</td>
                          <td className="max-w-[260px] truncate px-4 py-3 text-xs" title={inv.description}>{inv.description}</td>
                          <td className="px-4 py-3 whitespace-nowrap">RM {Number(inv.amount_myr).toFixed(2)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs">{inv.due_date ? formatDate(inv.due_date) : "—"}</td>
                          <td className="px-4 py-3">
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
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
