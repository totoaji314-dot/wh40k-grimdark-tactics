// Compress the environment kit for the web. Materials are NOT deduplicated: their names are texture IDs.
import fs from 'node:fs';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('local_only/env/env.glb');
await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), weld(), prune({ keepLeaves: false }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync('public/assets/env', { recursive: true });
await io.write('public/assets/env/env.glb', doc);
fs.copyFileSync('local_only/env/env.json', 'public/assets/env/env.json');
console.log('env.glb', (fs.statSync('public/assets/env/env.glb').size / 1e6).toFixed(2), 'MB, materials:', doc.getRoot().listMaterials().map((m) => m.getName()).join(','));
