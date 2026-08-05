import { createClient } from "@/lib/supabase/server";
import { winnersRevealed } from "@/lib/winners";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import { TESTIMONIAL_KIND_LABEL, TESTIMONIAL_GATE_NOTE, TESTIMONIAL_VIDEO_GUIDANCE_NOTE } from "@/lib/testimonials";
import TestimonialRecorder from "@/components/TestimonialRecorder";

/**
 * "Your Winner Testimonial" box on /account — appears only for a Top-3
 * winner in a competition whose winners are already revealed (same gate
 * CertificatesSection uses). Renders the recorder until one testimonial
 * exists, then a replay of what was submitted. CertificatesSection reads
 * the same winner_testimonials row to decide whether to show the Winner
 * Certificate download link at all.
 */
export default async function WinnerTestimonialSection({ registrationId }: { registrationId: string | null }) {
  if (!registrationId) return null;
  const supabase = await createClient();

  const { data: reg } = await supabase
    .from("registrations")
    .select(
      "payment_status, competition_id, competition:competitions(name, registration_deadline, winners_announce_date)",
    )
    .eq("id", registrationId)
    .maybeSingle();
  const competition = reg?.competition as unknown as {
    name: string;
    registration_deadline: string | null;
    winners_announce_date: string | null;
  } | null;
  if (!reg || reg.payment_status !== "paid" || !competition) return null;
  if (!winnersRevealed(competition.registration_deadline, competition.winners_announce_date)) return null;

  const rankings = await computeCategoryRankings(supabase, reg.competition_id as string);
  const isWinner = [...rankings.values()].flat().some((e) => e.registrationId === registrationId);
  if (!isWinner) return null;

  const { data: testimonial } = await supabase
    .from("winner_testimonials")
    .select("kind, media_path, message, created_at")
    .eq("registration_id", registrationId)
    .maybeSingle();

  let mediaUrl: string | null = null;
  if (testimonial?.media_path) {
    mediaUrl = supabase.storage.from("testimonials").getPublicUrl(testimonial.media_path).data.publicUrl;
  }

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-lg font-bold">Your Winner Testimonial — {competition.name}</h2>
      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {TESTIMONIAL_GATE_NOTE}
        </p>
        <p className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          {TESTIMONIAL_VIDEO_GUIDANCE_NOTE}
        </p>

        {testimonial ? (
          <div className="mt-3">
            <p className="mb-2 text-sm font-semibold text-green-700">
              ✅ Submitted — {TESTIMONIAL_KIND_LABEL[testimonial.kind as "video" | "voice" | "message"]}
            </p>
            {testimonial.kind === "video" && mediaUrl && (
              <div className="space-y-2">
                <video src={mediaUrl} controls playsInline className="w-full max-w-md rounded-md bg-black" />
                <div>
                  <p className="text-[11px] font-semibold text-neutral-400">🎙️ Voice Testimonial (auto, from this video)</p>
                  <audio src={mediaUrl} controls className="w-full max-w-md" />
                </div>
              </div>
            )}
            {testimonial.kind === "voice" && mediaUrl && <audio src={mediaUrl} controls className="w-full max-w-md" />}
            {testimonial.kind === "message" && testimonial.message && (
              <blockquote className="rounded-md border-l-4 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm italic text-neutral-700">
                “{testimonial.message}”
              </blockquote>
            )}
          </div>
        ) : (
          <div className="mt-3">
            <TestimonialRecorder />
          </div>
        )}
      </div>
    </div>
  );
}
