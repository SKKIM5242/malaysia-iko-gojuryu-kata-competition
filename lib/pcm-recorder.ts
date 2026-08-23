/**
 * A voice recorder that behaves like Audacity rather than like a browser.
 *
 * WHY THIS EXISTS
 *
 * The same microphone, recorded two ways, gave two very different results.
 * Measuring energy during PAUSES as a share of energy during speech:
 *
 *     band      via MediaRecorder    via Audacity
 *     1-3 kHz              68%              2%
 *     3-6 kHz             200%              1%
 *     6-10 kHz            319%              0%
 *
 * Through the browser, the silences were louder than the voice in the upper
 * bands — a high, warbling ring between words. Through Audacity, silence was
 * silence. Two things caused that, and both are avoided here:
 *
 *  1. automatic gain control, which winds the gain up during a pause hunting
 *     for signal and lifts the microphone's own hiss into audibility;
 *  2. a lossy codec fed a very quiet signal, which has too little to work
 *     with and spends its bits describing the noise.
 *
 * So: capture raw samples with every browser filter off, decide the level
 * ONCE at the end where the whole recording can be measured, and write an
 * uncompressed WAV. No codec, no moving gain, nothing that behaves
 * differently between words than it does during them.
 *
 * A first attempt at this used a compressor and make-up gain in the live
 * path. That made things worse and the arithmetic says why: it lifted the
 * hiss by the same 14 dB as the voice, leaving the speech-to-noise ratio
 * untouched at 23 dB while making the noise plainly audible. Loudness was
 * never the problem to solve first.
 */

/** 22.05 kHz keeps everything a voice produces, sibilance included, and a
 * full 15-minute testimonial lands near 38 MB — inside the 50 MB ceiling
 * with room to spare. 48 kHz would double that for detail no speaking voice
 * contains. */
export const VOICE_SAMPLE_RATE = 22_050;

export interface VoiceAnalysis {
  /** Median level of the quietest fifth of the recording — the room, not
   * the speaker. */
  noiseFloorDb: number;
  /** Median level of the loudest fifth — the speaker. */
  speechDb: number;
  /** How far the voice sits above the room. Below ~15 dB the recording will
   * sound noisy however it is processed, and the honest answer is to move
   * closer rather than to turn anything up. */
  snrDb: number;
  /** Gain actually applied, in dB. */
  appliedGainDb: number;
  /** True when the gain had to be held back to keep the noise floor from
   * becoming audible — the signal the UI uses to suggest a retake. */
  gainLimitedByNoise: boolean;
}

export interface VoiceResult {
  blob: Blob;
  durationSeconds: number;
  analysis: VoiceAnalysis;
}

const dB = (x: number) => (x > 0 ? 20 * Math.log10(x) : -120);
const lin = (d: number) => Math.pow(10, d / 20);

/** Level of each 20 ms slice, which is roughly one syllable's worth. */
function envelope(samples: Float32Array, sampleRate: number): number[] {
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  const out: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j] * samples[j];
    out.push(Math.sqrt(sum / win));
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Decides one gain for the whole recording, from what the recording
 * actually contains.
 *
 * The rule that matters: **never lift the noise floor above -55 dBFS.**
 * That is roughly where room hiss stops being something you have to listen
 * for and becomes something you hear. Reaching the target speech level is
 * the second priority, not the first — which is the exact mistake the
 * compressor version made.
 */
function chooseGain(env: number[]): { gain: number; analysis: VoiceAnalysis } {
  const sorted = [...env].sort((a, b) => a - b);
  const quietFifth = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));
  const loudFifth = sorted.slice(Math.floor(sorted.length * 0.8));
  const noiseFloorDb = dB(median(quietFifth));
  const speechDb = dB(median(loudFifth));
  const snrDb = speechDb - noiseFloorDb;

  const TARGET_SPEECH_DB = -20;
  const NOISE_CEILING_DB = -55;

  const wantedGain = TARGET_SPEECH_DB - speechDb;
  const allowedByNoise = NOISE_CEILING_DB - noiseFloorDb;
  const appliedGainDb = Math.max(0, Math.min(wantedGain, allowedByNoise));

  return {
    gain: lin(appliedGainDb),
    analysis: {
      noiseFloorDb: +noiseFloorDb.toFixed(1),
      speechDb: +speechDb.toFixed(1),
      snrDb: +snrDb.toFixed(1),
      appliedGainDb: +appliedGainDb.toFixed(1),
      gainLimitedByNoise: allowedByNoise < wantedGain - 0.5,
    },
  };
}

/** 16-bit PCM WAV. Uncompressed on purpose: a codec is the other half of
 * what was damaging these recordings, and at this sample rate the size is
 * affordable. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    off += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

/**
 * Captures raw microphone audio for the life of one take.
 *
 * `start()` opens the microphone with every browser filter switched off —
 * echo cancellation, noise suppression and automatic gain control all
 * disabled — because each of them changes its behaviour between words, and
 * that is what produced the ringing. What is captured is what the
 * microphone heard.
 */
export class VoiceRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private captureRate = 48_000;
  /** Live level for the on-screen meter, updated as samples arrive so it
   * does not depend on the page's animation frames. */
  level = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule("/pcm-recorder-worklet.js");
    const source = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, "pcm-recorder");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const frame = e.data;
      this.chunks.push(frame);
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      this.level = Math.sqrt(sum / frame.length);
    };
    // Connected to the destination through a silent gain so the graph is
    // pulled: some browsers do not run a worklet that leads nowhere.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);

    this.ctx = ctx;
    this.node = node;
    this.captureRate = ctx.sampleRate;
  }

  beginTake(): void {
    this.chunks = [];
    this.node?.port.postMessage("start");
  }

  /** Stops capturing and produces the finished, level-corrected WAV. */
  async finish(): Promise<VoiceResult | null> {
    this.node?.port.postMessage("stop");
    if (this.chunks.length === 0) return null;

    let total = 0;
    for (const c of this.chunks) total += c.length;
    const raw = new Float32Array(total);
    let at = 0;
    for (const c of this.chunks) {
      raw.set(c, at);
      at += c.length;
    }

    const { gain, analysis } = chooseGain(envelope(raw, this.captureRate));

    // Resampled through an OfflineAudioContext, which uses the browser's own
    // resampler rather than a hand-rolled one — dropping samples by hand is
    // an easy way to add the aliasing whistle this is trying to remove.
    const durationSeconds = raw.length / this.captureRate;
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(durationSeconds * VOICE_SAMPLE_RATE),
      VOICE_SAMPLE_RATE,
    );
    const buf = offline.createBuffer(1, raw.length, this.captureRate);
    buf.copyToChannel(raw, 0);
    const src = offline.createBufferSource();
    src.buffer = buf;
    const g = offline.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();

    return {
      blob: encodeWav(rendered.getChannelData(0), VOICE_SAMPLE_RATE),
      durationSeconds,
      analysis,
    };
  }

  stop(): void {
    try {
      this.node?.port.postMessage("stop");
      this.node?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      void this.ctx?.close();
    } catch {
      // Already torn down.
    }
    this.ctx = null;
    this.node = null;
    this.stream = null;
  }
}

/** AudioWorklet is required. Every browser this competition supports has
 * had it for years, but a caller still needs to know before committing to
 * this path rather than the MediaRecorder fallback. */
export function voiceRecorderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof OfflineAudioContext !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}
