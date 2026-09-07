/**
 * Lightweight, dependency-free audio feedback for the barcode/QR scanning
 * experience shared across every warehouse workspace. Generates short
 * tones with the Web Audio API — no audio file asset to ship, host, or
 * keep in sync with the design system, and no third-party sound library.
 *
 * Two short, clearly distinct, non-intrusive tones:
 *   - success: a single short high-pitched beep (~120ms) — a scan resolved
 *     to a valid, usable item.
 *   - error: two short, lower, descending tones (~200ms total) — a scan
 *     was rejected (not found, ineligible, duplicate, or failed to save).
 *     Deliberately a different shape (falling two-note vs. single rising
 *     tone), not just a different pitch, so it's distinguishable even at
 *     low volume or over warehouse floor noise.
 *
 * Both are best-effort: if the browser has no Web Audio support (or
 * hasn't granted it yet), these fail silently rather than throwing — audio
 * is a nice-to-have layered on top of the already-sufficient visual
 * (banner) feedback every workspace already shows, never a requirement to
 * operate the scanner.
 */

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextClass();
  }
  if (sharedAudioContext.state === 'suspended') {
    void sharedAudioContext.resume().catch(() => undefined);
  }
  return sharedAudioContext;
}

function playTone(ctx: AudioContext, frequency: number, startTime: number, duration: number, gainPeak: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

/** Short, high, single beep for a recognized/successful scan. */
export function playScanSuccessTone(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    playTone(ctx, 1568, ctx.currentTime, 0.12, 0.12);
  } catch {
    // Audio feedback is best-effort only — never let it break scanning.
  }
}

/** Short, lower, two-note descending beep for a rejected/invalid/failed scan. */
export function playScanErrorTone(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    playTone(ctx, 392, now, 0.09, 0.11);
    playTone(ctx, 294, now + 0.1, 0.09, 0.11);
  } catch {
    // Audio feedback is best-effort only — never let it break scanning.
  }
}
