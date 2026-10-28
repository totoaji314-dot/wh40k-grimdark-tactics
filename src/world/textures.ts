import * as THREE from 'three';
import { fbm, vnoise, worley } from './noise';

// Procedurally generated tileable PBR textures (albedo + height/normal + roughness) for terrain and buildings.
// Generated once at load time: no texture downloads and they stay sharp at any zoom thanks to tiling.

export interface TexSet { albedo: Uint8ClampedArray; normal: Uint8ClampedArray; size: number }

type Px = (u: number, v: number) => [number, number, number, number, number]; // r g b height rough (0..1)

function make(size: number, fn: Px, bump = 2.0): TexSet {
  const albedo = new Uint8ClampedArray(size * size * 4);
  const normal = new Uint8ClampedArray(size * size * 4);
  const h = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, hh, ro] = fn(x / size, y / size);
    const i = y * size + x;
    albedo[i * 4] = r * 255; albedo[i * 4 + 1] = g * 255; albedo[i * 4 + 2] = b * 255; albedo[i * 4 + 3] = 255;
    h[i] = hh; rough[i] = ro;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    let nx = (l - r) * bump * size / 256, ny = (u - d) * bump * size / 256, nz = 1;
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    normal[i * 4] = (nx * 0.5 + 0.5) * 255; normal[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; normal[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
    normal[i * 4 + 3] = rough[i] * 255;
  }
  return { albedo, normal, size };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (h: number): [number, number, number] => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// ------------------------------------------------------------------ terrain layers (tile ~6-10 m)
export const TERRAIN_LAYERS = ['dirt', 'mud', 'rubble', 'road', 'ash'] as const;

const P = 8; // noise periods per tile

export function terrainLayer(name: typeof TERRAIN_LAYERS[number], size: number): TexSet {
  switch (name) {
    case 'dirt': return make(size, (u, v) => {
      const n = fbm(u * P, v * P, 6, 11, P);
      const m = fbm(u * 3, v * 3, 4, 17, 3);
      // sparse irregular gravel: distorted cells, only a few of them become stones
      const wu = u + (fbm(u * 16, v * 16, 3, 5, 16) - 0.5) * 0.03, wv = v + (fbm(u * 16, v * 16, 3, 6, 16) - 0.5) * 0.03;
      const w = worley(wu * 40, wv * 40, 5, 40);
      const peb = sstep(0.28, 0.08, w[0]) * (w[2] > 0.82 ? 1 : 0) * (0.5 + n);
      const base = lerp3(lerp3(hex(0x4a3e32), hex(0x6e604c), n), hex(0x5a554c), sstep(0.45, 0.75, m) * 0.6);
      const c = lerp3(base, hex(0x7e786c), peb * 0.7);
      const k = 0.82 + 0.3 * fbm(u * 48, v * 48, 3, 3, 48);
      return [c[0] * k, c[1] * k, c[2] * k, n * 0.7 + peb * 0.4 + fbm(u * 48, v * 48, 3, 9, 48) * 0.3, 0.94 - peb * 0.15];
    }, 2.2);
    case 'mud': return make(size, (u, v) => {
      const n = fbm(u * P, v * P, 6, 21, P);
      const ruts = Math.abs(Math.sin((v + fbm(u * 4, v * 4, 3, 2, 4) * 0.2) * Math.PI * 6));
      const wet = sstep(0.55, 0.7, fbm(u * 4, v * 4, 4, 9, 4));
      const c = lerp3(hex(0x3c3026), hex(0x54442f), n);
      const k = 1 - wet * 0.35;
      return [c[0] * k, c[1] * k, c[2] * k, n * 0.5 + ruts * 0.15 - wet * 0.3, mix(0.88, 0.25, wet)];
    }, 2.0);
    case 'rubble': return make(size, (u, v) => {
      const w = worley(u * 10, v * 10, 7, 10);
      const w2 = worley(u * 26, v * 26, 9, 26);
      const n = fbm(u * P, v * P, 5, 31, P);
      const stone = 1 - sstep(0.0, 0.12, w[1] - w[0]);
      const base = lerp3(hex(0x5e5a54), hex(0x8a857a), w[2]);
      const c = lerp3(lerp3(base, hex(0x4a3e30), stone), hex(0x9a8f80), sstep(0.25, 0.05, w2[0]) * 0.5);
      const k = 0.8 + 0.35 * n;
      return [c[0] * k, c[1] * k, c[2] * k, (1 - w[0]) * 0.8 - stone * 0.5 + n * 0.3, 0.85];
    }, 3.2);
    case 'road': return make(size, (u, v) => {
      const gx = (u * 4) % 1, gy = (v * 4) % 1;
      const seam = Math.min(sstep(0.0, 0.025, gx), sstep(1.0, 0.975, gx), sstep(0.0, 0.025, gy), sstep(1.0, 0.975, gy));
      const n = fbm(u * P, v * P, 6, 41, P);
      const crack = sstep(0.03, 0.0, Math.abs(fbm(u * 6, v * 6, 4, 13, 6) - 0.5)) * 0.9;
      const stain = fbm(u * 3, v * 3, 4, 61, 3);
      const c = lerp3(hex(0x55524c), hex(0x726d64), n);
      const grime = sstep(0.35, 0.75, fbm(u * 5, v * 5, 4, 91, 5));
      const k = (0.6 + 0.4 * seam) * (1 - crack * 0.6) * (0.8 + 0.25 * stain) * (1 - grime * 0.35);
      return [c[0] * k, c[1] * k, c[2] * k * 0.98, seam * 0.6 - crack * 0.5 + n * 0.15, 0.78];
    }, 2.0);
    case 'ash': return make(size, (u, v) => {
      const n = fbm(u * P, v * P, 6, 51, P);
      const w = worley(u * 16, v * 16, 3, 16);
      const ember = sstep(0.82, 0.95, fbm(u * 16, v * 16, 3, 71, 16));
      const c = lerp3(hex(0x1e1c1a), hex(0x3c3834), n);
      return [c[0] + ember * 0.25, c[1] + ember * 0.06, c[2], n * 0.5 + (1 - w[0]) * 0.2, 0.95];
    }, 1.6);
  }
}

// ------------------------------------------------------------------ building / prop materials (tile 2 m, 1 UV unit = 2 m)
export const ENV_MATS = ['ferrocrete', 'stone', 'metal', 'rust', 'brass', 'glass', 'sandbag', 'wood', 'hazard', 'rubble', 'roof', 'lamp', 'scrap', 'red', 'bone'] as const;
export type EnvMat = typeof ENV_MATS[number];

export const ENV_PBR: Record<EnvMat, { metal: number; emissive?: number }> = {
  ferrocrete: { metal: 0 }, stone: { metal: 0 }, metal: { metal: 0.75 }, rust: { metal: 0.45 }, brass: { metal: 1 },
  glass: { metal: 0.2, emissive: 0x2a1408 }, sandbag: { metal: 0 }, wood: { metal: 0 }, hazard: { metal: 0.3 }, rubble: { metal: 0 },
  roof: { metal: 0.6 }, lamp: { metal: 0, emissive: 0xffc070 }, scrap: { metal: 0.55 }, red: { metal: 0.35 }, bone: { metal: 0 },
};

export function envTexture(name: EnvMat, size: number): TexSet {
  switch (name) {
    case 'ferrocrete': return make(size, (u, v) => {
      const n = fbm(u * 6, v * 6, 6, 101, 6);
      const gy = (v * 2) % 1;
      const seam = Math.min(sstep(0, 0.02, gy), sstep(1, 0.98, gy), sstep(0, 0.01, (u * 2) % 1), sstep(1, 0.99, (u * 2) % 1));
      const stain = sstep(0.4, 0.9, fbm(u * 2, v * 3, 4, 7, 2)) * (0.4 + v * 0.6);
      const pit = sstep(0.62, 0.7, fbm(u * 24, v * 24, 2, 9, 24));
      const c = lerp3(hex(0x7a7770), hex(0x9a968c), n);
      const k = (0.72 + 0.28 * seam) * (1 - stain * 0.3) * (1 - pit * 0.1);
      return [c[0] * k, c[1] * k, c[2] * k, n * 0.4 + seam * 0.5 - pit * 0.3, 0.88];
    }, 2.5);
    case 'stone': return make(size, (u, v) => {
      const row = Math.floor(v * 6), off = (row % 2) * 0.5;
      const bx = (u * 3 + off) % 1, by = (v * 6) % 1;
      const mortar = Math.min(sstep(0, 0.05, bx), sstep(1, 0.95, bx), sstep(0, 0.09, by), sstep(1, 0.91, by));
      const id = vnoise(Math.floor(u * 3 + off), row, 5);
      const n = fbm(u * 8, v * 8, 5, 111, 8);
      const c = lerp3(lerp3(hex(0x4e4a46), hex(0x6e6860), id), hex(0x2c2a28), 1 - mortar);
      const k = 0.78 + 0.35 * n;
      return [c[0] * k, c[1] * k, c[2] * k, mortar * 0.7 + n * 0.3, 0.9];
    }, 3.0);
    case 'metal': return make(size, (u, v) => {
      const px = (u * 2) % 1, py = (v * 2) % 1;
      const seam = Math.min(sstep(0, 0.015, px), sstep(1, 0.985, px), sstep(0, 0.015, py), sstep(1, 0.985, py));
      const rv = Math.min(Math.hypot(((u * 16) % 1) - 0.5, (py < 0.05 || py > 0.95 ? 0.5 : 9))) < 0.18 ? 1 : 0;
      const n = fbm(u * 10, v * 10, 5, 121, 10);
      const scr = sstep(0.8, 0.9, fbm(u * 40, v * 4, 3, 5, 40));
      const c = lerp3(hex(0x34363a), hex(0x4a4c50), n);
      const k = 0.75 + 0.25 * seam;
      return [c[0] * k + scr * 0.15, c[1] * k + scr * 0.15, c[2] * k + scr * 0.16, seam * 0.6 + rv * 0.5 + n * 0.15, 0.5 - scr * 0.2];
    }, 2.0);
    case 'rust': return make(size, (u, v) => {
      const n = fbm(u * 8, v * 8, 6, 131, 8);
      const r = sstep(0.35, 0.65, fbm(u * 4, v * 4, 5, 33, 4));
      const c = lerp3(hex(0x3c3a38), lerp3(hex(0x6a3a1e), hex(0x8a5226), n), r);
      return [c[0], c[1], c[2], n * 0.5 + r * 0.3, mix(0.55, 0.92, r)];
    }, 2.4);
    case 'brass': return make(size, (u, v) => {
      const n = fbm(u * 8, v * 8, 5, 141, 8);
      const tar = sstep(0.5, 0.8, fbm(u * 3, v * 3, 4, 41, 3));
      const c = lerp3(lerp3(hex(0xa07a34), hex(0xd0aa58), n), hex(0x3a3420), tar * 0.6);
      return [c[0], c[1], c[2], n * 0.3, 0.32 + tar * 0.4];
    }, 1.2);
    case 'glass': return make(size, (u, v) => {
      const n = fbm(u * 6, v * 6, 4, 151, 6);
      const lead = Math.min(sstep(0, 0.04, (u * 4) % 1), sstep(1, 0.96, (u * 4) % 1), sstep(0, 0.04, (v * 6) % 1), sstep(1, 0.96, (v * 6) % 1));
      const tint = lerp3(hex(0x3a2418), hex(0x6a3418), n);
      const c = lerp3(hex(0x101010), tint, lead);
      return [c[0], c[1], c[2], lead * 0.5, 0.15 + (1 - lead) * 0.6];
    }, 1.5);
    case 'sandbag': return make(size, (u, v) => {
      const weave = 0.5 + 0.5 * Math.sin(u * size * 0.8) * Math.sin(v * size * 0.8);
      const n = fbm(u * 6, v * 6, 5, 161, 6);
      const c = lerp3(hex(0x6a5e44), hex(0x8e8060), n);
      const k = 0.85 + 0.15 * weave;
      return [c[0] * k, c[1] * k, c[2] * k, weave * 0.3 + n * 0.4, 0.95];
    }, 1.8);
    case 'wood': return make(size, (u, v) => {
      const plank = (u * 5) % 1;
      const gap = Math.min(sstep(0, 0.04, plank), sstep(1, 0.96, plank));
      const id = vnoise(Math.floor(u * 5), 3, 7);
      const grain = 0.5 + 0.5 * Math.sin((v * 40 + fbm(u * 5, v * 2, 3, 3, 5) * 8 + id * 10) * Math.PI);
      const c = lerp3(hex(0x3e2a1a), hex(0x6a4a2c), grain * 0.6 + id * 0.4);
      const k = 0.55 + 0.45 * gap;
      return [c[0] * k, c[1] * k, c[2] * k, gap * 0.6 + grain * 0.15, 0.8];
    }, 2.0);
    case 'hazard': return make(size, (u, v) => {
      const s = ((u + v) * 4) % 1 < 0.5 ? 1 : 0;
      const n = fbm(u * 8, v * 8, 5, 171, 8);
      const wear = sstep(0.55, 0.75, fbm(u * 6, v * 6, 4, 77, 6));
      let c = s ? hex(0xc8a020) : hex(0x161616);
      c = lerp3(c, hex(0x5a5650), wear * 0.7);
      return [c[0] * (0.8 + 0.2 * n), c[1] * (0.8 + 0.2 * n), c[2] * (0.8 + 0.2 * n), n * 0.3 - wear * 0.2, 0.6];
    }, 1.2);
    case 'rubble': return terrainLayer('rubble', size);
    case 'roof': return make(size, (u, v) => {
      const corr = 0.5 + 0.5 * Math.sin(u * Math.PI * 24);
      const n = fbm(u * 6, v * 6, 5, 181, 6);
      const r = sstep(0.45, 0.7, fbm(u * 3, v * 3, 4, 13, 3));
      const c = lerp3(lerp3(hex(0x3a3c3e), hex(0x5a5c5e), corr), hex(0x6a3a1e), r);
      return [c[0] * (0.8 + 0.2 * n), c[1] * (0.8 + 0.2 * n), c[2] * (0.8 + 0.2 * n), corr * 0.8, mix(0.5, 0.9, r)];
    }, 2.0);
    case 'lamp': return make(size, () => [1, 0.85, 0.6, 0, 0.3], 0);
    case 'scrap': return make(size, (u, v) => {
      const w = worley(u * 5, v * 5, 19, 5);
      const n = fbm(u * 8, v * 8, 5, 191, 8);
      const pal = [hex(0x5a5a52), hex(0x6a3a1e), hex(0x3c4a2c), hex(0x8a6a2a)];
      const c = pal[Math.floor(w[2] * 4) % 4];
      const edge = sstep(0.06, 0.0, w[1] - w[0]);
      return [c[0] * (0.7 + 0.3 * n) + edge * 0.2, c[1] * (0.7 + 0.3 * n) + edge * 0.2, c[2] * (0.7 + 0.3 * n) + edge * 0.2, edge * 0.8 + n * 0.2, 0.75];
    }, 2.0);
    case 'red': return make(size, (u, v) => {
      const n = fbm(u * 8, v * 8, 5, 201, 8);
      const chip = sstep(0.6, 0.75, fbm(u * 10, v * 10, 4, 21, 10));
      const c = lerp3(hex(0x7a1a12), hex(0x4a4440), chip);
      return [c[0] * (0.8 + 0.25 * n), c[1] * (0.8 + 0.25 * n), c[2] * (0.8 + 0.25 * n), n * 0.2 + chip * 0.2, 0.6];
    }, 1.4);
    case 'bone': return make(size, (u, v) => {
      const n = fbm(u * 8, v * 8, 5, 211, 8);
      const c = lerp3(hex(0xb8ac88), hex(0xddd2b0), n);
      return [c[0], c[1], c[2], n * 0.3, 0.55];
    }, 1.0);
  }
}

/** Build a WebGL2 array texture from several equally sized RGBA layers. */
export function arrayTexture(layers: Uint8ClampedArray[], size: number, srgb: boolean): THREE.DataArrayTexture {
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((l, i) => data.set(l, i * size * size * 4));
  const t = new THREE.DataArrayTexture(data, size, size, layers.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function dataTexture(px: Uint8ClampedArray, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(px.buffer.slice(0)), size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
