import * as THREE from 'three';

/**
 * Grimdark sky: smoke-choked gradient dome with a burning horizon glow, drifting cloud bands, a hazy
 * sun, and a procedural hive-city skyline painted into the same shader (three depth layers of gothic
 * blocks with needle spires, lit windows, smoke columns and a few colossal hive ziggurats). Drawing the
 * skyline in the sky shader keeps it in the same haze as the sky at every height and costs no geometry.
 */
export function buildSky(sunDir: THREE.Vector3) {
  const group = new THREE.Group();
  group.name = 'sky';
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: sunDir.clone().normalize() }, uTime: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: FRAG,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  return { group, dome };
}

const FRAG = /* glsl */ `
varying vec3 vDir; uniform vec3 uSun; uniform float uTime; uniform float uFlash;
#define PI 3.14159265
float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
float adiff(float a, float b){ return mod(a - b + PI, 2.0 * PI) - PI; }

// One ring of hive blocks: N cells around the horizon, height scale H (in sin-elevation units).
// Returns the silhouette top at this azimuth; 'cell' gets a per-building random for windows.
float hive(float a01, float N, float H, float seed, float ruin, out float cell){
  float x = a01 * N;
  float id = mod(floor(x), N);
  float f = fract(x);
  float r1 = h(vec2(id, seed)), r2 = h(vec2(id, seed + 1.7)), r3 = h(vec2(id, seed + 3.1));
  cell = r1;
  float m = 0.04 + 0.14 * r2;
  float inside = step(m, f) * step(f, 1.0 - m);
  float hb = H * (0.22 + 0.5 * r1);
  float c = 0.5 + (r3 - 0.5) * 0.3;
  float s = hb * inside;
  // broken battlements along the roof line
  s -= inside * ruin * H * 0.05 * step(0.55, fract(f * 9.0 + r2 * 3.0)) * step(0.4, r3);
  // stepped upper tiers
  float w1 = 0.26 + 0.1 * r2;
  s = max(s, step(abs(f - c), w1) * hb * (1.16 + 0.12 * r3));
  float w2 = 0.12 + 0.05 * r1;
  s = max(s, step(abs(f - c), w2) * hb * (1.34 + 0.28 * r2));
  // gothic needle spire with a pair of flanking pinnacles
  float tip = hb * (2.0 + 1.8 * r3);
  float base = hb * 1.3;
  float ws = 0.055 + 0.03 * r1;
  float pr = 1.0 - abs(f - c) / ws;
  s = max(s, step(0.5, r2) * step(0.0, pr) * mix(base, tip, pr * pr * 0.35 + pr * 0.65));
  float pin = 1.0 - abs(abs(f - c) - w1 * 0.8) / 0.025;
  s = max(s, step(0.5, r2) * step(0.0, pin) * (hb * 1.16 + hb * 0.45 * pin));
  // manufactorum smokestacks
  s = max(s, step(0.78, r3) * step(abs(f - 0.82 + 0.1 * r1), 0.022) * hb * (1.5 + 0.8 * r2));
  return s;
}

// A colossal hive ziggurat centred on azimuth a0, half-width W (radians), tier top H.
float mega(float a, float a0, float W, float H){
  float x = abs(adiff(a, a0)) / W;
  if (x > 1.0) return -1.0;
  float tier = floor((1.0 - x) * 6.0) / 6.0;
  float s = H * (0.12 + 0.62 * tier);
  // tier-edge buttress teeth
  s += H * 0.035 * step(0.6, fract((1.0 - x) * 6.0)) * step(0.5, fract(x * 40.0));
  // central needle and two flanking spires
  s = max(s, H * (0.8 + 0.7 * max(0.0, 1.0 - x / 0.05)) * step(x, 0.05));
  float sx = 1.0 - abs(x - 0.32) / 0.03;
  s = max(s, step(0.0, sx) * H * (0.62 + 0.35 * sx));
  float sx2 = 1.0 - abs(x - 0.62) / 0.025;
  s = max(s, step(0.0, sx2) * H * (0.42 + 0.22 * sx2));
  return s;
}

// lit windows inside a silhouette (angular grid so they stay crisp at any distance)
vec3 windows(float a01, float el, float top, float density, float seed){
  vec2 g = vec2(a01 * 2400.0, el * 380.0);
  vec2 id = floor(g); vec2 f = fract(g);
  float row = h(vec2(id.y, floor(id.x / 9.0)) + seed);
  float r = h(id + seed);
  float lit = step(1.0 - density, r) * step(0.45, row);
  float shape = step(0.32, f.x) * step(f.x, 0.68) * step(0.22, f.y) * step(f.y, 0.78);
  float below = step(el, top - 0.006) * step(0.002, el);
  float flick = 0.7 + 0.3 * sin(uTime * (0.6 + r * 3.0) + r * 40.0);
  vec3 c = mix(vec3(1.0, 0.48, 0.16), vec3(1.0, 0.78, 0.42), h(id + seed + 5.0));
  return c * lit * shape * below * flick;
}

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float a = atan(d.z, d.x);
  float a01 = a / (2.0 * PI) + 0.5;
  vec3 zen = vec3(0.07, 0.08, 0.11);
  vec3 mid = vec3(0.26, 0.25, 0.27);
  // horizon: warm toward the low sun, cool grey-blue away from it
  float az = max(0.0, dot(normalize(d.xz + 1e-4), normalize(uSun.xz)));
  vec3 hor = mix(vec3(0.42, 0.38, 0.38), vec3(0.85, 0.50, 0.26), az * az);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, y));
  col = mix(col, zen, smoothstep(0.22, 0.75, y));
  // burning hive glow on the northern horizon
  float north = max(0.0, -d.z) * (1.0 - smoothstep(0.0, 0.16, y));
  col += vec3(0.55, 0.18, 0.04) * north * 0.9;

  // ---- hive-city skyline, far to near ----
  vec3 dark = vec3(0.075, 0.065, 0.062) + vec3(0.30, 0.10, 0.02) * north * (1.0 - smoothstep(0.0, 0.08, y));
  float lowHaze = mix(0.5, 1.0, smoothstep(0.0, 0.1, y));
  float cell; vec3 win = vec3(0.0); float sil = 0.0;
  float s0 = hive(a01, 140.0, 0.055, 11.0, 0.0, cell);
  float m0 = step(y, s0);
  col = mix(col, dark, m0 * 0.32 * lowHaze);
  win = mix(win, windows(a01, y, s0, 0.10, 3.0) * 0.35, m0);
  float s1 = hive(a01, 82.0, 0.085, 23.0, 0.5, cell);
  float m1 = step(y, s1);
  col = mix(col, dark, m1 * 0.5 * lowHaze);
  win = mix(win, windows(a01, y, s1, 0.12, 7.0) * 0.55, m1);
  // smoke columns climbing out of the city
  float smoke = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float ac = -PI + 2.0 * PI * h(vec2(fi, 9.1));
    float b = 0.015 + 0.05 * h(vec2(fi, 3.3));
    float up = max(0.0, y - b);
    float dx = adiff(a, ac + up * 0.45);
    float w = 0.02 + up * 0.3;
    if (abs(dx) < w * 1.6 && y > b - 0.02 && y < 0.6) {
      float nz = n(vec2(dx * 30.0, y * 12.0 - uTime * 0.06 + fi * 7.0)) * 0.6 + n(vec2(dx * 80.0, y * 30.0 - uTime * 0.12)) * 0.4;
      float mk = smoothstep(w, w * 0.25, abs(dx) * (0.75 + 0.6 * nz)) * smoothstep(b - 0.01, b + 0.03, y) * (1.0 - smoothstep(0.2, 0.55, y));
      smoke = max(smoke, mk * (0.55 + 0.45 * nz));
    }
  }
  col = mix(col, vec3(0.085, 0.075, 0.07) + vec3(0.2, 0.08, 0.02) * north, smoke * 0.7);
  win *= 1.0 - smoke * 0.7;
  float s2 = hive(a01, 46.0, 0.12, 37.0, 1.0, cell);
  float s3 = max(max(mega(a, -2.42, 0.2, 0.25), mega(a, -1.18, 0.28, 0.21)), max(mega(a, 1.75, 0.24, 0.17), mega(a, 0.35, 0.16, 0.13)));
  float m2 = step(y, max(s2, s3));
  col = mix(col, dark * 0.85, m2 * 0.7 * lowHaze);
  win = mix(win, windows(a01, y, max(s2, s3), 0.14, 13.0) * 0.8, m2);
  sil = max(max(m0, m1), m2);

  // cloud / smoke bands (thinner over the skyline so the spires read, tops still vanish into smog)
  vec2 uv = d.xz / max(0.08, y + 0.15) * 1.3;
  float c = fbm(uv * 1.2 + vec2(uTime * 0.004, uTime * 0.002));
  float c2 = fbm(uv * 3.1 - vec2(uTime * 0.006, 0.0));
  float cl = smoothstep(0.42, 0.85, c * 0.7 + c2 * 0.4) * smoothstep(-0.02, 0.25, y);
  cl *= 1.0 - sil * 0.55 * (1.0 - smoothstep(0.12, 0.3, y));
  col = mix(col, mix(vec3(0.14, 0.13, 0.14), vec3(0.55, 0.32, 0.18), az * az * 0.6), cl * 0.75);
  col += win * (1.0 - cl * 0.8) * 1.6;
  // sun haze
  float s = max(0.0, dot(d, normalize(uSun)));
  col += vec3(1.0, 0.72, 0.42) * pow(s, 18.0) * 0.8 + vec3(1.0, 0.55, 0.3) * pow(s, 4.0) * 0.32;
  // sun shafts through the smoke bands
  float rays = smoothstep(0.5, 1.0, fbm(vec2(atan(d.z - uSun.z, d.x - uSun.x) * 6.0, uTime * 0.02))) * pow(s, 3.0);
  col += vec3(1.0, 0.6, 0.3) * rays * 0.35 * (1.0 - cl * 0.5);
  col += vec3(1.0, 0.95, 0.8) * pow(s, 400.0) * 2.0 * (1.0 - cl) * (1.0 - sil);
  col += vec3(1.0, 0.6, 0.3) * uFlash * (1.0 - smoothstep(0.0, 0.3, y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
