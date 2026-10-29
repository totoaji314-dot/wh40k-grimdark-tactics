import * as THREE from 'three';
import type { UnitLibrary, VariantAsset, ClipInfo } from './UnitLibrary';
import type { Anim } from '../sim/anim';
export { newAnim, play, playUpper, stepAnim } from '../sim/anim';
export type { Anim } from '../sim/anim';

export interface Figure {
  variant: string;
  x: number; y: number; z: number;
  yaw: number;        // radians, 0 = facing +Z
  scale: number;
  tint: number;       // per-soldier brightness variation
  anim: Anim;
  visible: boolean;
}

interface Batch {
  asset: VariantAsset;
  meshes: THREE.InstancedMesh[];
  animA: THREE.InstancedBufferAttribute[];
  animB: THREE.InstancedBufferAttribute[];
  animU: THREE.InstancedBufferAttribute[];
  vars: THREE.InstancedBufferAttribute[];
  cap: number;
}

/** Fractional row for clip time (wraps loops, clamps one-shots). */
export function rowOf(c: ClipInfo, t: number): [number, number, number] {
  if (c.loop) {
    const n = c.frames - 1;
    let f = (t * 30) % n; if (f < 0) f += n;
    const i = Math.floor(f);
    return [c.row + i, c.row + i + 1, f - i];
  }
  const f = Math.min(Math.max(0, t * 30), c.frames - 1);
  const i = Math.floor(f);
  return [c.row + i, c.row + Math.min(i + 1, c.frames - 1), f - i];
}

export class UnitRenderer {
  batches = new Map<string, Batch>();
  group = new THREE.Group();
  lodDist = [26, 70];
  stats = { drawn: 0, tris: 0, calls: 0 };
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private sphere = new THREE.Sphere();
  private up = new THREE.Vector3(0, 1, 0);

  shadows: boolean;
  constructor(private lib: UnitLibrary, counts: Record<string, number>, shadows = true) {
    this.shadows = shadows;
    this.group.name = 'units';
    for (const [id, n] of Object.entries(counts)) {
      const asset = lib.variants.get(id);
      if (!asset || n <= 0) continue;
      const cap = n;
      const b: Batch = { asset, meshes: [], animA: [], animB: [], animU: [], vars: [], cap };
      asset.lods.forEach((g, lod) => {
        const geo = g.clone();
        const aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aA.setUsage(THREE.DynamicDrawUsage);
        const aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aB.setUsage(THREE.DynamicDrawUsage);
        const aU = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aU.setUsage(THREE.DynamicDrawUsage);
        const aV = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1); aV.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aAnimA', aA); geo.setAttribute('aAnimB', aB); geo.setAttribute('aAnimU', aU); geo.setAttribute('aVar', aV);
        const mesh = new THREE.InstancedMesh(geo, asset.material, cap);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = shadows && lod < 2;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = asset.depthMaterial;
        mesh.count = 0;
        mesh.name = `${id}_lod${lod}`;
        this.group.add(mesh);
        b.meshes.push(mesh); b.animA.push(aA); b.animB.push(aB); b.animU.push(aU); b.vars.push(aV);
      });
      this.batches.set(id, b);
    }
  }

  setShadows(on: boolean) {
    this.shadows = on;
    for (const b of this.batches.values()) b.meshes.forEach((m, lod) => (m.castShadow = on && lod < 2));
  }

  update(camera: THREE.Camera, figures: Figure[], lodBias = 1) {
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const cam = (camera as THREE.PerspectiveCamera).position;
    const counts = new Map<string, number[]>();
    for (const id of this.batches.keys()) counts.set(id, [0, 0, 0]);
    const d0 = this.lodDist[0] * lodBias, d1 = this.lodDist[1] * lodBias;
    let drawn = 0, tris = 0;
    for (const f of figures) {
      if (!f.visible) continue;
      const b = this.batches.get(f.variant);
      if (!b) continue;
      const h = b.asset.height * f.scale;
      this.sphere.center.set(f.x, f.y + h * 0.5, f.z); this.sphere.radius = h * 0.75;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const dist = this.sphere.center.distanceTo(cam);
      const lod = dist < d0 ? 0 : dist < d1 ? 1 : 2;
      const c = counts.get(f.variant)!;
      const i = c[lod]++;
      if (i >= b.cap) continue;
      this.q.setFromAxisAngle(this.up, f.yaw);
      this.s.setScalar(f.scale);
      this.m.compose(this.v.set(f.x, f.y, f.z), this.q, this.s);
      b.meshes[lod].setMatrixAt(i, this.m);
      const clips = b.asset.clips;
      const ca = clips[f.anim.clip] ?? clips.idle;
      const [r0, r1, t] = rowOf(ca, f.anim.t);
      const A = b.animA[lod].array as Float32Array;
      A[i * 4] = r0; A[i * 4 + 1] = r1; A[i * 4 + 2] = t; A[i * 4 + 3] = 0;
      const Bv = b.animB[lod].array as Float32Array;
      if (f.anim.prev && f.anim.blend > 0) {
        const cb = clips[f.anim.prev] ?? ca;
        const [q0, q1, qt] = rowOf(cb, f.anim.pt);
        Bv[i * 4] = q0; Bv[i * 4 + 1] = q1; Bv[i * 4 + 2] = qt; Bv[i * 4 + 3] = f.anim.blend;
      } else Bv[i * 4 + 3] = 0;
      const U = b.animU[lod].array as Float32Array;
      const cu = f.anim.up ? clips[f.anim.up] : undefined;
      if (cu && f.anim.uw > 0.002) {
        const [u0, u1, ut] = rowOf(cu, f.anim.ut);
        U[i * 4] = u0; U[i * 4 + 1] = u1; U[i * 4 + 2] = ut; U[i * 4 + 3] = f.anim.uw;
      } else U[i * 4 + 3] = 0;
      (b.vars[lod].array as Float32Array)[i] = f.tint;
      drawn++; tris += b.asset.tris[lod];
    }
    let calls = 0;
    for (const [id, b] of this.batches) {
      const c = counts.get(id)!;
      b.meshes.forEach((mesh, lod) => {
        const n = Math.min(c[lod], b.cap);
        mesh.count = n;
        if (n > 0) {
          calls++;
          mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
          for (const a of [b.animA[lod], b.animB[lod], b.animU[lod]]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
          b.vars[lod].clearUpdateRanges(); b.vars[lod].addUpdateRange(0, n); b.vars[lod].needsUpdate = true;
        }
      });
    }
    this.stats = { drawn, tris, calls };
  }

  /** World-space muzzle point of a figure (main weapon or off-hand). */
  muzzle(f: Figure, which: 1 | 2, out: THREE.Vector3): THREE.Vector3 {
    return this.point(f, which === 1 ? 'muzzle' : 'muzzle2', out);
  }

  point(f: Figure, which: 'muzzle' | 'muzzle2' | 'head', out: THREE.Vector3): THREE.Vector3 {
    const b = this.batches.get(f.variant) ?? null;
    const asset = b?.asset ?? this.lib.variants.get(f.variant)!;
    const c = asset.clips[f.anim.clip] ?? asset.clips.idle;
    const [r0] = rowOf(c, f.anim.t);
    const arr = asset[which];
    const cu = f.anim.up && f.anim.uw > 0.5 && which !== 'head' ? asset.clips[f.anim.up] : undefined;
    if (cu) {
      // upper-body layer: muzzle from the layer clip, shifted by how far the legs' hips are from the layer clip's hips
      const [u0] = rowOf(cu, f.anim.ut);
      const h = asset.hips;
      out.set(arr[u0 * 3] + h[r0 * 3] - h[u0 * 3], arr[u0 * 3 + 1] + h[r0 * 3 + 1] - h[u0 * 3 + 1], arr[u0 * 3 + 2] + h[r0 * 3 + 2] - h[u0 * 3 + 2]).multiplyScalar(f.scale);
    } else out.set(arr[r0 * 3], arr[r0 * 3 + 1], arr[r0 * 3 + 2]).multiplyScalar(f.scale);
    const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const x = out.x * cs + out.z * sn, z = -out.x * sn + out.z * cs;
    return out.set(f.x + x, f.y + out.y, f.z + z);
  }
}
