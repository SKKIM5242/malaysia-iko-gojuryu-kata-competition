import { createClient } from "@/lib/supabase/server";

const COMMISSION_RATE = 0.1;
/** Schools/Senseis need MORE than this many participants to qualify for
 * any revenue share at all -- 10 or fewer gets 0%, per the organiser's
 * explicit "no revenue share for less than 10" rule. Referees have no such
 * threshold: they earn 10% of every judged student's fee regardless of count. */
const SCHOOL_SENSEI_THRESHOLD = 10;

export interface CommissionRow {
  recipientType: "school" | "sensei" | "referee";
  recipientId: string;
  name: string;
  participantCount: number;
  totalFeesUsd: number;
  commissionUsd: number;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  payoutStatus: "unpaid" | "paid";
}

/**
 * Computes School/Sensei/Referee commissions fresh from live registration
 * data every time -- nothing here is stored, so it can never drift out of
 * sync with actual paid registrations. commission_payouts only tracks
 * whether the organiser has actually paid out what this computed.
 */
export async function computeCommissions(): Promise<CommissionRow[]> {
  const supabase = await createClient();

  const [
    { data: schools },
    { data: senseis },
    { data: referees },
    { data: participants },
    { data: registrations },
    { data: competitions },
    { data: refProfiles },
    { data: assignments },
    { data: videos },
    { data: payouts },
  ] = await Promise.all([
    supabase.from("schools").select("id, name, bank_name, bank_account_no, bank_account_name"),
    supabase.from("senseis").select("id, name, bank_name, bank_account_no, bank_account_name"),
    supabase.from("referees").select("id, full_name, email, user_id, bank_name, bank_account_no, bank_account_name"),
    supabase.from("participants").select("id, school_id, sensei_id"),
    supabase.from("registrations").select("id, participant_id, competition_id, payment_status"),
    supabase.from("competitions").select("id, registration_fee_usd"),
    supabase.from("profiles").select("user_id, email").eq("role", "referee"),
    supabase.from("referee_assignments").select("video_id, referee_user_id"),
    supabase.from("kata_videos").select("id, registration_id"),
    supabase.from("commission_payouts").select("recipient_type, recipient_id, status"),
  ]);

  const feeByCompetition = new Map<string, number>(
    (competitions ?? []).map((c) => [c.id as string, Number(c.registration_fee_usd ?? 0)]),
  );
  // Only paid registrations count -- there's no commission on money the
  // organiser hasn't actually collected yet.
  const feeByRegistration = new Map<string, number>();
  for (const r of registrations ?? []) {
    if (r.payment_status !== "paid") continue;
    feeByRegistration.set(r.id as string, feeByCompetition.get(r.competition_id as string) ?? 0);
  }
  const feeByParticipant = new Map<string, number>();
  for (const r of registrations ?? []) {
    if (r.payment_status !== "paid") continue;
    const fee = feeByCompetition.get(r.competition_id as string) ?? 0;
    feeByParticipant.set(r.participant_id as string, (feeByParticipant.get(r.participant_id as string) ?? 0) + fee);
  }

  const payoutStatus = new Map<string, "unpaid" | "paid">(
    (payouts ?? []).map((p) => [`${p.recipient_type}:${p.recipient_id}`, p.status as "unpaid" | "paid"]),
  );
  const statusFor = (type: string, id: string) => payoutStatus.get(`${type}:${id}`) ?? "unpaid";

  const rows: CommissionRow[] = [];

  for (const s of schools ?? []) {
    const own = (participants ?? []).filter((p) => p.school_id === s.id);
    const totalFees = own.reduce((sum, p) => sum + (feeByParticipant.get(p.id as string) ?? 0), 0);
    const qualifies = own.length > SCHOOL_SENSEI_THRESHOLD;
    rows.push({
      recipientType: "school", recipientId: s.id as string, name: s.name as string,
      participantCount: own.length, totalFeesUsd: totalFees,
      commissionUsd: qualifies ? totalFees * COMMISSION_RATE : 0,
      bankName: s.bank_name as string | null, bankAccountNo: s.bank_account_no as string | null,
      bankAccountName: s.bank_account_name as string | null,
      payoutStatus: statusFor("school", s.id as string),
    });
  }

  for (const s of senseis ?? []) {
    const own = (participants ?? []).filter((p) => p.sensei_id === s.id);
    const totalFees = own.reduce((sum, p) => sum + (feeByParticipant.get(p.id as string) ?? 0), 0);
    const qualifies = own.length > SCHOOL_SENSEI_THRESHOLD;
    rows.push({
      recipientType: "sensei", recipientId: s.id as string, name: s.name as string,
      participantCount: own.length, totalFeesUsd: totalFees,
      commissionUsd: qualifies ? totalFees * COMMISSION_RATE : 0,
      bankName: s.bank_name as string | null, bankAccountNo: s.bank_account_no as string | null,
      bankAccountName: s.bank_account_name as string | null,
      payoutStatus: statusFor("sensei", s.id as string),
    });
  }

  // referees.user_id is the real link now (migration 0040, kept in sync by
  // handle_new_user going forward) -- email match only covers the rare case
  // where that backfill/trigger hasn't linked a row yet.
  const userIdByEmail = new Map<string, string>(
    (refProfiles ?? []).map((p) => [String(p.email ?? "").toLowerCase(), p.user_id as string]),
  );
  const registrationIdByVideo = new Map<string, string>(
    (videos ?? []).map((v) => [v.id as string, v.registration_id as string]),
  );
  const judgedRegistrationsByUser = new Map<string, Set<string>>();
  for (const a of assignments ?? []) {
    const regId = registrationIdByVideo.get(a.video_id as string);
    if (!regId) continue;
    const uid = a.referee_user_id as string;
    if (!judgedRegistrationsByUser.has(uid)) judgedRegistrationsByUser.set(uid, new Set());
    judgedRegistrationsByUser.get(uid)!.add(regId);
  }

  for (const r of referees ?? []) {
    const uid = (r.user_id as string | null) ?? userIdByEmail.get(String(r.email ?? "").toLowerCase());
    const judgedRegIds = uid ? judgedRegistrationsByUser.get(uid) ?? new Set<string>() : new Set<string>();
    const totalFees = [...judgedRegIds].reduce((sum, regId) => sum + (feeByRegistration.get(regId) ?? 0), 0);
    rows.push({
      recipientType: "referee", recipientId: r.id as string, name: r.full_name as string,
      participantCount: judgedRegIds.size, totalFeesUsd: totalFees,
      commissionUsd: totalFees * COMMISSION_RATE,
      bankName: r.bank_name as string | null, bankAccountNo: r.bank_account_no as string | null,
      bankAccountName: r.bank_account_name as string | null,
      payoutStatus: statusFor("referee", r.id as string),
    });
  }

  return rows.sort((a, b) => b.commissionUsd - a.commissionUsd);
}
