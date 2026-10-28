// Persistent settings + graphics quality presets with automatic detection (PC vs tablet/phone).

export type QualityLevel = 'low' | 'medium' | 'high';

export interface Settings {
  quality: 'auto' | QualityLevel;
  shadows: boolean;
  post: boolean;
  showFps: boolean;
  volume: number;
  music: number;
  camSpeed: number;
  edgePan: boolean;
}

export interface QualityPreset {
  pixelRatio: number;     // multiplier on devicePixelRatio (capped)
  maxDpr: number;
  shadowSize: number;     // 0 = off
  terrainRes: number;
  texSize: number;
  envTex: number;
  bloom: boolean;
  lodBias: number;
  particles: number;      // particle budget
  halfUnitTex: boolean;
  antialias: boolean;
  lights: number;
}

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 0.8, maxDpr: 1, shadowSize: 0, terrainRes: 225, texSize: 256, envTex: 256, bloom: false, lodBias: 0.55, particles: 700, halfUnitTex: true, antialias: false, lights: 2 },
  medium: { pixelRatio: 1, maxDpr: 1.5, shadowSize: 1024, terrainRes: 289, texSize: 512, envTex: 256, bloom: true, lodBias: 0.8, particles: 1400, halfUnitTex: true, antialias: false, lights: 4 },
  high: { pixelRatio: 1, maxDpr: 2, shadowSize: 2048, terrainRes: 385, texSize: 512, envTex: 512, bloom: true, lodBias: 1.15, particles: 2600, halfUnitTex: false, antialias: true, lights: 8 },
};

const KEY = 'gt40k.settings.v1';
const DEFAULTS: Settings = { quality: 'auto', shadows: true, post: true, showFps: false, volume: 0.8, music: 0.45, camSpeed: 1, edgePan: false };

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...s };
  } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export function isTouchDevice() {
  try { return matchMedia('(pointer:coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(any-pointer:fine)').matches); } catch { return false; }
}

/** Pick a quality level from the device: phones / school tablets get low or medium, desktops high. */
export function detectQuality(gl?: WebGL2RenderingContext | null): QualityLevel {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua) || isTouchDevice();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  let gpu = '';
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch { /* ignore */ }
  const weakGpu = /Mali-G5|Mali-T|Adreno \(TM\) [3-5]\d\d|PowerVR|Intel\(R\) (HD|UHD) Graphics [1-6]\d\d\b|SwiftShader|llvmpipe/i.test(gpu);
  if (mobile) {
    if (weakGpu || mem <= 3 || cores <= 4) return 'low';
    return 'medium';
  }
  if (weakGpu || mem <= 4) return 'medium';
  return 'high';
}
