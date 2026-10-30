import * as THREE from 'three';
import type { Battle, Unit } from '../sim/Battle';

/** A place where something worth filming is happening; heat decays over a few seconds. */
interface Hot { x: number; z: number; heat: number }
type ShotKind = 'orbit' | 'track' | 'low' | 'chase' | 'tank';
interface Shot { kind: ShotKind; x: number; z: number; t: number; dur: number; a: number; r: number; h: number; dir: number; unit: Unit | null }

/**
 * Cinematic mode: the interface disappears behind letterbox bars and the game directs its own camera.
 * It cuts between low tracking shots, slow orbits and close-ups on the hottest part of the battle
 * (melee, charges, tank fire, explosions). With a unit selected it stays on that unit as a chase camera.
 */
export class Cinematic {
  active = false;
  private hot: Hot[] = [];
  private shot: Shot | null = null;
  private bars: HTMLDivElement[] = [];
  private follow: Unit | null = null;
  private look = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private seq = 0;
  private checkT = 0;

  /** clear(x0, z0, x1, z1): nothing solid between the points; open(x, z): room for a camera there (no wall within a few metres) */
  constructor(ui: HTMLElement, private cam: THREE.PerspectiveCamera, private heightAt: (x: number, z: number) => number,
    private clear: (x0: number, z0: number, x1: number, z1: number) => boolean, private open: (x: number, z: number) => boolean) {
    for (const side of ['top', 'bottom']) {
      const b = document.createElement('div');
      b.className = `cine-bar ${side}`;
      ui.appendChild(b);
      this.bars.push(b);
    }
  }

  /** Something happened at x,z: melee blows add a little, charges, tank fire and explosions a lot. */
  heat(x: number, z: number, amount: number) {
    for (const h of this.hot) if (Math.abs(h.x - x) < 14 && Math.abs(h.z - z) < 14) { h.heat += amount; h.x += (x - h.x) * 0.1; h.z += (z - h.z) * 0.1; return; }
    if (this.hot.length < 48) this.hot.push({ x, z, heat: amount });
  }

  toggle(follow: Unit | null) {
    this.active = !this.active;
    document.body.classList.toggle('cinematic', this.active);
    this.follow = this.active ? follow : null;
    this.shot = null;
    return this.active;
  }

  /** Where the shadow camera / listener should centre while a shot runs. */
  get focus() { return this.shot ? { x: this.shot.x, z: this.shot.z } : null; }

  private pick(b: Battle) {
    this.seq++;
    const f = this.follow && b.active(this.follow) ? this.follow : null;
    if (f) {
      const al = f.soldiers.filter((s) => s.alive);
      const x = al.reduce((s, o) => s + o.x, 0) / al.length, z = al.reduce((s, o) => s + o.z, 0) / al.length;
      const kind: ShotKind = f.vehicle ? 'tank' : this.seq % 3 === 2 ? 'low' : 'chase';
      return { kind, x, z, t: 0, dur: 7 + Math.random() * 3, a: f.yaw + Math.PI + (Math.random() - 0.5) * 1.6, r: f.vehicle ? 11 : 9 + Math.random() * 4, h: kind === 'low' ? 1.4 : 3.2, dir: Math.random() < 0.5 ? 1 : -1, unit: f };
    }
    // the hottest spot that is not the one we just filmed (variety), else the biggest fight
    const ranked = [...this.hot].sort((p, q) => q.heat - p.heat);
    let spot: Hot | undefined = ranked.find((h) => !this.shot || Math.hypot(h.x - this.shot.x, h.z - this.shot.z) > 25) ?? ranked[0];
    let unit: Unit | null = null;
    if (!spot || spot.heat < 1) {
      // quiet battlefield: an advancing or firing unit
      const live = b.units.filter((u) => b.active(u) && (u.moving || u.target));
      unit = live[Math.floor(Math.random() * live.length)] ?? b.units.find((u) => b.active(u)) ?? null;
      if (!unit) return null;
      spot = { x: unit.x, z: unit.z, heat: 0 };
    }
    // a vehicle close to the action gets its own close-up now and then
    if (!unit) for (const u of b.units) if (u.vehicle && b.active(u) && Math.hypot(u.x - spot.x, u.z - spot.z) < 40 && this.seq % 4 === 0) unit = u;
    // otherwise film the unit nearest the action (soldiers in frame, not the shell crater)
    if (!unit) {
      let bd = 40;
      for (const u of b.units) { if (!b.active(u)) continue; const d = Math.hypot(u.x - spot.x, u.z - spot.z); if (d < bd) { bd = d; unit = u; } }
    }
    const kinds: ShotKind[] = unit?.vehicle ? ['tank'] : ['track', 'orbit', 'low'];
    const kind = kinds[this.seq % kinds.length];
    const x = unit ? unit.x : spot.x, z = unit ? unit.z : spot.z;
    return { kind, x, z, t: 0, dur: 5.5 + Math.random() * 2.5, a: Math.random() * Math.PI * 2, r: kind === 'orbit' ? 18 + Math.random() * 8 : kind === 'low' ? 10 + Math.random() * 4 : 14 + Math.random() * 6, h: kind === 'low' ? 1.3 : kind === 'orbit' ? 6 + Math.random() * 3 : 2.6, dir: Math.random() < 0.5 ? 1 : -1, unit };
  }

  update(dt: number, b: Battle) {
    for (const h of this.hot) h.heat *= Math.exp(-dt * 0.45);
    this.hot = this.hot.filter((h) => h.heat > 0.15);
    if (!this.shot || this.shot.t >= this.shot.dur) { this.shot = this.pick(b); if (this.shot) this.aim(this.shot); }
    const s = this.shot;
    if (!s) return;
    s.t += dt;
    // a moving shot that swings behind a wall cuts to the next one
    this.checkT -= dt;
    if (this.checkT <= 0 && s.t > 0.6) {
      this.checkT = 0.4;
      const pts = s.unit ? s.unit.soldiers.filter((o) => o.alive).slice(0, 6) : [];
      const seen = pts.length ? pts.filter((o) => this.clear(this.pos.x, this.pos.z, o.x, o.z)).length / pts.length : this.clear(this.pos.x, this.pos.z, s.x, s.z) ? 1 : 0;
      if (seen < 0.34) s.t = s.dur;
    }
    // shots on a unit keep the unit in frame as it moves
    if (s.unit && b.active(s.unit)) {
      const al = s.unit.soldiers.filter((o) => o.alive);
      const ux = al.reduce((q, o) => q + o.x, 0) / al.length, uz = al.reduce((q, o) => q + o.z, 0) / al.length;
      s.x += (ux - s.x) * Math.min(1, dt * 2); s.z += (uz - s.z) * Math.min(1, dt * 2);
    }
    const k = s.t / s.dur;
    let a = s.a, r = s.r, h = s.h, lookH = 1.5;
    switch (s.kind) {
      case 'orbit': a += s.dir * k * 0.9; break;
      case 'track': a += s.dir * k * 0.35; r *= 1 - k * 0.15; break;
      case 'low': a += s.dir * k * 0.25; lookH = 1.8; break;
      case 'chase': if (s.unit) a = s.unit.yaw + Math.PI + s.dir * 0.5; lookH = 1.6; break;
      case 'tank': {
        // low three-quarter angle on the hull, drifting round it
        if (s.unit) a = s.unit.yaw + Math.PI * 0.75 * s.dir + k * 0.5 * s.dir;
        r = 12; h = 1.6; lookH = 2.2; break;
      }
    }
    this.pos.set(s.x + Math.sin(a) * r, 0, s.z + Math.cos(a) * r);
    this.pos.y = Math.max(this.heightAt(this.pos.x, this.pos.z) + h, this.heightAt(s.x, s.z) + h * 0.6);
    this.look.set(s.x, this.heightAt(s.x, s.z) + lookH, s.z);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    const fov = s.kind === 'orbit' ? 34 : 28;
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }

  /** Start the shot from an angle with a clear view of the subject (try eight directions round it). */
  private aim(s: Shot) {
    // score each of 8 directions x 2 distances by how many of the subject's soldiers the camera would actually see
    const pts = s.unit ? s.unit.soldiers.filter((o) => o.alive).slice(0, 12).map((o) => [o.x, o.z]) : [[s.x, s.z]];
    let best = -1, ba = s.a, br = s.r;
    for (const r of [s.r, s.r * 0.65]) for (let i = 0; i < 8; i++) {
      const ang = s.a + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 4;
      const x = s.x + Math.sin(ang) * r, z = s.z + Math.cos(ang) * r;
      if (!this.open(x, z)) continue;
      let seen = 0;
      for (const [px, pz] of pts) if (this.clear(x, z, px, pz)) seen++;
      const score = seen / pts.length + (r === s.r ? 0.05 : 0);
      if (score > best) { best = score; ba = ang; br = r; }
    }
    s.a = ba; s.r = br;
    if (best < 0.3) s.dur = Math.min(s.dur, 2.5);   // poor view everywhere: keep it short
    this.pos.set(s.x + Math.sin(ba) * br, 0, s.z + Math.cos(ba) * br);
  }

  dispose() { for (const b of this.bars) b.remove(); document.body.classList.remove('cinematic'); }
}
