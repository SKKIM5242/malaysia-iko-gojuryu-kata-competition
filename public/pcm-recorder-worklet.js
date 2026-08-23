/**
 * Captures raw microphone samples and posts them to the page.
 *
 * This exists because the browser's own recording path is what was
 * damaging voice testimonials. Comparing the same microphone recorded two
 * ways showed the difference plainly: through Audacity a pause was silent,
 * through MediaRecorder the pauses carried MORE high-band energy than the
 * speech did. Nothing here processes the sound at all — it copies the
 * samples out untouched, and every decision about level is made afterwards
 * on the whole recording, where the noise floor can actually be measured
 * rather than guessed at moment by moment.
 *
 * An AudioWorklet rather than a ScriptProcessor: this runs on the audio
 * thread, so a busy main thread (React re-rendering, a timer firing) cannot
 * make it drop a buffer, which is its own source of clicks and stutter.
 */
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => {
      if (e.data === "start") this.recording = true;
      else if (e.data === "stop") this.recording = false;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.recording || !input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    // Copied, not referenced: the runtime reuses these buffers between
    // callbacks, so posting the original would deliver whatever happened to
    // be in it by the time the page read it.
    this.port.postMessage(new Float32Array(channel));
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorderProcessor);
