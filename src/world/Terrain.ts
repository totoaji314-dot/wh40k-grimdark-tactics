import * as THREE from 'three';
import { BattleMap, EXTENT, HALF, HN } from './MapGen';
import { TERRAIN_LAYERS, terrainLayer, arrayTexture } from './textures';
import { fbm } from './noise';

/**
 * Terrain mesh with a 5-layer splat shader (dirt, mud, rubble, ferrocrete road, ash) using
 * tileable procedural textures in a texture array, height-blended transitions and macro variation.
 */
export function buildTerrain(map: BattleMap, res: number, texSize: number) {
  const geo = new THREE.PlaneGeometry(EXTENT + 260, EXTENT + 260, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const splat = new Float32Array(n * 4);
  const outer = (EXTENT + 260) / 2;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let h: number;
    if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) h = map.heightAt(x, z);
    else {
      // outskirts: rolling ash wasteland rising toward the horizon
      const e = Math.max(Math.abs(x), Math.abs(z)) - HALF;
      h = map.heightAt(Math.max(-HALF, Math.min(HALF, x)), Math.max(-HALF, Math.min(HALF, z))) + e * 0.25 + (fbm(x / 40, z / 40, 3, 9) - 0.5) * e * 0.3;
      if (Math.max(Math.abs(x), Math.abs(z)) >= outer - 1) h -= 10;
    }
    pos.setY(i, h);
    const fx = Math.round(Math.max(-HALF, Math.min(HALF, x)) + HALF), fz = Math.round(Math.max(-HALF, Math.min(HALF, z)) + HALF);
    const k = fz * HN + fx;
    const inside = Math.abs(x) <= HALF && Math.abs(z) <= HALF;
    splat[i * 4] = inside ? Math.min(1, map.mud[k]) : 0.2;
    splat[i * 4 + 1] = inside ? Math.min(1, map.rubble[k]) : 0.35;
    splat[i * 4 + 2] = inside ? Math.min(1, map.road[k]) : 0;
    splat[i * 4 + 3] = inside ? Math.min(1, map.scorch[k]) : 0.45;
  }
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.computeVertexNormals();

  const layers = TERRAIN_LAYERS.map((l) => terrainLayer(l, texSize));
  const albedo = arrayTexture(layers.map((l) => l.albedo), texSize, true);
  const normal = arrayTexture(layers.map((l) => l.normal), texSize, false);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tAlb = { value: albedo };
    sh.uniforms.tNrm = { value: normal };
    sh.uniforms.uTile = { value: new THREE.Vector4(7.0, 6.0, 5.0, 8.0) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tAlb;
uniform sampler2DArray tNrm;
uniform vec4 uTile;
varying vec4 vSplat;
varying vec3 vWPos;
float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
vec4 tri(int layer, float tile, out vec4 nrm) {
  // two rotated samples break up visible tiling
  vec2 uv = vWPos.xz / tile;
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz / (tile * 2.3) + 0.37;
  float m = smoothstep(0.35, 0.65, vn(vWPos.xz * 0.045 + float(layer) * 3.1));
  vec4 a = mix(texture(tAlb, vec3(uv, float(layer))), texture(tAlb, vec3(uv2, float(layer))), m * 0.6);
  nrm = mix(texture(tNrm, vec3(uv, float(layer))), texture(tNrm, vec3(uv2, float(layer))), m * 0.6);
  return a;
}
vec3 gNrm; float gRough;
`)
      .replace('#include <map_fragment>', `
vec4 n0, n1, n2, n3, n4;
vec4 c0 = tri(0, uTile.x, n0);
vec4 c1 = tri(1, uTile.y, n1);
vec4 c2 = tri(2, uTile.z, n2);
vec4 c3 = tri(3, uTile.w, n3);
vec4 c4 = tri(4, 6.5, n4);
// height-aware blend weights
float slope = 1.0 - clamp(vNormal.y, 0.0, 1.0);
vec4 s = vSplat;
s.y = clamp(s.y + slope * 0.4, 0.0, 1.0);
float noiseB = vn(vWPos.xz * 0.18) * 0.35;
vec4 w;
w.x = clamp(s.x * 1.4 - noiseB, 0.0, 1.0);
w.y = clamp(s.y * 1.3 - noiseB * 0.5 + (n2.z - 0.5) * 0.6, 0.0, 1.0);
w.z = clamp(s.z * 1.6 - noiseB * 0.4, 0.0, 1.0);
w.w = clamp(s.w * 1.3 - noiseB * 0.6, 0.0, 1.0);
float w0 = max(0.05, 1.0 - max(max(w.x, w.y), max(w.z, w.w)));
float sum = w0 + w.x + w.y + w.z + w.w;
vec3 alb = (c0.rgb * w0 + c1.rgb * w.x + c2.rgb * w.y + c3.rgb * w.z + c4.rgb * w.w) / sum;
vec4 nb = (n0 * w0 + n1 * w.x + n2 * w.y + n3 * w.z + n4 * w.w) / sum;
float macro = vn(vWPos.xz * 0.012) * 0.5 + vn(vWPos.xz * 0.05) * 0.5;
alb *= mix(0.78, 1.12, macro);
diffuseColor.rgb *= alb;
gRough = nb.a;
vec3 tn = normalize(nb.xyz * 2.0 - 1.0);
vec3 wn = normalize(vec3(tn.x, 0.0, tn.y) * 1.2 + vec3(0.0, tn.z, 0.0));
// rotate the detail normal onto the geometric world normal
vec3 gw = normalize(inverseTransformDirection(vNormal, viewMatrix));
vec3 tx = normalize(cross(vec3(0.0, 0.0, 1.0), gw));
vec3 tz = cross(gw, tx);
gNrm = normalize(tx * tn.x + tz * -tn.y + gw * tn.z);
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
