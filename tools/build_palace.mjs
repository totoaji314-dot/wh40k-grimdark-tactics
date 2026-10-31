// Build public/assets/terra/palace.glb + palace.json from the Blender landmark export
// (tools/blender/terra_landmarks.py -> local_only/terra_build/palace_src.glb + palace_anchors.json).
//   node tools/build_palace.mjs [srcDir]
// Every piece arrives as <piece>__L0/L1/L2 (hand-built detail levels; the statue scans are decimated in Blender).
// Here: shared materials deduplicated, textures shrunk to WebP (1K for the big stone/metal sets, 512 for small ones),
// geometry quantised and meshopt-compressed. palace.json gets each piece's bounds, triangle counts per LOD,
// LOD switch distances, the anchors (niches, braziers, banners, sentries) and the material tints the game applies.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, textureCompress, getBounds, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const SRC = process.argv[2] || 'local_only/terra_build';
const OUT = 'public/assets/terra';
// base colour multipliers for the tiling ambientCG sets (the source textures stay neutral so one set can serve
// several looks); kept in step with MATS in terra_landmarks.py
const TINTS = {
  stone: [0.80, 0.78, 0.74], stone_pale: [0.95, 0.93, 0.88], stone_dark: [0.55, 0.54, 0.55], marble: [1, 1, 1],
  gold: [1.0, 0.78, 0.36], bronze: [0.85, 0.62, 0.42], iron: [0.42, 0.42, 0.44], roof: [0.40, 0.42, 0.46],
  cloth: [0.55, 0.05, 0.04], paving: [0.92, 0.9, 0.86], paint: [0.13, 0.25, 0.62], robe: [0.36, 0.28, 0.21],
  bone: [0.93, 0.88, 0.76], floor: [0.9, 0.9, 0.9], cable: [0.30, 0.27, 0.25],
};
const SMALL_TEX = /Fabric|Travertine|Rust0|MetalPlates013|Granite/i;

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(path.join(SRC, 'palace_src.glb'));
const anchors = JSON.parse(fs.readFileSync(path.join(SRC, 'palace_anchors.json'), 'utf8'));
const srcBytes = fs.statSync(path.join(SRC, 'palace_src.glb')).size;

const triCount = (mesh) => mesh.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
const pieces = {};
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
for (const node of scene.listChildren()) {
  const m = /^(.+)__L(\d)$/.exec(node.getName());
  if (!m || !node.getMesh()) continue;
  const [, id, l] = m;
  const p = (pieces[id] ??= { lods: [], tris: [] });
  p.lods[+l] = node.getName();
  p.tris[+l] = Math.round(triCount(node.getMesh()));
  if (l === '0') {
    // bounds of a lone node: getBounds works on scenes and nodes alike
    const b = getBounds(node);
    p.min = b.min.map((v) => +v.toFixed(3));
    p.size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
    // LOD switch distances from the piece's size: a 2 m pilgrim drops detail at 40 m, the 100 m gate at ~250 m
    const r = Math.hypot(...p.size) / 2;
    p.r = +r.toFixed(2);
    p.lodDist = [Math.round(Math.max(40, r * 4.5)), Math.round(Math.max(110, r * 11))];
  }
}

// small texture sets first (512), then everything else (1K); resizing never enlarges
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80, pattern: SMALL_TEX }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
);
await doc.transform(weld(), dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE, PropertyType.MATERIAL] }), prune({ keepLeaves: false }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync(OUT, { recursive: true });
await io.write(path.join(OUT, 'palace.glb'), doc);
const meta = {
  pieces, anchors: anchors.anchors, tints: TINTS,
  source: 'Modelled in code (tools/blender/terra_landmarks.py). Textures: ambientCG (CC0). Statues: SMK Statens Museum for Kunst (public domain) and Smithsonian 3D (CC0) scans, decimated.',
};
fs.writeFileSync(path.join(OUT, 'palace.json'), JSON.stringify(meta, null, 1));
const outBytes = fs.statSync(path.join(OUT, 'palace.glb')).size;
for (const [id, p] of Object.entries(pieces)) console.log(id.padEnd(22), 'tris', p.tris.join(' / ').padEnd(22), 'size', p.size.map((v) => v.toFixed(1)).join(' x ').padEnd(22), 'lod at', p.lodDist.join(' / '), 'm');
console.log(`palace.glb ${(srcBytes / 1e6).toFixed(1)} MB -> ${(outBytes / 1e6).toFixed(2)} MB, ${doc.getRoot().listTextures().length} textures, ${doc.getRoot().listMaterials().length} materials`);
