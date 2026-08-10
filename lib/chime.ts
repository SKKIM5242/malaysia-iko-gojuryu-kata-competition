/** Two-note "ding dong" doorbell chime, synthesized entirely with Web Audio
 * oscillators rather than a bundled sound file -- no asset to host, license,
 * or ship.
 *
 * `ctx` must already be running from a real user gesture (iOS Safari
 * refuses to start audio otherwise) -- create/resume it at the moment of
 * the tap that kicks off the countdown, not later when the countdown timer
 * itself fires, or the chime silently never sounds on iPhone.
 *
 * Resolves once the chime has finished playing, so a caller can safely
 * start recording right after -- the bell is never mid-tone when the mic
 * starts listening for the follow-on clap-to-stop cue.
 */
export function playDingDong(ctx: AudioContext): Promise<void> {
  const now = ctx.currentTime;

  function tone(freq: number, start: number, duration: number) {
    // Fundamental plus a quiet octave-up partial gives a slightly bell-like
    // timbre instead of a flat, obviously-synthesized sine beep.
    for (const [multiplier, gainScale] of [
      [1, 1],
      [2, 0.28],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * multiplier;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.32 * gainScale, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    }
  }

  // Classic descending "ding" (G5) then "dong" (C5), a perfect fifth down.
  tone(783.99, 0, 0.55);
  tone(523.25, 0.38, 0.75);

  return new Promise((resolve) => setTimeout(resolve, 1150));
}
