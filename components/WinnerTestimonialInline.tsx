import { TESTIMONIAL_KIND_LABEL, TESTIMONIAL_GATE_NOTE, TESTIMONIAL_VIDEO_GUIDANCE_NOTE, type TestimonialKind } from "@/lib/testimonials";
import TestimonialRecorder from "@/components/TestimonialRecorder";

export interface WinnerTestimonialInfo {
  kind: TestimonialKind;
  mediaUrl: string | null;
  message: string | null;
}

/**
 * Testimonial block for one winner's box on the public /winners page —
 * this is the merge point of what used to be the separate /testimonials
 * page (now retired) and My Account's recorder (also retired from there).
 * Three states:
 *  - A testimonial exists: shown inline, for every visitor, same as the
 *    old /testimonials gallery did.
 *  - None yet, and the signed-in visitor IS this winner: the two gate
 *    notes plus the 4-button recorder.
 *  - None yet, anyone else: a plain "Pending" note — no buttons, since
 *    only the owning account can ever submit one (see submitTestimonial
 *    in app/actions/account.ts).
 */
export default function WinnerTestimonialInline({
  isOwner,
  testimonial,
}: {
  isOwner: boolean;
  testimonial: WinnerTestimonialInfo | null;
}) {
  if (testimonial) {
    return (
      <div className="mt-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2">
        <p className="mb-1 text-xs font-semibold text-neutral-500">{TESTIMONIAL_KIND_LABEL[testimonial.kind]}</p>
        {testimonial.kind === "video" && testimonial.mediaUrl && (
          <div className="space-y-1.5">
            <video src={testimonial.mediaUrl} controls playsInline className="w-full max-w-xs rounded bg-black" />
            <div>
              <p className="text-[11px] font-semibold text-neutral-400">🎙️ Voice Testimonial (auto, from this video)</p>
              <audio src={testimonial.mediaUrl} controls className="w-full max-w-xs" />
            </div>
          </div>
        )}
        {testimonial.kind === "voice" && testimonial.mediaUrl && (
          <audio src={testimonial.mediaUrl} controls className="w-full max-w-xs" />
        )}
        {testimonial.kind === "message" && testimonial.message && (
          <blockquote className="border-l-4 border-neutral-300 pl-2 text-xs italic text-neutral-700">
            “{testimonial.message}”
          </blockquote>
        )}
      </div>
    );
  }

  if (!isOwner) {
    return <p className="mt-1 text-xs font-semibold text-amber-700">⏳ Testimonial pending</p>;
  }

  return (
    <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
      <p className="text-xs font-semibold text-amber-800">🎓 Give your testimonial</p>
      <p className="mt-1 text-[11px] text-amber-900">{TESTIMONIAL_GATE_NOTE}</p>
      <p className="mt-1 text-[11px] text-amber-900">{TESTIMONIAL_VIDEO_GUIDANCE_NOTE}</p>
      <div className="mt-2">
        <TestimonialRecorder />
      </div>
    </div>
  );
}
