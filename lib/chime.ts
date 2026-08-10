/** `ctx` must already be running from a real user gesture (iOS Safari
 * refuses to start audio otherwise) -- create/resume it at the moment of
 * the tap that kicks off the countdown, not later when the countdown timer
 * itself fires, or sound silently never plays on iPhone. */

/** Sharp, hard alarm-style beep -- played once per second while the
 * countdown is running, so a performer several metres from the phone (per
 * the recorder's own camera-placement instructions) can hear it counting
 * down without looking at the screen. A square wave reads as a harder,
 * more "alarm clock" tone than the ding-dong's soft sine bell -- the two
 * are meant to sound clearly different so the switch from ticking to the
 * chime is unmistakable as "recording has started now." */
export function playAlarmTick(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

/** Two-note "ding dong" doorbell chime marking the countdown's end and
 * recording's actual start -- synthesized entirely with Web Audio
 * oscillators rather than a bundled sound file, no asset to host, license,
 * or ship.
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
      // Peak gain raised close to the safe headroom ceiling (1.0 would
      // start clipping a typical phone speaker) -- the original 0.32 read
      // as much too soft on a real device, especially with the performer
      // standing several metres away per the camera-placement instructions.
      gain.gain.linearRampToValueAtTime(0.9 * gainScale, now + start + 0.02);
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
