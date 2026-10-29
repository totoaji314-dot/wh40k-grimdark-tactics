import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Loads rigged unit models (one GLB per variant, made by tools/blender) and bakes every animation clip
 * into a float texture of bone matrices. Soldiers are then drawn with GPU instancing: each instance
 * reads its own clip/frame from the texture, so hundreds of animated soldiers cost a few draw calls.
 */
export interface ClipInfo {
  name: string;
  row: number;        // first texture row
  frames: number;     // rows used (looping clips include the closing frame)
  loop: boolean;
  speed: number;      // ground speed in m/s that matches the stride (locomotion clips)
  event: number;      // normalised time of the shot / blow (fire, melee)
  dur: number;        // seconds
}

export interface VariantAsset {
  id: string;
  faction: string;
  cls: string;
  height: number;
  lods: THREE.BufferGeometry[];
  boneTex: THREE.DataTexture;
  bones: number;
  rows: number;
  clips: Record<string, ClipInfo>;
  muzzle: Float32Array;   // per row: xyz of the main weapon muzzle in model space
  muzzle2: Float32Array;  // per row: off-hand weapon muzzle
  head: Float32Array;     // per row: head position (for aiming / line of sight)
  hips: Float32Array;     // per row: hips position (re-anchors the upper-body layer's muzzle)
  mask: Float32Array;     // per bone: 1 = follows the upper-body layer, 0 = legs
  hipsBone: number;
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  tris: number[];
}

interface FactionMeta {
  faction: string;
  atlas: number;
  textures: Record<string, string>;
  variants: Record<string, { kind: string; cls: string; height: number; lods: number[]; clips: Record<string, { frames: number; loop: boolean; speed?: number; event?: number }>; file: string }>;
}

const FPS = 30;

export class UnitLibrary {
  variants = new Map<string, VariantAsset>();
  private loader = new GLTFLoader();
  private tex = new THREE.TextureLoader();
  /** faction -> base URL, for factions loaded from somewhere else (local-only reference assets) */
  overrides: Record<string, string> = {};
  constructor(private base: string, private maxAniso = 4) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  async loadFaction(faction: string, half: boolean, onProgress?: (msg: string) => void) {
    const base = this.overrides[faction] ?? this.base;
    const meta: FactionMeta = await (await fetch(`${base}${faction}.json`)).json();
    const suffix = half ? '_half' : '';
    const load = (k: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => {
      this.tex.load(`${base}${meta.textures[k]}${suffix}.webp`, (t) => {
        t.flipY = false; // glTF UV convention
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = this.maxAniso;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        res(t);
      }, undefined, rej);
    });
    const [albedo, orm, normal, emissive] = await Promise.all([load('albedo', true), load('orm', false), load('normal', false), load('emissive', true)]);
    for (const [id, v] of Object.entries(meta.variants)) {
      onProgress?.(id);
      const gltf = await this.loader.loadAsync(base + v.file);
      const asset = this.bake(id, faction, v, gltf);
      const mat = new THREE.MeshStandardMaterial({
        map: albedo, roughnessMap: orm, metalnessMap: orm, aoMap: orm, aoMapIntensity: 0.6, normalMap: normal,
        emissiveMap: emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.6, roughness: 1, metalness: 0.6,
      });
      // reference models authored for a different engine come with darker, dirt-baked diffuse maps: lift them at runtime
      // (textures stay untouched) so they read under this game's dusk lighting
      if (this.overrides[faction]) { mat.color.setScalar(1.35); mat.envMapIntensity = 1.6; }
      asset.material = skinMaterial(mat, asset) as THREE.MeshStandardMaterial;
      asset.depthMaterial = skinMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), asset, true) as THREE.MeshDepthMaterial;
      this.variants.set(id, asset);
    }
  }

  private bake(id: string, faction: string, v: FactionMeta['variants'][string], gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): VariantAsset {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    const lodOf = (m: THREE.Object3D) => (/lod2/.test(m.name) ? 2 : /lod1/.test(m.name) ? 1 : 0);
    meshes.sort((a, b) => lodOf(a) - lodOf(b));
    const ref = meshes[0];
    const skel = ref.skeleton;
    const B = skel.bones.length;
    const names = Object.keys(v.clips);
    const clips: Record<string, ClipInfo> = {};
    let rows = 0;
    for (const n of names) {
      const c = v.clips[n];
      clips[n] = { name: n, row: rows, frames: c.frames, loop: c.loop, speed: c.speed ?? 0, event: c.event ?? 0.5, dur: (c.loop ? c.frames - 1 : c.frames) / FPS };
      rows += c.frames;
    }
    // one extra matrix slot per row (index B) holds inverse(K(hips)) so the upper-body layer can be re-anchored on the legs' hips
    const W = B + 1;
    const data = new Float32Array(W * 3 * 4 * rows);
    const muzzle = new Float32Array(rows * 3), muzzle2 = new Float32Array(rows * 3), head = new Float32Array(rows * 3), hips = new Float32Array(rows * 3);
    const UPPER: Record<string, number> = { spine: 0.5, chest: 1, neck: 1, head: 1, weapon: 1, offhand: 1, muzzle: 1, muzzle2: 1 };
    const mask = new Float32Array(B);
    skel.bones.forEach((b, i) => { const n = b.name.replace(/\.[LR]$/, ''); mask[i] = UPPER[b.name] ?? (['clavicle', 'upper_arm', 'forearm', 'hand', 'pauldron'].includes(n) ? 1 : 0); });
    const iHips = Math.max(0, skel.bones.findIndex((b) => b.name === 'hips'));
    const Kh = new THREE.Matrix4();
    const mixer = new THREE.AnimationMixer(scene);
    const K = new THREE.Matrix4(), T = new THREE.Matrix4();
    const iMz = skel.bones.findIndex((b) => b.name === 'muzzle'), iMz2 = skel.bones.findIndex((b) => b.name === 'muzzle2'), iHead = skel.bones.findIndex((b) => b.name === 'head');
    const put = (o: number, e: number[] | Float32Array) => { data[o] = e[0]; data[o + 1] = e[4]; data[o + 2] = e[8]; data[o + 3] = e[12]; data[o + 4] = e[1]; data[o + 5] = e[5]; data[o + 6] = e[9]; data[o + 7] = e[13]; data[o + 8] = e[2]; data[o + 9] = e[6]; data[o + 10] = e[10]; data[o + 11] = e[14]; };
    const p = new THREE.Vector3();
    for (const n of names) {
      const clip = gltf.animations.find((a) => a.name === n);
      if (!clip) throw new Error(`${id}: missing clip ${n}`);
      const act = mixer.clipAction(clip);
      act.reset(); act.play();
      const info = clips[n];
      for (let f = 0; f < info.frames; f++) {
        mixer.setTime(Math.min(f / FPS, clip.duration));
        scene.updateMatrixWorld(true);
        const r = info.row + f;
        for (let i = 0; i < B; i++) {
          // K = meshWorld * bindInv * boneWorld * boneInverse * bind  (model-space skin matrix)
          K.multiplyMatrices(skel.bones[i].matrixWorld, skel.boneInverses[i]);
          T.multiplyMatrices(ref.bindMatrixInverse, K);
          K.multiplyMatrices(T, ref.bindMatrix);
          T.multiplyMatrices(ref.matrixWorld, K);
          put((r * W * 3 + i * 3) * 4, T.elements);
          if (i === iHips) Kh.copy(T).invert();
        }
        put((r * W * 3 + B * 3) * 4, Kh.elements);
        for (const [idx, arr] of [[iMz, muzzle], [iMz2, muzzle2], [iHead, head], [iHips, hips]] as const) {
          if (idx < 0) continue;
          skel.bones[idx].getWorldPosition(p);
          arr[r * 3] = p.x; arr[r * 3 + 1] = p.y; arr[r * 3 + 2] = p.z;
        }
      }
      act.stop();
    }
    const boneTex = new THREE.DataTexture(data, W * 3, rows, THREE.RGBAFormat, THREE.FloatType);
    boneTex.minFilter = THREE.NearestFilter; boneTex.magFilter = THREE.NearestFilter;
    boneTex.generateMipmaps = false; boneTex.needsUpdate = true;
    const lods = meshes.slice(0, 3).map((m) => {
      const g = m.geometry.clone();
      // meshopt-quantised attributes are fine for the GPU; just make sure bounds exist
      g.computeBoundingSphere();
      return g;
    });
    const tris = lods.map((g) => (g.index ? g.index.count : g.attributes.position.count) / 3);
    return { id, faction, cls: v.cls, height: v.height, lods, boneTex, bones: B, rows, clips, muzzle, muzzle2, head, hips, mask, hipsBone: iHips, tris, material: null!, depthMaterial: null! };
  }
}

/** Inject texture-driven instanced skinning into a built-in material. */
export function skinMaterial(mat: THREE.Material, asset: Pick<VariantAsset, 'boneTex' | 'mask' | 'hipsBone' | 'bones'>, depth = false) {
  const boneTex = asset.boneTex;
  const maskArr = new Float32Array(48); maskArr.set(asset.mask.subarray(0, 48));
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBones = { value: boneTex };
    sh.uniforms.uMask = { value: maskArr };
    sh.uniforms.uHipsBone = { value: asset.hipsBone };
    sh.uniforms.uHipsInv = { value: asset.bones };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2D uBones;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 aAnimA;
attribute vec4 aAnimB;
attribute vec4 aAnimU;
uniform float uMask[48];
uniform float uHipsBone;
uniform float uHipsInv;
attribute float aVar;
varying float vVar;
mat4 bmAt(float bone, float row) {
  int x = int(bone + 0.5) * 3; int y = int(row + 0.5);
  vec4 a = texelFetch(uBones, ivec2(x, y), 0);
  vec4 b = texelFetch(uBones, ivec2(x + 1, y), 0);
  vec4 c = texelFetch(uBones, ivec2(x + 2, y), 0);
  return mat4(a.x, b.x, c.x, 0.0, a.y, b.y, c.y, 0.0, a.z, b.z, c.z, 0.0, a.w, b.w, c.w, 1.0);
}
mat4 baseAt(float bone) {
  mat4 m = bmAt(bone, aAnimA.x) * (1.0 - aAnimA.z) + bmAt(bone, aAnimA.y) * aAnimA.z;
  if (aAnimB.w > 0.002) {
    mat4 n = bmAt(bone, aAnimB.x) * (1.0 - aAnimB.z) + bmAt(bone, aAnimB.y) * aAnimB.z;
    m = m * (1.0 - aAnimB.w) + n * aAnimB.w;
  }
  return m;
}
// upper-body layer: pose from clip U, re-anchored on the hips of the base (legs) pose: K_L(hips) * inverse(K_U(hips)) * K_U(bone)
bool gFixReady = false;
mat4 gFix;
mat4 upperFix() {
  if (!gFixReady) {
    mat4 inv = bmAt(uHipsInv, aAnimU.x) * (1.0 - aAnimU.z) + bmAt(uHipsInv, aAnimU.y) * aAnimU.z;
    gFix = baseAt(uHipsBone) * inv;
    gFixReady = true;
  }
  return gFix;
}
mat4 boneAt(float bone) {
  mat4 m = baseAt(bone);
  if (aAnimU.w > 0.002) {
    float k = uMask[int(bone + 0.5)] * aAnimU.w;
    if (k > 0.001) {
      mat4 u = bmAt(bone, aAnimU.x) * (1.0 - aAnimU.z) + bmAt(bone, aAnimU.y) * aAnimU.z;
      m = m * (1.0 - k) + (upperFix() * u) * k;
    }
  }
  return m;
}
`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
mat4 skinM = boneAt(skinIndex.x) * skinWeight.x + boneAt(skinIndex.y) * skinWeight.y + boneAt(skinIndex.z) * skinWeight.z + boneAt(skinIndex.w) * skinWeight.w;
transformed = (skinM * vec4(transformed, 1.0)).xyz;
vVar = aVar;
`);
    if (!depth) {
      // normals: recompute with the same skin matrix (skinM is declared later, so rebuild it here)
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  mat4 sn = boneAt(skinIndex.x) * skinWeight.x + boneAt(skinIndex.y) * skinWeight.y + boneAt(skinIndex.z) * skinWeight.z + boneAt(skinIndex.w) * skinWeight.w;
  objectNormal = normalize(mat3(sn) * objectNormal);
}
`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vVar;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vVar;');
    }
  };
  mat.customProgramCacheKey = () => (depth ? 'skin-depth' : 'skin') + boneTex.uuid;
  return mat;
}
