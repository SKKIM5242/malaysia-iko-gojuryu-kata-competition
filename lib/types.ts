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
  created_at: string;
}

export interface School {
  id: string;
  user_id: string | null;
  name: string;
  state: string | null;
  affiliation_code: string | null;
  created_at: string;
}

export interface Sensei {
  id: string;
  user_id: string | null;
  name: string;
  rank: string | null;
  school_id: string | null;
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
  school_id: string | null;
  sensei_id: string | null;
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
