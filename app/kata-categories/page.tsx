import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady, getCategories } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { loadRecordingsByCategory } from "@/lib/arena";
import { groupByKata } from "@/lib/division";
import { NoTranslate, SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
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
            Sign in as Admin/Organizer, Referee/Judge, Audience, or Customer Support to browse every
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
            This page is for Admin/Organizer, Referee/Judge, Audience, and Customer Support accounts
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

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Kata Categories</h1>
        <p className="mt-1 mb-8 text-sm text-neutral-500">
          Every kata event&apos;s 16 sub-categories, in order, with live slot counts and every
          submitted recording. View only.
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
                  <h2 className="mb-3 text-lg font-bold">{competition.name}</h2>
                  {cats.length === 0 ? (
                    <p className="text-sm text-neutral-400">Categories have not been published yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {groupByKata(cats).map(([base, subCats]) => (
                        <details key={base} className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
                            <NoTranslate>{base}</NoTranslate>{" "}
                            <span className="font-normal text-neutral-400">({subCats.length} sub-categories)</span>
                          </summary>
                          <div className="space-y-3 px-4 pb-4">
                            {subCats.map((cat) => {
                              const taken = categoryTaken.get(cat.id) ?? 0;
                              const left = cat.max_participants != null ? Math.max(0, cat.max_participants - taken) : null;
                              const recordings = recordingsByCategory.get(cat.id) ?? [];
                              return (
                                <div key={cat.id} className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-semibold text-neutral-700">
                                      {cat.name.split(" — ").slice(1).join(" — ") || cat.name}
                                    </span>
                                    <span
                                      className={`shrink-0 text-xs whitespace-nowrap ${left === 0 ? "font-semibold text-red-600" : "text-neutral-400"}`}
                                    >
                                      {cat.max_participants != null
                                        ? `${taken}/${cat.max_participants} taken (${left} left)`
                                        : `${taken} taken (no cap)`}
                                    </span>
                                  </div>
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
                      ))}
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
