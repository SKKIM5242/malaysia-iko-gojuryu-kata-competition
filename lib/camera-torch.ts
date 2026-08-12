/** The device's camera flash ("torch"), used as a continuous light so a
 * kata or testimonial recorded in a dim room is actually visible.
 *
 * Support is genuinely uneven and there is no polyfill: torch is exposed
 * through MediaStreamTrack capabilities, which Android Chrome implements
 * and iOS Safari does not, at any version — Apple has never shipped torch
 * control to web pages. So this is capability-detected and the button is
 * hidden entirely where it cannot work, rather than shown as a control
 * that silently does nothing.
 *
 * The constraint keys aren't in the DOM typings, hence the casts. */

/** True only when this device/browser can actually switch the flash on for
 * the given live stream. Re-check after the stream changes — capabilities
 * are per-track, and a front camera usually has no torch even when the
 * back one does. */
export function torchSupported(stream: MediaStream | null | undefined): boolean {
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== "function") return false;
  try {
    // Cast the RESULT rather than the track: intersecting MediaStreamTrack
    // with a wider getCapabilities() still resolves to the built-in
    // signature, so `torch` stays invisible to the compiler.
    const caps = track.getCapabilities() as Record<string, unknown>;
    return caps.torch === true;
  } catch {
    return false;
  }
}

/** Switches the flash on/off. Returns whether it actually took effect, so
 * the caller can keep its button state honest instead of showing "on" over
 * a lamp that never lit. */
export async function setTorch(stream: MediaStream | null | undefined, on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints);
    return true;
  } catch {
    return false;
  }
}
