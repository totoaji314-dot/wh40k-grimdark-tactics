import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BattleMap, HALF, HN, PLAY } from './MapGen';
import { mulberry32, vnoise, fbm } from './noise';
import { envTexture, terrainLayer, dataTexture } from './textures';

/**
 * Ground clutter that makes the battlefield read as a real place: rocks, broken masonry, rusted scrap,
 * wind-blown dead grass, charred trees, and water pooled in shell craters. All instanced; counts scale
 * with the graphics quality.
 */
export function buildScatter(map: BattleMap, density: number, shadows: boolean) {
  const group = new THREE.Group();
  group.name = 'scatter';
  const rnd = mulberry32(4242);
  const idx = (x: number, z: number) => Math.round(Math.max(-HALF, Math.min(HALF, z)) + HALF) * HN + Math.round(Math.max(-HALF, Math.min(HALF, x)) + HALF);
  const free = (x: number, z: number, pad = 0.6) => !map.isBlocked(x, z) && !map.isSolid(x, z, pad) && !map.inTrench(x, z);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, z: number, scale: [number, number, number], sink: number, tilt = 0.25) => {
    e.set((rnd() - 0.5) * tilt, rnd() * Math.PI * 2, (rnd() - 0.5) * tilt);
    q.setFromEuler(e);
    m4.compose(v.set(x, map.heightAt(x, z) - sink, z), q, s.set(...scale));
    mesh.setMatrixAt(i, m4);
  };
  const tex = (t: ReturnType<typeof envTexture>) => [dataTexture(t.albedo, t.size, true), dataTexture(t.normal, t.size, false)] as const;

  // ---------------------------------------------------------------- rocks and masonry chunks
  const rockGeos = [0, 1, 2].map((k) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 0.72 + 0.5 * vnoise(v.x * 2.1 + k * 7, v.y * 2.3 + v.z * 1.7, 11 + k);
      v.multiplyScalar(n); v.y *= 0.62;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  });
  const [rAlb, rNrm] = tex(terrainLayer('rubble', 256));
  rAlb.repeat.set(0.6, 0.6); rNrm.repeat.set(0.6, 0.6);
  const rockMat = new THREE.MeshStandardMaterial({ map: rAlb, normalMap: rNrm, roughness: 0.95, color: 0xe0d6c8 });
  const nRocks = Math.floor(1800 * density);
  rockGeos.forEach((g, k) => {
    const n = Math.floor(nRocks / 3);
    const mesh = new THREE.InstancedMesh(g, rockMat, n);
    let i = 0, guard = 0;
    while (i < n && guard++ < n * 20) {
      const x = (rnd() * 2 - 1) * (PLAY + 15), z = (rnd() * 2 - 1) * (PLAY + 15);
      const rub = map.rubble[idx(x, z)] ?? 0;
      const clump = fbm(x / 9, z / 9, 2, 31);
      if (rnd() > 0.03 + rub * 0.85 + Math.max(0, clump - 0.62) * 1.5 || !free(x, z, 0.4)) continue;
      const sc = (0.12 + Math.pow(rnd(), 3) * 0.9) * (1 + rub * 0.6);
      place(mesh, i++, x, z, [sc * (0.8 + rnd() * 0.5), sc, sc * (0.8 + rnd() * 0.5)], sc * 0.25, 0.6);
    }
    mesh.count = i; mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.name = 'rocks' + k;
    group.add(mesh);
  });

  const [cAlb, cNrm] = tex(envTexture('ferrocrete', 256));
  const chunkMat = new THREE.MeshStandardMaterial({ map: cAlb, normalMap: cNrm, roughness: 0.9, color: 0xc8c0b4 });
  const chunkGeo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const nChunks = Math.floor(1500 * density);
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, nChunks);
  {
    let i = 0, guard = 0;
    while (i < nChunks && guard++ < nChunks * 30) {
      const x = (rnd() * 2 - 1) * PLAY, z = (rnd() * 2 - 1) * PLAY;
      const rub = map.rubble[idx(x, z)] ?? 0;
      if (rub < 0.25 || rnd() > rub || !free(x, z, 0.3)) continue;
      const sc = 0.12 + Math.pow(rnd(), 2) * 0.55;
      place(chunks, i++, x, z, [sc * (1 + rnd() * 1.5), sc * (0.4 + rnd() * 0.5), sc * (0.6 + rnd())], sc * 0.15, 1.2);
    }
    chunks.count = i; chunks.castShadow = shadows; chunks.receiveShadow = true; chunks.name = 'masonry';
    group.add(chunks);
  }

  // ---------------------------------------------------------------- rusted scrap: plates and girders
  const [sAlb, sNrm] = tex(envTexture('rust', 256));
  const scrapMat = new THREE.MeshStandardMaterial({ map: sAlb, normalMap: sNrm, roughness: 0.75, metalness: 0.5, color: 0xa09088 });
  const girder = mergeGeometries([
    new THREE.BoxGeometry(0.06, 0.4, 1).translate(0, 0, 0),
    new THREE.BoxGeometry(0.3, 0.05, 1).translate(0, 0.18, 0),
    new THREE.BoxGeometry(0.3, 0.05, 1).translate(0, -0.18, 0),
  ])!;
  const plate = new THREE.BoxGeometry(1, 0.03, 0.8);
  for (const [geo, n0, len] of [[girder, 220, 4], [plate, 320, 1.2]] as const) {
    const n = Math.floor(n0 * density);
    const mesh = new THREE.InstancedMesh(geo, scrapMat, n);
    let i = 0, guard = 0;
    while (i < n && guard++ < n * 30) {
      const x = (rnd() * 2 - 1) * PLAY, z = (rnd() * 2 - 1) * PLAY;
      const rub = (map.rubble[idx(x, z)] ?? 0) + (map.scorch[idx(x, z)] ?? 0) * 0.5;
      if (rnd() > 0.05 + rub * 0.6 || !free(x, z, 0.6)) continue;
      const L = len * (0.4 + rnd() * 0.8);
      place(mesh, i++, x, z, [1, 1, L], 0.05, 0.5);
    }
    mesh.count = i; mesh.castShadow = shadows; mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------------------------------------------------------- dead grass tufts (wind sway)
  const grassTex = makeGrassTexture();
  const tuft = mergeGeometries([0, 60, 120].map((a) => new THREE.PlaneGeometry(1, 0.6).translate(0, 0.3, 0).rotateY((a * Math.PI) / 180)))!;
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: 0xb8b0a4 });
  const grassU = { uTime: { value: 0 } };
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassU.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp0 = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sway = sin(uTime * 1.7 + wp0.x * 0.35 + wp0.z * 0.27) * 0.12 + sin(uTime * 3.1 + wp0.x) * 0.04;
        transformed.x += sway * position.y; transformed.z += sway * 0.6 * position.y;`);
    // light the blades like the ground beneath them (both card sides face up), not by the flat card normal
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'vec3 normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);\nvec3 nonPerturbedNormal = normal;');
  };
  const nGrass = Math.floor(7000 * density);
  const grass = new THREE.InstancedMesh(tuft, grassMat, nGrass);
  {
    let i = 0, guard = 0;
    const col = new THREE.Color();
    while (i < nGrass && guard++ < nGrass * 12) {
      const x = (rnd() * 2 - 1) * (PLAY + 25), z = (rnd() * 2 - 1) * (PLAY + 25);
      const k = idx(x, z);
      const bad = (map.road[k] ?? 0) + (map.rubble[k] ?? 0) * 0.8 + (map.scorch[k] ?? 0) + (map.mud[k] ?? 0) * 0.6;
      const patch = fbm(x / 22, z / 22, 3, 77);
      if (bad > 0.5 || patch < 0.5 || rnd() > (patch - 0.5) * 3 || !free(x, z, 0.2)) continue;
      const sc = 0.5 + rnd() * 0.9;
      place(grass, i, x, z, [sc, sc * (0.7 + rnd() * 0.7), sc], 0.05, 0.2);
      grass.setColorAt(i, col.setHSL(0.07 + rnd() * 0.04, 0.1 + rnd() * 0.08, 0.3 + rnd() * 0.1));
      i++;
    }
    grass.count = i; grass.castShadow = false; grass.receiveShadow = true; grass.name = 'grass';
    group.add(grass);
  }

  // ---------------------------------------------------------------- charred dead trees
  const treeParts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.12, 0.28, 6, 7).translate(0, 3, 0)];
  for (const [h, a, l] of [[3.8, 0.9, 2.2], [4.8, -1.1, 1.8], [2.7, 2.6, 1.6], [5.3, 1.9, 1.2]]) {
    const b = new THREE.CylinderGeometry(0.04, 0.09, l, 5).translate(0, l / 2, 0).rotateZ(0.9).rotateY(a).translate(0, h, 0);
    treeParts.push(b);
  }
  const treeGeo = mergeGeometries(treeParts.map((g) => g.toNonIndexed()))!;
  treeGeo.computeVertexNormals();
  const [wAlb, wNrm] = tex(envTexture('wood', 256));
  const treeMat = new THREE.MeshStandardMaterial({ map: wAlb, normalMap: wNrm, color: 0x3a3430, roughness: 0.95 });
  const nTrees = Math.floor(70 * Math.max(0.5, density));
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, nTrees);
  {
    let i = 0, guard = 0;
    while (i < nTrees && guard++ < nTrees * 60) {
      const x = (rnd() * 2 - 1) * (PLAY + 30), z = (rnd() * 2 - 1) * (PLAY + 30);
      if ((map.road[idx(x, z)] ?? 0) > 0.2 || !free(x, z, 1.2)) continue;
      if (Math.abs(x) < PLAY - 20 && Math.abs(z) < PLAY - 20 && rnd() < 0.6) continue; // mostly toward the edges
      const sc = 0.7 + rnd() * 0.8;
      place(trees, i++, x, z, [sc, sc * (0.8 + rnd() * 0.5), sc], 0.2, 0.25);
    }
    trees.count = i; trees.castShadow = shadows; trees.receiveShadow = true; trees.name = 'trees';
    group.add(trees);
  }

  // ---------------------------------------------------------------- water pooled in craters
  const discs: THREE.BufferGeometry[] = [];
  for (const c of map.craters) {
    if (c.r < 3.2) continue;
    const y = map.heightAt(c.x, c.z) + c.r * 0.07;
    const g = new THREE.CircleGeometry(c.r * 0.55, 20);
    const p = g.attributes.position;
    for (let i = 1; i < p.count; i++) { const a = Math.atan2(p.getY(i), p.getX(i)); const k = 0.8 + 0.25 * vnoise(Math.cos(a) * 2 + c.x, Math.sin(a) * 2 + c.z, 5); p.setXY(i, p.getX(i) * k, p.getY(i) * k); }
    g.rotateX(-Math.PI / 2).translate(c.x, y, c.z);
    discs.push(g);
  }
  if (discs.length) {
    const water = new THREE.Mesh(mergeGeometries(discs)!, new THREE.MeshStandardMaterial({ color: 0x1e1a14, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.6, transparent: true, opacity: 0.88 }));
    water.receiveShadow = true; water.name = 'puddles'; water.renderOrder = 1;
    group.add(water);
  }
  return { group, update: (t: number) => { grassU.uTime.value = t; } };
}

function makeGrassTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const r = mulberry32(9);
  for (let i = 0; i < 46; i++) {
    const x = S * (0.1 + r() * 0.8), lean = (r() - 0.5) * S * 0.5, h = S * (0.45 + r() * 0.5);
    const shade = 120 + r() * 90;
    g.strokeStyle = `rgb(${shade},${shade * 0.86},${shade * 0.55})`;
    g.lineWidth = 1.5 + r() * 2;
    g.beginPath(); g.moveTo(x, S); g.quadraticCurveTo(x + lean * 0.3, S - h * 0.6, x + lean, S - h); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
