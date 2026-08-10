export interface ClapDetectorOptions {
  /** Called once, the instant a clap is heard. */
  onClap: () => void;
  /** Milliseconds to wait after starting before arming detection -- gives
   * the mic a moment to settle right as recording begins (immediately
   * after the countdown's own ding-dong chime finishes), so residual
   * reverb or the participant's opening bow/footsteps can't trigger an
   * immediate false stop. */
  armDelayMs?: number;
}

// Peak amplitude (0..1, time-domain) a sound must clear before it's even
// considered -- ordinary speech picked up from a few metres away shouldn't
// reach this; a clap or a shout both will. First-round on-device testing
// (real iPhone, real clap, a few metres from the mic) found NOTHING was
// triggering at 0.4 -- a phone mic's own AGC compresses a clap's raw peak
// a lot more than a quiet desk-top test suggested, so this starts much
// more permissive and may still need another pass of on-device tuning.
const LOUD_THRESHOLD = 0.12;
// Spectral flatness (0..1, geometric/arithmetic mean of the magnitude
// spectrum) required on top of LOUD_THRESHOLD. A clap is a broadband
// impulse -- its energy spreads roughly evenly across the spectrum, close
// to white noise, which is HIGH flatness. A voice -- including a shouted
// "Kiai" -- concentrates its energy at a pitch and that pitch's harmonic
// overtones, which is LOW flatness even when very loud. Requiring both
// loud AND flat in the same instant is what tells the two apart. Lowered
// alongside LOUD_THRESHOLD for the same reason -- room reverb and a
// compressed mic signal both pull a real clap's measured flatness down
// from the clean-signal number a bare hand clap has in isolation.
const FLATNESS_THRESHOLD = 0.15;
const COOLDOWN_MS = 1500;
const DEFAULT_ARM_DELAY_MS = 500;

/**
 * Listens to `stream`'s audio track for a single hand clap and calls
 * `onClap()` when one is heard. Not a replacement for a manual Stop button
 * -- a sufficiently sharp, unpitched shout or a loud ambient bang could
 * still pass both thresholds, and a soft or muffled clap could miss them --
 * just an additional, hands-free way to trigger the same stop.
 *
 * Returns a cleanup function that stops listening and releases the audio
 * graph. Safe to call more than once.
 */
export function startClapDetector(stream: MediaStream, options: ClapDetectorOptions): () => void {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack || typeof AudioContext === "undefined") return () => {};

  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  // No smoothing -- a clap's whole signature is its sharp, near-instant
  // attack; the AnalyserNode's default exponential smoothing would blur
  // exactly that away.
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);
  const startedAt = performance.now();
  const armDelayMs = options.armDelayMs ?? DEFAULT_ARM_DELAY_MS;
  let cooldownUntil = 0;
  let rafId = 0;
  let stopped = false;

  function tick() {
    if (stopped) return;
    rafId = requestAnimationFrame(tick);
    const now = performance.now();
    if (now - startedAt < armDelayMs || now < cooldownUntil) return;

    analyser.getByteTimeDomainData(timeData);
    let peak = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = Math.abs(timeData[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    if (peak < LOUD_THRESHOLD) return;

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
  rafId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
    try {
      source.disconnect();
    } catch {
      // Already disconnected -- nothing left to do.
    }
    void ctx.close().catch(() => {});
  };
}
