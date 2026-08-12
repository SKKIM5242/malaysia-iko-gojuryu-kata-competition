export interface ClapDetectorOptions {
  /** Called once, the instant a clap is heard. */
  onClap: () => void;
  /** Milliseconds to wait after starting before arming detection -- gives
   * the mic a moment to settle right as recording begins (immediately
   * after the countdown's own ding-dong chime finishes), so residual
   * reverb or the participant's opening bow/footsteps can't trigger an
   * immediate false stop. Also the window used to learn the room's own
   * background level before anything can fire. */
  armDelayMs?: number;
}

// How many times louder than the room's own rolling background level a
// sound must be to count as an onset.
//
// This replaced a pair of FIXED absolute thresholds, which is why detection
// only ever worked at one distance: a clap one metre from the phone lands
// near full scale, while the same clap fifteen metres away lands barely
// above the room tone. No single absolute number can accept the far one
// without the near one's own room noise constantly tripping it. Measuring
// the RATIO against whatever the room is currently doing scales across that
// whole range by construction, and adapts to a noisy dojo vs a silent one
// without any per-venue tuning.
const ONSET_RATIO = 4;
// Absolute floor, applied on top of the ratio, so that near-silence (where
// the rolling background approaches zero and almost anything clears the
// ratio) can't self-trigger on mic hiss.
const ABSOLUTE_FLOOR = 0.045;
// Spectral flatness (0..1, geometric/arithmetic mean of the magnitude
// spectrum). A clap is a broadband impulse -- its energy spreads roughly
// evenly across the spectrum, close to white noise, which is HIGH flatness.
// A voice -- including a shouted "Kiai" -- concentrates its energy at a
// pitch and that pitch's harmonic overtones, which is LOW flatness even
// when very loud. Requiring both an onset AND flatness is what tells the
// two apart. Deliberately lower than a clean-signal clap measures, because
// distance and room reverb both smear a clap's spectrum and pull its
// measured flatness down.
const FLATNESS_THRESHOLD = 0.1;
const COOLDOWN_MS = 1500;
const DEFAULT_ARM_DELAY_MS = 500;
// How fast the rolling background level tracks the room. Deliberately slow:
// a clap lasts a few tens of milliseconds, so at this rate a single burst
// barely moves the background it is being compared against, while a genuine
// change in room noise (an air-conditioner starting, a crowd arriving) is
// absorbed within a second or two.
const FLOOR_SMOOTHING = 0.02;

/**
 * Listens to `stream`'s audio track for a hand clap and calls `onClap()`
 * when one is heard. Not a replacement for a manual Stop button -- a
 * sufficiently sharp, unpitched bang could still pass both tests, and a
 * soft or heavily muffled clap could miss them -- just an additional,
 * hands-free way to trigger the same stop.
 *
 * `ctx` MUST be a context already resumed by a real user gesture (the same
 * one the countdown's chime plays through, created at the moment of the
 * Start tap) -- this used to create its own fresh AudioContext here
 * instead, but that construction happens well after the tap, inside the
 * countdown timer's own async callback, which is NOT a user gesture. A
 * context created there can be silently left suspended by the browser, in
 * which case the analyser below never receives real microphone data at
 * all -- the reads just return silence forever, so NO threshold, however
 * loose, could ever fire.
 *
 * Returns a cleanup function that stops listening and disconnects from
 * `ctx` -- it does NOT close ctx, since that context is owned by the
 * caller (shared with the chime, and reused for the next countdown/take in
 * the same session). Safe to call more than once.
 */
export function startClapDetector(ctx: AudioContext, stream: MediaStream, options: ClapDetectorOptions): () => void {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return () => {};

  const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));

  // Pre-amp ahead of the analyser. A clap from across a hall can arrive at
  // only a few percent of full scale, and the level readings below are
  // taken AFTER this, so lifting the signal first gives the maths something
  // with real resolution to work on instead of a handful of tiny values.
  const preamp = ctx.createGain();
  preamp.gain.value = 8;

  // Everything below ~800Hz is discarded before measuring: room rumble,
  // air-conditioning, traffic, footfall and handling noise all live down
  // there and would otherwise dominate the level readings and hold the
  // rolling background high enough to mask a distant clap. A clap's own
  // energy is overwhelmingly above this point, so it loses almost nothing.
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 800;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  // No smoothing -- a clap's whole signature is its sharp, near-instant
  // attack; the AnalyserNode's default exponential smoothing would blur
  // exactly that away.
  analyser.smoothingTimeConstant = 0;

  // Terminating the chain into a MUTED gain node connected to the
  // destination, rather than leaving the analyser dangling. An analyser
  // with no path to a destination is not guaranteed to be pulled by the
  // audio graph at all; routing it through silence guarantees it runs
  // without emitting anything (which would otherwise feed the mic straight
  // back out of the speaker mid-recording).
  const silent = ctx.createGain();
  silent.gain.value = 0;

  source.connect(preamp);
  preamp.connect(highpass);
  highpass.connect(analyser);
  analyser.connect(silent);
  silent.connect(ctx.destination);

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Float32Array(analyser.fftSize);
  const startedAt = performance.now();
  const armDelayMs = options.armDelayMs ?? DEFAULT_ARM_DELAY_MS;
  // Seeded low so the very first frames don't compare against zero.
  let backgroundPeak = 0.01;
  let cooldownUntil = 0;
  let rafId = 0;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function tick() {
    if (stopped) return;

    // getFloatTimeDomainData, not the byte version: the byte version
    // quantises to 256 steps across the whole range, so a distant clap and
    // the room tone underneath it can land on the SAME step and become
    // literally indistinguishable. Float keeps the difference the ratio
    // test depends on.
    analyser.getFloatTimeDomainData(timeData);
    let peak = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = Math.abs(timeData[i]);
      if (v > peak) peak = v;
    }

    const now = performance.now();
    const armed = now - startedAt >= armDelayMs && now >= cooldownUntil;
    const isOnset = armed && peak > backgroundPeak * ONSET_RATIO && peak > ABSOLUTE_FLOOR;

    if (!isOnset) {
      // Track the room only on frames that AREN'T a candidate onset, so a
      // clap never raises the very background it's being measured against.
      backgroundPeak = backgroundPeak * (1 - FLOOR_SMOOTHING) + peak * FLOOR_SMOOTHING;
      return;
    }

    analyser.getByteFrequencyData(freqData);
    let sum = 0;
    let logSum = 0;
    const n = freqData.length;
    for (let i = 0; i < n; i++) {
      const mag = freqData[i] / 255 + 1e-6;
      sum += mag;
      logSum += Math.log(mag);
    }
    const arithMean = sum / n;
    const geoMean = Math.exp(logSum / n);
    const flatness = arithMean > 0 ? geoMean / arithMean : 0;
    if (flatness < FLATNESS_THRESHOLD) return;

    cooldownUntil = now + COOLDOWN_MS;
    options.onClap();
  }

  // Driven by BOTH requestAnimationFrame and a timer. rAF alone is throttled
  // to zero the moment the page stops compositing -- which on a phone
  // includes the screen dimming or locking part-way through a long kata --
  // and the detector would simply stop listening with no sign anything was
  // wrong. The interval keeps it running in that state; the two are
  // idempotent, and the cooldown means overlapping calls can't double-fire.
  function rafLoop() {
    if (stopped) return;
    rafId = requestAnimationFrame(rafLoop);
    tick();
  }
  rafId = requestAnimationFrame(rafLoop);
  timerId = setInterval(tick, 16);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
    if (timerId !== null) clearInterval(timerId);
    for (const node of [source, preamp, highpass, analyser, silent]) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected -- nothing left to do.
      }
    }
    // ctx itself is NOT closed here -- it's owned by the caller (see the
    // doc comment above).
  };
}
