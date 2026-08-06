import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { EmptyState, SectionTitle, SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
import { TESTIMONIAL_KIND_LABEL, type TestimonialKind } from "@/lib/testimonials";

export const dynamic = "force-dynamic";
export const metadata = { title: "Winner Testimonials" };

interface TestimonialRow {
  id: string;
  kind: TestimonialKind;
  media_path: string | null;
  message: string | null;
  created_at: string;
  registration: {
    participant: { full_name: string } | null;
    category: { name: string } | null;
    competition: { name: string } | null;
  } | null;
}

/**
 * Every winner testimonial, replayable by anyone — signed in or not — per
 * the organizer's explicit "open to public" instruction. Submitted from
 * /account (see WinnerTestimonialSection.tsx); one per Top-3 registration.
 */
export default async function TestimonialsPage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-4 py-10">
          <SetupNotice />
        </main>
        <SiteFooter />
      </>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("winner_testimonials")
    .select(
      "id, kind, media_path, message, created_at, " +
        "registration:registrations(participant:participants(full_name), category:categories(name), competition:competitions(name))",
    )
    .order("created_at", { ascending: false });
  const testimonials = (data as unknown as TestimonialRow[]) ?? [];

  const mediaUrl = (path: string) => supabase.storage.from("testimonials").getPublicUrl(path).data.publicUrl;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <SectionTitle>Winner Testimonials</SectionTitle>
        <p className="mb-2 text-sm text-neutral-500">
          What our Top 3 winners had to say — in their own words, voice, or video.
        </p>
        <p className="mb-6 text-xs text-neutral-400">
          Recording your own?{" "}
          <a
            href="/winner-testimonial-sample-scripts.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-red-700 underline underline-offset-2"
          >
            Download 40 sample scripts (PDF)
          </a>{" "}
          to practice with — also available from My Account when you record.
        </p>
        {testimonials.length === 0 ? (
          <EmptyState>No testimonials yet.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {testimonials.map((t) => {
              const participantName = t.registration?.participant?.full_name ?? "A winner";
              const competitionName = t.registration?.competition?.name ?? null;
              const categoryName = t.registration?.category?.name ?? null;
              return (
                <div key={t.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                  <p className="font-bold text-neutral-900">{participantName}</p>
                  {competitionName && <p className="text-xs text-neutral-500">{competitionName}</p>}
                  {categoryName && <p className="text-xs text-neutral-400">{categoryName}</p>}
                  <p className="mt-1 text-xs font-semibold text-neutral-400">{TESTIMONIAL_KIND_LABEL[t.kind]}</p>
                  <div className="mt-3 space-y-2">
                    {t.kind === "video" && t.media_path && (
                      <>
                        <video src={mediaUrl(t.media_path)} controls playsInline className="w-full rounded-md bg-black" />
                        <div>
                          <p className="text-[11px] font-semibold text-neutral-400">🎙️ Voice Testimonial (auto, from this video)</p>
                          <audio src={mediaUrl(t.media_path)} controls className="w-full" />
                        </div>
                      </>
                    )}
                    {t.kind === "voice" && t.media_path && <audio src={mediaUrl(t.media_path)} controls className="w-full" />}
                    {t.kind === "message" && t.message && (
                      <blockquote className="rounded-md border-l-4 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm italic text-neutral-700">
                        “{t.message}”
                      </blockquote>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
