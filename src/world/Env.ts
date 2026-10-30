import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BattleMap, Footprint } from './MapGen';
import { ENV_MATS, ENV_PBR, envTexture, dataTexture, type EnvMat } from './textures';

/**
 * Loads the Blender environment kit and statically batches every placed piece by material:
 * the whole battlefield's buildings and props draw in ~15 calls. AO comes from baked vertex colours.
 */
export async function loadEnvFootprints(base: string): Promise<Record<string, Footprint>> {
  return (await fetch(base + 'env.json')).json();
}

/** De-quantise every attribute to plain Float32 (meshopt / quantize stores int16 positions). Must run before transforming. */
const UV_SCALE: Record<string, number> = { stone: 3.2, ferrocrete: 3.0, roof: 2.5, sandbag: 1.4, wood: 1.6, rubble: 2.5 };

/** World-space box projection (1 UV = `scale` metres): seamless across neighbouring pieces. */
function boxUV(g: THREE.BufferGeometry, scale: number) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z * Math.sign(n.getX(i) || 1); v = y; } else { u = -x * Math.sign(n.getZ(i) || 1); v = y; }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function toFloat(g: THREE.BufferGeometry) {
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k] as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized && !(a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) continue;
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
    g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
  }
  return g;
}

/** extraKits: more GLB kits (vehicles) whose pieces become available to makePiece with the same materials */
export async function buildEnv(base: string, map: BattleMap, texSize: number, castShadow: boolean, backdrop = 1, extraKits: string[] = []) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // piece name -> list of [material name, geometry]
  const pieces = new Map<string, [string, THREE.BufferGeometry][]>();
  const kits = await Promise.all([base + 'env.glb', ...extraKits].map((u) => loader.loadAsync(u)));
  for (const gltf of kits) {
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pieceName = (m.parent && m.parent !== gltf.scene ? m.parent.name : m.name).replace(/_\d+$/, '');
    const g = toFloat(m.geometry.clone());
    g.applyMatrix4(m.matrixWorld);
    const matName = ((m.material as THREE.Material).name || 'ferrocrete').replace(/\.\d+$/, '');
    if (!pieces.has(pieceName)) pieces.set(pieceName, []);
    pieces.get(pieceName)!.push([matName, g]);
  });
  }
  const near = new Map<string, THREE.BufferGeometry[]>();
  const far = new Map<string, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  // the backdrop ring is thinned on lower quality settings (every other block on medium, a quarter on low)
  const keep = map.backdrop.filter((_, i) => i === 0 || (i * 0.618034) % 1 < backdrop);
  /** one kit part moved into place, attributes normalised for merging (float position/normal/uv, RGBA AO colour, index) */
  const prep = (g: THREE.BufferGeometry, mat: string, m: THREE.Matrix4) => {
    const c = g.clone();
    c.applyMatrix4(m);
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) c.deleteAttribute(k);
    if (!c.attributes.color) c.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 4).fill(1), 4));
    if (c.attributes.color.itemSize === 3) {
      const src = c.attributes.color.array as ArrayLike<number>;
      const col = new Float32Array(c.attributes.position.count * 4);
      for (let i = 0; i < c.attributes.position.count; i++) { col[i * 4] = src[i * 3]; col[i * 4 + 1] = src[i * 3 + 1]; col[i * 4 + 2] = src[i * 3 + 2]; col[i * 4 + 3] = 1; }
      c.setAttribute('color', new THREE.BufferAttribute(col, 4));
    }
    // track links keep their authored UVs (u runs along the loop, so the tread can scroll)
    if (mat !== 'track' || !c.attributes.uv) boxUV(c, UV_SCALE[mat] ?? 2.0);
    if (!c.index) { const idx = new Uint32Array(c.attributes.position.count); for (let i = 0; i < idx.length; i++) idx[i] = i; c.setIndex(new THREE.BufferAttribute(idx, 1)); }
    for (const k of ['position', 'normal', 'uv', 'color']) {
      const at = c.attributes[k] as THREE.BufferAttribute;
      if (!(at.array instanceof Float32Array) || at.normalized) {
        const fl = new Float32Array(at.count * at.itemSize);
        for (let i = 0; i < at.count; i++) for (let j = 0; j < at.itemSize; j++) fl[i * at.itemSize + j] = at.getComponent(i, j);
        c.setAttribute(k, new THREE.BufferAttribute(fl, at.itemSize));
      }
    }
    return c;
  };
  for (const [list, byMat] of [[map.placements, near], [keep, far]] as const) for (const p of list) {
    const parts = pieces.get(p.piece);
    if (!parts) continue;
    q.setFromAxisAngle(up, p.rot);
    m4.compose(v.set(p.x, p.y, p.z), q, s);
    for (const [mat, g] of parts) {
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(prep(g, mat, m4));
    }
  }
  const group = new THREE.Group();
  group.name = 'env';
  const mats: Partial<Record<EnvMat, THREE.MeshStandardMaterial>> = {};
  const getMat = (matName: string) => {
    const name = (ENV_MATS as readonly string[]).includes(matName) ? matName as EnvMat : 'ferrocrete';
    if (!mats[name]) {
      const t = envTexture(name, texSize);
      const pbr = ENV_PBR[name];
      const albedo = dataTexture(t.albedo, t.size, true);
      const normal = dataTexture(t.normal, t.size, false);
      const m = new THREE.MeshStandardMaterial({ map: albedo, normalMap: normal, roughness: 1, metalness: pbr.metal, vertexColors: true });
      m.normalScale.set(1.2, 1.2);
      m.onBeforeCompile = (sh) => {
        // roughness lives in the normal map alpha; vertex colour = baked AO (squeezed so it never goes fully black)
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = texture2D(normalMap, vNormalMapUv).a;')
          .replace('#include <color_fragment>', '#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )\n diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.65, vColor.r));\n#endif');
      };
      if (pbr.emissive) { m.emissive = new THREE.Color(pbr.emissive); m.emissiveIntensity = name === 'lamp' ? 4 : 1.2; m.emissiveMap = albedo; }
      m.name = name;
      mats[name] = m;
    }
    return mats[name]!;
  };
  let tris = 0;
  for (const [byMat, isFar] of [[near, false], [far, true]] as const) for (const [matName, geos] of byMat) {
    const mat = getMat(matName);
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    // far blocks sit outside every shadow frustum: skip them in the shadow pass
    mesh.castShadow = !isFar && castShadow && mat.name !== 'glass' && mat.name !== 'lamp';
    mesh.receiveShadow = !isFar;
    mesh.name = (isFar ? 'far_' : 'env_') + mat.name;
    group.add(mesh);
    tris += merged.attributes.position.count / 3;
  }
  /** A movable copy of one kit piece (drop pods, aircraft): one mesh per material, origin at the piece origin. */
  const makePiece = (name: string) => {
    const parts = pieces.get(name);
    const g = new THREE.Group(); g.name = name;
    if (!parts) return g;
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    const I = new THREE.Matrix4();
    for (const [mat, geo] of parts) { if (!byMat.has(mat)) byMat.set(mat, []); byMat.get(mat)!.push(prep(geo, mat, I)); }
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false); if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, getMat(mat)); mesh.castShadow = castShadow; mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  };
  return { group, tris, makePiece, getMat };
}
