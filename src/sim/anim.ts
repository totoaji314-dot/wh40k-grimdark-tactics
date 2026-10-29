/**
 * Animation state of one soldier: current clip + time, the previous clip being blended out, and an optional
 * upper-body layer (fire / reload / command) that plays over the locomotion clip so a soldier can shoot or
 * reload while walking: spine, arms, head and weapons follow the upper clip, hips and legs keep walking.
 */
export interface Anim {
  clip: string;
  t: number;          // seconds into clip
  rate: number;       // playback rate
  prev: string | null;
  pt: number;
  prate: number;
  blend: number;      // 1 -> fully previous clip, 0 -> fully current
  fade: number;
  up: string | null;  // upper-body layer clip
  ut: number;
  urate: number;
  udur: number;       // seconds the layer stays on before fading out
  uw: number;         // layer weight 0..1
}

export interface ClipMeta { dur: number; loop: boolean; speed: number; event: number }
export type ClipTable = Record<string, Record<string, ClipMeta>>; // variant -> clip -> meta

/** Clips that keep an upper-body layer running (locomotion / stances); anything else is full-body and cancels it. */
const LAYERABLE = new Set(['idle', 'aim', 'walk', 'walk_aim', 'run', 'sprint', 'charge', 'turn', 'cover']);

export function newAnim(clip: string, t0 = 0): Anim {
  return { clip, t: t0, rate: 1, prev: null, pt: 0, prate: 1, blend: 0, fade: 0.2, up: null, ut: 0, urate: 1, udur: 0, uw: 0 };
}

/** Switch clip with a crossfade. `restart` replays the same clip from the start (e.g. another shot). */
export function play(a: Anim, clip: string, rate = 1, fade = 0.2, restart = false) {
  if (!LAYERABLE.has(clip)) { a.up = null; a.uw = 0; }
  if (a.clip === clip && !restart) { a.rate = rate; return; }
  if (fade > 0) { a.prev = a.clip; a.pt = a.t; a.prate = a.rate; a.blend = 1; a.fade = fade; } else { a.prev = null; a.blend = 0; }
  a.clip = clip; a.t = 0; a.rate = rate;
}

/** Play `clip` on the upper body only (for `dur` seconds), over whatever the legs are doing. */
export function playUpper(a: Anim, clip: string, dur: number, rate = 1) {
  if (!LAYERABLE.has(a.clip)) return;
  a.up = clip; a.ut = 0; a.urate = rate; a.udur = dur;
  if (a.uw < 0.05) a.uw = 0.05;
}

export function stepAnim(a: Anim, dt: number) {
  a.t += dt * a.rate;
  if (a.prev) {
    a.pt += dt * a.prate;
    a.blend = Math.max(0, a.blend - dt / Math.max(0.01, a.fade));
    if (a.blend <= 0) a.prev = null;
  }
  if (a.up) {
    a.ut += dt * a.urate;
    a.uw = a.ut < a.udur ? Math.min(1, a.uw + dt / 0.08) : a.uw - dt / 0.18;
    if (a.uw <= 0) { a.up = null; a.uw = 0; }
  }
}
