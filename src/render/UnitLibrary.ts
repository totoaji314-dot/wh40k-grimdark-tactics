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
      asset.material = skinMaterial(mat, asset.boneTex) as THREE.MeshStandardMaterial;
      asset.depthMaterial = skinMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), asset.boneTex, true) as THREE.MeshDepthMaterial;
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
    const data = new Float32Array(B * 3 * 4 * rows);
    const muzzle = new Float32Array(rows * 3), muzzle2 = new Float32Array(rows * 3), head = new Float32Array(rows * 3);
    const mixer = new THREE.AnimationMixer(scene);
    const K = new THREE.Matrix4(), T = new THREE.Matrix4();
    const iMz = skel.bones.findIndex((b) => b.name === 'muzzle'), iMz2 = skel.bones.findIndex((b) => b.name === 'muzzle2'), iHead = skel.bones.findIndex((b) => b.name === 'head');
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
          const e = T.elements;
          const o = (r * B * 3 + i * 3) * 4;
          data[o] = e[0]; data[o + 1] = e[4]; data[o + 2] = e[8]; data[o + 3] = e[12];
          data[o + 4] = e[1]; data[o + 5] = e[5]; data[o + 6] = e[9]; data[o + 7] = e[13];
          data[o + 8] = e[2]; data[o + 9] = e[6]; data[o + 10] = e[10]; data[o + 11] = e[14];
        }
        for (const [idx, arr] of [[iMz, muzzle], [iMz2, muzzle2], [iHead, head]] as const) {
          if (idx < 0) continue;
          skel.bones[idx].getWorldPosition(p);
          arr[r * 3] = p.x; arr[r * 3 + 1] = p.y; arr[r * 3 + 2] = p.z;
        }
      }
      act.stop();
    }
    const boneTex = new THREE.DataTexture(data, B * 3, rows, THREE.RGBAFormat, THREE.FloatType);
    boneTex.minFilter = THREE.NearestFilter; boneTex.magFilter = THREE.NearestFilter;
    boneTex.generateMipmaps = false; boneTex.needsUpdate = true;
    const lods = meshes.slice(0, 3).map((m) => {
      const g = m.geometry.clone();
      // meshopt-quantised attributes are fine for the GPU; just make sure bounds exist
      g.computeBoundingSphere();
      return g;
    });
    const tris = lods.map((g) => (g.index ? g.index.count : g.attributes.position.count) / 3);
    return { id, faction, cls: v.cls, height: v.height, lods, boneTex, bones: B, rows, clips, muzzle, muzzle2, head, tris, material: null!, depthMaterial: null! };
  }
}

/** Inject texture-driven instanced skinning into a built-in material. */
export function skinMaterial(mat: THREE.Material, boneTex: THREE.Texture, depth = false) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBones = { value: boneTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2D uBones;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 aAnimA;
attribute vec4 aAnimB;
attribute float aVar;
varying float vVar;
mat4 bmAt(float bone, float row) {
  int x = int(bone + 0.5) * 3; int y = int(row + 0.5);
  vec4 a = texelFetch(uBones, ivec2(x, y), 0);
  vec4 b = texelFetch(uBones, ivec2(x + 1, y), 0);
  vec4 c = texelFetch(uBones, ivec2(x + 2, y), 0);
  return mat4(a.x, b.x, c.x, 0.0, a.y, b.y, c.y, 0.0, a.z, b.z, c.z, 0.0, a.w, b.w, c.w, 1.0);
}
mat4 boneAt(float bone) {
  mat4 m = bmAt(bone, aAnimA.x) * (1.0 - aAnimA.z) + bmAt(bone, aAnimA.y) * aAnimA.z;
  if (aAnimB.w > 0.002) {
    mat4 n = bmAt(bone, aAnimB.x) * (1.0 - aAnimB.z) + bmAt(bone, aAnimB.y) * aAnimB.z;
    m = m * (1.0 - aAnimB.w) + n * aAnimB.w;
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
