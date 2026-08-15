import { KATA_FAMILIES } from "@/lib/kata-families";
import { KATA_FAMILY_BELT_GROUP_OPTIONS } from "@/lib/reference-data";
import { saveRefereeKataFamilies } from "@/app/actions/admin";

/** The 5-family x 3-belt eligibility grid, shared between the Judges page
 * (full detail panel) and the Judging page's Workload table (inline, one
 * per row) so both edit the exact same fields the exact same way -- no
 * separate "family only, edit narrowing elsewhere" cut-down version. */
export default function JudgeKataFamiliesForm({
  refereeId,
  kataFamilies,
  kataFamilyBeltGroups,
  returnTo,
}: {
  refereeId: string;
  kataFamilies: string[] | null;
  kataFamilyBeltGroups: string[] | null;
  returnTo: string;
}) {
  const families = kataFamilies ?? [];
  const beltGroups = kataFamilyBeltGroups ?? [];
  return (
    <form action={saveRefereeKataFamilies} className="space-y-2">
      <input type="hidden" name="id" value={refereeId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <div className="space-y-2">
        {KATA_FAMILIES.map((f) => (
          <div key={f} className="rounded border border-neutral-200 bg-white p-2">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <input type="checkbox" name="kata_families" value={f} defaultChecked={families.includes(f)} />
              {f}
            </label>
            <div className="mt-1 ml-5 flex flex-wrap gap-3">
              {KATA_FAMILY_BELT_GROUP_OPTIONS.map((b) => (
                <label key={b.key} className="flex items-center gap-1 text-xs text-neutral-500">
                  <input
                    type="checkbox" name="kata_family_belt_groups" value={`${f}:${b.key}`}
                    defaultChecked={beltGroups.includes(`${f}:${b.key}`)}
                  />
                  {b.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        type="submit"
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        Save kata families
      </button>
    </form>
  );
}
