import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady, getCategories } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { loadRecordingsByCategory } from "@/lib/arena";
import { groupByFamily, adjacentKataOf, familyOfGroup, isKataFamily } from "@/lib/kata-families";
import KataFamilyControl from "@/components/KataFamilyControl";
import KataOrderControl from "@/components/KataOrderControl";
import { kataBaseOf } from "@/lib/division";
import KataGroupDragZone from "@/components/KataGroupDragZone";
import SubcategoryDragZone from "@/components/SubcategoryDragZone";
import CategoryActionButton from "@/components/CategoryActionButton";
import { AddKataForm, RenameKataControl } from "@/components/KataAdminControls";
import { NoTranslate, SetupNotice } from "@/components/ui";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import AuthForms from "@/components/AuthForms";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kata Categories" };

const PRIVILEGED_ROLES = ["admin", "organizer", "staff", "customer_support", "referee", "audience"];

interface ProfileRow {
  role: string;
  approved: boolean;
}

export default async function KataCategoriesPage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <SetupNotice />
        </main>
        <SiteFooter />
      </>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Kata Categories</h1>
          <p className="mb-8 text-sm text-neutral-500">
            Sign in as Admin/Organizer, Judge, Audience, or Participant Support to browse every
            submitted recording sorted by kata category, with live slot counts. View only.
          </p>
          <AuthForms />
        </main>
        <SiteFooter />
      </>
    );
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, approved")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileData as ProfileRow | null;

  if (!profile || !profile.approved || !PRIVILEGED_ROLES.includes(profile.role)) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Categories</h1>
          <p className="mt-2 text-sm text-neutral-500">
            This page is for Admin/Organizer, Judge, Audience, and Participant Support accounts
            only.{" "}
            <Link href="/kata-arena" className="underline">
              Go to Kata Arena
            </Link>{" "}
            to watch your own recordings instead.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const competitions = await getAllCompetitions();
  // Viewing this page is open to every PRIVILEGED_ROLES member above, but
  // reordering the actual category structure is a bigger capability —
  // limited to the same admin tier that can already edit categories on the
  // Competitions page. Referee/Audience/Support keep view-only access.
  const canManageKata = ["admin", "organizer", "staff"].includes(profile.role);

  // Same "Undo last merge (N)" / "Undo delete (N)" stack as the admin
  // Competitions page, mirrored here so organizers don't have to leave this
  // page to undo something they just did from it. See that page for the
  // full reasoning on how these counts are computed.
  const mergeStatsByCompetition = new Map<string, { count: number; description: string | null }>();
  const deleteStatsByCompetition = new Map<string, { count: number; description: string | null }>();
  if (canManageKata) {
    const [{ data: mergeLogRows }, { data: deleteLogRows }] = await Promise.all([
      supabase
        .from("category_merge_log")
        .select("competition_id, description, created_at")
        .is("undone_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("category_delete_log")
        .select("competition_id, category, created_at")
        .is("undone_at", null)
        .order("created_at", { ascending: false }),
    ]);
    for (const row of (mergeLogRows as Array<{ competition_id: string; description: string | null }>) ?? []) {
      const existing = mergeStatsByCompetition.get(row.competition_id);
      if (existing) existing.count += 1;
      else mergeStatsByCompetition.set(row.competition_id, { count: 1, description: row.description });
    }
    for (const row of (deleteLogRows as Array<{ competition_id: string; category: { name?: string } | null }>) ?? []) {
      const existing = deleteStatsByCompetition.get(row.competition_id);
      if (existing) existing.count += 1;
      else {
        deleteStatsByCompetition.set(row.competition_id, {
          count: 1,
          description: row.category?.name ? `Restore "${row.category.name}"` : null,
        });
      }
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Kata Categories</h1>
        <p className="mt-1 mb-8 text-sm text-neutral-500">
          Every kata event&apos;s 16 sub-categories, in order, with live slot counts and every
          submitted recording. {canManageKata ? "Drag the grip (⠿) next to a kata event to reorder it." : "View only."}
        </p>
        {competitions.length === 0 ? (
          <p className="text-sm text-neutral-400">No competitions yet.</p>
        ) : (
          await Promise.all(
            competitions.map(async (competition) => {
              const [cats, recordingsByCategory] = await Promise.all([
                getCategories(competition.id),
                loadRecordingsByCategory(supabase, competition.id),
              ]);
              const categoryTaken = new Map<string, number>();
              if (cats.length > 0) {
                const { data: counts } = await supabase.rpc("category_paid_counts", {
                  p_category_ids: cats.map((c: Category) => c.id),
                });
                for (const row of (counts as Array<{ category_id: string; cnt: number }>) ?? []) {
                  categoryTaken.set(row.category_id, row.cnt);
                }
              }

              return (
                <div key={competition.id} className="mb-12">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-bold">{competition.name}</h2>
                    {canManageKata && (
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/competitions?addcat=${competition.id}`}
                          className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                        >
                          + Add category
                        </Link>
                        <AddKataForm competitionId={competition.id} returnTo="/kata-categories" />
                        <CategoryActionButton
                          actionName="undoMerge"
                          fields={{ competition_id: competition.id, return_to: "/kata-categories" }}
                          className={
                            (mergeStatsByCompetition.get(competition.id)?.count ?? 0) > 0
                              ? "rounded border border-orange-300 px-2 py-0.5 text-xs font-semibold text-orange-700 hover:bg-orange-50"
                              : "rounded border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-400 hover:bg-neutral-50"
                          }
                          title={
                            mergeStatsByCompetition.get(competition.id)?.description ??
                            "No merge has been done for this tier yet — nothing to undo."
                          }
                          confirmMessage={
                            (mergeStatsByCompetition.get(competition.id)?.count ?? 0) > 0
                              ? `Undo the most recent merge for this tier?\n\n${mergeStatsByCompetition.get(competition.id)?.description ?? ""}\n\nThis restores the categories it combined and moves registrations back to where they were. Click again afterward to step back one merge further, if more than one was done.`
                              : undefined
                          }
                        >
                          ↺ Undo last merge ({mergeStatsByCompetition.get(competition.id)?.count ?? 0})
                        </CategoryActionButton>
                        <CategoryActionButton
                          actionName="undoDelete"
                          fields={{ competition_id: competition.id, return_to: "/kata-categories" }}
                          className={
                            (deleteStatsByCompetition.get(competition.id)?.count ?? 0) > 0
                              ? "rounded border border-orange-300 px-2 py-0.5 text-xs font-semibold text-orange-700 hover:bg-orange-50"
                              : "rounded border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-400 hover:bg-neutral-50"
                          }
                          title={
                            deleteStatsByCompetition.get(competition.id)?.description ??
                            "No category has been deleted for this tier yet — nothing to undo."
                          }
                          confirmMessage={
                            (deleteStatsByCompetition.get(competition.id)?.count ?? 0) > 0
                              ? `Undo the most recent category delete for this tier?\n\n${deleteStatsByCompetition.get(competition.id)?.description ?? ""}\n\nThis recreates the deleted category. Click again afterward to step back one delete further, if more than one was done.`
                              : undefined
                          }
                        >
                          ↺ Undo delete ({deleteStatsByCompetition.get(competition.id)?.count ?? 0})
                        </CategoryActionButton>
                      </span>
                    )}
                  </div>
                  {cats.length === 0 ? (
                    <p className="text-sm text-neutral-400">Categories have not been published yet.</p>
                  ) : (
                    <div className="space-y-6" data-drag-list={`kata-cat-groups-${competition.id}`}>
                      {groupByFamily(cats).map(([family, kataGroups]) => {
                        const totalCats = kataGroups.reduce((sum, [, subCats]) => sum + subCats.length, 0);
                        const alreadyMerged =
                          kataGroups.length === 1 &&
                          kataGroups[0][1].length === 1 &&
                          kataGroups[0][0] === `${family} Kata — Combined (All Kata, Belts, Ages & Genders)`;
                        return (
                        <div key={family}>
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                              {family} Kata
                            </h3>
                            {canManageKata && !alreadyMerged && (
                              <CategoryActionButton
                                actionName="mergeFamily"
                                fields={{ competition_id: competition.id, family, return_to: "/kata-categories" }}
                                className="rounded border border-sky-300 px-2 py-0.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                                title={`Combine every ${family} Kata sub-category — any kata, belt, age, or gender within this group — into one category`}
                                confirmMessage={`Merge all ${totalCats} ${family} Kata categories (every kata, belt, age, and gender in this group) into ONE combined category for this tier?\n\nExisting registrations move over automatically — no resubmission needed. This also means new registrants can no longer be placed into a specific ${family} kata/belt/age slot afterward, the same as the existing Merge → Mix and Merge age buttons. Best done once registration for this tier is effectively closed.`}
                              >
                                Merge all {family} Kata ({totalCats}) → one category
                              </CategoryActionButton>
                            )}
                          </div>
                          <div className="space-y-2" data-drag-family={family}>
                            {kataGroups.map(([base, subCats], kataIndex) => {
                              const neighborAbove = adjacentKataOf(base, "above");
                              const neighborBelow = adjacentKataOf(base, "below");
                              const kyuCats = subCats.filter((cat) => cat.belt_group === "kyu");
                              const danCats = subCats.filter((cat) => cat.belt_group === "dan");
                              const kyuMerged = kyuCats.length === 1 && kyuCats[0].name === `${base} — Color/Kyu Belt — Combined (All Ages & Genders)`;
                              const danMerged = danCats.length === 1 && danCats[0].name === `${base} — Black Belt & Dan Holders — Combined (All Ages & Genders)`;
                              // Any taken slot anywhere in this kata blocks deleting the
                              // whole thing; the server re-checks against ALL
                              // registrations and is the authority.
                              const kataTaken = subCats.reduce((n, cat) => n + (categoryTaken.get(cat.id) ?? 0), 0);
                              return (
                              <details key={base} data-drag-item={base} className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
                                  {canManageKata ? (
                                    <KataGroupDragZone competitionId={competition.id} base={base} returnTo="/kata-categories">
                                      <span className="min-w-[9rem] flex-1">
                                        <NoTranslate>{base}</NoTranslate>{" "}
                                        <span className="font-normal text-neutral-400">({subCats.length} sub-categories)</span>
                                      </span>
                                      <KataOrderControl
                                        competitionId={competition.id}
                                        base={base}
                                        position={kataIndex + 1}
                                        total={kataGroups.length}
                                        returnTo="/kata-categories"
                                      />
                                      <KataFamilyControl
                                        competitionId={competition.id}
                                        base={base}
                                        currentFamily={familyOfGroup(base, subCats)}
                                        isOverridden={subCats.some((cat) => isKataFamily(cat.kata_family))}
                                        returnTo="/kata-categories"
                                      />
                                    </KataGroupDragZone>
                                  ) : (
                                    <span>
                                      <NoTranslate>{base}</NoTranslate>{" "}
                                      <span className="font-normal text-neutral-400">({subCats.length} sub-categories)</span>
                                    </span>
                                  )}
                                  {canManageKata && (
                                    <span className="ml-auto flex flex-wrap items-center gap-1">
                                      <RenameKataControl competitionId={competition.id} base={base} returnTo="/kata-categories" />
                                      {kataTaken > 0 ? (
                                        <span
                                          className="cursor-not-allowed rounded border border-neutral-200 px-2 py-0.5 text-xs font-normal text-neutral-400"
                                          title={`Can't delete — ${kataTaken} slot${kataTaken === 1 ? "" : "s"} already taken in this kata. Merge it instead.`}
                                        >
                                          Delete
                                        </span>
                                      ) : (
                                        <CategoryActionButton
                                          actionName="deleteKata"
                                          fields={{ competition_id: competition.id, kata_base: base, return_to: "/kata-categories" }}
                                          className="rounded border border-red-300 px-2 py-0.5 text-xs font-normal text-red-700 hover:bg-red-50"
                                          title={`Delete “${base}” and all ${subCats.length} of its sub-categories`}
                                          confirmMessage={`Delete “${base}” and ALL ${subCats.length} of its sub-categories?\n\nOnly possible because no slots are taken. Undo is available on the All Competitions page in the admin panel.`}
                                        >
                                          Delete
                                        </CategoryActionButton>
                                      )}
                                      {neighborAbove && (
                                        <CategoryActionButton
                                          actionName="mergeAdjacentKata"
                                          fields={{ competition_id: competition.id, kata_base: base, direction: "above", return_to: "/kata-categories" }}
                                          className="rounded border border-fuchsia-300 px-2 py-0.5 text-xs font-normal text-fuchsia-700 hover:bg-fuchsia-50"
                                          title={`Combine every sub-category of "${base}" with every sub-category of "${neighborAbove}" (the kata immediately above it) into one`}
                                          confirmMessage={`Merge ALL of "${base}" with ALL of "${neighborAbove}" (every belt, age, and gender in both) into ONE combined category?\n\nExisting registrations move over automatically — no resubmission needed. Undo this from the All Competitions page in the admin panel, next to "+ Add category", if this isn't what you meant.`}
                                        >
                                          ↑ Merge with kata above
                                        </CategoryActionButton>
                                      )}
                                      {neighborBelow && (
                                        <CategoryActionButton
                                          actionName="mergeAdjacentKata"
                                          fields={{ competition_id: competition.id, kata_base: base, direction: "below", return_to: "/kata-categories" }}
                                          className="rounded border border-fuchsia-300 px-2 py-0.5 text-xs font-normal text-fuchsia-700 hover:bg-fuchsia-50"
                                          title={`Combine every sub-category of "${base}" with every sub-category of "${neighborBelow}" (the kata immediately below it) into one`}
                                          confirmMessage={`Merge ALL of "${base}" with ALL of "${neighborBelow}" (every belt, age, and gender in both) into ONE combined category?\n\nExisting registrations move over automatically — no resubmission needed. Undo this from the All Competitions page in the admin panel, next to "+ Add category", if this isn't what you meant.`}
                                        >
                                          Merge with kata below ↓
                                        </CategoryActionButton>
                                      )}
                                      {kyuCats.length > 1 && !kyuMerged && (
                                        <CategoryActionButton
                                          actionName="mergeBeltGroup"
                                          fields={{ competition_id: competition.id, kata_base: base, belt_group: "kyu", return_to: "/kata-categories" }}
                                          className="rounded border border-teal-300 px-2 py-0.5 text-xs font-normal text-teal-700 hover:bg-teal-50"
                                          title={`Combine every Color/Kyu Belt sub-category (any age or gender) for ${base} into one`}
                                          confirmMessage={`Merge all ${kyuCats.length} Color/Kyu Belt categories for "${base}" (every age and gender) into ONE combined category?\n\nExisting registrations move over automatically.`}
                                        >
                                          Merge Color/Kyu Belt ({kyuCats.length})
                                        </CategoryActionButton>
                                      )}
                                      {danCats.length > 1 && !danMerged && (
                                        <CategoryActionButton
                                          actionName="mergeBeltGroup"
                                          fields={{ competition_id: competition.id, kata_base: base, belt_group: "dan", return_to: "/kata-categories" }}
                                          className="rounded border border-indigo-300 px-2 py-0.5 text-xs font-normal text-indigo-700 hover:bg-indigo-50"
                                          title={`Combine every Black Belt & Dan Holders sub-category (any age or gender) for ${base} into one`}
                                          confirmMessage={`Merge all ${danCats.length} Black Belt & Dan Holders categories for "${base}" (every age and gender) into ONE combined category?\n\nExisting registrations move over automatically.`}
                                        >
                                          Merge Black Belt & Dan ({danCats.length})
                                        </CategoryActionButton>
                                      )}
                                    </span>
                                  )}
                                </summary>
                                <div className="space-y-3 px-4 pb-4">
                                  {subCats.map((cat) => {
                                    const taken = categoryTaken.get(cat.id) ?? 0;
                                    const left = cat.max_participants != null ? Math.max(0, cat.max_participants - taken) : null;
                                    const recordings = recordingsByCategory.get(cat.id) ?? [];
                                    const subLabel = cat.name.split(" — ").slice(1).join(" — ") || cat.name;
                                    const nameRow = (
                                      <div className="flex flex-1 items-center justify-between gap-2">
                                        <span className="text-sm font-semibold text-neutral-700">{subLabel}</span>
                                        <span
                                          className={`shrink-0 text-xs whitespace-nowrap ${left === 0 ? "font-semibold text-red-600" : "text-neutral-400"}`}
                                        >
                                          {cat.max_participants != null
                                            ? `${taken}/${cat.max_participants} taken (${left} left)`
                                            : `${taken} taken (no cap)`}
                                        </span>
                                      </div>
                                    );
                                    return (
                                      <div key={cat.id} data-drag-item={cat.id} className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0">
                                        <div className="flex items-center gap-2">
                                          {canManageKata ? (
                                            <SubcategoryDragZone categoryId={cat.id} label={subLabel} returnTo="/kata-categories">
                                              {nameRow}
                                            </SubcategoryDragZone>
                                          ) : (
                                            nameRow
                                          )}
                                        </div>
                                        {canManageKata && (
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {(cat.gender === "male" || cat.gender === "female") && (
                                              <CategoryActionButton
                                                actionName="mergeToMix"
                                                fields={{ category_id: cat.id, return_to: "/kata-categories" }}
                                                className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50"
                                                title="Move this category's (and its Male/Female sibling's) registrations into a shared Mix (Male & Female) category"
                                              >
                                                Merge → Mix
                                              </CategoryActionButton>
                                            )}
                                            <CategoryActionButton
                                              actionName="mergeAgeGroup"
                                              fields={{ category_id: cat.id, direction: "before", return_to: "/kata-categories" }}
                                              className="rounded border border-purple-300 px-2 py-0.5 text-xs text-purple-700 hover:bg-purple-50"
                                              title="Merge with the earlier age group (same kata, belt, and gender) — the age range widens to cover both; repeat to combine 2 or 3 age groups"
                                            >
                                              ⇤ Merge age
                                            </CategoryActionButton>
                                            <CategoryActionButton
                                              actionName="mergeAgeGroup"
                                              fields={{ category_id: cat.id, direction: "after", return_to: "/kata-categories" }}
                                              className="rounded border border-purple-300 px-2 py-0.5 text-xs text-purple-700 hover:bg-purple-50"
                                              title="Merge with the later age group (same kata, belt, and gender) — the age range widens to cover both; repeat to combine 2 or 3 age groups"
                                            >
                                              Merge age ⇥
                                            </CategoryActionButton>
                                            <Link
                                              href={`/admin/competitions?editcat=${cat.id}`}
                                              className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50"
                                            >
                                              Edit
                                            </Link>
                                            <CategoryActionButton
                                              actionName="delete"
                                              fields={{ id: cat.id, return_to: "/kata-categories" }}
                                              className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                                            >
                                              Delete
                                            </CategoryActionButton>
                                          </div>
                                        )}
                                        {recordings.length === 0 ? (
                                          <p className="mt-1 text-xs text-neutral-400">No recordings submitted yet.</p>
                                        ) : (
                                          <ul className="mt-1.5 space-y-1">
                                            {recordings.map((r, i) => (
                                              <li
                                                key={`${cat.id}-${i}`}
                                                className="flex items-center justify-between gap-2 text-sm"
                                              >
                                                <span className="text-neutral-600">{r.participantName}</span>
                                                {r.playbackUrl && (
                                                  <a
                                                    href={r.playbackUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="shrink-0 rounded border border-neutral-300 px-2.5 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                                                  >
                                                    Watch
                                                  </a>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </details>
                              );
                            })}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }),
          )
        )}
      </main>
      <SiteFooter />
    </>
  );
}
