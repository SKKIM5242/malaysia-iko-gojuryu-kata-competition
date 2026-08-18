import { setJudgesPublished } from "@/app/actions/admin";
import { KATA_FAMILIES } from "@/lib/kata-families";
import type { ConfirmedJudge } from "@/lib/data";
import type { Competition } from "@/lib/types";
import JudgeCard from "@/components/JudgeCard";

/** Small inline Publish/Unpublish toggle -- only ever rendered for
 * Admin/Organizer/Staff (see canPublish below); the underlying
 * setJudgesPublished action enforces the same tier server-side regardless
 * of what this hides. */
function PublishToggle({
  competitionId,
  published,
  returnTo,
}: {
  competitionId: string;
  published: boolean;
  returnTo: string;
}) {
  return (
    <form action={setJudgesPublished} className="inline">
      <input type="hidden" name="competition_id" value={competitionId} />
      <input type="hidden" name="value" value={published ? "false" : "true"} />
      <input type="hidden" name="return_to" value={returnTo} />
      <button
        type="submit"
        className={`rounded border px-3 py-1 text-xs font-semibold ${
          published
            ? "border-red-300 bg-white text-red-700 hover:bg-red-50"
            : "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700"
        }`}
      >
        {published ? "Unpublish Judge Confirmed" : "Publish Judge Confirmed"}
      </button>
    </form>
  );
}

/**
 * "Confirmed Judges" -- one block per competition tier, each broken into 5
 * kata-family boxes. Gated per tier by `judges_published` (see
 * setJudgesPublished): Admin/Organizer/Staff see every tier regardless of
 * publish state, with a toggle button; everyone else only sees tiers that
 * have actually been published, and if none have, this renders nothing at
 * all -- no heading, no empty box.
 */
export default function ConfirmedJudgesSection({
  judges,
  tiers,
  canPublish,
}: {
  judges: ConfirmedJudge[];
  tiers: Competition[];
  canPublish: boolean;
}) {
  const visibleTiers = canPublish ? tiers : tiers.filter((t) => t.judges_published);
  if (visibleTiers.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-2xl font-bold tracking-tight">Confirmed Judges</h2>
      <p className="mt-1 text-sm text-neutral-500">Approved judges, grouped by the kata families they're in charge of.</p>
      <div className="mt-6 space-y-10">
        {visibleTiers.map((tier) => {
          const tierJudges = judges.filter((j) => j.tierIds.includes(tier.id));
          return (
            <div key={tier.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2">
                <h3 className="text-lg font-bold">{tier.name}</h3>
                {canPublish && (
                  <PublishToggle competitionId={tier.id} published={tier.judges_published} returnTo="/participants" />
                )}
              </div>
              {tierJudges.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-400">No approved judges for this tier yet.</p>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  {KATA_FAMILIES.map((family) => {
                    const familyJudges = tierJudges.filter(
                      (j) => j.kataFamilies.length === 0 || j.kataFamilies.includes(family),
                    );
                    return (
                      <div key={family} className="rounded-lg border border-neutral-200 p-3">
                        <p className="mb-2 text-sm font-bold text-neutral-900">{family}</p>
                        {familyJudges.length === 0 ? (
                          <p className="text-xs text-neutral-400">No judges assigned yet.</p>
                        ) : (
                          <div className="space-y-3">
                            {familyJudges.map((j) => (
                              <JudgeCard key={j.id} judge={j} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
