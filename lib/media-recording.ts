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
