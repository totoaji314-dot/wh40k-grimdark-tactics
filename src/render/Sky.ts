import * as THREE from 'three';
import { mulberry32 } from '../world/noise';

/**
 * Grimdark sky: smoke-choked gradient dome with a burning horizon glow, drifting cloud bands,
 * a hazy sun, and a ring of distant hive-city spires / manufactorum stacks for scale.
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
      fragmentShader: `
        varying vec3 vDir; uniform vec3 uSun; uniform float uTime; uniform float uFlash;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 zen = vec3(0.10, 0.10, 0.12);
          vec3 mid = vec3(0.30, 0.25, 0.22);
          vec3 hor = vec3(0.62, 0.40, 0.25);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, y));
          col = mix(col, zen, smoothstep(0.18, 0.7, y));
          // burning hive glow on the northern horizon
          float north = max(0.0, -d.z) * (1.0 - smoothstep(0.0, 0.16, y));
          col += vec3(0.55, 0.18, 0.04) * north * 0.9;
          // cloud / smoke bands
          vec2 uv = d.xz / max(0.08, y + 0.15) * 1.3;
          float c = fbm(uv * 1.2 + vec2(uTime * 0.004, uTime * 0.002));
          float c2 = fbm(uv * 3.1 - vec2(uTime * 0.006, 0.0));
          float cl = smoothstep(0.42, 0.85, c * 0.7 + c2 * 0.4) * smoothstep(-0.02, 0.25, y);
          col = mix(col, vec3(0.16, 0.14, 0.14), cl * 0.75);
          // sun haze
          float s = max(0.0, dot(d, normalize(uSun)));
          col += vec3(1.0, 0.75, 0.45) * pow(s, 18.0) * 0.55 + vec3(1.0, 0.55, 0.3) * pow(s, 4.0) * 0.2;
          col += vec3(1.0, 0.95, 0.8) * pow(s, 400.0) * 2.0 * (1.0 - cl);
          col += vec3(1.0, 0.6, 0.3) * uFlash * (1.0 - smoothstep(0.0, 0.3, y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // distant city silhouette ring (merged boxes, fogged to the horizon colour)
  const rnd = mulberry32(99);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2 + rnd() * 0.02;
    const r = 700 + rnd() * 450;
    const big = rnd() < 0.08;
    const h = big ? 220 + rnd() * 260 : 30 + rnd() * 120;
    const w = big ? 40 + rnd() * 50 : 18 + rnd() * 60;
    const g = new THREE.BoxGeometry(w, h, w * (0.6 + rnd()));
    g.translate(Math.cos(a) * r, h / 2 - 8, Math.sin(a) * r);
    parts.push(g);
    if (big) {
      const sp = new THREE.ConeGeometry(w * 0.35, h * 0.5, 6);
      sp.translate(Math.cos(a) * r, h + h * 0.25 - 8, Math.sin(a) * r);
      parts.push(sp);
    }
    if (rnd() < 0.25) {
      const st = new THREE.CylinderGeometry(4 + rnd() * 4, 6 + rnd() * 5, h * 1.4, 8);
      st.translate(Math.cos(a) * r + 20, h * 0.7 - 8, Math.sin(a) * r + 10);
      parts.push(st);
    }
  }
  const merged = mergeBoxes(parts);
  const city = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: 0x1c1816, fog: true }));
  city.name = 'skyline';
  group.add(city);
  return { group, dome };
}

function mergeBoxes(geos: THREE.BufferGeometry[]) {
  let n = 0;
  const nonIdx = geos.map((g) => { const x = g.toNonIndexed(); n += x.attributes.position.count; return x; });
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of nonIdx) { pos.set(g.attributes.position.array as Float32Array, o); o += g.attributes.position.count * 3; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}
