import { createClient } from "@/lib/supabase/server";
import { COMMISSION_ENTRY_THRESHOLD } from "@/lib/tier-entries";

const COMMISSION_RATE = 0.1;
/** Schools/Senseis qualify PER COMPETITION TIER: more than this many paid
 * ENTRIES (kata events) by their students within a single tier earns 10% of
 * that tier's fees. A tier with 10 or fewer entries earns nothing, even if
 * another tier qualifies — the organizer's rule is "more than 10 events per
 * competition Tier", so both the test and the payout are per-tier.
 *
 * Referees have no threshold: they earn 10% of every judged student's fee
 * regardless of count, and are not tier-scoped. */
const SCHOOL_SENSEI_THRESHOLD = COMMISSION_ENTRY_THRESHOLD;

export interface CommissionTierSplit {
  competitionId: string;
  /** Paid entries (kata events) this recipient's students hold in this tier. */
  entryCount: number;
  feesUsd: number;
  /** entryCount > SCHOOL_SENSEI_THRESHOLD — this tier pays on its own. */
  qualifies: boolean;
}

export interface CommissionRow {
  recipientType: "school" | "sensei" | "referee";
  recipientId: string;
  name: string;
  /** Distinct students, for context. NOT what qualification is tested on. */
  participantCount: number;
  /** Paid entries (kata events) — the unit the commission rule is written in. */
  entryCount: number;
  totalFeesUsd: number;
  /** Fees from qualifying tiers only — the base the 10% is taken from. */
  qualifyingFeesUsd: number;
  commissionUsd: number;
  /** Per-tier breakdown, tiers with no entries omitted. Empty for referees,
   * whose commission is not tier-scoped. */
  tiers: CommissionTierSplit[];
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  payoutStatus: "unpaid" | "paid";
  receiptPath: string | null;
}

/**
 * Computes School/Sensei/Referee commissions fresh from live registration
 * data every time -- nothing here is stored, so it can never drift out of
 * sync with actual paid registrations. commission_payouts only tracks
 * whether the organizer has actually paid out what this computed.
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
    supabase.from("commission_payouts").select("recipient_type, recipient_id, status, receipt_path"),
  ]);

  const feeByCompetition = new Map<string, number>(
    (competitions ?? []).map((c) => [c.id as string, Number(c.registration_fee_usd ?? 0)]),
  );
  // Only paid registrations count -- there's no commission on money the
  // organizer hasn't actually collected yet.
  const feeByRegistration = new Map<string, number>();
  for (const r of registrations ?? []) {
    if (r.payment_status !== "paid") continue;
    feeByRegistration.set(r.id as string, feeByCompetition.get(r.competition_id as string) ?? 0);
  }
  // Paid entries grouped by participant AND tier — the commission rule is
  // "more than 10 events per competition Tier", so a flat per-participant
  // total can't answer it.
  const entriesByParticipantTier = new Map<string, Map<string, { entries: number; fees: number }>>();
  for (const r of registrations ?? []) {
    if (r.payment_status !== "paid") continue;
    const pid = r.participant_id as string;
    const cid = r.competition_id as string;
    if (!pid || !cid) continue;
    const fee = feeByCompetition.get(cid) ?? 0;
    let byTier = entriesByParticipantTier.get(pid);
    if (!byTier) {
      byTier = new Map();
      entriesByParticipantTier.set(pid, byTier);
    }
    const cur = byTier.get(cid) ?? { entries: 0, fees: 0 };
    cur.entries += 1;
    cur.fees += fee;
    byTier.set(cid, cur);
  }

  // Cheapest tier first, so the breakdown always reads USD 10 -> 100 -> 200
  // rather than in whatever order the rows came back.
  const competitionOrder = [...(competitions ?? [])]
    .sort((a, b) => Number(a.registration_fee_usd ?? 0) - Number(b.registration_fee_usd ?? 0))
    .map((c) => c.id as string);

  /** Rolls a school's or sensei's students up into per-tier entry counts and
   * fees, then applies the threshold tier by tier. */
  function tierRollup(ownParticipantIds: string[]): {
    tiers: CommissionTierSplit[];
    entryCount: number;
    totalFees: number;
    qualifyingFees: number;
  } {
    const perTier = new Map<string, { entries: number; fees: number }>();
    for (const pid of ownParticipantIds) {
      for (const [cid, v] of entriesByParticipantTier.get(pid) ?? []) {
        const cur = perTier.get(cid) ?? { entries: 0, fees: 0 };
        cur.entries += v.entries;
        cur.fees += v.fees;
        perTier.set(cid, cur);
      }
    }
    const tiers: CommissionTierSplit[] = [];
    let entryCount = 0;
    let totalFees = 0;
    let qualifyingFees = 0;
    for (const cid of competitionOrder) {
      const v = perTier.get(cid);
      if (!v || v.entries === 0) continue;
      const qualifies = v.entries > SCHOOL_SENSEI_THRESHOLD;
      tiers.push({ competitionId: cid, entryCount: v.entries, feesUsd: v.fees, qualifies });
      entryCount += v.entries;
      totalFees += v.fees;
      if (qualifies) qualifyingFees += v.fees;
    }
    return { tiers, entryCount, totalFees, qualifyingFees };
  }

  const payoutStatus = new Map<string, "unpaid" | "paid">(
    (payouts ?? []).map((p) => [`${p.recipient_type}:${p.recipient_id}`, p.status as "unpaid" | "paid"]),
  );
  const statusFor = (type: string, id: string) => payoutStatus.get(`${type}:${id}`) ?? "unpaid";
  const receiptPath = new Map<string, string | null>(
    (payouts ?? []).map((p) => [`${p.recipient_type}:${p.recipient_id}`, p.receipt_path as string | null]),
  );
  const receiptFor = (type: string, id: string) => receiptPath.get(`${type}:${id}`) ?? null;

  const rows: CommissionRow[] = [];

  for (const s of schools ?? []) {
    const own = (participants ?? []).filter((p) => p.school_id === s.id);
    const roll = tierRollup(own.map((p) => p.id as string));
    rows.push({
      recipientType: "school", recipientId: s.id as string, name: s.name as string,
      participantCount: own.length, entryCount: roll.entryCount,
      totalFeesUsd: roll.totalFees, qualifyingFeesUsd: roll.qualifyingFees,
      commissionUsd: roll.qualifyingFees * COMMISSION_RATE,
      tiers: roll.tiers,
      bankName: s.bank_name as string | null, bankAccountNo: s.bank_account_no as string | null,
      bankAccountName: s.bank_account_name as string | null,
      payoutStatus: statusFor("school", s.id as string),
      receiptPath: receiptFor("school", s.id as string),
    });
  }

  for (const s of senseis ?? []) {
    const own = (participants ?? []).filter((p) => p.sensei_id === s.id);
    const roll = tierRollup(own.map((p) => p.id as string));
    rows.push({
      recipientType: "sensei", recipientId: s.id as string, name: s.name as string,
      participantCount: own.length, entryCount: roll.entryCount,
      totalFeesUsd: roll.totalFees, qualifyingFeesUsd: roll.qualifyingFees,
      commissionUsd: roll.qualifyingFees * COMMISSION_RATE,
      tiers: roll.tiers,
      bankName: s.bank_name as string | null, bankAccountNo: s.bank_account_no as string | null,
      bankAccountName: s.bank_account_name as string | null,
      payoutStatus: statusFor("sensei", s.id as string),
      receiptPath: receiptFor("sensei", s.id as string),
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
      // A referee's unit is the judged entry, not the student — one entry per
      // registration judged, so the two counts are the same here.
      participantCount: judgedRegIds.size, entryCount: judgedRegIds.size,
      totalFeesUsd: totalFees, qualifyingFeesUsd: totalFees,
      commissionUsd: totalFees * COMMISSION_RATE,
      tiers: [],
      bankName: r.bank_name as string | null, bankAccountNo: r.bank_account_no as string | null,
      bankAccountName: r.bank_account_name as string | null,
      payoutStatus: statusFor("referee", r.id as string),
      receiptPath: receiptFor("referee", r.id as string),
    });
  }

  return rows.sort((a, b) => b.commissionUsd - a.commissionUsd);
}
