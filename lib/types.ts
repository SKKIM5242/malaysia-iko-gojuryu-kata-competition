export type PaymentStatus = "pending" | "paid" | "rejected";
export type CompetitionStatus = "draft" | "open" | "closed" | "completed";

export interface Competition {
  id: string;
  user_id: string | null;
  name: string;
  venue: string | null;
  event_date: string | null;
  registration_deadline: string | null;
  registration_fee_usd: number | null;
  status: CompetitionStatus;
  description: string | null;
  judges_required: number;
  created_at: string;
}

export interface School {
  id: string;
  user_id: string | null;
  name: string;
  state: string | null;
  /** Person in-charge / chief instructor of the school. */
  contact_title: string | null;
  contact_name: string | null;
  contact_karate_title: string | null;
  contact_rank: string | null;
  gender: string | null;
  home_address: string | null;
  home_country: string | null;
  city_town: string | null;
  postcode: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  invitation_code: string | null;
  created_at: string;
}

export interface Sensei {
  id: string;
  user_id: string | null;
  name: string;
  ic_passport: string | null;
  date_of_birth: string | null;
  rank: string | null;
  gender: string | null;
  school_id: string | null;
  home_address: string | null;
  home_country: string | null;
  city_town: string | null;
  postcode: string | null;
  certificate_path: string | null;
  registered_by: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  invitation_code: string | null;
  created_at: string;
  school?: Pick<School, "id" | "name"> | null;
}

export interface Category {
  id: string;
  competition_id: string | null;
  name: string;
  age_min: number | null;
  age_max: number | null;
  belt_group: string | null;
  gender: string | null;
  sort_order: number;
  max_participants: number | null;
  created_at: string;
}

export interface BankDetails {
  id: string;
  participant_id: string;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  created_at: string;
}

export interface Participant {
  id: string;
  user_id: string | null;
  full_name: string;
  ic_passport: string;
  date_of_birth: string | null;
  gender: string | null;
  belt_rank: string | null;
  home_address: string | null;
  home_country: string | null;
  city_town: string | null;
  postcode: string | null;
  certificate_path: string | null;
  rank_confirmation: string | null;
  email: string | null;
  phone: string | null;
  school_id: string | null;
  sensei_id: string | null;
  invitation_code: string | null;
  created_at: string;
  school?: Pick<School, "id" | "name" | "state"> | null;
  sensei?: Pick<Sensei, "id" | "name" | "rank"> | null;
  bank?: Pick<BankDetails, "bank_name" | "bank_account_no" | "bank_account_name"> | null;
}

export interface Registration {
  id: string;
  user_id: string | null;
  competition_id: string | null;
  participant_id: string | null;
  category_id: string | null;
  division: string | null;
  payment_status: PaymentStatus;
  payment_reference: string | null;
  notes: string | null;
  created_at: string;
  participant?: Participant | null;
  category?: Pick<Category, "id" | "name"> | null;
  competition?: Pick<Competition, "id" | "name"> | null;
}

export interface Announcement {
  id: string;
  user_id: string | null;
  competition_id: string | null;
  title: string;
  body: string | null;
  published: boolean;
  sort_order: number;
  created_at: string;
}

export interface Student {
  id: string;
  full_name: string;
  ic_passport: string | null;
  date_of_birth: string | null;
  gender: string | null;
  category: "student" | "adult";
  email: string | null;
  phone: string | null;
  home_address: string | null;
  city_town: string | null;
  home_country: string | null;
  join_date: string | null;
  status: "active" | "inactive";
  notes: string | null;
  created_at: string;
}

export interface FeePlan {
  id: string;
  name: string;
  kind: "membership_yearly" | "training_monthly" | "grading";
  amount_myr: number | null;
  billing_interval: "yearly" | "monthly" | "bimonthly" | "quarterly";
  audience: "student" | "adult" | "all";
  active: boolean;
  created_at: string;
}

export interface ClassEnrollment {
  id: string;
  student_id: string;
  fee_plan_id: string;
  start_date: string;
  next_billing_date: string;
  status: "active" | "paused" | "cancelled";
  created_at: string;
  student?: Pick<Student, "id" | "full_name" | "category"> | null;
  fee_plan?: Pick<FeePlan, "id" | "name" | "amount_myr" | "billing_interval"> | null;
}

export interface ClassInvoice {
  id: string;
  student_id: string;
  fee_plan_id: string | null;
  description: string;
  amount_myr: number;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  status: "unpaid" | "paid" | "void";
  payment_reference: string | null;
  stripe_invoice_id: string | null;
  checkout_url: string | null;
  created_at: string;
  student?: Pick<Student, "id" | "full_name" | "phone"> | null;
  fee_plan?: Pick<FeePlan, "id" | "name"> | null;
}

export interface AuditLog {
  id: string;
  table_name: string | null;
  record_id: string | null;
  action: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_id: string | null;
  created_at: string;
}
