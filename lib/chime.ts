/** `ctx` must already be running from a real user gesture (iOS Safari
 * refuses to start audio otherwise) -- create/resume it at the moment of
 * the tap that kicks off the countdown, not later when the countdown timer
 * itself fires, or sound silently never plays on iPhone. */

/** One shared loudness chain per AudioContext.
 *
 * Simply raising a plain gain node toward 1.0 stops helping long before the
 * sound is actually loud: a phone speaker's ceiling is set by its own tiny
 * driver, not by our gain value, and a bare sine at 0.9 still reads as soft
 * across a hall. What actually carries is (a) sitting in the 2-4 kHz band
 * where both a phone speaker's efficiency and human hearing sensitivity
 * peak, (b) harmonics rather than a pure tone, and (c) a heavily compressed
 * signal so the AVERAGE level -- which is what perceived loudness tracks --
 * sits near the ceiling instead of only the brief peaks touching it.
 *
 * The compressor squashes everything into the top of the range and the
 * make-up gain after it pushes that squashed signal hard into the speaker.
 * Some clipping at the very top is deliberate here: for an alarm cue,
 * carrying distance matters far more than tonal purity.
 *
 * Cached per context because the countdown fires one tick per second and
 * rebuilding the chain each time would leak nodes for the whole countdown. */
const masterChains = new WeakMap<AudioContext, GainNode>();

function masterInput(ctx: AudioContext): GainNode {
  const existing = masterChains.get(ctx);
  if (existing) return existing;

  const input = ctx.createGain();
  input.gain.value = 1;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -28;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.05;

  // Make-up gain -- DynamicsCompressorNode has no make-up stage of its own,
  // so without this the compressor only ever makes things quieter.
  const makeup = ctx.createGain();
  makeup.gain.value = 3.2;

  input.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(ctx.destination);

  masterChains.set(ctx, input);
  return input;
}

/** Sharp, hard alarm-style beep -- played once per second while the
 * countdown is running, so a performer standing well back from the phone
 * (the recorder's own camera-placement instructions put them ~3m away, and
 * the organizer wants it audible much further out than that) can hear it
 * counting down without looking at the screen.
 *
 * Two detuned square waves around 2.5 kHz rather than one 1 kHz tone: that
 * band is roughly where a phone speaker is most efficient AND where the ear
 * is most sensitive, and the slight detune plus square-wave harmonics make
 * it cut through room noise far better than a pure tone at the same
 * measured level. */
export function playAlarmTick(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const out = masterInput(ctx);
  for (const freq of [2500, 2530]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + 0.005);
    // Held flat before decaying, rather than decaying immediately -- a
    // sustained burst carries much further than a click of the same peak
    // level, since perceived loudness integrates over roughly 100-200ms.
    gain.gain.setValueAtTime(0.9, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.35);
  }
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
  const out = masterInput(ctx);

  function tone(freq: number, start: number, duration: number) {
    // Fundamental plus upper partials. The partials are what make this
    // carry: a phone speaker reproduces almost nothing of a 500Hz
    // fundamental, so a bell built only from that vanishes across a room,
    // while its 2x/3x/4x partials sit right in the band the speaker
    // actually drives well.
    for (const [multiplier, gainScale] of [
      [1, 0.7],
      [2, 1],
      [3, 0.6],
      [4, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq * multiplier;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.9 * gainScale, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(out);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    }
  }

  // Classic descending "ding" (G5) then "dong" (C5), a perfect fifth down.
  tone(783.99, 0, 0.55);
  tone(523.25, 0.38, 0.75);

  return new Promise((resolve) => setTimeout(resolve, 1150));
}
