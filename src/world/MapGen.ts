import { fbm, mulberry32 } from './noise';

// Deterministic battlefield generator. Produces the heightfield, prop placements (environment kit pieces)
// and the simulation grids: walkable / cover / line-of-sight height / trench.

export interface Footprint { w: number; d: number; cover: number; block: boolean; h: number }
export interface Placement { piece: string; x: number; z: number; rot: number; y: number }
export type MapType = 'ruins' | 'trenches' | 'terra';

/** Holy Terra palace pieces, drawn by src/world/Palace.ts from public/assets/terra/palace.glb (modelled in
 *  tools/blender/terra_landmarks.py), not the environment kit. Sizes follow the models at 1 unit = 1 m. */
export const TERRA_FOOT: Record<string, Footprint> = {
  // the Eternity Gate is drawn as one piece; its two towers block through the invisible gate_tower footprints and
  // the 26 m passage between them stays open
  eternity_gate: { w: 80, d: 34, cover: 0, block: false, h: 0 },
  gate_tower: { w: 27.6, d: 34.4, cover: 0.6, block: true, h: 52 },
  palace_wall: { w: 24, d: 12.4, cover: 0.85, block: true, h: 26 },
  palace_tower: { w: 24.8, d: 24.8, cover: 0.7, block: true, h: 34 },
  throne_hall: { w: 61.6, d: 45.5, cover: 0.8, block: true, h: 36 },
  rhino: { w: 3.8, d: 7.5, cover: 0.7, block: true, h: 3 },
  brazier: { w: 1.6, d: 1.6, cover: 0.15, block: true, h: 3 },
  // statue = a saint or hero scan on a marble plinth (8 m); equestrian = the bronze commander on his rock (8.5 m);
  // emperor_statue = the colossal enthroned Emperor on the plaza (13 m)
  statue: { w: 3.6, d: 3.6, cover: 0.6, block: true, h: 8 },
  equestrian: { w: 4.0, d: 7.2, cover: 0.6, block: true, h: 8.5 },
  emperor_statue: { w: 8.6, d: 10.2, cover: 0.65, block: true, h: 13 },
};
/** where the palace stands: the gate across the avenue at z, the throne hall behind it */
export const PALACE = { z: 132, hall: 180, gate: 13 };

export const EXTENT = 440;          // terrain size (m)
export const HALF = EXTENT / 2;
export const PLAY = 200;            // playable half size
export const HN = 441;              // heightfield samples per side (1 m)
export const CELL = 2;              // sim grid cell (m)
export const GN = EXTENT / CELL;    // 220

export class BattleMap {
  height = new Float32Array(HN * HN);
  road = new Float32Array(HN * HN);
  scorch = new Float32Array(HN * HN);
  rubble = new Float32Array(HN * HN);
  mud = new Float32Array(HN * HN);
  blocked = new Uint8Array(GN * GN);
  cover = new Float32Array(GN * GN);
  losH = new Float32Array(GN * GN);
  trench = new Uint8Array(GN * GN);
  placements: Placement[] = [];
  /** purely visual city blocks beyond the battlefield (never touch the simulation grids) */
  backdrop: Placement[] = [];
  craters: { x: number; z: number; r: number }[] = [];
  trenches: [number, number][][] = [];
  fires: { x: number; z: number; y: number; s: number }[] = [];
  lamps: { x: number; y: number; z: number }[] = [];
  /** exact oriented footprints of blocking pieces, bucketed for fast soldier collision */
  solids: { x: number; z: number; c: number; s: number; hw: number; hd: number }[] = [];
  private solidGrid = new Map<number, number[]>();
  rnd: () => number;

  constructor(public type: MapType, public foot: Record<string, Footprint>, seed = 1234) {
    this.foot = { ...foot, ...TERRA_FOOT };
    this.rnd = mulberry32(seed + (type === 'trenches' ? 77 : type === 'terra' ? 151 : 0));
    this.baseTerrain(seed);
    if (type === 'ruins') this.layoutRuins(); else if (type === 'terra') this.layoutTerra(); else this.layoutTrenches();
    this.finish();
    this.layoutBackdrop(seed);
  }

  /** Ground height including the visual outskirts beyond the simulated map: a low rubble plain, so the
   *  ruined city and the hive skyline behind it stay visible instead of a wall of hills. */
  farHeight(x: number, z: number) {
    if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) return this.heightAt(x, z);
    const e = Math.max(Math.abs(x), Math.abs(z)) - HALF;
    const cx = Math.max(-HALF, Math.min(HALF, x)), cz = Math.max(-HALF, Math.min(HALF, z));
    return this.heightAt(cx, cz) + e * 0.045 + (fbm(x / 26, z / 26, 3, 9) - 0.5) * Math.min(e, 30) * 0.3;
  }

  /** Ring of ruined hive blocks around the battlefield (separate RNG so the battle layout is unchanged). */
  private layoutBackdrop(seed: number) {
    const r = mulberry32(seed * 7 + 901 + (this.type === 'trenches' ? 3 : 0));
    const B = 234, O = 336, STEP = 30;
    const add = (piece: string, x: number, z: number, rot: number) => this.backdrop.push({ piece, x, z, rot, y: this.farHeight(x, z) - 0.4 });
    // landmark cathedral far beyond the enemy lines, plus a ring of hive blocks on a jittered street grid
    const cx = this.type === 'ruins' ? -95 : 110;
    const terra = this.type === 'terra';
    add('cathedral', cx, -296, 0.04);
    // Terra: the Imperial Palace rises behind the defenders — a wall of sanctums and spires to the south
    if (terra) for (let x = -300, k = 0; x <= 300; x += 75, k++) add(k % 2 ? 'palace_dome_b' : 'palace_spire_a', x + (r() - 0.5) * 12, 300 + (r() - 0.5) * 14, (r() - 0.5) * 0.06);
    for (let gx = -O; gx <= O; gx += STEP) for (let gz = -O; gz <= O; gz += STEP) {
      const x = gx + (r() - 0.5) * 10, z = gz + (r() - 0.5) * 10;
      const m = Math.max(Math.abs(x), Math.abs(z));
      const k = r(), rot = Math.floor(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.12;
      if (m < B || m > O || k < 0.22) continue;
      if (Math.abs(x - cx) < 40 && Math.abs(z + 296) < 50) continue;
      const depth = (m - B) / (O - B);
      if (terra && z > 255) continue; // the palace front is kept clear
      const piece = terra
        ? (k < 0.36 ? 'chapel' : k < 0.5 ? 'hab' : k < 0.62 ? 'watchtower' : k < 0.7 ? 'monument' : k < 0.86 ? 'ruinrow' : 'chapel')
        : k < 0.42 ? 'hab' : k < 0.55 ? 'manufactorum' : k < 0.66 ? 'chapel' : k < 0.74 ? (depth > 0.35 ? 'smokestack' : 'watchtower') : k < 0.9 ? 'ruinrow' : 'hab';
      if (piece === 'ruinrow') {
        // a broken street front: three wall sections and pillars
        const c = Math.cos(rot), s = Math.sin(rot);
        for (let w = -1; w <= 1; w++) add(r() < 0.6 ? 'wall_ruin' : 'wall_ruin2', x + c * w * 8.6, z - s * w * 8.6, rot);
        add('pillar', x + c * 12.9, z - s * 12.9, rot);
        continue;
      }
      add(piece, x, z, rot);
      if (piece === 'hab' && r() < 0.5) add('hab', x + 13 * Math.cos(rot), z - 13 * Math.sin(rot), rot);
    }
  }

  // ---------------------------------------------------------------- queries
  private hi(x: number, z: number) { return Math.round(z + HALF) * HN + Math.round(x + HALF); }
  heightAt(x: number, z: number): number {
    const fx = Math.min(HN - 1.001, Math.max(0, x + HALF)), fz = Math.min(HN - 1.001, Math.max(0, z + HALF));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const h = this.height, i = iz * HN + ix;
    const a = h[i], b = h[i + 1], c = h[i + HN], d = h[i + HN + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  cellOf(x: number, z: number) {
    const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL);
    if (cx < 0 || cz < 0 || cx >= GN || cz >= GN) return -1;
    return cz * GN + cx;
  }
  /** True if a circle (soldier) at x,z of radius r overlaps a building / prop footprint. */
  isSolid(x: number, z: number, r = 0.35) {
    const k = Math.floor((x + HALF) / 8) * 100 + Math.floor((z + HALF) / 8);
    const list = this.solidGrid.get(k);
    if (!list) return false;
    for (const i of list) {
      const o = this.solids[i];
      const dx = x - o.x, dz = z - o.z;
      const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
      if (Math.abs(lx) < o.hw + r && Math.abs(lz) < o.hd + r) return true;
    }
    return false;
  }
  isBlocked(x: number, z: number) { const c = this.cellOf(x, z); return c < 0 || this.blocked[c] === 1 || Math.abs(x) > PLAY || Math.abs(z) > PLAY; }
  coverAt(x: number, z: number) { const c = this.cellOf(x, z); return c < 0 ? 0 : this.cover[c]; }
  inTrench(x: number, z: number) { const c = this.cellOf(x, z); return c >= 0 && this.trench[c] === 1; }
  /** True if a straight line at shoulder height is not blocked by buildings / walls. */
  los(x0: number, z0: number, x1: number, z1: number, h0 = 1.6, h1 = 1.4): boolean {
    const dx = x1 - x0, dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    const n = Math.ceil(L / (CELL * 0.7));
    const y0 = this.heightAt(x0, z0) + h0, y1 = this.heightAt(x1, z1) + h1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const c = this.cellOf(x0 + dx * t, z0 + dz * t);
      if (c < 0) continue;
      const top = this.losH[c];
      if (top > 0 && top > y0 + (y1 - y0) * t) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- generation
  private baseTerrain(seed: number) {
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
      const x = i - HALF, z = j - HALF;
      let h = (fbm(x / 140, z / 140, 4, seed) - 0.5) * 8 + (fbm(x / 35, z / 35, 3, seed + 5) - 0.5) * 1.6 + (fbm(x / 7, z / 7, 2, seed + 13) - 0.5) * 0.35;
      const edge = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - PLAY + 10) / 30;
      h += edge * edge * 6; // rise toward the map edge so the battlefield sits in a shallow bowl
      this.height[j * HN + i] = h;
      this.mud[j * HN + i] = Math.max(0, fbm(x / 34, z / 34, 4, seed + 9) - 0.44) * 3;
    }
  }

  private paint(arr: Float32Array, x: number, z: number, r: number, v: number, soft = 0.5) {
    const r2 = r + 2;
    for (let j = Math.floor(z - r2); j <= z + r2; j++) for (let i = Math.floor(x - r2); i <= x + r2; i++) {
      const ii = i + HALF, jj = j + HALF;
      if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue;
      const d = Math.hypot(i - x, j - z) / r;
      if (d > 1) continue;
      const k = d < soft ? 1 : 1 - (d - soft) / (1 - soft);
      const o = jj * HN + ii;
      arr[o] = Math.max(arr[o], v * k);
    }
  }

  /** Flatten terrain toward `h` over a rectangle (with soft edges). */
  private flatten(x: number, z: number, w: number, d: number, rot: number, h: number | null, margin = 4) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.hypot(w, d) / 2 + margin;
    const target = h ?? this.heightAt(x, z);
    for (let j = Math.floor(z - R); j <= z + R; j++) for (let i = Math.floor(x - R); i <= x + R; i++) {
      const ii = i + HALF, jj = j + HALF;
      if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue;
      const lx = (i - x) * c - (j - z) * s, lz = (i - x) * s + (j - z) * c;
      const ox = Math.max(0, Math.abs(lx) - w / 2), oz = Math.max(0, Math.abs(lz) - d / 2);
      const o = Math.hypot(ox, oz);
      if (o > margin) continue;
      const k = 1 - o / margin;
      const idx = jj * HN + ii;
      this.height[idx] += (target - this.height[idx]) * k * k * (3 - 2 * k);
    }
    return target;
  }

  private roadLine(pts: [number, number][], width: number) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let t = 0; t <= L; t += 1.5) {
        const x = x0 + (x1 - x0) * t / L, z = z0 + (z1 - z0) * t / L;
        this.paint(this.road, x, z, width / 2, 1, 0.8);
        const h = this.heightAt(x, z);
        this.flatten(x, z, width, 2, 0, h - 0.05, 3);
      }
    }
  }

  crater(x: number, z: number, r: number) {
    for (let j = Math.floor(z - r * 1.6); j <= z + r * 1.6; j++) for (let i = Math.floor(x - r * 1.6); i <= x + r * 1.6; i++) {
      const ii = i + HALF, jj = j + HALF;
      if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue;
      const d = Math.hypot(i - x, j - z) / r;
      let dh = 0;
      if (d < 1) dh = -(1 - d * d) * r * 0.32;
      else if (d < 1.6) dh = Math.sin((d - 1) / 0.6 * Math.PI) * r * 0.08;
      this.height[jj * HN + ii] += dh;
    }
    this.paint(this.scorch, x, z, r * 1.3, 0.9, 0.3);
    this.paint(this.rubble, x, z, r * 1.7, 0.5, 0.5);
    this.craters.push({ x, z, r });
  }

  private trenchLine(pts: [number, number][], depth = 1.8, width = 3.2) {
    this.trenches.push(pts);
    for (let k = 0; k < pts.length - 1; k++) {
      const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let t = 0; t <= L; t += 0.5) {
        const x = x0 + (x1 - x0) * t / L, z = z0 + (z1 - z0) * t / L;
        for (let j = Math.floor(z - width); j <= z + width; j++) for (let i = Math.floor(x - width); i <= x + width; i++) {
          const ii = i + HALF, jj = j + HALF;
          if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue;
          const d = Math.hypot(i - x, j - z);
          const idx = jj * HN + ii;
          const ground = this.baseH ? this.baseH[idx] : this.height[idx];
          if (d < width / 2) this.height[idx] = Math.min(this.height[idx], ground - depth);
          else if (d < width / 2 + 1.2) this.height[idx] = Math.min(this.height[idx], ground - depth * (1 - (d - width / 2) / 1.2) * 0.9);
        }
        this.paint(this.mud, x, z, width, 1.0, 0.6);
        for (const o of [-width / 2 + 0.4, 0, width / 2 - 0.4]) {
          const c = this.cellOf(x + Math.cos(Math.atan2(x1 - x0, z1 - z0)) * o, z - Math.sin(Math.atan2(x1 - x0, z1 - z0)) * o);
          if (c >= 0) this.trench[c] = 1;
        }
      }
      // revetments on both walls, duckboards on the floor, sandbag parapet in front (north side)
      const ang = Math.atan2(x1 - x0, z1 - z0);
      const nx = Math.cos(ang), nz = -Math.sin(ang);
      for (let t = 2; t < L - 1; t += 4) {
        const x = x0 + (x1 - x0) * t / L, z = z0 + (z1 - z0) * t / L;
        const rot = ang + Math.PI / 2;
        for (const side of [-1, 1]) {
          const px = x + nx * side * (width / 2 + 0.15), pz = z + nz * side * (width / 2 + 0.15);
          this.placements.push({ piece: 'trench_wall', x: px, z: pz, rot: rot + (side > 0 ? Math.PI : 0), y: NaN });
        }
        this.placements.push({ piece: 'duckboard', x, z, rot, y: NaN });
        if (this.rnd() < 0.55) {
          const sx = x + nx * (width / 2 + 1.6) * (nz < 0 ? 1 : -1), sz = z + nz * (width / 2 + 1.6) * (nz < 0 ? 1 : -1);
          this.placements.push({ piece: 'sandbags', x: sx, z: sz, rot, y: NaN });
        }
      }
    }
  }
  private baseH: Float32Array | null = null;

  private place(piece: string, x: number, z: number, rot = 0, flat = true) {
    const f = this.foot[piece];
    let y = this.heightAt(x, z);
    if (flat && f && f.block && f.w * f.d > 12) y = this.flatten(x, z, f.w, f.d, rot, null, 5);
    this.placements.push({ piece, x, z, rot, y });
  }

  private scatter(piece: string, n: number, x0: number, x1: number, z0: number, z1: number, rotRandom = true) {
    for (let k = 0; k < n; k++) {
      const x = x0 + this.rnd() * (x1 - x0), z = z0 + this.rnd() * (z1 - z0);
      if (this.near(x, z, 7)) continue;
      this.place(piece, x, z, rotRandom ? this.rnd() * Math.PI * 2 : 0, false);
    }
  }

  private near(x: number, z: number, r: number) {
    for (const p of this.placements) {
      const f = this.foot[p.piece];
      if (!f || !f.block) continue;
      if (Math.abs(p.x - x) < f.w / 2 + r && Math.abs(p.z - z) < f.d / 2 + r) return true;
    }
    return Math.abs(this.road[this.hi(x, z)]) > 0.5;
  }

  private wallRow(x0: number, z0: number, x1: number, z1: number, ruinChance = 0.75) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(z1 - z0, x1 - x0) * -1;
    const n = Math.floor(L / 9.6);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const r = this.rnd();
      if (r < 0.15) { this.place('rubble', x, z, this.rnd() * 6, false); continue; }
      this.place(r < ruinChance ? (this.rnd() < 0.5 ? 'wall_ruin' : 'wall_ruin2') : 'wall', x, z, rot);
      if (k < n - 1) {
        const tp = (k + 1) / n;
        this.place('pillar', x0 + (x1 - x0) * tp, z0 + (z1 - z0) * tp, rot);
      }
    }
  }

  private layoutRuins() {
    const r = this.rnd;
    const main: [number, number][] = []; for (let z = -215; z <= 215; z += 10) main.push([Math.sin(z / 70) * 8, z]);
    this.roadLine(main, 9);
    this.roadLine([[-215, -22], [-60, -20], [0, -22], [60, -24], [215, -20]], 8);
    this.baseH = this.height.slice();
    // central district
    this.place('manufactorum', -48, -50, 0);
    this.place('hab', 42, -62, Math.PI / 2);
    this.place('chapel', 46, 2, 0);
    this.place('hab', -66, 4, 0);
    this.place('smokestack', -88, -78, 0);
    this.place('smokestack', 92, -100, 0);
    this.place('monument', 0, 16, 0);
    this.place('cathedral', 62, -152, 0);
    this.wallRow(-20, -95, -20, -32);
    this.wallRow(20, -100, 20, -38);
    this.wallRow(-95, -10, -28, -10, 0.85);
    this.wallRow(28, -12, 90, -12, 0.85);
    this.wallRow(-30, 20, -30, 52, 0.9);
    this.wallRow(26, 26, 26, 50, 0.9);
    this.place('wreck', 6, -70, 0.3); this.place('wreck', -54, -22, 1.5); this.place('wreck', 64, -26, 1.8); this.place('wreck', -6, 40, 2.6);
    this.place('pipeline', -78, 34, 0); this.place('pipeline', 82, 12, Math.PI / 2); this.place('pipeline', 70, -40, 0);
    for (let z = -170; z <= 150; z += 26) {
      const x = Math.sin(z / 70) * 8;
      if (Math.abs(z - 16) < 12 || Math.abs(z + 22) < 10) continue;
      this.place('lamp', x + 7, z, -Math.PI / 2, false); this.place('lamp', x - 7, z + 13, Math.PI / 2, false);
    }
    this.scatter('rubble', 22, -110, 110, -130, 40);
    this.scatter('crates', 12, -110, 110, -120, 40);
    this.scatter('barrels', 12, -110, 110, -120, 40);
    // imperial defence line
    for (let x = -96; x <= 96; x += 6) {
      if (Math.abs(x - Math.sin(48 / 70) * 8) < 6) continue;
      const z = 48 + Math.cos(x / 30) * 2;
      this.place(r() < 0.8 ? 'sandbags' : 'barricade', x, z, 0, false);
    }
    for (let x = -110; x <= 110; x += 14) this.place('tank_trap', x + r() * 4, 30 + r() * 4, r() * 3, false);
    this.place('watchtower', -105, 72, 0); this.place('watchtower', 105, 72, 0);
    this.place('bunker', -60, 66, Math.PI); this.place('bunker', 62, 64, Math.PI);
    this.scatter('crates', 6, -90, 90, 70, 110);
    // ork camp
    for (let x = -100; x <= 100; x += 9) if (r() < 0.6) this.place('ork_barricade', x + r() * 3, -132 + r() * 6, r() * 0.6 - 0.3, false);
    for (let k = 0; k < 9; k++) this.place('ork_totem', -110 + r() * 220, -140 - r() * 30, r() * 6, false);
    this.scatter('wreck', 3, -150, 150, -170, -140);
    // craters
    for (let k = 0; k < 34; k++) {
      const x = -160 + r() * 320, z = -125 + r() * 165;
      if (this.near(x, z, 6)) continue;
      this.crater(x, z, 2.5 + r() * 5);
    }
    for (let k = 0; k < 8; k++) this.fires.push({ x: -120 + r() * 240, z: -120 + r() * 150, y: 0, s: 0.6 + r() });
  }

  /** Holy Terra: the approach to the Imperial Palace. A processional avenue runs north to south through a besieged
   *  hab district, lined with statues, to the palace bastion wall and its gate; the palace sanctums stand behind it.
   *  The defenders (side 0) hold the south. */
  private layoutTerra() {
    const r = this.rnd;
    const avenue: [number, number][] = []; for (let z = -215; z <= 215; z += 10) avenue.push([0, z]);
    this.roadLine(avenue, 14);
    this.roadLine([[-215, 22], [-30, 22], [30, 22], [215, 22]], 10);
    this.roadLine([[-215, -72], [215, -72]], 8);
    this.baseH = this.height.slice();
    // the Imperial Palace across the south: the Eternity Gate on the avenue, curtain walls and towers either side;
    // inside, the throne hall of the Golden Throne between two towers, the courtyard with saints and braziers
    const zG = PALACE.z;
    this.flatten(0, zG, 84, 40, 0, null, 6);
    this.place('eternity_gate', 0, zG, 0, false);
    for (const sg of [-1, 1]) {
      this.place('gate_tower', sg * 26.2, zG, 0, false);
      // from the gate outward: three walls, a tower, two walls, a tower, a wall (the last runs off the map edge)
      let x = 37;
      for (const seg of ['w', 'w', 'w', 't', 'w', 'w', 't', 'w']) {
        if (seg === 'w') { this.place('palace_wall', sg * (x + 12), zG, 0); x += 24; } else { this.place('palace_tower', sg * (x + 12.2), zG, 0); x += 24.4; }
      }
      this.place('brazier', sg * 9.5, zG - 21, 0, false);          // before the gate (the model's brazier anchors)
      this.place('palace_tower', sg * 45, PALACE.hall - 12, 0);
      this.place('brazier', sg * 9.5, PALACE.hall - 25, 0, false);  // at the throne hall's steps
      this.place('statue', sg * 11, PALACE.hall - 31, -sg * Math.PI / 2);
      this.place('cathedral', sg * 100, 172, Math.PI / 2);
      // Rhinos of the palace garrison parked in the courtyard and behind the defence line
      this.place('rhino', sg * 62, zG + 14, Math.PI / 2 + sg * 0.08, false);
      this.place('rhino', sg * 52, zG - 24, sg * 0.15, false);
    }
    this.place('throne_hall', 0, PALACE.hall, 0);
    // statues of the Emperor's saints and primarchs line the avenue: great monuments alternating with saints on foot
    let alt = 0;
    for (let z = -160; z <= 90; z += 27) {   // stops short of the gate: its front is kept clear
      if (Math.abs(z - 22) < 14 || Math.abs(z + 72) < 12) continue;
      const piece = alt++ % 2 ? 'statue' : 'monument';
      this.place(piece, -15, z, piece === 'statue' ? -Math.PI / 2 : 0); this.place(piece, 15, z, piece === 'statue' ? Math.PI / 2 : 0);
    }
    this.place('emperor_statue', 0, 22, 0); // the great plaza at the crossing: the Emperor enthroned, facing the enemy
    this.place('equestrian', -30, 106, 0); this.place('equestrian', 30, 106, 0);   // before the gate, riding out north
    for (let z = -170; z <= 100; z += 18) { if (Math.abs(z - 22) < 10) continue; this.place('lamp', 10, z, -Math.PI / 2, false); this.place('lamp', -10, z + 9, Math.PI / 2, false); }
    // the defenders' line in front of the wall
    for (let x = -120; x <= 120; x += 6) {
      if (Math.abs(x) < 12) continue;
      const z = 100 + Math.cos(x / 36) * 2;
      this.place(r() < 0.7 ? 'sandbags' : 'barricade', x, z, 0, false);
    }
    for (let x = -130; x <= 130; x += 13) if (Math.abs(x) > 14) this.place('tank_trap', x + r() * 3, 82 + r() * 4, r() * 3, false);
    this.place('bunker', -70, 116, Math.PI); this.place('bunker', 70, 116, Math.PI);
    this.scatter('crates', 8, -110, 110, 104, 119);
    this.scatter('barrels', 6, -110, 110, 104, 119);
    // the besieged hab district to the north: palace precinct blocks, siege damage
    this.place('chapel', -58, -20, 0); this.place('chapel', 58, -28, Math.PI);
    this.place('hab', -62, -112, 0); this.place('hab', 60, -118, Math.PI / 2);
    this.place('manufactorum', -96, 48, Math.PI / 2); this.place('hab', 96, 52, 0);
    this.wallRow(-28, -150, -28, -86, 0.7); this.wallRow(28, -150, 28, -86, 0.7);
    this.wallRow(-110, -50, -36, -50, 0.75); this.wallRow(36, -46, 110, -46, 0.75);
    this.wallRow(-34, 40, -34, 70, 0.6); this.wallRow(34, 40, 34, 70, 0.6);
    this.place('wreck', -46, 6, 1.2); this.place('wreck', 50, 64, 2.4); this.place('wreck', -8, -120, 0.4);
    this.scatter('rubble', 18, -140, 140, -150, 60);
    for (let k = 0; k < 22; k++) {
      const x = -160 + r() * 320, z = -150 + r() * 200;
      if (this.near(x, z, 6)) continue;
      this.crater(x, z, 2.5 + r() * 4.5);
    }
    for (let k = 0; k < 7; k++) this.fires.push({ x: -130 + r() * 260, z: -140 + r() * 170, y: 0, s: 0.6 + r() });
  }

  private layoutTrenches() {
    const r = this.rnd;
    const main: [number, number][] = []; for (let z = -215; z <= 215; z += 10) main.push([Math.sin(z / 70) * 6 - 4, z]);
    this.roadLine(main.filter(([, z]) => z < 20 || z > 120), 8);
    this.baseH = this.height.slice();
    const zig = (x0: number, x1: number, z: number, amp: number, seg: number) => {
      const pts: [number, number][] = [];
      let k = 0;
      for (let x = x0; x <= x1; x += seg) pts.push([x, z + ((k++) % 2 ? amp : -amp)]);
      return pts;
    };
    this.trenchLine(zig(-150, 150, 56, 1.6, 16));
    this.trenchLine(zig(-110, 110, 88, 1.4, 14));
    for (const x of [-84, -14, 56]) this.trenchLine([[x, 59], [x + 4, 72], [x, 86]]);
    this.place('bunker', -70, 74, Math.PI); this.place('bunker', 70, 74, Math.PI); this.place('bunker', 4, 100, Math.PI);
    this.place('watchtower', -125, 96, 0); this.place('watchtower', 125, 96, 0);
    this.scatter('crates', 8, -100, 100, 95, 125);
    this.scatter('barrels', 6, -100, 100, 95, 125);
    // no man's land
    for (const z of [34, 6]) for (let x = -150; x <= 150; x += 4.5) if (r() < 0.82 && Math.abs(x) > 6) this.place('wire', x, z + r() * 2, r() * 0.3 - 0.15, false);
    for (let x = -140; x <= 140; x += 12) this.place('tank_trap', x + r() * 5, 20 + r() * 8, r() * 3, false);
    this.place('wreck', -40, 14, 0.5); this.place('wreck', 50, -12, 2.2); this.place('wreck', 110, 24, 1.0);
    for (let k = 0; k < 70; k++) {
      const x = -170 + r() * 340, z = -70 + r() * 112;
      if (this.near(x, z, 4)) continue;
      this.crater(x, z, 2 + r() * 5.5);
    }
    // ruins to the north
    this.place('manufactorum', -56, -98, 0);
    this.place('hab', 60, -92, 0);
    this.place('chapel', 0, -78, 0);
    this.place('cathedral', -70, -152, 0);
    this.place('smokestack', -104, -128, 0); this.place('smokestack', 110, -138, 0);
    this.wallRow(-36, -66, -36, -20, 0.9); this.wallRow(34, -60, 34, -22, 0.9);
    this.scatter('rubble', 18, -130, 130, -110, -10);
    for (let x = -100; x <= 100; x += 9) if (r() < 0.6) this.place('ork_barricade', x + r() * 3, -140 + r() * 6, r() * 0.6 - 0.3, false);
    for (let k = 0; k < 9; k++) this.place('ork_totem', -110 + r() * 220, -148 - r() * 25, r() * 6, false);
    for (let k = 0; k < 10; k++) this.fires.push({ x: -130 + r() * 260, z: -100 + r() * 130, y: 0, s: 0.6 + r() });
  }

  private finish() {
    // resolve placement heights and raster footprints into the sim grids
    for (const p of this.placements) {
      if (Number.isNaN(p.y)) p.y = this.heightAt(p.x, p.z);
      if (p.piece === 'trench_wall') p.y = (this.baseH ?? this.height)[this.hi(p.x, p.z)] ?? p.y;
      if (p.piece === 'lamp') this.lamps.push({ x: p.x + Math.cos(-p.rot) * 1.0, y: p.y + 4.9, z: p.z + Math.sin(-p.rot) * 1.0 });
      const f = this.foot[p.piece];
      if (!f) continue;
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      if (f.block) {
        const id = this.solids.push({ x: p.x, z: p.z, c, s, hw: f.w / 2, hd: f.d / 2 }) - 1;
        const R2 = Math.hypot(f.w, f.d) / 2 + 1;
        for (let gx = Math.floor((p.x - R2 + HALF) / 8); gx <= Math.floor((p.x + R2 + HALF) / 8); gx++) for (let gz = Math.floor((p.z - R2 + HALF) / 8); gz <= Math.floor((p.z + R2 + HALF) / 8); gz++) {
          const k = gx * 100 + gz; const l = this.solidGrid.get(k); if (l) l.push(id); else this.solidGrid.set(k, [id]);
        }
      }
      const R = Math.hypot(f.w, f.d) / 2 + 3;
      for (let cz = Math.floor((p.z - R + HALF) / CELL); cz <= (p.z + R + HALF) / CELL; cz++) for (let cx = Math.floor((p.x - R + HALF) / CELL); cx <= (p.x + R + HALF) / CELL; cx++) {
        if (cx < 0 || cz < 0 || cx >= GN || cz >= GN) continue;
        const wx = cx * CELL - HALF + CELL / 2, wz = cz * CELL - HALF + CELL / 2;
        // footprint local coords (three.js rotation about Y by p.rot)
        const lx = (wx - p.x) * c - (wz - p.z) * s, lz = (wx - p.x) * s + (wz - p.z) * c;
        const ox = Math.abs(lx) - f.w / 2, oz = Math.abs(lz) - f.d / 2;
        const o = Math.max(ox, oz);
        const i = cz * GN + cx;
        if (o < 0.9) {
          if (f.block) this.blocked[i] = 1;
          if (f.h > 2.4 && f.block) this.losH[i] = Math.max(this.losH[i], p.y + f.h * 0.85);
        }
        if (f.cover > 0 && o < 2.2) this.cover[i] = Math.max(this.cover[i], f.cover * (o < 0 ? 1 : 1 - o / 2.6));
      }
      if (['wall_ruin', 'wall_ruin2', 'rubble', 'manufactorum', 'hab', 'chapel', 'wreck'].includes(p.piece)) this.paint(this.rubble, p.x, p.z, Math.max(f.w, f.d) * 0.7, 0.8, 0.4);
    }
    for (let i = 0; i < GN * GN; i++) if (this.trench[i]) this.cover[i] = Math.max(this.cover[i], 0.72);
    for (const c of this.craters) {
      const ci = this.cellOf(c.x, c.z);
      if (ci >= 0) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const i = ci + dz * GN + dx;
        if (i >= 0 && i < GN * GN && Math.hypot(dx, dz) * CELL < c.r) this.cover[i] = Math.max(this.cover[i], 0.35);
      }
    }
    for (const f of this.fires) f.y = this.heightAt(f.x, f.z);
    // keep the map edges impassable
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) {
      const x = i * CELL - HALF + 1, z = j * CELL - HALF + 1;
      if (Math.abs(x) > PLAY || Math.abs(z) > PLAY) this.blocked[j * GN + i] = 1;
    }
  }
}
