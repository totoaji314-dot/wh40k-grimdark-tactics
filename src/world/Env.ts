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

export async function buildEnv(base: string, map: BattleMap, texSize: number, castShadow: boolean) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(base + 'env.glb');
  // piece name -> list of [material name, geometry]
  const pieces = new Map<string, [string, THREE.BufferGeometry][]>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pieceName = (m.parent && m.parent !== gltf.scene ? m.parent.name : m.name).replace(/_\d+$/, '');
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const matName = ((m.material as THREE.Material).name || 'ferrocrete').replace(/\.\d+$/, '');
    if (!pieces.has(pieceName)) pieces.set(pieceName, []);
    pieces.get(pieceName)!.push([matName, g]);
  });
  const byMat = new Map<string, THREE.BufferGeometry[]>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (const p of map.placements) {
    const parts = pieces.get(p.piece);
    if (!parts) continue;
    q.setFromAxisAngle(up, p.rot);
    m4.compose(v.set(p.x, p.y, p.z), q, s);
    for (const [mat, g] of parts) {
      const c = g.clone();
      c.applyMatrix4(m4);
      for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) c.deleteAttribute(k);
      if (!c.attributes.color) {
        const col = new Float32Array(c.attributes.position.count * 4).fill(1);
        c.setAttribute('color', new THREE.BufferAttribute(col, 4));
      }
      if (c.attributes.color.itemSize === 3) {
        const src = c.attributes.color.array as ArrayLike<number>;
        const col = new Float32Array(c.attributes.position.count * 4);
        for (let i = 0; i < c.attributes.position.count; i++) { col[i * 4] = src[i * 3]; col[i * 4 + 1] = src[i * 3 + 1]; col[i * 4 + 2] = src[i * 3 + 2]; col[i * 4 + 3] = 1; }
        c.setAttribute('color', new THREE.BufferAttribute(col, 4));
      }
      if (!c.attributes.uv) c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
      const nonIndexed = c.index ? c.toNonIndexed() : c;
      // normalise attribute types for merging
      for (const k of ['position', 'normal', 'uv', 'color']) {
        const a = nonIndexed.attributes[k] as THREE.BufferAttribute;
        if (!(a.array instanceof Float32Array) || a.normalized) {
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
          nonIndexed.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
        }
      }
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(nonIndexed);
    }
  }
  const group = new THREE.Group();
  group.name = 'env';
  const mats: Partial<Record<EnvMat, THREE.MeshStandardMaterial>> = {};
  let tris = 0;
  for (const [matName, geos] of byMat) {
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
          .replace('#include <color_fragment>', '#if defined( USE_COLOR_ALPHA )\n diffuseColor.rgb *= mix(0.32, 1.0, vColor.r);\n#elif defined( USE_COLOR )\n diffuseColor.rgb *= mix(0.32, 1.0, vColor.r);\n#endif');
      };
      if (pbr.emissive) { m.emissive = new THREE.Color(pbr.emissive); m.emissiveIntensity = name === 'lamp' ? 4 : 1.2; m.emissiveMap = albedo; }
      m.name = name;
      mats[name] = m;
    }
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mats[name]);
    mesh.castShadow = castShadow && name !== 'glass' && name !== 'lamp';
    mesh.receiveShadow = true;
    mesh.name = 'env_' + name;
    group.add(mesh);
    tris += merged.attributes.position.count / 3;
  }
  return { group, tris };
}
