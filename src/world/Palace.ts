import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { PALACE, TERRA_FOOT, type BattleMap, type Placement } from './MapGen';
import { mulberry32 } from './noise';

/**
 * The Imperial Palace on the Holy Terra map: the Eternity Gate, curtain walls and towers, the throne hall with the
 * Golden Throne, the palace skyline, banners, braziers, servo-skulls, pilgrims, Rhinos and the statue scans.
 * Everything comes from public/assets/terra/palace.glb, modelled in tools/blender/terra_landmarks.py with three
 * hand-built detail levels per piece. Each piece and LOD is one InstancedMesh per material; instances move between
 * the LODs by camera distance (checked every few frames, rebuilt only when an instance changes level).
 */
export interface PalaceAnchor { p: [number, number, number]; yaw: number; h?: number; len?: number }
export interface PalacePiece { lods: string[]; tris: number[]; min: [number, number, number]; size: [number, number, number]; r: number; lodDist: [number, number] }
export interface PalaceMeta { pieces: Record<string, PalacePiece>; anchors: Record<string, Record<string, PalaceAnchor[]>>; tints: Record<string, [number, number, number]> }

/** map pieces the palace draws (the kit skips them when the palace loaded); gate_tower is invisible collision */
export const PALACE_PIECES = new Set([...Object.keys(TERRA_FOOT), 'palace_spire_a', 'palace_dome_b']);

/** saints and heroes on the avenue plinths (cycled), the four apostles in the gate's niches */
const AVENUE_STATUES = ['saint_george', 'emperor_augustus', 'warrior_minerva', 'hero_heracles', 'saint_kunigunde', 'athena_shield', 'hero_apollo', 'victorious_soldier', 'god_king'];
const NICHE_STATUES = ['saint_peter', 'saint_james', 'saint_thomas', 'saint_bartholomew'];

/** base-colour saturation kept per material (the texture is desaturated, then the tint applied): settles the clean
 *  ambientCG sets into the dusty dusk palette while gold, crimson cloth and the blue Rhinos keep their colour */
const SATURATION: Record<string, number> = {
  stone: 0.45, stone_pale: 0.45, stone_dark: 0.45, marble: 0.55, gold: 0.35, bronze: 0.4, iron: 0.5, roof: 0, cloth: 0.25,
  paving: 0.5, paint: 0.3, robe: 0.5, bone: 0.5, floor: 0.6, cable: 0.5,
};
/** the roof set is red clay: shown desaturated as dark slate; the cloth set is a dark weave (albedo ~0.1), so its
 *  crimson tint goes above 1 to land at a deep red instead of near black */
const TINT_OVERRIDE: Record<string, [number, number, number]> = { roof: [0.34, 0.37, 0.43], cloth: [2.1, 0.2, 0.14] };

export async function loadPalaceMeta(base: string): Promise<PalaceMeta> {
  const r = await fetch(base + 'palace.json');
  if (!r.ok) throw new Error('palace.json ' + r.status);
  return r.json();
}

/** Piece-local point -> world, with the kit's rotation sense (about +Y). */
function local(p: Placement, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + x * c + z * s, p.y + y, p.z - x * s + z * c];
}

/** Palace garrison posts (gate sentinels, sentries on the gate towers and walls) for the unit renderer:
 *  position and figure yaw (0 = facing +Z). Needed before the renderer is built, so it works from the meta alone. */
export function palaceSentries(map: BattleMap, meta: PalaceMeta) {
  const out: { x: number; y: number; z: number; yaw: number }[] = [];
  for (const p of map.placements) {
    const a = meta.anchors[p.piece];
    if (!a || (p.piece !== 'eternity_gate' && p.piece !== 'palace_wall')) continue;
    for (const k of ['sentinel', 'sentry']) for (const an of a[k] ?? []) {
      const [x, y, z] = local(p, ...an.p);
      if (Math.abs(x) > 205) continue;
      out.push({ x, y, z, yaw: p.rot + Math.PI + an.yaw });
    }
  }
  return out;
}

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material }
interface Inst { m: THREE.Matrix4; c: THREE.Vector3 }

/** One piece: its instances and, per LOD, one InstancedMesh per material part. */
class PieceSet {
  items: Inst[] = [];
  meshes: THREE.InstancedMesh[][] = [];
  lodOf = new Int8Array(0);
  constructor(public id: string, public meta: PalacePiece, private parts: Part[][], public shadow: boolean, public dynamic = false) {}
  add(m: THREE.Matrix4) {
    const c = new THREE.Vector3(0, this.meta.min[1] + this.meta.size[1] / 2, 0).applyMatrix4(m);
    this.items.push({ m, c });
  }
  build(group: THREE.Group) {
    const n = this.items.length;
    this.lodOf = new Int8Array(n).fill(-1);
    this.parts.forEach((list, lod) => {
      this.meshes[lod] = list.map(({ geo, mat }) => {
        const mesh = new THREE.InstancedMesh(geo, mat, n);
        if (this.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0; mesh.visible = false;
        mesh.castShadow = this.shadow; mesh.receiveShadow = true;
        mesh.name = `palace_${this.id}_L${lod}`;
        group.add(mesh);
        return mesh;
      });
    });
  }
  /** Move instances between LODs; rebuilds only the levels whose membership changed (or every call when dynamic). */
  update(cam: THREE.Vector3, bias: number) {
    const [d0, d1] = this.meta.lodDist;
    let changed = this.dynamic;
    for (let i = 0; i < this.items.length; i++) {
      const d = this.items[i].c.distanceTo(cam);
      const prev = this.lodOf[i];
      // 6% hysteresis so an instance sitting on a boundary does not flicker between levels
      const h = prev === -1 ? 1 : 1.06;
      let l = d < d0 * bias ? 0 : d < d1 * bias ? 1 : 2;
      if (prev !== -1 && l !== prev) { const back = prev < l ? d < [d0, d1][prev] * bias * h : d > [d0, d1][l] * bias / h; if (back) l = prev; }
      if (l !== prev) { this.lodOf[i] = l; changed = true; }
    }
    if (!changed) return;
    const counts = [0, 0, 0];
    for (let i = 0; i < this.items.length; i++) {
      const l = this.lodOf[i];
      for (const mesh of this.meshes[l]) mesh.setMatrixAt(counts[l], this.items[i].m);
      counts[l]++;
    }
    this.meshes.forEach((list, l) => {
      for (const mesh of list) {
        mesh.count = counts[l]; mesh.visible = counts[l] > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (counts[l]) mesh.computeBoundingSphere();
      }
    });
  }
  /** triangles currently submitted (before frustum culling) */
  tris() { return this.meshes.reduce((a, list, l) => a + (list[0]?.count ?? 0) * this.meta.tris[l], 0); }
}

export async function buildPalace(base: string, map: BattleMap, meta: PalaceMeta, castShadow: boolean) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(base + 'palace.glb');
  gltf.scene.updateMatrixWorld(true);
  const matCache = new Map<THREE.Material, THREE.Material>();
  const prepMat = (src: THREE.MeshStandardMaterial) => {
    let m = matCache.get(src) as THREE.MeshStandardMaterial | undefined;
    if (m) return m;
    m = src.clone();
    const name = src.name.replace(/\.\d+$/, '');
    const tint = TINT_OVERRIDE[name] ?? meta.tints[name];
    if (tint) m.color.setRGB(tint[0], tint[1], tint[2]);
    if (name === 'glow') { m.emissiveIntensity = 1.3; }
    if (name === 'glow_red') { m.emissiveIntensity = 2.2; }
    const sat = SATURATION[name] ?? (name.startsWith('scan_') ? 0.6 : 1);
    if (sat < 1) {
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  sampledDiffuseColor.rgb = mix( vec3( dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) ), sampledDiffuseColor.rgb, ${sat.toFixed(2)} );
  diffuseColor *= sampledDiffuseColor;
#endif`);
      };
      m.customProgramCacheKey = () => 'palace-sat-' + sat.toFixed(2);
    }
    matCache.set(src, m);
    return m;
  };
  // node name -> parts with geometry baked into the piece's frame (de-quantised first, as in Props.ts)
  const nodeParts = new Map<string, Part[]>();
  for (const root of gltf.scene.children) {
    const list: Part[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone();
      for (const k of Object.keys(geo.attributes)) {
        const at = geo.attributes[k] as THREE.BufferAttribute;
        if (at.array instanceof Float32Array && !at.normalized) continue;
        const fl = new Float32Array(at.count * at.itemSize);
        for (let i = 0; i < at.count; i++) for (let j = 0; j < at.itemSize; j++) fl[i * at.itemSize + j] = at.getComponent(i, j);
        geo.setAttribute(k, new THREE.BufferAttribute(fl, at.itemSize));
      }
      geo.applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingSphere();
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) list.push({ geo, mat: prepMat(mat as THREE.MeshStandardMaterial) });
    });
    nodeParts.set(root.name, list);
  }
  const sets = new Map<string, PieceSet>();
  const set = (id: string) => {
    let s = sets.get(id);
    if (s) return s;
    const pm = meta.pieces[id];
    if (!pm) return null;
    const parts = pm.lods.map((n) => nodeParts.get(n) ?? []);
    const far = id.startsWith('palace_spire') || id.startsWith('palace_dome');
    const small = pm.r < 1.5;
    s = new PieceSet(id, pm, parts, castShadow && !far && !small, id === 'servo_skull');
    sets.set(id, s);
    return s;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  /** place a piece at world x, y, z with yaw about +Y (the pieces face -Z at yaw 0) */
  const put = (id: string, x: number, y: number, z: number, yaw: number, s = 1) => {
    const ps = set(id);
    if (!ps) return;
    q.setFromAxisAngle(up, yaw);
    ps.add(m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)).clone());
  };
  const anchors = (piece: string, kind: string) => meta.anchors[piece]?.[kind] ?? [];
  /** put `id` at each `kind` anchor of placement p */
  const atAnchors = (p: Placement, kind: string, id: string | ((i: number) => string), yawOff = 0) => {
    anchors(p.piece, kind).forEach((a, i) => {
      const [x, y, z] = local(p, ...a.p);
      put(typeof id === 'string' ? id : id(i), x, y, z, p.rot + a.yaw + yawOff);
    });
  };
  const fires: { x: number; y: number; z: number; s: number }[] = [];
  const fireAt = (p: Placement, kind: string) => {
    // braziers: the model's fire anchor sits in the bowl
    const f = anchors('brazier', 'fire')[0]?.p ?? [0, 3.1, 0];
    for (const a of anchors(p.piece, kind)) {
      const [x, y, z] = local(p, ...a.p);
      put('brazier', x, y, z, p.rot);
      fires.push({ x, y: y + f[1], z, s: 0.5 });
    }
  };
  let statueN = 0;
  for (const p of [...map.placements, ...map.backdrop]) {
    switch (p.piece) {
      case 'eternity_gate':
        put('eternity_gate', p.x, p.y, p.z, p.rot);
        atAnchors(p, 'niche', (i) => NICHE_STATUES[i % NICHE_STATUES.length]);
        atAnchors(p, 'banner', 'imperial_banner');
        break;
      case 'palace_wall': {
        put('palace_wall', p.x, p.y, p.z, p.rot);
        // a banner on every other wall section
        if (Math.round(Math.abs(p.x) / 24) % 2 === 0) atAnchors(p, 'banner', 'imperial_banner');
        break;
      }
      case 'palace_tower': put('palace_tower', p.x, p.y, p.z, p.rot); atAnchors(p, 'banner', 'imperial_banner'); break;
      case 'throne_hall': {
        put('throne_hall', p.x, p.y, p.z, p.rot);
        atAnchors(p, 'banner', 'imperial_banner');
        fireAt(p, 'brazier');
        // the dais, the Golden Throne on it and the gilded figure enthroned
        const da = anchors('throne_hall', 'dais')[0];
        if (da) {
          const [x, y, z] = local(p, ...da.p);
          const dais: Placement = { piece: 'throne_dais', x, y, z, rot: p.rot + da.yaw };
          put('throne_dais', x, y, z, dais.rot);
          fireAt(dais, 'brazier');
          const ta = anchors('throne_dais', 'throne')[0];
          if (ta) {
            const [tx, ty, tz] = local(dais, ...ta.p);
            const throne: Placement = { piece: 'golden_throne', x: tx, y: ty, z: tz, rot: dais.rot };
            put('golden_throne', tx, ty, tz, throne.rot);
            atAnchors(throne, 'occupant', 'seated_prophet');
          }
        }
        break;
      }
      case 'brazier': {
        put('brazier', p.x, p.y, p.z, p.rot);
        const f = anchors('brazier', 'fire')[0]?.p ?? [0, 3.1, 0];
        fires.push({ x: p.x, y: p.y + f[1], z: p.z, s: 0.5 });
        break;
      }
      case 'statue': {
        put('statue_plinth', p.x, p.y, p.z, p.rot);
        const top = anchors('statue_plinth', 'statue')[0]?.p ?? [0, 2.6, 0];
        const [x, y, z] = local(p, ...top);
        put(AVENUE_STATUES[statueN++ % AVENUE_STATUES.length], x, y, z, p.rot);
        break;
      }
      case 'equestrian': put('equestrian_commander', p.x, p.y, p.z, p.rot); break;
      case 'emperor_statue': put('emperor_enthroned', p.x, p.y, p.z, p.rot); break;
      case 'rhino': put('rhino', p.x, p.y, p.z, p.rot); break;
      case 'palace_spire_a': case 'palace_dome_b': put(p.piece, p.x, p.y, p.z, p.rot); break;
    }
  }
  // pilgrims kneeling in rows in the courtyard before the throne hall, a few standing with candles by the gate
  const rnd = mulberry32(4242);
  const free = (x: number, z: number) => !map.isSolid(x, z, 0.6) && !map.isBlocked(x, z);
  for (const sg of [-1, 1]) {
    for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++) {
      const x = sg * (15 + k * 2.3 + (rnd() - 0.5) * 0.6), z = PALACE.hall - 27 + row * 2.4 + (rnd() - 0.5) * 0.6;
      if (free(x, z)) put('pilgrim_kneel', x, map.heightAt(x, z), z, Math.PI + (rnd() - 0.5) * 0.4);
    }
    for (let k = 0; k < 4; k++) {
      const x = sg * (3.5 + rnd() * 3), z = PALACE.z + 16 + k * 1.8 + rnd();
      if (free(x, z)) put('pilgrim_stand', x, map.heightAt(x, z), z, Math.PI + (rnd() - 0.5) * 0.8);
    }
  }
  // servo-skulls drifting on slow loops over the gate approach and the courtyard
  const skulls: { x: number; y: number; z: number; r: number; w: number; ph: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const inside = k >= 7;
    const x = (rnd() - 0.5) * (inside ? 50 : 70), z = inside ? PALACE.z + 18 + rnd() * 10 : PALACE.z - 36 + rnd() * 18;
    skulls.push({ x, y: map.heightAt(x, z) + 6 + rnd() * 7, z, r: 2 + rnd() * 4, w: (0.25 + rnd() * 0.3) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6.3 });
  }
  const skullSet = set('servo_skull');
  for (const s of skulls) put('servo_skull', s.x, s.y, s.z, 0);

  const group = new THREE.Group();
  group.name = 'palace';
  for (const s of sets.values()) s.build(group);
  let frame = 0, clock = 0;
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  const sq = new THREE.Quaternion(), sv = new THREE.Vector3(), ss = new THREE.Vector3(1, 1, 1);
  const update = (camera: THREE.Camera, dt: number, bias = 1) => {
    clock += dt;
    const cam = camera.position;
    if (skullSet) {
      skulls.forEach((s, i) => {
        const a = s.ph + clock * s.w;
        sv.set(s.x + Math.cos(a) * s.r, s.y + Math.sin(clock * 1.3 + s.ph) * 0.35, s.z + Math.sin(a) * s.r);
        // face along the loop, nose dipping as it bobs
        sq.setFromEuler(new THREE.Euler(Math.sin(clock * 1.3 + s.ph) * 0.12, -a + (s.w > 0 ? Math.PI : 0), 0, 'YXZ'));
        skullSet.items[i].m.compose(sv, sq, ss);
        skullSet.items[i].c.copy(sv);
      });
      skullSet.update(cam, bias);
    }
    // the static pieces only need a look when the camera moved, and not every frame
    if ((frame++ % 6 === 0 && cam.distanceToSquared(lastCam) > 4) || lastCam.x === 1e9) {
      lastCam.copy(cam);
      for (const s of sets.values()) if (!s.dynamic) s.update(cam, bias);
    }
  };
  const stats = () => {
    let tris = 0, meshes = 0;
    for (const s of sets.values()) { tris += s.tris(); for (const l of s.meshes) for (const m of l) if (m.visible) meshes++; }
    return { tris, meshes };
  };
  const count = [...sets.values()].reduce((a, s) => a + s.items.length, 0);
  return { group, update, stats, fires, count, pieces: sets.size };
}
