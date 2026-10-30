import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { BattleMap, Placement } from './MapGen';
import { mulberry32 } from './noise';

/**
 * Photoscanned props (CC0, Poly Haven — see docs/ASSET_MANIFEST.md) that replace the procedural crates, barrels and
 * concrete barricades of the environment kit, plus battlefield junk scattered around defence lines and wrecks.
 * Collision is unchanged: the props are laid out inside each kit piece's footprint. Everything is instanced.
 */
export interface PropMeta { size: [number, number, number]; min: [number, number, number]; tris: number }

/** kit pieces whose procedural geometry the props replace */
export const PROP_PIECES = new Set(['crates', 'barrels', 'barricade']);

/** rz / rx: roll about the prop's own centre (barrel knocked over / tyre lying flat) */
type Item = [id: string, x: number, y: number, z: number, yaw: number, scale?: number, rz?: number, rx?: number];

export async function buildProps(base: string, map: BattleMap, density: number, castShadow: boolean) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [gltf, meta] = await Promise.all([
    loader.loadAsync(base + 'props.glb'),
    fetch(base + 'props.json').then((r) => r.json() as Promise<Record<string, PropMeta>>),
  ]);
  gltf.scene.updateMatrixWorld(true);
  // prop id -> its meshes with geometry moved so the prop stands centred on the origin, base at y = 0
  const parts = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[]>();
  const inv = new THREE.Matrix4(), off = new THREE.Matrix4();
  for (const root of gltf.scene.children) {
    const m = meta[root.name];
    if (!m) continue;
    inv.copy(root.matrixWorld).invert();
    off.makeTranslation(-(m.min[0] + m.size[0] / 2), -m.min[1], -(m.min[2] + m.size[2] / 2));
    const list: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(off, new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)));
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      // settle the clean scans into the dusty dusk palette of the battlefield: darker, warmer, about half as saturated
      mat.color.multiply(new THREE.Color(0.74, 0.7, 0.64));
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\n diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, 0.45);');
      };
      mat.customProgramCacheKey = () => 'prop-dusty';
      list.push({ geo, mat });
    });
    parts.set(root.name, list);
  }

  const rnd = mulberry32(7171);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const jit = (a: number) => (rnd() - 0.5) * a;
  /** the props that stand in for one kit piece, in the piece's local frame (x across, z depth) */
  const layout = (piece: string): Item[] => {
    switch (piece) {
      case 'barricade': {
        const id = rnd() < 0.5 ? 'concrete_road_barrier' : 'concrete_road_barrier_02';
        return [[id, -0.77 + jit(0.08), 0, jit(0.1), jit(0.12)], [id, 0.77 + jit(0.08), 0, jit(0.1), Math.PI + jit(0.12)]];
      }
      case 'barrels': {
        const b = () => (rnd() < 0.25 ? 'Barrel_01' : 'barrel_03'); // red hazard drums are the accent, grey steel the norm
        const S = 1.15;
        const out: Item[] = [[b(), -0.46, 0, -0.42, rnd() * 6, S], [b(), 0.4, 0, -0.46, rnd() * 6, S], [b(), -0.05, 0, 0.4, rnd() * 6, S]];
        // a fourth knocked over, or a fourth standing
        const id = b(), lie = -(meta[id].size[1] - meta[id].size[0]) / 2;
        out.push(rnd() < 0.55 ? [id, 0.66, lie * S, 0.48, 1.2 + jit(0.6), S, Math.PI / 2] : [id, 0.66, 0, 0.5, rnd() * 6, S]);
        return out;
      }
      case 'crates': {
        const out: Item[] = [
          ['wooden_military_crate', -0.25, 0, -0.45, jit(0.1), 1.55],
          ['wooden_military_crate', -0.25, 0, 0.42, Math.PI + jit(0.1), 1.55],
          ['old_military_crate', 0.95, 0, 0, Math.PI / 2 + jit(0.15), 0.85],
        ];
        if (rnd() < 0.65) out.push(['wooden_military_crate', -0.25 + jit(0.2), 0.72, jit(0.3), Math.PI / 2 + jit(0.3), 1.45]);
        if (rnd() < 0.5) out.push(['metal_jerrycan', 0.9 + jit(0.3), 0.25, jit(0.5), rnd() * 6, 1.2]);
        return out;
      }
    }
    return [];
  };

  const items: Item[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
  const world = (p: Placement, it: Item): Item => {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    // same rotation sense as the kit (rotation about +Y)
    const x = p.x + it[1] * c + it[3] * s, z = p.z - it[1] * s + it[3] * c;
    const y = (Number.isFinite(p.y) ? p.y : map.heightAt(p.x, p.z)) + it[2];
    return [it[0], x, y, z, p.rot + it[4], it[5], it[6], it[7]];
  };
  for (const p of map.placements) if (PROP_PIECES.has(p.piece)) for (const it of layout(p.piece)) items.push(world(p, it));

  // junk dropped around defences and wrecks: jerrycans, tyres, wheel rims, ammo cases
  const free = (x: number, z: number) => !map.isBlocked(x, z) && !map.isSolid(x, z, 0.5) && !map.inTrench(x, z);
  const junk = ['metal_jerrycan', 'old_tyre', 'rusted_wheel_rim_01', 'old_military_crate', 'metal_jerrycan', 'old_tyre'];
  for (const p of map.placements) {
    const near = p.piece === 'wreck' ? 4 : p.piece === 'bunker' || p.piece === 'watchtower' ? 3 : p.piece === 'sandbags' || p.piece === 'barricade' ? 1 : 0;
    if (!near) continue;
    const n = Math.round(near * density * (0.5 + rnd()));
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, r = (p.piece === 'wreck' ? 4.2 : p.piece === 'bunker' ? 4.5 : 2.2) + rnd() * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (!free(x, z)) continue;
      const id = pick(junk), y = map.heightAt(x, z);
      if (id === 'old_tyre' || id === 'rusted_wheel_rim_01') {
        // lying flat (axis up), sometimes a short stack of tyres
        const h = meta[id].size[2];
        const stack = id === 'old_tyre' && rnd() < 0.3 ? 2 + Math.floor(rnd() * 2) : 1;
        for (let i = 0; i < stack; i++) items.push([id, x + jit(0.06), y + h / 2 + i * h * 0.95 - meta[id].size[1] / 2, z + jit(0.06), rnd() * 6, 1, 0, Math.PI / 2]);
      } else items.push([id, x, y - 0.02, z, rnd() * 6]);
    }
  }

  // one instanced mesh per prop part
  const byId = new Map<string, Item[]>();
  for (const it of items) { if (!byId.has(it[0])) byId.set(it[0], []); byId.get(it[0])!.push(it); }
  const group = new THREE.Group();
  group.name = 'props';
  const e = new THREE.Euler(), sc = new THREE.Vector3(), centre = new THREE.Matrix4(), back = new THREE.Matrix4(), roll = new THREE.Matrix4();
  let tris = 0;
  for (const [id, list] of byId) {
    const pl = parts.get(id);
    if (!pl) continue;
    const half = meta[id].size[1] / 2;
    for (const { geo, mat } of pl) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        const s = it[5] ?? 1;
        e.set(0, it[4], 0); q.setFromEuler(e);
        m4.compose(v.set(it[1], it[2], it[3]), q, sc.set(s, s, s));
        if (it[6] || it[7]) {
          centre.makeTranslation(0, half, 0); back.makeTranslation(0, -half, 0);
          m4.multiply(centre).multiply(roll.makeRotationFromEuler(e.set(it[7] ?? 0, 0, it[6] ?? 0))).multiply(back);
        }
        mesh.setMatrixAt(i, m4);
      });
      mesh.castShadow = castShadow; mesh.receiveShadow = true;
      mesh.name = 'prop_' + id;
      mesh.computeBoundingSphere();
      group.add(mesh);
      tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * list.length;
    }
  }
  return { group, tris, count: items.length };
}
