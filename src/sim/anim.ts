/** Animation state of one soldier: current clip + time, and the previous clip being blended out. */
export interface Anim {
  clip: string;
  t: number;          // seconds into clip
  rate: number;       // playback rate
  prev: string | null;
  pt: number;
  prate: number;
  blend: number;      // 1 -> fully previous clip, 0 -> fully current
  fade: number;
}

export interface ClipMeta { dur: number; loop: boolean; speed: number; event: number }
export type ClipTable = Record<string, Record<string, ClipMeta>>; // variant -> clip -> meta

export function newAnim(clip: string, t0 = 0): Anim {
  return { clip, t: t0, rate: 1, prev: null, pt: 0, prate: 1, blend: 0, fade: 0.2 };
}

/** Switch clip with a crossfade. `restart` replays the same clip from the start (e.g. another shot). */
export function play(a: Anim, clip: string, rate = 1, fade = 0.2, restart = false) {
  if (a.clip === clip && !restart) { a.rate = rate; return; }
  if (fade > 0) { a.prev = a.clip; a.pt = a.t; a.prate = a.rate; a.blend = 1; a.fade = fade; } else { a.prev = null; a.blend = 0; }
  a.clip = clip; a.t = 0; a.rate = rate;
}

export function stepAnim(a: Anim, dt: number) {
  a.t += dt * a.rate;
  if (a.prev) {
    a.pt += dt * a.prate;
    a.blend = Math.max(0, a.blend - dt / Math.max(0.01, a.fade));
    if (a.blend <= 0) a.prev = null;
  }
}
