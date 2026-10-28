import { BattleMap, CELL, GN, HALF } from '../world/MapGen';

/** A* on the battle grid (8-connected) with line-of-walk path smoothing. */
export class Nav {
  private g = new Float32Array(GN * GN);
  private f = new Float32Array(GN * GN);
  private from = new Int32Array(GN * GN);
  private stamp = new Uint32Array(GN * GN);
  private closed = new Uint32Array(GN * GN);
  private run = 1;
  private heap: number[] = [];
  constructor(private map: BattleMap) {}

  walkable(i: number) { return i >= 0 && i < GN * GN && this.map.blocked[i] === 0; }

  /** Straight walkable line between two world points (grid DDA, slightly conservative). */
  clear(x0: number, z0: number, x1: number, z1: number) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(L / (CELL * 0.45));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (this.map.isBlocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  nearestWalkable(x: number, z: number): [number, number] {
    if (!this.map.isBlocked(x, z)) return [x, z];
    for (let r = 1; r < 30; r++) for (let a = 0; a < 16; a++) {
      const px = x + Math.cos(a / 16 * Math.PI * 2) * r * CELL, pz = z + Math.sin(a / 16 * Math.PI * 2) * r * CELL;
      if (!this.map.isBlocked(px, pz)) return [px, pz];
    }
    return [x, z];
  }

  path(x0: number, z0: number, x1: number, z1: number): [number, number][] {
    [x1, z1] = this.nearestWalkable(x1, z1);
    if (this.clear(x0, z0, x1, z1)) return [[x1, z1]];
    const sx = Math.floor((x0 + HALF) / CELL), sz = Math.floor((z0 + HALF) / CELL);
    const tx = Math.floor((x1 + HALF) / CELL), tz = Math.floor((z1 + HALF) / CELL);
    let s = sz * GN + sx;
    const t = tz * GN + tx;
    if (!this.walkable(s)) { const [ax, az] = this.nearestWalkable(x0, z0); s = Math.floor((az + HALF) / CELL) * GN + Math.floor((ax + HALF) / CELL); }
    const run = ++this.run;
    const H = (i: number) => { const dx = Math.abs((i % GN) - tx), dz = Math.abs(Math.floor(i / GN) - tz); return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz); };
    this.heap.length = 0;
    this.g[s] = 0; this.f[s] = H(s); this.stamp[s] = run; this.from[s] = -1;
    this.push(s);
    let found = false, iter = 0;
    while (this.heap.length && iter++ < 60000) {
      const c = this.pop();
      if (this.closed[c] === run) continue;
      this.closed[c] = run;
      if (c === t) { found = true; break; }
      const cx = c % GN, cz = Math.floor(c / GN);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
        const ni = nz * GN + nx;
        if (!this.walkable(ni) || this.closed[ni] === run) continue;
        if (dx && dz && (!this.walkable(cz * GN + nx) || !this.walkable(nz * GN + cx))) continue;
        const cost = this.g[c] + (dx && dz ? 1.4142 : 1) + this.map.cover[ni] * 0.1;
        if (this.stamp[ni] !== run || cost < this.g[ni]) {
          this.stamp[ni] = run; this.g[ni] = cost; this.f[ni] = cost + H(ni); this.from[ni] = c;
          this.push(ni);
        }
      }
    }
    if (!found) return [[x1, z1]];
    const cells: number[] = [];
    for (let c = t; c !== -1; c = this.from[c]) cells.push(c);
    cells.reverse();
    const pts: [number, number][] = cells.map((c) => [(c % GN) * CELL - HALF + CELL / 2, Math.floor(c / GN) * CELL - HALF + CELL / 2]);
    pts[pts.length - 1] = [x1, z1];
    // string pulling
    const out: [number, number][] = [];
    let ax = x0, az = z0, k = 0;
    while (k < pts.length - 1) {
      let j = pts.length - 1;
      while (j > k + 1 && !this.clear(ax, az, pts[j][0], pts[j][1])) j--;
      out.push(pts[j]); [ax, az] = pts[j]; k = j;
    }
    if (!out.length) out.push([x1, z1]);
    return out;
  }

  private push(i: number) {
    const h = this.heap, f = this.f;
    h.push(i);
    let k = h.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (f[h[p]] <= f[h[k]]) break; [h[p], h[k]] = [h[k], h[p]]; k = p; }
  }
  private pop() {
    const h = this.heap, f = this.f;
    const top = h[0]; const last = h.pop()!;
    if (h.length) {
      h[0] = last; let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1; let m = k;
        if (l < h.length && f[h[l]] < f[h[m]]) m = l;
        if (r < h.length && f[h[r]] < f[h[m]]) m = r;
        if (m === k) break;
        [h[m], h[k]] = [h[k], h[m]]; k = m;
      }
    }
    return top;
  }
}
