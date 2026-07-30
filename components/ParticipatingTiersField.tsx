import { shortTierName } from "@/lib/invitation-codes";

/** "Which competition tier(s) will you have participants in?" — one tick box
 * per open tier, on both the public and admin School / Sensei forms so the
 * two stay identical.
 *
 * All boxes share the name `participating_tier_ids`, so the server action
 * reads them with formData.getAll() and stores the checked ids as an array.
 *
 * This is declared intent captured at registration time, before any student
 * has actually entered. Commission is still computed from real paid
 * registrations — see the note rendered below the boxes, which says so
 * plainly so nobody assumes ticking a box earns them anything. */
export default function ParticipatingTiersField({
  competitions,
  selected,
  idPrefix = "",
  who = "school",
}: {
  competitions: Array<{ id: string; name: string }>;
  selected?: string[] | null;
  idPrefix?: string;
  who?: "school" | "sensei";
}) {
  const chosen = new Set(selected ?? []);
  return (
    <div className="sm:col-span-2">
      <p className="mb-1 block text-sm font-medium text-neutral-700">
        Competition tier(s) you will have participants in
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {competitions.map((c) => {
          const id = `${idPrefix}tier_${c.id}`;
          return (
            <label key={c.id} htmlFor={id} className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                id={id}
                name="participating_tier_ids"
                type="checkbox"
                value={c.id}
                defaultChecked={chosen.has(c.id)}
                className="h-4 w-4 rounded border-neutral-300 accent-red-700"
              />
              {shortTierName(c.name)}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        Tick every tier you expect to enter students in — you can tick more than one, and this can be
        changed later. This tells the organizer which tiers to expect you in; it does not register
        anyone by itself, and it does not decide commission. Commission is worked out from your{" "}
        {who === "school" ? "school&apos;s" : "own"} students&apos; actual paid entries.
      </p>
    </div>
  );
}
