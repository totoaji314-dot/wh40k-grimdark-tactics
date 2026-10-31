// Build public/assets/props/props.glb from downloaded CC0 Poly Haven models (originals stay untouched in
// D:/01_BoltgunReference/Downloaded_Assets/polyhaven). Each prop is simplified for many on-screen copies, its
// textures shrunk to WebP, and all of them merged into one file with one root node per prop.
//   node tools/build_props.mjs [props|terra] [sourceDir]
// The 'terra' set (Holy Terra street lamps and searchlights) is loaded only on that map; the palace is build_palace.mjs.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, weld, simplify, textureCompress, mergeDocuments, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const SET = process.argv[2] === 'terra' ? 'terra' : 'props';
const SRC = process.argv[3] || 'D:/01_BoltgunReference/Downloaded_Assets/polyhaven';
// id -> [target triangles, texture size, source folder (default: id), only this top-level node of the source]
const SETS = {};
SETS.props = {
  Barrel_01: [1400, 512],
  barrel_03: [1200, 512],
  concrete_road_barrier: [1600, 512],
  concrete_road_barrier_02: [1600, 512],
  old_military_crate: [1600, 512],
  wooden_military_crate: [2400, 512],
  metal_jerrycan: [900, 256],
  old_tyre: [1200, 256],
  rusted_wheel_rim_01: [1100, 256],
};
SETS.terra = {
  street_lamp_01: [2600, 512],
  portable_searchlight: [2200, 512],
};
const PROPS = SETS[SET];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const tris = (doc) => doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);

const out = new (await import('@gltf-transform/core')).Document();
out.createBuffer();
const outScene = out.createScene('props');
out.getRoot().setDefaultScene(outScene);
const meta = {};
for (const [id, [target, tex, srcId = id, only]] of Object.entries(PROPS)) {
  const dir = path.join(SRC, srcId);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const doc = await io.read(path.join(dir, file));
  if (only) {
    // one piece of a modular kit: drop every other top-level node, then prune what they used
    const sc = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
    for (const n of sc.listChildren()) if (n.getName() !== only) { sc.removeChild(n); n.dispose(); }
    if (!sc.listChildren().length) throw new Error(only + ' not found in ' + srcId);
    await doc.transform(prune());
  }
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf8'));
  const before = tris(doc);
  // some scans ship shape keys (the wheel rim): not needed, and instanced meshes can't drive them
  for (const m of doc.getRoot().listMeshes()) { m.setWeights([]); for (const p of m.listPrimitives()) for (const t of p.listTargets()) { p.removeTarget(t); t.dispose(); } }
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, target / before), error: 0.02 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }));
  const after = tris(doc);
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const map = mergeDocuments(out, doc);
  const merged = map.get(scene);
  const root = out.createNode(id);
  for (const c of merged.listChildren()) root.addChild(c);
  outScene.addChild(root);
  merged.dispose();
  meta[id] = { size: b.max.map((v, i) => +(v - b.min[i]).toFixed(3)), min: b.min.map((v) => +v.toFixed(3)), tris: Math.round(after), authors: Object.keys(info.authors || {}), source: info.source, license: 'CC0' };
  console.log(id.padEnd(26), Math.round(before), '->', Math.round(after), 'tris', 'size', meta[id].size.join(' x '));
}
// one shared buffer after merging
const buf = out.getRoot().listBuffers()[0];
for (const a of out.getRoot().listAccessors()) a.setBuffer(buf);
for (const b of out.getRoot().listBuffers().slice(1)) b.dispose();
await out.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE, PropertyType.MATERIAL] }), prune({ keepLeaves: false }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync('public/assets/props', { recursive: true });
await io.write(`public/assets/props/${SET}.glb`, out);
fs.writeFileSync(`public/assets/props/${SET}.json`, JSON.stringify(meta, null, 1));
console.log(`${SET}.glb`, (fs.statSync(`public/assets/props/${SET}.glb`).size / 1e3).toFixed(0), 'kB');
