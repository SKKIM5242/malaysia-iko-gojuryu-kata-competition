import { createClient } from "@/lib/supabase/server";

export interface TierPrizeRow {
  competitionId: string;
  competitionName: string;
  firstPlaceUsd: number;
  secondPlaceUsd: number;
  thirdPlaceUsd: number;
}

/**
 * Top-3 prize amounts per tier, as a real setting the organizer controls
 * directly -- not parsed from the tier's own announcement text, which is
 * free-form marketing copy that can be reworded at any time. Every
 * competition gets a row here (defaulting to $0 until the organizer sets
 * it), so this always has one entry per tier even before any prize is set.
 */
export async function getTierPrizes(): Promise<TierPrizeRow[]> {
  const supabase = await createClient();
  const [{ data: comps }, { data: prizes }] = await Promise.all([
    supabase.from("competitions").select("id, name, registration_fee_usd").order("registration_fee_usd", { ascending: true }),
    supabase.from("tier_prizes").select("competition_id, first_place_usd, second_place_usd, third_place_usd"),
  ]);
  const prizeByComp = new Map(
    (prizes ?? []).map((p) => [
      p.competition_id as string,
      {
        first: Number(p.first_place_usd ?? 0),
        second: Number(p.second_place_usd ?? 0),
        third: Number(p.third_place_usd ?? 0),
      },
    ]),
  );
  return (comps ?? []).map((c) => {
    const p = prizeByComp.get(c.id as string);
    return {
      competitionId: c.id as string,
      competitionName: c.name as string,
      firstPlaceUsd: p?.first ?? 0,
      secondPlaceUsd: p?.second ?? 0,
      thirdPlaceUsd: p?.third ?? 0,
    };
  });
}
