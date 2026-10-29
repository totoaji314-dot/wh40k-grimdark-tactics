// Copies Blender build output (local_only/models/<faction>) into the web build:
// GLBs as-is, atlas PNGs -> WebP (full size + half size for low graphics quality), metadata JSON.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// MODELS_SRC / MODELS_DST let private builds (e.g. local-only reference assets) use the same pipeline without touching public/
const src = path.resolve(process.env.MODELS_SRC ?? 'local_only/models');
const dst = path.resolve(process.env.MODELS_DST ?? 'public/assets/units');
fs.mkdirSync(dst, { recursive: true });
const factions = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(src).filter((d) => fs.existsSync(path.join(src, d, d + '.json')));
for (const f of factions) {
  const dir = fs.existsSync(path.join(src, f + '.json')) ? src : path.join(src, f);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, f + '.json'), 'utf8'));
  for (const v of Object.values(meta.variants)) {
    const doc = await io.read(path.join(dir, v.file));
    await doc.transform(dedup(), weld(), resample({ tolerance: 0.0005 }), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(path.join(dst, v.file), doc);
  }
  for (const [k, name] of Object.entries(meta.textures)) {
    const png = path.join(dir, name + '.png');
    if (!fs.existsSync(png)) continue;
    const q = k === 'normal' ? 92 : 86;
    await sharp(png).webp({ quality: q, effort: 5 }).toFile(path.join(dst, name + '.webp'));
    await sharp(png).resize(meta.atlas / 2).webp({ quality: q, effort: 5 }).toFile(path.join(dst, name + '_half.webp'));
  }
  fs.writeFileSync(path.join(dst, f + '.json'), JSON.stringify(meta));
  const size = fs.readdirSync(dst).filter((n) => n.startsWith(f) || Object.values(meta.variants).some((v) => v.file === n)).reduce((s, n) => s + fs.statSync(path.join(dst, n)).size, 0);
  console.log(`${f}: ${Object.keys(meta.variants).length} variants, ${(size / 1e6).toFixed(2)} MB`);
}
