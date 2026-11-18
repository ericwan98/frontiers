// Little synthesised sound effects, so there are no audio files to load.
const MUTE_KEY = "frontiers:mute";

let audio: AudioContext | null = null;
let muted = localStorage.getItem(MUTE_KEY) === "1";

export const isMuted = () => muted;

export function setMuted(on: boolean): void {
  muted = on;
  localStorage.setItem(MUTE_KEY, on ? "1" : "0");
}

/** One note `at` seconds from now, sliding to `slideTo` Hz if given. */
function note(freq: number, at: number, duration: number, type: OscillatorType = "triangle", slideTo?: number): void {
  audio ??= new AudioContext();
  const t = audio.currentTime + at;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  // Sawtooths are much louder than triangles at the same gain.
  const peak = type === "triangle" ? 0.2 : 0.05;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** The sound of a submitted drawing, from a little arpeggio down to a sad trombone. */
export function scoreSound(points: number): void {
  if (muted) return;
  if (points >= 85) [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.07, 0.3));
  else if (points >= 65) [523, 784].forEach((f, i) => note(f, i * 0.08, 0.3));
  else if (points >= 40) note(440, 0, 0.3);
  else if (points >= 15) note(330, 0, 0.4, "triangle", 247);
  else [392, 370, 349].forEach((f, i) => note(f, i * 0.28, i === 2 ? 0.9 : 0.3, "sawtooth", i === 2 ? 294 : undefined));
}

export function fanfare(): void {
  if (muted) return;
  [523, 659, 784].forEach((f, i) => note(f, i * 0.12, 0.2));
  note(1047, 0.36, 0.7);
  note(784, 0.36, 0.7);
}
