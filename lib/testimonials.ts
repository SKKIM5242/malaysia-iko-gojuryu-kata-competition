export type TestimonialKind = "video" | "voice" | "message";

export const TESTIMONIAL_KIND_LABEL: Record<TestimonialKind, string> = {
  video: "🎥 Video Testimonial",
  voice: "🎙️ Voice Testimonial",
  message: "💬 Type Message Testimonial",
};

/** Video testimonials only — the organizer's explicit min/max, enforced
 * client-side while recording (see components/TestimonialRecorder.tsx).
 * Voice and typed testimonials have no length requirement. */
export const TESTIMONIAL_MIN_VIDEO_SECONDS = 3 * 60;
export const TESTIMONIAL_MAX_VIDEO_SECONDS = 10 * 60;

/** The gating rule, shown wherever a winner is offered the recorder. */
export const TESTIMONIAL_GATE_NOTE =
  "Winner must choose one type of testimonial — only then are you allowed to download your certificate(s). " +
  "If not, your reward payout will be held until a testimonial is given.";

/** Recording guidance + thank-you, shown directly below the gate note. */
export const TESTIMONIAL_VIDEO_GUIDANCE_NOTE =
  "The video testimonial needs to be at least 3 minutes, up to a maximum of 10 minutes. Please do a practice " +
  "take first, adjust your timing, and only then come back to do the actual recording. We, the organizer, " +
  "thank you for your co-operation and for the testimonial given in advance.";
