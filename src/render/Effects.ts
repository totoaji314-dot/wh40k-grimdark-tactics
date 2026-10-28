import * as THREE from 'three';

// GPU particle + tracer system for combat effects. All sprites are procedurally drawn into one atlas.
//   frame 0 soft glow, 1 smoke puff, 2 flame, 3 spark / streak

function makeAtlas() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d')!;
  // glow
  let gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  // smoke: many soft blobs
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * S * 0.28;
    const x = S + S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r, rr = S * (0.12 + Math.random() * 0.16);
    gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(255,255,255,${0.16 + Math.random() * 0.1})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  // flame: tall teardrop
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (Math.random() - 0.5) * S * 0.3, y = S + S * 0.62 - Math.random() * S * 0.5, rr = S * (0.08 + Math.random() * 0.14);
    gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  // spark streak
  gr = g.createLinearGradient(S + S / 2, S + 8, S + S / 2, S * 2 - 8);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(S + S / 2 - 5, S + 8, 10, S - 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array;
  size: Float32Array; grow: Float32Array; col: Float32Array; a0: Float32Array; frame: Float32Array; rot: Float32Array; rotV: Float32Array;
  grav: Float32Array; drag: Float32Array;
  aPos: THREE.InstancedBufferAttribute; aCol: THREE.InstancedBufferAttribute; aMisc: THREE.InstancedBufferAttribute;
  n: number; cap: number;
}

export interface FXOpts { size: number; grow?: number; life: number; color: number; alpha?: number; frame: number; vx?: number; vy?: number; vz?: number; grav?: number; drag?: number; rotV?: number; add?: boolean }

const VS = `
attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iMisc; // size, rot, frame
varying vec2 vUv; varying vec4 vCol;
#include <fog_pars_vertex>
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iMisc.y), s = sin(iMisc.y);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  vec3 wp = iPos + (right * q.x + up * q.y) * iMisc.x;
  float f = iMisc.z;
  // atlas cell (canvas rows are flipped by the texture upload)
  vUv = vec2((uv.x + mod(f, 2.0)) * 0.5, (uv.y + 1.0 - floor(f / 2.0)) * 0.5);
  vCol = iCol;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
uniform sampler2D tAtlas; varying vec2 vUv; varying vec4 vCol;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(tAtlas, vUv);
  gl_FragColor = vec4(vCol.rgb * t.rgb, t.a * vCol.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <fog_fragment>
}`;

export class Effects {
  group = new THREE.Group();
  private add: Pool; private alpha: Pool;
  private tracers: { mesh: THREE.InstancedMesh; aA: THREE.InstancedBufferAttribute; aB: THREE.InstancedBufferAttribute; aC: THREE.InstancedBufferAttribute; list: Tracer[]; cap: number };
  private lights: { l: THREE.PointLight; t: number; max: number }[] = [];
  private emitters: { x: number; y: number; z: number; s: number; kind: 'fire' | 'stack'; acc: number }[] = [];
  private v = new THREE.Vector3();
  budget: number;
  camPos = new THREE.Vector3();

  constructor(budget: number, lightCount: number) {
    this.budget = budget;
    const atlas = makeAtlas();
    this.add = this.pool(Math.floor(budget * 0.55), atlas, THREE.AdditiveBlending);
    this.alpha = this.pool(Math.floor(budget * 0.45), atlas, THREE.NormalBlending);
    this.alpha.mesh.renderOrder = 5; this.add.mesh.renderOrder = 6;
    this.tracers = this.tracerPool(600);
    for (let i = 0; i < lightCount; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 18, 2);
      l.visible = false;
      this.group.add(l);
      this.lights.push({ l, t: 0, max: 0 });
    }
  }

  private pool(cap: number, atlas: THREE.Texture, blending: THREE.Blending): Pool {
    const geo = new THREE.PlaneGeometry(1, 1);
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); aPos.setUsage(THREE.DynamicDrawUsage);
    const aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aCol.setUsage(THREE.DynamicDrawUsage);
    const aMisc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); aMisc.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', aPos); geo.setAttribute('iCol', aCol); geo.setAttribute('iMisc', aMisc);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tAtlas: { value: atlas } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending, fog: true,
    });
    mat.uniforms.tAtlas.value = atlas;
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.frustumCulled = false; mesh.count = 0;
    this.group.add(mesh);
    const F = (k: number) => new Float32Array(cap * k);
    return { mesh, pos: F(3), vel: F(3), life: F(1), max: F(1), size: F(1), grow: F(1), col: F(3), a0: F(1), frame: F(1), rot: F(1), rotV: F(1), grav: F(1), drag: F(1), aPos, aCol, aMisc, n: 0, cap };
  }

  private tracerPool(cap: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0);
    const aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aA.setUsage(THREE.DynamicDrawUsage);
    const aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aB.setUsage(THREE.DynamicDrawUsage);
    const aC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aC.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aA', aA); geo.setAttribute('aB', aB); geo.setAttribute('aC', aC);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; varying vec4 vC; varying vec2 vUv;
        void main(){
          vec3 a = aA.xyz, b = aB.xyz; float w = aA.w;
          vec3 d = normalize(b - a + vec3(1e-5));
          vec3 camPos = cameraPosition;
          vec3 side = normalize(cross(d, normalize(mix(a, b, position.x) - camPos)));
          vec3 wp = mix(a, b, position.x) + side * position.y * w;
          vC = aC; vUv = vec2(position.x, position.y + 0.5);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `varying vec4 vC; varying vec2 vUv;
        void main(){ float e = 1.0 - abs(vUv.y - 0.5) * 2.0; float head = smoothstep(0.0, 0.9, vUv.x);
          gl_FragColor = vec4(vC.rgb * (0.6 + e * 1.6), vC.a * e * e * head); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 7;
    this.group.add(mesh);
    return { mesh, aA, aB, aC, list: [] as Tracer[], cap };
  }

  spawn(x: number, y: number, z: number, o: FXOpts) {
    const p = o.add ? this.add : this.alpha;
    if (p.n >= p.cap) return;
    const i = p.n++;
    p.pos[i * 3] = x; p.pos[i * 3 + 1] = y; p.pos[i * 3 + 2] = z;
    p.vel[i * 3] = o.vx ?? 0; p.vel[i * 3 + 1] = o.vy ?? 0; p.vel[i * 3 + 2] = o.vz ?? 0;
    p.life[i] = 0; p.max[i] = o.life; p.size[i] = o.size; p.grow[i] = o.grow ?? 0;
    const c = o.color;
    p.col[i * 3] = ((c >> 16) & 255) / 255; p.col[i * 3 + 1] = ((c >> 8) & 255) / 255; p.col[i * 3 + 2] = (c & 255) / 255;
    p.a0[i] = o.alpha ?? 1; p.frame[i] = o.frame; p.rot[i] = Math.random() * 6.28; p.rotV[i] = o.rotV ?? (Math.random() - 0.5);
    p.grav[i] = o.grav ?? 0; p.drag[i] = o.drag ?? 0;
  }

  /** Projectile tracer from a to b over `dur` seconds. */
  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number, dur: number, kind: string) {
    const T = this.tracers;
    if (T.list.length >= T.cap) return;
    const style = TRACER[kind] ?? TRACER.slug;
    T.list.push({ ax, ay, az, bx, by, bz, t: 0, dur: Math.max(0.03, dur), ...style });
  }

  light(x: number, y: number, z: number, color: number, intensity: number, dur: number, range = 16) {
    if (!this.lights.length) return;
    // reuse the light that is dimmest / farthest
    let best = this.lights[0], bs = -1;
    for (const L of this.lights) {
      const s = L.t <= 0 ? 1e9 : -L.l.intensity;
      if (s > bs) { bs = s; best = L; }
    }
    if (this.camPos.distanceToSquared(this.v.set(x, y, z)) > 160 * 160) return;
    best.l.position.set(x, y, z); best.l.color.setHex(color); best.l.distance = range;
    best.t = dur; best.max = intensity; best.l.intensity = intensity; best.l.visible = true;
  }

  // ------------------------------------------------------------------ high-level effects
  muzzle(x: number, y: number, z: number, kind: string, dx: number, dz: number) {
    const st = TRACER[kind] ?? TRACER.slug;
    const s = st.flash;
    this.spawn(x, y, z, { size: s, grow: -s * 6, life: 0.07, color: st.flashColor, frame: 0, add: true });
    this.spawn(x + dx * s * 0.4, y, z + dz * s * 0.4, { size: s * 0.7, grow: -s * 4, life: 0.06, color: 0xffffff, alpha: 0.8, frame: 0, add: true });
    if (kind !== 'las' && kind !== 'plasma') this.spawn(x, y, z, { size: 0.25, grow: 1.2, life: 0.9, color: 0x8a8580, alpha: 0.35, frame: 1, vy: 0.5, vx: dx * 0.6, vz: dz * 0.6 });
    if (s > 0.5) this.light(x, y, z, st.flashColor, s * 6, 0.07, 10);
  }

  impact(x: number, y: number, z: number, kind: string, hitArmour: boolean, hitFlesh: boolean) {
    const st = TRACER[kind] ?? TRACER.slug;
    if (kind === 'plasma') { this.explosion(x, y, z, 1.2, 0x60c0ff); return; }
    if (kind === 'bolt' || kind === 'hbolt') {
      this.spawn(x, y, z, { size: kind === 'hbolt' ? 1.1 : 0.75, grow: -2, life: 0.12, color: 0xffb050, frame: 0, add: true });
      this.light(x, y, z, 0xff9040, kind === 'hbolt' ? 5 : 3, 0.08, 9);
    }
    if (hitArmour) {
      for (let i = 0; i < 4; i++) this.spawn(x, y, z, { size: 0.12, life: 0.25 + Math.random() * 0.2, color: 0xffd080, frame: 3, add: true, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 6, grav: 12 });
    } else if (hitFlesh) {
      this.spawn(x, y, z, { size: 0.3, grow: 1.2, life: 0.4, color: 0x4a1612, alpha: 0.7, frame: 1, vy: 0.3 });
    } else {
      this.spawn(x, y, z, { size: 0.4, grow: 1.8, life: 0.8, color: 0x7a6a58, alpha: 0.55, frame: 1, vy: 0.6, drag: 1 });
      this.spawn(x, y, z, { size: 0.12, life: 0.35, color: 0x5a4a3a, alpha: 0.9, frame: 1, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, grav: 9 });
    }
    void st;
  }

  explosion(x: number, y: number, z: number, r: number, color = 0xff8030) {
    this.spawn(x, y + 0.3, z, { size: r * 2.2, grow: r * 3, life: 0.28, color, frame: 0, add: true });
    for (let i = 0; i < 6; i++) this.spawn(x, y + 0.3, z, { size: r * (0.6 + Math.random() * 0.5), grow: r * 1.2, life: 0.35 + Math.random() * 0.2, color: 0xffa040, frame: 2, add: true, vx: (Math.random() - 0.5) * 4 * r, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 4 * r });
    for (let i = 0; i < 5; i++) this.spawn(x, y + 0.5, z, { size: r * 0.9, grow: r * 1.6, life: 1.6 + Math.random(), color: 0x3a3430, alpha: 0.6, frame: 1, vx: (Math.random() - 0.5) * 2, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 2, drag: 0.8 });
    for (let i = 0; i < 8; i++) this.spawn(x, y + 0.3, z, { size: 0.15, life: 0.5 + Math.random() * 0.4, color: 0xffd090, frame: 3, add: true, vx: (Math.random() - 0.5) * 12, vy: 3 + Math.random() * 6, vz: (Math.random() - 0.5) * 12, grav: 14 });
    this.light(x, y + 1, z, color, 12 * r, 0.25, 14 + r * 6);
  }

  dust(x: number, y: number, z: number, s = 1) {
    for (let i = 0; i < 3; i++) this.spawn(x + (Math.random() - 0.5) * 0.6, y + 0.15, z + (Math.random() - 0.5) * 0.6, { size: 0.5 * s, grow: 1.4 * s, life: 1.1, color: 0x6a5e50, alpha: 0.4, frame: 1, vx: (Math.random() - 0.5), vy: 0.4, vz: (Math.random() - 0.5), drag: 1 });
  }

  addFire(x: number, y: number, z: number, s: number) { this.emitters.push({ x, y, z, s, kind: 'fire', acc: 0 }); }
  addStack(x: number, y: number, z: number, s: number) { this.emitters.push({ x, y, z, s, kind: 'stack', acc: 0 }); }

  // ------------------------------------------------------------------ update
  update(dt: number, camPos: THREE.Vector3, wind: [number, number]) {
    this.camPos.copy(camPos);
    for (const e of this.emitters) {
      const d2 = (e.x - camPos.x) ** 2 + (e.z - camPos.z) ** 2;
      const far = d2 > 300 * 300;
      e.acc += dt * (e.kind === 'fire' ? (far ? 3 : 14) * e.s : 4 * e.s);
      while (e.acc > 1) {
        e.acc -= 1;
        if (e.kind === 'fire') {
          this.spawn(e.x + (Math.random() - 0.5) * e.s, e.y + 0.2, e.z + (Math.random() - 0.5) * e.s, { size: 0.9 * e.s, grow: -0.4, life: 0.6 + Math.random() * 0.4, color: Math.random() < 0.5 ? 0xff7020 : 0xffa040, frame: 2, add: true, vy: 2.2 + Math.random(), rotV: 0 });
          if (Math.random() < 0.6) this.spawn(e.x + (Math.random() - 0.5) * e.s, e.y + 1.4 * e.s, e.z + (Math.random() - 0.5) * e.s, { size: 1.6 * e.s, grow: 2.6 * e.s, life: 5 + Math.random() * 3, color: 0x1e1b1a, alpha: 0.5, frame: 1, vy: 1.8 + Math.random(), vx: wind[0], vz: wind[1], drag: 0.12 });
          if (Math.random() < 0.15) this.spawn(e.x, e.y + 0.8, e.z, { size: 0.06, life: 2, color: 0xffa040, frame: 0, add: true, vx: (Math.random() - 0.5) * 1.5 + wind[0], vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 1.5 + wind[1] });
        } else {
          this.spawn(e.x + (Math.random() - 0.5) * 2, e.y, e.z + (Math.random() - 0.5) * 2, { size: 3.5 * e.s, grow: 4.5 * e.s, life: 10 + Math.random() * 5, color: 0x2a2624, alpha: 0.42, frame: 1, vy: 2.2 + Math.random(), vx: wind[0] * 1.6, vz: wind[1] * 1.6, drag: 0.05 });
        }
      }
    }
    for (const p of [this.add, this.alpha]) this.step(p, dt);
    // tracers
    const T = this.tracers;
    let n = 0;
    for (let i = T.list.length - 1; i >= 0; i--) {
      const r = T.list[i];
      r.t += dt;
      if (r.t >= r.dur + 0.02) { T.list.splice(i, 1); continue; }
    }
    const A = T.aA.array as Float32Array, B = T.aB.array as Float32Array, C = T.aC.array as Float32Array;
    for (const r of T.list) {
      const k = Math.min(1, r.t / r.dur);
      const dx = r.bx - r.ax, dy = r.by - r.ay, dz = r.bz - r.az;
      const L = Math.hypot(dx, dy, dz) || 1;
      const hx = r.ax + dx * k, hy = r.ay + dy * k, hz = r.az + dz * k;
      const tl = Math.min(r.len, L * k);
      A[n * 4] = hx - dx / L * tl; A[n * 4 + 1] = hy - dy / L * tl; A[n * 4 + 2] = hz - dz / L * tl; A[n * 4 + 3] = r.w;
      B[n * 4] = hx; B[n * 4 + 1] = hy; B[n * 4 + 2] = hz;
      C[n * 4] = r.r; C[n * 4 + 1] = r.g; C[n * 4 + 2] = r.b; C[n * 4 + 3] = 1;
      n++;
      if (r.kind === 'plasma' && Math.random() < 0.6) this.spawn(hx, hy, hz, { size: 0.55, life: 0.12, color: 0x60c0ff, frame: 0, add: true });
    }
    T.mesh.count = n;
    for (const a of [T.aA, T.aB, T.aC]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    for (const L of this.lights) {
      if (L.t <= 0) { L.l.visible = false; continue; }
      L.t -= dt;
      L.l.intensity = Math.max(0, L.max * (L.t > 0 ? 1 : 0));
    }
  }

  private step(p: Pool, dt: number) {
    let w = 0;
    const P = p.aPos.array as Float32Array, Cc = p.aCol.array as Float32Array, Mm = p.aMisc.array as Float32Array;
    for (let i = 0; i < p.n; i++) {
      p.life[i] += dt;
      if (p.life[i] >= p.max[i]) continue;
      // compact in place
      if (w !== i) {
        for (const [arr, k] of [[p.pos, 3], [p.vel, 3], [p.col, 3]] as const) for (let j = 0; j < k; j++) arr[w * k + j] = arr[i * k + j];
        p.life[w] = p.life[i]; p.max[w] = p.max[i]; p.size[w] = p.size[i]; p.grow[w] = p.grow[i]; p.a0[w] = p.a0[i];
        p.frame[w] = p.frame[i]; p.rot[w] = p.rot[i]; p.rotV[w] = p.rotV[i]; p.grav[w] = p.grav[i]; p.drag[w] = p.drag[i];
      }
      const dr = Math.max(0, 1 - p.drag[w] * dt);
      p.vel[w * 3] *= dr; p.vel[w * 3 + 1] = p.vel[w * 3 + 1] * dr - p.grav[w] * dt; p.vel[w * 3 + 2] *= dr;
      p.pos[w * 3] += p.vel[w * 3] * dt; p.pos[w * 3 + 1] += p.vel[w * 3 + 1] * dt; p.pos[w * 3 + 2] += p.vel[w * 3 + 2] * dt;
      p.size[w] = Math.max(0.01, p.size[w] + p.grow[w] * dt);
      p.rot[w] += p.rotV[w] * dt;
      const t = p.life[w] / p.max[w];
      const fade = p.frame[w] === 1 ? Math.min(1, t * 6) * (1 - t) : (1 - t);
      P[w * 3] = p.pos[w * 3]; P[w * 3 + 1] = p.pos[w * 3 + 1]; P[w * 3 + 2] = p.pos[w * 3 + 2];
      Cc[w * 4] = p.col[w * 3]; Cc[w * 4 + 1] = p.col[w * 3 + 1]; Cc[w * 4 + 2] = p.col[w * 3 + 2]; Cc[w * 4 + 3] = p.a0[w] * fade;
      Mm[w * 3] = p.size[w]; Mm[w * 3 + 1] = p.rot[w]; Mm[w * 3 + 2] = p.frame[w];
      w++;
    }
    p.n = w;
    p.mesh.count = w;
    for (const [a, k] of [[p.aPos, 3], [p.aCol, 4], [p.aMisc, 3]] as const) { a.clearUpdateRanges(); a.addUpdateRange(0, w * k); a.needsUpdate = true; }
  }
}

interface Tracer { ax: number; ay: number; az: number; bx: number; by: number; bz: number; t: number; dur: number; len: number; w: number; r: number; g: number; b: number; kind: string; flash: number; flashColor: number }

const TR = (kind: string, len: number, w: number, color: number, flash: number, flashColor: number) =>
  ({ kind, len, w, r: ((color >> 16) & 255) / 255 * 2, g: ((color >> 8) & 255) / 255 * 2, b: (color & 255) / 255 * 2, flash, flashColor });
const TRACER: Record<string, Omit<Tracer, 'ax' | 'ay' | 'az' | 'bx' | 'by' | 'bz' | 't' | 'dur'>> = {
  las: TR('las', 5, 0.07, 0xff3010, 0.35, 0xff4020),
  bolt: TR('bolt', 2.2, 0.09, 0xffa030, 0.6, 0xffa040),
  hbolt: TR('hbolt', 2.8, 0.12, 0xffb040, 0.85, 0xffb050),
  stub: TR('stub', 3.5, 0.05, 0xffd060, 0.45, 0xffc060),
  plasma: TR('plasma', 1.6, 0.32, 0x40b0ff, 0.9, 0x70d0ff),
  slug: TR('slug', 2.5, 0.06, 0xff9a40, 0.55, 0xffa050),
  none: TR('none', 0, 0, 0, 0, 0),
};
