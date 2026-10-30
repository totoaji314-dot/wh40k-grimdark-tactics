import * as THREE from 'three';
import type { Battle, Soldier } from '../sim/Battle';
import { angDiff } from '../sim/Battle';
import type { Effects } from './Effects';
import { addHeroLight } from './UnitLibrary';

/** Pivots and sizes written by tools/blender/vehicles.py (three.js space, metres). */
export interface VehicleMeta {
  hull: string; track: string; turret: string; barrel: string;
  turretAt: number[]; barrelAt: number[]; muzzle: number[]; hullMuzzle: number[];
  sponsons: number[][]; exhausts: number[][];
  trackTile: number; length: number; width: number; height: number;
}

interface View {
  s: Soldier; meta: VehicleMeta;
  root: THREE.Group; hull: THREE.Group; turret: THREE.Group; barrel: THREE.Group;
  trackMat: THREE.MeshStandardMaterial | null;
  pitch: number; roll: number; elev: number;
  recoil: number;      // 1 right after the main gun fires, decays to 0 (barrel snaps back and runs out again)
  kick: number;        // hull rock from the shot
  kickYaw: number;     // direction of the shot relative to the hull
  trackOff: number;
  exhaustAcc: number; smokeAcc: number;
  dead: boolean;
  fly: { vx: number; vy: number; vz: number; sx: number; sz: number } | null;
}

/** A vehicle copy of an environment material: same textures and shader tweaks, plus the units' camera fill and rim light. */
const cloneMat = (m: THREE.MeshStandardMaterial) => {
  const c = m.clone(); const base = m.onBeforeCompile;
  const rim = m.name === 'track' ? 0.25 : 0.4;
  c.onBeforeCompile = (sh, r) => { base.call(m, sh, r); addHeroLight(sh, 0.8, rim); };
  c.customProgramCacheKey = () => 'vehicle-' + rim;
  return c;
};

/**
 * Tanks on the battlefield: the hull follows the ground, the turret traverses, the barrel elevates and recoils,
 * tracks scroll with the distance driven, engines smoke, damaged hulls burn, destroyed ones lose the turret.
 */
export class VehicleViews {
  views = new Map<Soldier, View>();
  private paints = new Map<string, THREE.MeshStandardMaterial>();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private wreck: THREE.MeshStandardMaterial;
  private v = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private makePiece: (name: string) => THREE.Group, private getMat: (name: string) => THREE.MeshStandardMaterial,
    private meta: Record<string, VehicleMeta>, private fx: Effects, private heightAt: (x: number, z: number) => number) {
    this.wreck = cloneMat(getMat('rust'));
    this.wreck.color.setRGB(0.42, 0.33, 0.27);
    this.wreck.roughness = 1;
    this.wreck.name = 'wreck';
  }

  /** Paint per regiment: Cadian olive drab as authored, Krieg a darker grey-green. */
  private paint(faction: string) {
    let m = this.paints.get(faction);
    if (!m) {
      m = cloneMat(this.getMat('paint'));
      if (faction === 'krieg') m.color.setRGB(0.78, 0.84, 0.86);
      this.paints.set(faction, m);
    }
    return m;
  }

  /** Hull + turret + barrel assembled at the origin (also used for the unit-card portrait). */
  assemble(model: string, faction: string) {
    const M = this.meta[model];
    const root = new THREE.Group();
    const hull = this.makePiece(M.hull), track = this.makePiece(M.track), turret = this.makePiece(M.turret), barrel = this.makePiece(M.barrel);
    const paint = this.paint(faction);
    for (const g of [hull, turret, barrel]) g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      if (name === 'paint') { m.material = paint; return; }
      let vm = this.mats.get(name);
      if (!vm) { vm = cloneMat(m.material as THREE.MeshStandardMaterial); vm.name = name; this.mats.set(name, vm); }
      m.material = vm;
    });
    let trackMat: THREE.MeshStandardMaterial | null = null;
    track.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const base = m.material as THREE.MeshStandardMaterial;
      const tm = cloneMat(base);
      // own texture objects (same image data) so each tank can scroll its tracks on its own
      if (base.map) tm.map = base.map.clone();
      if (base.normalMap) tm.normalMap = base.normalMap.clone();
      m.material = tm;
      trackMat = tm;
    });
    hull.add(track);
    turret.position.fromArray(M.turretAt); hull.add(turret);
    barrel.position.fromArray(M.barrelAt); turret.add(barrel);
    root.add(hull);
    root.rotation.order = 'YXZ';
    return { root, hull, turret, barrel, trackMat: trackMat as THREE.MeshStandardMaterial | null, M };
  }

  add(s: Soldier) {
    if (this.views.has(s) || !s.def.vehicle) return;
    const a = this.assemble(s.def.vehicle.model, s.def.faction);
    this.scene.add(a.root);
    const v: View = { s, meta: a.M, root: a.root, hull: a.hull, turret: a.turret, barrel: a.barrel, trackMat: a.trackMat, pitch: 0, roll: 0, elev: 0, recoil: 0, kick: 0, kickYaw: 0, trackOff: 0, exhaustAcc: 0, smokeAcc: 0, dead: false, fly: null };
    this.views.set(s, v);
    this.place(v, 1);
  }

  /** World position of a weapon's muzzle; firing the main gun starts the recoil. */
  muzzle(s: Soldier, mount: string | undefined, out: THREE.Vector3) {
    const v = this.views.get(s);
    if (!v) return out.set(s.x, s.y + 2, s.z);
    v.root.updateMatrixWorld(true);
    const M = v.meta;
    if (mount === 'turret') {
      v.recoil = 1; v.kick = 1; v.kickYaw = v.turret.rotation.y;
      return v.barrel.localToWorld(out.fromArray(M.muzzle));
    }
    if (mount === 'sponsonL') return v.hull.localToWorld(out.fromArray(M.sponsons[0]));
    if (mount === 'sponsonR') return v.hull.localToWorld(out.fromArray(M.sponsons[1]));
    return v.hull.localToWorld(out.fromArray(M.hullMuzzle));
  }

  /** The hull brews up: everything charred, the turret is thrown off by the ammunition explosion. */
  destroy(s: Soldier) {
    const v = this.views.get(s);
    if (!v || v.dead) return;
    v.dead = true;
    v.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = this.wreck; });
    this.scene.attach(v.turret);
    const a = Math.random() * Math.PI * 2;
    v.fly = { vx: Math.cos(a) * 2.5, vy: 8 + Math.random() * 3, vz: Math.sin(a) * 2.5, sx: (Math.random() - 0.5) * 3, sz: (Math.random() - 0.5) * 3 };
  }

  private place(v: View, k: number) {
    const s = v.s, M = v.meta;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    const L = M.length * 0.42, W = M.width * 0.4;
    const H = this.heightAt;
    const hF = H(s.x + fx * L, s.z + fz * L), hB = H(s.x - fx * L, s.z - fz * L);
    const hL = H(s.x + rx * W, s.z + rz * W), hR = H(s.x - rx * W, s.z - rz * W);
    v.pitch += (Math.atan2(hB - hF, 2 * L) - v.pitch) * k;
    v.roll += (Math.atan2(hL - hR, 2 * W) - v.roll) * k;
    const rock = v.kick * 0.035;
    v.root.position.set(s.x, (hF + hB + hL + hR) / 4, s.z);
    v.root.rotation.set(v.pitch - rock * Math.cos(v.kickYaw), s.yaw, v.roll + rock * Math.sin(v.kickYaw));
  }

  update(dt: number, b: Battle) {
    for (const v of this.views.values()) {
      const s = v.s, M = v.meta;
      if (v.dead) {
        if (v.fly && dt > 0) {
          const t = v.turret, f = v.fly;
          f.vy -= 18 * dt;
          t.position.x += f.vx * dt; t.position.y += f.vy * dt; t.position.z += f.vz * dt;
          t.rotation.x += f.sx * dt; t.rotation.z += f.sz * dt;
          const g = this.heightAt(t.position.x, t.position.z) + 0.3;
          if (t.position.y < g && f.vy < 0) { t.position.y = g; v.fly = null; this.fx.dust(t.position.x, g, t.position.z, 3); }
        }
        continue;
      }
      const vs = b.vstate.get(s);
      if (!vs) continue;
      v.kick = Math.max(0, v.kick - dt * 3);
      this.place(v, Math.min(1, dt * 6));
      // turret traverse, gun laying (a little ballistic arc at long range), recoil
      v.turret.rotation.y = angDiff(s.yaw, vs.turret);
      const t = vs.tgt;
      const range = t ? Math.hypot(t.x - s.x, t.z - s.z) : 0;
      const want = t ? Math.atan2(t.y + 1 - (s.y + 2.6), range) + range * 0.0011 : 0;
      v.elev += (Math.max(-0.12, Math.min(0.3, want)) - v.elev) * Math.min(1, dt * 2.5);
      v.barrel.rotation.x = -v.elev;
      v.recoil = Math.max(0, v.recoil - dt * 1.5);
      const back = v.recoil > 0.85 ? (1 - v.recoil) / 0.15 : v.recoil / 0.85;
      v.barrel.position.set(M.barrelAt[0], M.barrelAt[1], M.barrelAt[2] - 0.55 * back);
      // tracks: the bottom run stays on the ground, so the texture moves backward along the loop as the hull drives forward
      v.trackOff -= (vs.speed * dt + Math.abs(vs.turnRate) * M.width * 0.4 * dt) / M.trackTile;
      if (v.trackMat?.map) { v.trackMat.map.offset.x = v.trackOff; if (v.trackMat.normalMap) v.trackMat.normalMap.offset.x = v.trackOff; }
      if (dt <= 0) continue;
      // engine exhaust: idle puffs, heavier when driving
      v.exhaustAcc += dt * (1.2 + Math.abs(vs.speed) * 1.6);
      while (v.exhaustAcc > 1) {
        v.exhaustAcc -= 1;
        const e = M.exhausts[Math.random() < 0.5 ? 0 : 1];
        const p = v.hull.localToWorld(this.v.fromArray(e));
        this.fx.spawn(p.x, p.y, p.z, { size: 0.35, grow: 1.4, life: 1.6 + Math.random(), color: 0x2e2a26, alpha: 0.42, frame: 1, vy: 1.6, vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, drag: 0.6 });
      }
      // damage: smoke from the engine deck below half hull points, fire below a quarter
      const hp = s.hp / s.maxHp;
      if (hp < 0.5) {
        v.smokeAcc += dt * (hp < 0.25 ? 9 : 4);
        while (v.smokeAcc > 1) {
          v.smokeAcc -= 1;
          const p = v.hull.localToWorld(this.v.set((Math.random() - 0.5) * 1.2, 2.2, -2.0 + (Math.random() - 0.5)));
          this.fx.spawn(p.x, p.y, p.z, { size: 0.8, grow: 2.2, life: 3 + Math.random() * 2, color: 0x2a2420, alpha: 0.55, frame: 1, vy: 1.8 + Math.random(), drag: 0.25 });
          if (hp < 0.25) this.fx.spawn(p.x, p.y, p.z, { size: 0.7, grow: -0.3, life: 0.5 + Math.random() * 0.3, color: Math.random() < 0.5 ? 0xff7020 : 0xffa040, frame: 2, add: true, vy: 2.4 });
        }
      }
    }
  }

  dispose() {
    for (const v of this.views.values()) { this.scene.remove(v.root); this.scene.remove(v.turret); }
    this.views.clear();
  }
}
