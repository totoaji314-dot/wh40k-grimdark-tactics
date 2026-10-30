// Compress the vehicle kit (tools/blender/vehicles.py output) for the web. Texture coordinates are left unquantised:
// the track piece's UVs run far outside 0..1 (metres along the track loop) and must survive exactly for tread scrolling.
import fs from 'node:fs';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('local_only/vehicles/vehicles.glb');
await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), weld(), prune({ keepLeaves: false }),
  quantize({ pattern: /^(POSITION|NORMAL|COLOR_0)$/, quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync('public/assets/vehicles', { recursive: true });
await io.write('public/assets/vehicles/vehicles.glb', doc);
fs.copyFileSync('local_only/vehicles/vehicles.json', 'public/assets/vehicles/vehicles.json');
console.log('vehicles.glb', (fs.statSync('public/assets/vehicles/vehicles.glb').size / 1e3).toFixed(0), 'kB, meshes:', doc.getRoot().listMeshes().map((m) => m.getName()).join(','));
