/** Safari (and every browser on iOS/iPadOS — Chrome, Telegram's in-app
 * browser, etc. all run on the same WebKit engine there, Apple requires
 * it) has never supported MediaRecorder with a webm mimeType at all, only
 * mp4 -- MediaRecorder.isTypeSupported correctly returns false for every
 * webm candidate below on those browsers, but a naive fallback would
 * return "video/webm" anyway, unconditionally. `new MediaRecorder(stream,
 * { mimeType: "video/webm" })` then throws immediately on construction --
 * exactly the "Could not access/start recording" symptom reported only on
 * iPhone, across every browser tried there, and only there. */
export function pickVideoMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

/** Supabase's PROJECT-WIDE upload ceiling. Not the kata-videos bucket's own
 * limit (500MB), which sits above this and never applies -- this is the one
 * that actually rejects an upload, with "object exceeded the maximum
 * allowed size". Every recording in the app has to land under it. */
export const UPLOAD_CEILING_BYTES = 50 * 1024 * 1024;

/** Fraction of the ceiling deliberately left unused. videoBitsPerSecond is
 * a TARGET, not a hard cap -- an encoder can run over it on very busy
 * footage (a fast kata against a detailed background is exactly that), and
 * a take that overshoots into a rejected upload is the worst possible
 * outcome: the participant performs the whole thing before finding out. */
const HEADROOM = 0.12;

/** Video/audio bitrates sized so a recording of this type CANNOT exceed the
 * upload ceiling at its own maximum length.
 *
 * This has to be per-type, because the types have very different caps. Left
 * on one shared 1.0 Mbit/s figure:
 *   - a 5:00 kata came out at 39.2MB -- comfortably under, and leaving
 *     quality on the table it could have spent;
 *   - a 10:00 video testimonial came out at 78.4MB -- over the ceiling, so
 *     anything longer than 6:23 could not be uploaded at all, even though
 *     the on-screen instructions invite up to 10 minutes.
 * Deriving the bitrate from the cap fixes both at once.
 *
 * VIDEO_CEILING keeps the short-cap types from being handed a bitrate
 * higher than the picture can actually use: past roughly 1.2 Mbit/s at
 * 720p30 the returns fall off quickly, and bigger files upload slower and
 * less reliably on mobile data -- which was its own source of failed
 * submissions. */
const VIDEO_CEILING_BPS = 1_200_000;

/** Never encode video below this, whatever the arithmetic says. Under about
 * half a megabit even a static talking head at 480p starts showing blocking
 * on every movement, and a recording nobody wants to watch is worse than a
 * shorter one. When the floor and the ceiling disagree the LENGTH gives way,
 * not the quality -- see fitsSeconds below. */
const VIDEO_FLOOR_BPS = 500_000;

export interface RecordingBitrates {
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  /** The longest recording that still lands inside the budget at these
   * bitrates. Normally equal to the maxSeconds asked for; SHORTER when the
   * requested length would have needed a bitrate below VIDEO_FLOOR_BPS.
   *
   * Callers must cap their own recording at this, not at their nominal
   * maximum -- otherwise the floor silently wins and produces a file that
   * cannot be uploaded, which is precisely the failure this whole helper
   * exists to make impossible. */
  fitsSeconds: number;
}

export function recordingBitrates(maxSeconds: number, audioBitsPerSecond = 96_000): RecordingBitrates {
  const budgetBits = UPLOAD_CEILING_BYTES * 8 * (1 - HEADROOM);
  const wanted = maxSeconds > 0 ? maxSeconds : 1;
  const totalBps = budgetBits / wanted;
  const videoBitsPerSecond = Math.min(
    VIDEO_CEILING_BPS,
    Math.max(VIDEO_FLOOR_BPS, Math.floor(totalBps - audioBitsPerSecond)),
  );
  const fitsSeconds = Math.min(wanted, Math.floor(budgetBits / (videoBitsPerSecond + audioBitsPerSecond)));
  return { videoBitsPerSecond, audioBitsPerSecond, fitsSeconds };
}

/** Same Safari/iOS caveat as pickVideoMimeType, for an audio-only stream. */
export function pickAudioMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

/** The file's real extension, matching whichever mimeType MediaRecorder
 * actually used to produce it — used to be hardcoded to .webm regardless,
 * which produced a .webm-named file containing mp4 data on Safari. */
export function extensionForMimeType(mimeType: string): string {
  if (mimeType.startsWith("video/mp4") || mimeType.startsWith("audio/mp4") || mimeType.startsWith("audio/aac")) {
    return "mp4";
  }
  return "webm";
}

/** Strips MediaRecorder's `;codecs=...` suffix (e.g. iOS Safari's own
 * `video/mp4;codecs=avc1,mp4a`) before the type is used as a Storage
 * upload's Content-Type -- Supabase Storage's bucket `allowed_mime_types`
 * check matches the header verbatim against entries like "video/mp4", so
 * the untouched, codec-qualified string is rejected with a 400 on every
 * iOS upload attempt even though the bucket does allow plain "video/mp4". */
export function bareMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim();
}
