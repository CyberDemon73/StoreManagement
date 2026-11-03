'use client';
/**
 * Short scan tones via Web Audio (no audio files). iOS only plays audio from a context that was
 * created or resumed inside a user gesture, so `unlockScanSound()` is called from the Scan button.
 */
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

export function unlockScanSound(): void {
  const c = context();
  if (c && c.state === 'suspended') void c.resume();
}

function tone(freq: number, startOffset: number, duration: number, type: OscillatorType): void {
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + startOffset;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** 'ok' = classic high till beep; 'miss' = two low tones (code read but not in the catalogue). */
export function playScanSound(kind: 'ok' | 'miss'): void {
  try {
    if (kind === 'ok') tone(1760, 0, 0.12, 'square');
    else { tone(330, 0, 0.14, 'sawtooth'); tone(220, 0.16, 0.18, 'sawtooth'); }
  } catch {
    // Sound is a nicety; never break scanning over it.
  }
}
