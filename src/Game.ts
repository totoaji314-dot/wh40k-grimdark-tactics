import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BattleMap, PLAY, HALF, GN, CELL } from './world/MapGen';
import { buildTerrain } from './world/Terrain';
import { buildEnv, loadEnvFootprints } from './world/Env';
import { VehicleViews, type VehicleMeta } from './render/Vehicles';
import { Cinematic } from './core/Cinematic';
import { localFactionOverrides } from './render/localAssets';
import { buildScatter } from './world/Scatter';
import { buildProps, PROP_PIECES } from './world/Props';
import { buildSky } from './render/Sky';
import { UnitLibrary, heroLight } from './render/UnitLibrary';
import { UnitRenderer, type Figure } from './render/UnitRenderer';
import { Effects } from './render/Effects';
import { CameraRig } from './core/CameraRig';
import { Battle, type Unit, type Soldier } from './sim/Battle';
import { Commander } from './sim/AI';
import { stepAnim, type ClipTable } from './sim/anim';
import { SOLDIERS, UNITS, FACTIONS, ABILITIES, type Scenario, type FormationId, type FactionId } from './sim/data';
import { Hud } from './ui/Hud';
import type { Audio } from './core/Audio';
import { PRESETS, type QualityLevel, type Settings } from './core/Settings';

const STEP = 1 / 30;
/** Low dusk sun from the west-north-west: raking light and long shadows over the battlefield. */
const SUN_DIR = new THREE.Vector3(-0.86, 0.33, -0.3).normalize();
const BASE = import.meta.env.BASE_URL;

interface Strike { kind: 'air' | 'pod'; t: number; x: number; z: number; dx: number; dz: number; mesh: THREE.Group; shots: number; bombs: number; done: boolean; pending?: { t: number; x: number; z: number }[] }

export interface BattleOptions { scenario: Scenario; difficulty: number; scale: number; quality: QualityLevel; seed?: number   /** false skips the pre-battle deployment phase (automated tests) */
  deploy?: boolean;
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uTime; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 0.88);                       // slightly desaturated grimdark palette
      c.rgb *= mix(vec3(0.94, 0.97, 1.05), vec3(1.06, 0.99, 0.9), smoothstep(0.1, 0.7, l)); // cool shadows, warm highlights
      c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * uVig * 2.2;
      float g = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * 0.018;
      gl_FragColor = c;
    }`,
};

export class Game {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rig!: CameraRig;
  battle!: Battle;
  map!: BattleMap;
  ai: Commander[] = [];
  lib!: UnitLibrary;
  units!: UnitRenderer;
  fx!: Effects;
  hud!: Hud;
  figures: Figure[] = [];
  figOf = new Map<Soldier, Figure>();
  vehicles!: VehicleViews;
  cine!: Cinematic;
  selected = new Set<Unit>();
  playerSide = 0;
  speed = 1;
  paused = false;
  /** pre-battle deployment: the simulation and AI wait while the player positions units */
  deploying = false;
  deployZone = { x0: 0, x1: 0, z0: 0, z1: 0 };
  private zoneMesh: THREE.Group | null = null;
  private groups = new Map<number, Unit[]>();
  private groupTap = { n: -1, t: 0 };
  private acc = 0;
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private sun!: THREE.DirectionalLight;
  private sky!: ReturnType<typeof buildSky>;
  private rings!: THREE.InstancedMesh;
  private preview!: THREE.InstancedMesh;
  private hudT = 0;
  private miniT = 0;
  private miniBg: HTMLCanvasElement | null = null;
  private running = false;
  private raf = 0;
  private last = 0;
  private fpsAcc = { t: 0, n: 0, fps: 60 };
  private resultsShown = false;
  private overT = 0;
  private disposers: (() => void)[] = [];
  private keys = new Set<string>();
  private preset;
  private hover: Unit | null = null;
  private flash = 0;
  private fireLights: THREE.PointLight[] = [];
  private scatter: ReturnType<typeof buildScatter> | null = null;
  private clock = 0;
  fireSpots: { x: number; y: number; z: number; s: number }[] = [];
  onExit?: () => void;
  onResult?: (won: boolean) => void;

  constructor(public renderer: THREE.WebGLRenderer, public ui: HTMLElement, public settings: Settings, public audio: Audio, public opts: BattleOptions) {
    this.preset = PRESETS[opts.quality];
    this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 3000);
  }

  // ====================================================================== loading
  async load(progress: (p: number, msg: string) => void) {
    const sc = this.opts.scenario;
    const P = this.preset;
    progress(0.05, '전장 지형 생성 중');
    const foot = await loadEnvFootprints(BASE + 'assets/env/');
    this.map = new BattleMap(sc.map, foot, (this.opts.seed ?? 1234) + sc.id.length);
    await tick();
    progress(0.15, '부대 모델 로드 중');
    const factions = new Set<FactionId>();
    for (const d of [...sc.side0, ...sc.side1]) factions.add(UNITS[d.unit].faction);
    const playerFactions = new Set((this.playerSide === 0 ? sc.side0 : sc.side1).map((d) => UNITS[d.unit].faction));
    this.support = { air: sc.support?.air ?? 0, pods: playerFactions.has('marines') ? sc.support?.pods ?? 0 : 0 };
    if (this.support.pods > 0) factions.add('marines');
    this.lib = new UnitLibrary(BASE + 'assets/units/', this.renderer.capabilities.getMaxAnisotropy() > 4 ? 4 : 1);
    this.lib.overrides = await localFactionOverrides();
    if (this.lib.overrides.marines) console.info('[units] marines: local Space Marine (2011) reference models (dev server only)');
    let fi = 0;
    for (const f of factions) {
      await this.lib.loadFaction(f, P.halfUnitTex, (id) => progress(0.15 + (fi / factions.size) * 0.4, `${FACTIONS[f].ko} 모델: ${id}`));
      fi++;
    }
    const clips: ClipTable = {};
    for (const [id, v] of this.lib.variants) { clips[id] = {}; for (const [c, m] of Object.entries(v.clips)) clips[id][c] = { dur: m.dur, loop: m.loop, speed: m.speed, event: m.event }; }
    progress(0.58, '전투 준비 중');
    this.battle = new Battle(this.map, sc, clips, this.opts.seed ?? (Date.now() & 0xffff), this.opts.scale);
    // difficulty: AI side gets a small stat edge / handicap through morale
    for (const u of this.battle.units) if (u.side !== this.playerSide) u.morale = Math.min(100, u.morale * (0.85 + this.opts.difficulty * 0.15));
    this.ai = [new Commander(this.battle, 1 - this.playerSide, this.opts.difficulty)];
    const counts: Record<string, number> = {};
    for (const s of this.battle.soldiers) {
      if (s.def.vehicle) continue;   // tanks are drawn by VehicleViews, not the instanced soldier renderer
      counts[s.def.id] = (counts[s.def.id] ?? 0) + 1;
      const f: Figure = { variant: s.def.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, scale: s.def.scale, tint: s.tint, anim: s.anim, visible: true };
      this.figures.push(f); this.figOf.set(s, f);
    }
    // room for drop-pod reinforcements (one tactical squad per pod)
    for (const [id, n] of UNITS.tactical.members) counts[id] = (counts[id] ?? 0) + n * this.support.pods;
    this.units = new UnitRenderer(this.lib, counts, P.shadowSize > 0 && this.settings.shadows);
    this.units.lodDist = [24, 64];
    this.scene.add(this.units.group);
    await tick();
    progress(0.66, '지형 텍스처 생성 중');
    const terrain = buildTerrain(this.map, P.terrainRes, P.texSize);
    this.scene.add(terrain);
    await tick();
    progress(0.78, '건물과 엄폐물 배치 중');
    const density = this.opts.quality === 'high' ? 1 : this.opts.quality === 'medium' ? 0.6 : 0.3;
    const vehicleMeta: Record<string, VehicleMeta> = await (await fetch(BASE + 'assets/vehicles/vehicles.json')).json();
    // photoscanned props replace the kit's crates / barrels / barricades; if they fail to load the kit pieces stay
    const props = await buildProps(BASE + 'assets/props/', this.map, density, P.shadowSize > 0 && this.settings.shadows).catch((err) => { console.warn('[props] not loaded', err); return null; });
    if (props) { this.scene.add(props.group); console.info('[props]', props.count, 'props,', Math.round(props.tris), 'triangles'); }
    const env = await buildEnv(BASE + 'assets/env/', this.map, P.envTex, P.shadowSize > 0 && this.settings.shadows, density === 1 ? 1 : density === 0.6 ? 0.5 : 0.25, [BASE + 'assets/vehicles/vehicles.glb'], props ? PROP_PIECES : new Set());
    this.scene.add(env.group);
    this.makePiece = env.makePiece;
    console.info('[env] triangles', env.tris, 'backdrop blocks', this.map.backdrop.length);
    this.scatter = buildScatter(this.map, density, this.opts.quality === 'high' && P.shadowSize > 0 && this.settings.shadows);
    this.scene.add(this.scatter.group);
    progress(0.9, '조명과 대기 효과');
    this.setupLights();
    this.fx = new Effects(P.particles, P.lights);
    this.scene.add(this.fx.group);
    this.vehicles = new VehicleViews(this.scene, env.makePiece, env.getMat, vehicleMeta, this.fx, (x, z) => this.map.heightAt(x, z));
    for (const s of this.battle.soldiers) if (s.def.vehicle) this.vehicles.add(s);
    for (const f of this.map.fires) { this.fx.addFire(f.x, f.y, f.z, f.s); this.fireSpots.push(f); }
    for (const p of this.map.placements) {
      if (p.piece === 'smokestack') this.fx.addStack(p.x, p.y + 37, p.z, 1.3);
      if (p.piece === 'manufactorum') {
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        for (const [lx, lz] of [[10, -3], [5, -3]]) this.fx.addStack(p.x + lx * c + lz * s, p.y + 23, p.z - lx * s + lz * c, 0.9);
      }
      if (p.piece === 'wreck' && Math.random() < 0.7) { this.fx.addFire(p.x, p.y + 2.2, p.z, 0.8); this.fireSpots.push({ x: p.x, y: p.y + 2.2, z: p.z, s: 0.8 }); }
    }
    // the burning city beyond the battlefield: a few big blazes and the tallest stacks still smoking
    {
      let fires = 0, stacks = 0;
      const far = density === 1 ? 5 : density === 0.6 ? 3 : 1;
      for (const p of this.map.backdrop) {
        if (p.piece === 'smokestack' && stacks < far) { this.fx.addStack(p.x, p.y + 37, p.z, 1.6); stacks++; }
        else if ((p.piece === 'hab' || p.piece === 'manufactorum') && fires < far && (Math.abs(p.x * 7.3 + p.z * 3.1) % 5) < 1) { this.fx.addFire(p.x, p.y + 1, p.z, 3.2); fires++; }
      }
    }
    this.makeMarkers();
    this.rig = new CameraRig(this.camera, (x, z) => this.map.heightAt(x, z));
    this.cine = new Cinematic(this.ui, this.camera, (x, z) => this.map.heightAt(x, z), (x0, z0, x1, z1) => this.map.los(x0, z0, x1, z1, 2.2, 1.2),
      (x, z) => !this.map.isBlocked(x, z) && ![[0, 0], [3.5, 0], [-3.5, 0], [0, 3.5], [0, -3.5], [2.5, 2.5], [-2.5, 2.5], [2.5, -2.5], [-2.5, -2.5]].some(([ox, oz]) => this.map.isSolid(x + ox, z + oz, 0.4)));
    const mine = this.battle.units.filter((u) => u.side === this.playerSide);
    const cx = mine.reduce((s, u) => s + u.x, 0) / mine.length, cz = mine.reduce((s, u) => s + u.z, 0) / mine.length;
    this.rig.focus(cx, cz + (cz > 0 ? 18 : -18), 85);
    this.rig.yaw = cz > 0 ? 0 : Math.PI;
    this.rig.update(1);
    this.setupPost();
    this.hud = new Hud(this.ui, this.battle, this.playerSide, {
      select: (u, add) => this.select(u, add), focus: (u) => this.rig.focus(u.x, u.z, Math.min(this.rig.dist, 60)),
      halt: () => this.forSel((u) => this.battle.order(u, { type: 'halt' })),
      run: () => { const on = ![...this.selected].every((u) => u.run); this.forSel((u) => { u.run = on; }); },
      charge: () => this.chargeNearest(),
      fireAtWill: () => { const on = ![...this.selected].every((u) => u.fireAtWill); this.forSel((u) => { u.fireAtWill = on; if (!on && u.order.type !== 'attack') u.target = null; }); },
      meleeMode: () => this.toggleMode('meleeMode', '근접전 모드'),
      guard: () => this.toggleMode('guard', '경계 모드'),
      skirmish: () => this.toggleMode('skirmish', '견제 모드'),
      groupLock: () => { this.groupLock = !this.groupLock; this.hud.groupLocked = this.groupLock; this.hud.toast(this.groupLock ? '그룹 진형 고정: 부대 간 배치를 유지하며 이동' : '그룹 진형 고정 해제', 1.6); this.hud.update(0, this.selected, this.speed, this.paused); },
      formation: (f) => this.forSel((u) => this.battle.setFormation(u, f)),
      ability: () => this.forSel((u) => { if (this.battle.useAbility(u)) this.abilityFx(u); }),
      selectAll: () => this.selectAll(),
      pause: () => this.togglePause(), speed: () => this.cycleSpeed(), menu: () => this.openMenu(), cinematic: () => this.toggleCinematic(),
    });
    this.hud.onBanner = (u, e) => {
      if (e.button === 2) { if (u.side !== this.playerSide && this.selected.size) this.attack(u, false); return; }
      this.clickUnit(u, e.shiftKey || e.ctrlKey || this.hud.multi);
    };
    try { this.hud.setPortraits(this.renderPortraits()); } catch (e) { console.warn('portraits', e); }
    this.hud.showSupport(this.support, (k) => this.armSupport(k));
    if (this.opts.deploy !== false) this.beginDeployment();
    this.hud.fpsEl.style.display = this.settings.showFps ? '' : 'none';
    this.buildMinimapBg();
    this.bindInput();
    this.hud.hint(matchMedia('(pointer:coarse)').matches ? '부대 카드/깃발을 눌러 선택 → 땅을 눌러 이동, 적을 눌러 공격 · 두 손가락으로 회전/확대' : '좌클릭: 선택 · 우클릭: 이동/공격 · 우클릭 드래그: 진형 방향 · WASD/QE/휠: 카메라');
    setTimeout(() => this.hud.hint(''), 9000);
    progress(1, '전투 개시');
    this.renderer.compile(this.scene, this.camera);
  }

  private setupLights() {
    const P = this.preset;
    // dusk: low warm sun raking across the field, cool sky fill, warm haze
    this.scene.background = new THREE.Color(0x6a5a52);
    this.scene.fog = new THREE.FogExp2(0x7a6a60, 0.0031);
    this.scene.add(new THREE.HemisphereLight(0x96a2bc, 0x56402e, 1.55));
    const amb = new THREE.AmbientLight(0x343c50, 0.4); this.scene.add(amb);
    const sunDir = SUN_DIR.clone();
    this.sun = new THREE.DirectionalLight(0xffb070, 3.6);
    heroLight.sunDir.value.copy(sunDir); heroLight.sunColor.value.copy(this.sun.color);
    this.sun.position.copy(sunDir).multiplyScalar(200);
    if (P.shadowSize > 0 && this.settings.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(P.shadowSize, P.shadowSize);
      this.sun.shadow.bias = -0.00025; this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 900;
      this.sun.shadow.radius = 2.5;
    }
    this.scene.add(this.sun, this.sun.target);
    this.sky = buildSky(sunDir);
    this.scene.add(this.sky.group);
    // image-based light: a smoky sky / burnt ground gradient so metal armour has something to reflect
    const envScene = new THREE.Scene();
    const eg = new THREE.SphereGeometry(10, 32, 16);
    const cols: number[] = [];
    const pa = eg.attributes.position;
    const top = new THREE.Color(0x6e7a94), horCool = new THREE.Color(0x8a8890), horWarm = new THREE.Color(0xd8925a), gnd = new THREE.Color(0x3a2e26), tmp = new THREE.Color(), hor = new THREE.Color(), dv = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      dv.set(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize();
      const y = dv.y;
      const az = Math.max(0, new THREE.Vector2(dv.x, dv.z).normalize().dot(new THREE.Vector2(sunDir.x, sunDir.z).normalize()));
      hor.copy(horCool).lerp(horWarm, az * az);
      tmp.copy(y > 0 ? hor : gnd).lerp(y > 0 ? top : gnd, Math.min(1, Math.abs(y) * 2.2));
      tmp.lerp(new THREE.Color(0xffd8a0), Math.pow(Math.max(0, dv.dot(sunDir)), 10) * 0.9);
      cols.push(tmp.r, tmp.g, tmp.b);
    }
    eg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    envScene.add(new THREE.Mesh(eg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pm.dispose();
    this.renderer.shadowMap.enabled = P.shadowSize > 0 && this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // persistent flickering firelight around the burning wrecks / fires nearest the camera
    const nFire = P.lights >= 8 ? 4 : P.lights >= 4 ? 2 : 0;
    for (let i = 0; i < nFire; i++) { const l = new THREE.PointLight(0xff7a30, 0, 16, 1.6); this.scene.add(l); this.fireLights.push(l); }
    this.audio.onDistantBoom = () => { this.flash = 0.6 + Math.random() * 0.4; };
  }

  private setupPost() {
    const P = this.preset;
    if (!P.bloom || !this.settings.post) { this.composer = null; return; }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: P.antialias ? 4 : 0 });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.45, 0.82);
    c.addPass(bloom);
    this.grade = new ShaderPass(GRADE);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  private makeMarkers() {
    const geo = new THREE.RingGeometry(0.42, 0.62, 24); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.rings = new THREE.InstancedMesh(geo, mat, 1200);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1200 * 3), 3);
    this.rings.count = 0; this.rings.frustumCulled = false; this.rings.renderOrder = 3;
    this.scene.add(this.rings);
    const pgeo = new THREE.CircleGeometry(0.35, 12); pgeo.rotateX(-Math.PI / 2);
    this.preview = new THREE.InstancedMesh(pgeo, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false, fog: false }), 1200);
    this.preview.count = 0; this.preview.frustumCulled = false; this.preview.renderOrder = 3;
    this.scene.add(this.preview);
  }

  // ====================================================================== main loop
  start() {
    this.running = true;
    this.last = performance.now();
    this.audio.startAmbience();
    this.hud.toast(this.opts.scenario.ko, 3);
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    loop();
  }

  /** One rendered frame: advance the fixed-step simulation, then animation, effects and rendering. */
  frame(dt: number) {
    const b = this.battle;
    if (!this.paused && !this.deploying) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= STEP && n < 6) {
        for (const a of this.ai) a.update(STEP);
        b.update(STEP);
        this.handleEvents();
        this.acc -= STEP; n++;
      }
      if (n >= 6) this.acc = 0;
      const adt = dt * this.speed;
      for (const s of b.soldiers) if (s.alive || s.deadT < 4) stepAnim(s.anim, adt);
    }
    if (this.cine.active) {
      // the rig keeps following the shot so shadows and the audio listener stay centred on it; the cinematic camera then takes over
      const f = this.cine.focus; if (f) this.rig.focus(f.x, f.z, 30);
      this.rig.update(dt);
      this.cine.update(this.paused ? 0 : dt * this.speed, b);
    } else this.updateCamera(dt);
    this.syncFigures();
    this.vehicles.update(this.paused || this.deploying ? 0 : dt * this.speed, b);
    this.units.update(this.camera, this.figures, this.preset.lodBias);
    this.updateRings();
    this.fx.update(this.paused ? 0 : dt * this.speed, this.camera.position, [1.2, -0.6]);
    if (!this.paused && !this.deploying) this.updateStrikes(dt * this.speed);
    this.updateSun();
    this.updateFireLights();
    this.clock += dt;
    this.scatter?.update(this.clock);
    this.sky.dome.position.copy(this.camera.position);
    const su = (this.sky.dome.material as THREE.ShaderMaterial).uniforms;
    su.uTime.value += dt; this.flash = Math.max(0, this.flash - dt * 2); su.uFlash.value = this.flash * 0.6;
    if (this.grade) this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt) % 10;
    this.audio.listener = { x: this.rig.focusPoint.x, z: this.rig.focusPoint.z, yaw: this.rig.yaw + Math.PI, dist: this.rig.dist };
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.updateBanners();
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.15; this.hud.update(0.15, this.selected, this.speed, this.paused); }
    this.miniT -= dt;
    if (this.miniT <= 0) { this.miniT = 0.25; this.drawMinimap(); }
    this.fpsAcc.t += dt; this.fpsAcc.n++;
    if (this.fpsAcc.t >= 0.5) {
      this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t; this.fpsAcc.t = 0; this.fpsAcc.n = 0;
      if (this.settings.showFps) {
        const info = this.renderer.info.render;
        this.hud.fpsEl.textContent = `${this.fpsAcc.fps.toFixed(0)} FPS · ${this.units.stats.drawn}명 · ${(info.triangles / 1000).toFixed(0)}k tri · ${info.calls} draw`;
      }
    }
    if (b.over && !this.resultsShown) { this.overT += dt; if (this.overT > 2.5) this.showResults(); }
  }

  get fps() { return this.fpsAcc.fps; }

  private syncFigures() {
    for (const s of this.battle.soldiers) {
      const f = this.figOf.get(s);
      if (!f) continue;
      f.x = s.x; f.y = s.y; f.z = s.z; f.yaw = s.yaw;
      f.visible = !(s as Soldier & { fled?: boolean }).fled;
    }
  }

  private updateSun() {
    const t = this.rig.focusPoint;
    const half = THREE.MathUtils.clamp(this.rig.dist * 1.1, 45, 170);
    const cam = this.sun.shadow.camera;
    if (cam.right !== half) { cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix(); }
    // snap to shadow texels to avoid shimmering
    const texel = (half * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(t.x / texel) * texel, sz = Math.round(t.z / texel) * texel;
    const dir = SUN_DIR;
    this.sun.target.position.set(sx, t.y, sz);
    this.sun.position.set(sx + dir.x * 250, t.y + dir.y * 250, sz + dir.z * 250);
    this.sun.target.updateMatrixWorld();
  }

  private fireT = 0;
  private updateFireLights() {
    if (!this.fireLights.length) return;
    this.fireT += 0.016;
    const f = this.rig.focusPoint;
    const near = this.fireSpots.map((s) => ({ s, d: (s.x - f.x) ** 2 + (s.z - f.z) ** 2 })).sort((a, b) => a.d - b.d);
    this.fireLights.forEach((l, i) => {
      const n = near[i];
      if (!n || n.d > 160 * 160) { l.intensity = 0; return; }
      l.position.set(n.s.x, n.s.y + 1.2, n.s.z);
      const fl = 0.75 + 0.25 * Math.sin(this.fireT * 13 + i * 2.1) * Math.sin(this.fireT * 7.3 + i);
      l.intensity = 9 * n.s.s * fl;
    });
  }

  private updateRings() {
    let n = 0;
    if (this.cine?.active) { this.rings.count = 0; return; }
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const put = (s: Soldier, col: number, scale: number) => {
      if (n >= 1200) return;
      m.makeScale(scale, 1, scale); m.setPosition(s.x, s.y + 0.06, s.z);
      this.rings.setMatrixAt(n, m); this.rings.setColorAt(n, c.setHex(col)); n++;
    };
    for (const u of this.selected) for (const s of u.soldiers) if (s.alive) put(s, u.mstate === 'routing' ? 0xff8040 : 0x9fff70, s.def.vehicle ? 6 : s.def.scale * (s.def.role === 'boss' ? 1.6 : 1));
    if (this.hover && !this.selected.has(this.hover)) for (const s of this.hover.soldiers) if (s.alive) put(s, this.hover.side === this.playerSide ? 0xfff0a0 : 0xff4030, s.def.vehicle ? 6 : s.def.scale);
    if (this.markTarget && this.markTarget.t > 0) { this.markTarget.t -= 1 / 60; for (const s of this.markTarget.u.soldiers) if (s.alive) put(s, 0xff2a1a, s.def.vehicle ? 6.5 : s.def.scale * 1.15); }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  private bannerV = new THREE.Vector3();
  private updateBanners() {
    const w = innerWidth, h = innerHeight;
    for (const u of this.battle.units) {
      const al = u.soldiers.filter((s) => s.alive);
      if (!al.length || u.mstate === 'gone') { this.hud.banner(u, 0, 0, false, false); continue; }
      let x = 0, z = 0, y = -1e9;
      for (const s of al) { x += s.x; z += s.z; y = Math.max(y, s.y); }
      x /= al.length; z /= al.length;
      const top = Math.max(...al.map((s) => s.def.vehicle ? s.def.vehicle.height : this.lib.variants.get(s.def.id)!.height * s.def.scale));
      this.bannerV.set(x, y + top + 1.2 + this.rig.dist * 0.02, z).project(this.camera);
      const vis = this.bannerV.z < 1 && Math.abs(this.bannerV.x) < 1.1 && Math.abs(this.bannerV.y) < 1.1;
      this.hud.banner(u, (this.bannerV.x * 0.5 + 0.5) * w, (-this.bannerV.y * 0.5 + 0.5) * h, vis, this.selected.has(u));
    }
  }

  private updateCamera(dt: number) {
    const k = this.keys, r = this.rig;
    const sp = 0.9 * this.settings.camSpeed * dt * 60 * 0.18;
    if (k.has('KeyW') || k.has('ArrowUp')) r.pan(0, sp);
    if (k.has('KeyS') || k.has('ArrowDown')) r.pan(0, -sp);
    if (k.has('KeyA') || k.has('ArrowLeft')) r.pan(-sp, 0);
    if (k.has('KeyD') || k.has('ArrowRight')) r.pan(sp, 0);
    if (k.has('KeyQ')) r.rotate(dt * 1.6);
    if (k.has('KeyE')) r.rotate(-dt * 1.6);
    if (this.edge[0] || this.edge[1]) r.pan(this.edge[0] * sp, this.edge[1] * sp);
    if (k.has('KeyZ')) r.zoom(1 - dt * 1.5);
    if (k.has('KeyX')) r.zoom(1 + dt * 1.5);
    r.update(dt);
  }

  // ====================================================================== events -> effects / audio / messages
  private v = new THREE.Vector3();
  private handleEvents() {
    const b = this.battle;
    for (const e of b.events) {
      switch (e.type) {
        case 'shot': {
          let m: THREE.Vector3, dx: number, dz: number;
          if (e.s.def.vehicle) {
            m = this.vehicles.muzzle(e.s, e.mount, this.v);
            const L = Math.hypot(e.tx - m.x, e.tz - m.z) || 1; dx = (e.tx - m.x) / L; dz = (e.tz - m.z) / L;
            if (e.mount === 'turret' && this.rig.focusPoint.distanceTo(m) < 90) this.rig.shake = Math.max(this.rig.shake, 0.25);
          } else {
            const f = this.figOf.get(e.s)!;
            m = this.units.point(f, e.pistol ? 'muzzle2' : 'muzzle', this.v);
            dx = Math.sin(e.s.yaw); dz = Math.cos(e.s.yaw);
          }
          this.fx.muzzle(m.x, m.y, m.z, e.w.tracer, dx, dz);
          this.fx.tracer(m.x, m.y, m.z, e.tx, e.ty, e.tz, e.dur, e.w.tracer);
          this.audio.play(soundOf(e.w.sound), e.s.x, e.s.z, 0.8);
          if (e.mount === 'turret') this.cine.heat(e.s.x, e.s.z, 2); else if (e.w.splash) this.cine.heat(e.tx, e.tz, 0.6);
          break;
        }
        case 'impact': {
          const t = e.target;
          const armour = !!t && t.def.armor > 0.6;
          this.fx.impact(e.x, e.y, e.z, e.w.tracer, e.hit && armour, e.hit && !armour);
          break;
        }
        case 'death':
          if (e.s.def.vehicle) {
            // tank destroyed: fireball, turret thrown off, the wreck keeps burning
            this.vehicles.destroy(e.s);
            this.fx.explosion(e.s.x, e.s.y + 1.5, e.s.z, 5, 0xff7a20);
            this.fx.addFire(e.s.x, e.s.y + 1.8, e.s.z, 1.4); this.fireSpots.push({ x: e.s.x, y: e.s.y + 1.8, z: e.s.z, s: 1.4 });
            this.audio.play('explosion', e.s.x, e.s.z, 1.3);
            this.rig.shake = Math.max(this.rig.shake, 0.8);
            this.hud.toast(`${e.s.unit.name} 격파!`, 2.5);
          } else { this.fx.dust(e.s.x, e.s.y, e.s.z, e.s.def.scale); if (Math.random() < 0.3) this.audio.play('death', e.s.x, e.s.z, 0.5); }
          break;
        case 'melee': {
          this.cine.heat(e.s.x, e.s.z, 0.25);
          if (e.hit && Math.random() < 0.5) {
            const x = (e.s.x + e.foe.x) / 2, z = (e.s.z + e.foe.z) / 2, y = e.foe.y + 1.1;
            const armour = e.foe.def.armor > 0.6;
            for (let i = 0; i < (armour ? 5 : 2); i++) this.fx.spawn(x, y, z, { size: armour ? 0.1 : 0.25, life: 0.3, color: armour ? 0xffd080 : 0x4a1612, frame: armour ? 3 : 1, add: armour, alpha: 0.8, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 5, grav: 10 });
          }
          const chain = ['marine_sergeant', 'guard_sergeant', 'krieg_watchmaster'].includes(e.s.def.id);
          this.audio.play(chain ? 'chainsword' : 'melee', e.s.x, e.s.z, 0.6);
          break;
        }
        case 'charge': {
          this.cine.heat(e.target.x, e.target.z, 4);
          if (e.u.faction === 'orks') this.audio.play('waaagh', e.u.x, e.u.z, 0.9);
          else if (e.u.faction === 'krieg') this.audio.play('whistle', e.u.x, e.u.z, 0.8);
          if (e.target.side === this.playerSide) this.hud.toast(`${e.u.name}이(가) ${e.target.name}에 돌격한다!`, 2);
          else if (e.u.side === this.playerSide) this.hud.toast(`${e.u.name} 돌격!`, 1.6);
          break;
        }
        case 'rout': this.hud.toast(`${e.u.name} 패주!`, 2.5); this.audio.play('horn', e.u.x, e.u.z, 0.5); break;
        case 'rally': if (e.u.side === this.playerSide) this.hud.toast(`${e.u.name} 재집결`, 2); break;
        case 'ability': this.abilityFx(e.u); break;
        case 'explosion': this.cine.heat(e.x, e.z, 2 + e.r * 0.2); this.fx.explosion(e.x, e.y, e.z, e.r * 0.8, e.color ?? 0x70c8ff); this.audio.play('explosion', e.x, e.z, e.color ? 1 : 0.7); if (e.color && e.r >= 5) this.rig.shake = Math.max(this.rig.shake, 0.5); break;
        case 'reinforce': this.addUnitView(e.u); break;
        case 'order': break;
      }
    }
    b.events.length = 0;
  }

  private abilityFx(u: Unit) {
    const id = u.tpl.ability;
    if (!id) return;
    this.hud.toast(`${u.name}: ${ABILITIES[id].ko}`, 2.2);
    if (id === 'waaagh') { this.audio.play('waaagh', u.x, u.z, 1.2); this.rig.shake = 0.6; }
    else if (id === 'bayonet') this.audio.play('whistle', u.x, u.z, 1);
    else this.audio.play('horn', u.x, u.z, 0.6);
  }

  // ====================================================================== selection & orders
  select(u: Unit, add: boolean) {
    if (u.side !== this.playerSide) return;
    if (add) { if (this.selected.has(u)) this.selected.delete(u); else this.selected.add(u); }
    else { this.selected.clear(); this.selected.add(u); }
    this.audio.play('click');
    this.hud.update(0, this.selected, this.speed, this.paused);
  }
  selectAll() { this.selected.clear(); for (const u of this.battle.units) if (u.side === this.playerSide && this.battle.active(u) && u.mstate !== 'gone') this.selected.add(u); this.audio.play('click'); }
  private forSel(fn: (u: Unit) => void) { for (const u of this.selected) if (this.battle.active(u)) fn(u); this.audio.play('click'); this.hud.update(0, this.selected, this.speed, this.paused); }

  private clickUnit(u: Unit, add: boolean) {
    if (u.side === this.playerSide) this.select(u, add);
    else if (this.selected.size) this.attack(u, false);
  }

  attack(target: Unit, run: boolean) {
    if (this.deploying) { this.hud.toast('배치 단계에서는 이동·배치만 할 수 있습니다 — 준비되면 전투 시작', 2); return; }
    for (const u of this.selected) this.battle.order(u, { type: 'attack', target, run: run || u.meleeOnly || u.meleeMode, charge: u.meleeOnly || u.meleeMode });
    this.audio.play('click');
    this.markTarget = { u: target, t: 1.2 };
  }
  private markTarget: { u: Unit; t: number } | null = null;

  private chargeNearest() {
    if (this.deploying) return;
    for (const u of this.selected) {
      const n = this.battle.nearestEnemyUnit(u);
      if (n) this.battle.order(u, { type: 'attack', target: u.target ?? n[1], run: true, charge: true });
    }
    this.audio.play('click');
  }

  /** Move selected units to a point (or spread along a line from a to b), facing `yaw`. */
  moveTo(ax: number, az: number, bx: number | null, bz: number | null, run: boolean, previewOnly = false) {
    const units = [...this.selected].filter((u) => this.battle.active(u) && u.mstate !== 'routing');
    if (!units.length) { this.preview.count = 0; return; }
    const cx = units.reduce((s, u) => s + u.x, 0) / units.length, cz = units.reduce((s, u) => s + u.z, 0) / units.length;
    let yaw: number, len: number, mx: number, mz: number;
    if (bx !== null && bz !== null && Math.hypot(bx - ax, bz - az) > 3) {
      // drag line defines the front; face perpendicular, toward the enemy side
      const lx = bx - ax, lz = bz - az;
      yaw = Math.atan2(-lz, lx);
      const enemyZ = this.battle.units.filter((u) => u.side !== this.playerSide).reduce((s, u) => s + u.z, 0);
      const fz = Math.cos(yaw);
      if (Math.sign(fz) !== Math.sign(enemyZ - (az + bz) / 2) && Math.abs(fz) > 0.2) yaw += Math.PI;
      len = Math.hypot(lx, lz); mx = (ax + bx) / 2; mz = (az + bz) / 2;
    } else {
      yaw = Math.hypot(ax - cx, az - cz) > 4 ? Math.atan2(ax - cx, az - cz) : units[0].yaw;
      len = 0; mx = ax; mz = az;
    }
    // group formation lock: the selection keeps its relative layout; a drag turns the whole group to the new facing
    if (this.groupLock && units.length > 1) {
      const yaw0 = Math.atan2(units.reduce((s, u) => s + Math.sin(u.yaw), 0), units.reduce((s, u) => s + Math.cos(u.yaw), 0));
      const dYaw = len > 0 ? yaw - yaw0 : 0, c = Math.cos(dYaw), sn = Math.sin(dYaw);
      const m4 = new THREE.Matrix4();
      let n = 0;
      for (const u of units) {
        const ox = u.x - cx, oz = u.z - cz;
        let px = mx + ox * c + oz * sn, pz = mz + oz * c - ox * sn;
        const uy = u.yaw + dYaw;
        if (this.deploying) [px, pz] = this.clampToZone(px, pz);
        if (previewOnly) {
          const save = { x: u.x, z: u.z, yaw: u.yaw };
          u.x = px; u.z = pz; u.yaw = uy;
          for (const so of u.soldiers) if (so.alive && n < 1200) { const [wx, wz] = this.battle.slotWorld(u, so); m4.makeTranslation(wx, this.map.heightAt(wx, wz) + 0.07, wz); this.preview.setMatrixAt(n++, m4); }
          u.x = save.x; u.z = save.z; u.yaw = save.yaw;
        } else if (this.deploying) this.battle.place(u, px, pz, uy);
        else this.battle.order(u, { type: 'move', x: px, z: pz, yaw: uy, run });
      }
      if (previewOnly) { this.preview.count = n; this.preview.instanceMatrix.needsUpdate = true; } else { this.preview.count = 0; this.audio.play('click'); }
      return;
    }
    const GAP = 4;
    const widths = units.map((u) => (u.files > 0 && u.formation !== 'column' ? u.files : this.battle.autoFiles(u)) * this.battle.fileSpacing(u) + GAP);
    const sumW = widths.reduce((a, b) => a + b, 0);
    // a drag shorter than the units' minimum frontage is stretched to fit; a longer one widens their ranks
    const total = Math.max(len, units.reduce((a, u) => a + Math.min(4, this.battle.autoFiles(u)) * this.battle.fileSpacing(u) + GAP, 0));
    // order units left -> right by their current position along the new front
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const order = units.map((u, i) => ({ u, i, k: (u.x - mx) * rx + (u.z - mz) * rz })).sort((a, b) => a.k - b.k);
    let off = -total / 2;
    const m = new THREE.Matrix4();
    let pn = 0;
    const alongTotal = len > 0 ? total : sumW;
    for (const { u, i } of order) {
      const w = len > 0 ? widths[i] * (total / sumW) : widths[i];
      let px = mx + rx * (off + w / 2), pz = mz + rz * (off + w / 2);
      off += w;
      const n = Math.max(1, u.soldiers.filter((s) => s.alive && s !== u.leader).length);
      const files = len > 0 && u.formation !== 'column' ? THREE.MathUtils.clamp(Math.round((w - GAP) / this.battle.fileSpacing(u)), Math.min(2, n), n) : undefined;
      if (this.deploying) [px, pz] = this.clampToZone(px, pz);
      if (previewOnly) {
        const save = { x: u.x, z: u.z, yaw: u.yaw, files: u.files };
        u.x = px; u.z = pz; u.yaw = yaw; if (files !== undefined) u.files = files;
        this.battle.layout(u, false);
        for (const s of u.soldiers) if (s.alive && pn < 1200) {
          const [wx, wz] = this.battle.slotWorld(u, s);
          m.makeTranslation(wx, this.map.heightAt(wx, wz) + 0.07, wz); this.preview.setMatrixAt(pn++, m);
        }
        u.x = save.x; u.z = save.z; u.yaw = save.yaw; u.files = save.files;
        this.battle.layout(u, false);
      } else if (this.deploying) this.battle.place(u, px, pz, yaw, files);
      else this.battle.order(u, { type: 'move', x: px, z: pz, yaw, run, files });
    }
    void alongTotal;
    if (previewOnly) { this.preview.count = pn; this.preview.instanceMatrix.needsUpdate = true; }
    else { this.preview.count = 0; this.audio.play('click'); }
  }

  // ====================================================================== input
  private ray = new THREE.Raycaster();
  groundAt(cx: number, cy: number): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let t = 0, prev = 0;
    for (let i = 0; i < 400; i++) {
      t += 1 + t * 0.01;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < this.map.heightAt(x, z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; const yy = o.y + d.y * m; if (yy < this.map.heightAt(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prev = t;
      if (t > 2500) break;
    }
    return null;
  }

  pickUnit(cx: number, cy: number, radius = 26): Unit | null {
    let best: Unit | null = null, bd = radius * radius;
    const v = new THREE.Vector3();
    for (const s of this.battle.soldiers) {
      if (!s.alive) continue;
      v.set(s.x, s.y + (s.def.vehicle ? 1.6 : 1.0 * s.def.scale), s.z).project(this.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = ((sx - cx) ** 2 + (sy - cy) ** 2) * (s.def.vehicle ? 0.2 : 1);   // a tank covers far more screen than a man
      if (d < bd) { bd = d; best = s.unit; }
    }
    return best && best.mstate !== 'gone' ? best : null;
  }

  private bindInput() {
    const cv = this.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, k: K | string, fn: (e: never) => void, o?: AddEventListenerOptions) => { t.addEventListener(k, fn as EventListener, o); this.disposers.push(() => t.removeEventListener(k, fn as EventListener)); };
    const touch = matchMedia('(pointer:coarse)').matches;
    on(cv, 'pointerdown', () => { if (this.cine?.active) this.toggleCinematic(); }, { capture: true });
    // ---------- mouse
    let lDown: { x: number; y: number } | null = null, rDown: { x: number; y: number; g: THREE.Vector3 | null } | null = null, mDown: { x: number; y: number } | null = null;
    let lastRight = 0;
    // browsers fire emulated mouse events after a tap; they must not act as desktop clicks
    const fromTouch = (e: MouseEvent) => performance.now() - this.lastTouch < 900 || (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents === true;
    on(cv, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    on(cv, 'mousedown', (e: MouseEvent) => {
      this.audio.unlock();
      if (fromTouch(e)) return;
      if (e.button === 0) lDown = { x: e.clientX, y: e.clientY };
      if (e.button === 2) rDown = { x: e.clientX, y: e.clientY, g: this.groundAt(e.clientX, e.clientY) };
      if (e.button === 1) { mDown = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
    });
    on(window, 'mousemove', (e: MouseEvent) => {
      if (mDown) { this.rig.rotate(-(e.clientX - mDown.x) * 0.006); this.rig.tilt = THREE.MathUtils.clamp(this.rig.tilt + (e.clientY - mDown.y) * 0.004, -0.4, 0.6); mDown = { x: e.clientX, y: e.clientY }; }
      if (lDown && Math.hypot(e.clientX - lDown.x, e.clientY - lDown.y) > 6) {
        const b = this.hud.selBox; b.style.display = '';
        b.style.left = `${Math.min(lDown.x, e.clientX)}px`; b.style.top = `${Math.min(lDown.y, e.clientY)}px`;
        b.style.width = `${Math.abs(e.clientX - lDown.x)}px`; b.style.height = `${Math.abs(e.clientY - lDown.y)}px`;
      }
      if (rDown && rDown.g && Math.hypot(e.clientX - rDown.x, e.clientY - rDown.y) > 10) {
        const g2 = this.groundAt(e.clientX, e.clientY);
        if (g2) this.moveTo(rDown.g.x, rDown.g.z, g2.x, g2.z, false, true);
      }
      if (!lDown && !rDown && !mDown && !touch) this.hover = this.pickUnit(e.clientX, e.clientY);
      this.edge = this.settings.edgePan ? [e.clientX < 8 ? -1 : e.clientX > innerWidth - 8 ? 1 : 0, e.clientY < 8 ? 1 : e.clientY > innerHeight - 8 ? -1 : 0] : [0, 0];
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (fromTouch(e)) { lDown = null; rDown = null; return; }
      if (e.button === 0 && lDown) {
        const box = this.hud.selBox.style.display !== 'none';
        if (box) this.boxSelect(lDown.x, lDown.y, e.clientX, e.clientY, e.shiftKey || e.ctrlKey);
        else if (e.target === cv && this.targeting) {
          const g = this.groundAt(e.clientX, e.clientY);
          if (g) this.callSupport(g.x, g.z);
        } else if (e.target === cv) {
          const u = this.pickUnit(e.clientX, e.clientY);
          if (u && u.side === this.playerSide) this.select(u, e.shiftKey || e.ctrlKey);
          else if (!u && !e.shiftKey) this.selected.clear();
        }
        this.hud.selBox.style.display = 'none';
        lDown = null;
      }
      if (e.button === 2 && this.targeting) { this.armSupport(null); rDown = null; return; }
      if (e.button === 2 && rDown) {
        const now = performance.now();
        const dbl = now - lastRight < 350;
        lastRight = now;
        const g2 = this.groundAt(e.clientX, e.clientY);
        const dragged = Math.hypot(e.clientX - rDown.x, e.clientY - rDown.y) > 10;
        const target = !dragged ? this.pickUnit(e.clientX, e.clientY) : null;
        if (target && target.side !== this.playerSide) this.attack(target, dbl);
        else if (rDown.g && this.selected.size) this.moveTo(rDown.g.x, rDown.g.z, dragged && g2 ? g2.x : null, dragged && g2 ? g2.z : null, dbl || [...this.selected].every((u) => u.run));
        this.preview.count = 0;
        rDown = null;
      }
      if (e.button === 1) mDown = null;
    });
    on(cv, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.rig.zoom(Math.exp(Math.sign(e.deltaY) * 0.12)); }, { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.audio.unlock();
      this.keys.add(e.code);
      const k = e.code;
      if (k === 'Space') { e.preventDefault(); this.togglePause(); }
      else if (k === 'Escape') { if (this.cine.active) this.toggleCinematic(); else if (this.targeting) this.armSupport(null); else this.openMenu(); }
      else if (k === 'KeyK') this.toggleCinematic();
      else if (k === 'KeyH') this.forSel((u) => this.battle.order(u, { type: 'halt' }));
      else if (k === 'KeyR') { const on2 = ![...this.selected].every((u) => u.run); this.forSel((u) => { u.run = on2; }); }
      else if (k === 'KeyC') this.chargeNearest();
      else if (k === 'KeyF') { const on2 = ![...this.selected].every((u) => u.fireAtWill); this.forSel((u) => { u.fireAtWill = on2; }); }
      else if (k === 'KeyG') this.forSel((u) => { if (this.battle.useAbility(u)) this.abilityFx(u); });
      else if (k === 'KeyM') this.toggleMode('meleeMode', '근접전 모드');
      else if (k === 'KeyV') this.toggleMode('guard', '경계 모드');
      else if (k === 'KeyX') this.toggleMode('skirmish', '견제 모드');
      else if (k === 'KeyL') { this.groupLock = !this.groupLock; this.hud.groupLocked = this.groupLock; this.hud.toast(this.groupLock ? '그룹 진형 고정' : '그룹 진형 고정 해제', 1.4); }
      else if (k === 'KeyA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.selectAll(); }
      else if ((k === 'Enter' || k === 'NumpadEnter') && this.deploying) this.startBattle();
      else if (/^Digit[1-9]$/.test(k) && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.assignGroup(Number(k[5])); }
      else if (/^Digit[1-4]$/.test(k) && e.altKey) { e.preventDefault(); this.forSel((u) => this.battle.setFormation(u, (['line', 'column', 'loose', 'defensive'] as FormationId[])[Number(k[5]) - 1])); }
      else if (/^Digit[1-9]$/.test(k) && this.groups.get(Number(k[5]))?.length) this.selectGroup(Number(k[5]));
      else if (/^Digit[1-4]$/.test(k)) this.forSel((u) => this.battle.setFormation(u, (['line', 'column', 'loose', 'defensive'] as FormationId[])[Number(k[5]) - 1]));
      else if (k === 'Equal' || k === 'NumpadAdd') this.speed = Math.min(4, this.speed + 1);
      else if (k === 'Minus' || k === 'NumpadSubtract') this.speed = Math.max(1, this.speed - 1);
      else if (k === 'Tab') { e.preventDefault(); this.cycleSelection(); }
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    // ---------- touch
    const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
    let gesture: 'none' | 'pan' | 'pinch' = 'none';
    let pinch0 = { d: 0, a: 0, cx: 0, cy: 0 };
    let longT: ReturnType<typeof setTimeout> | null = null;
    on(cv, 'pointerdown', (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      this.audio.unlock();
      this.lastTouch = performance.now();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (pts.size === 1) {
        gesture = 'none';
        longT = setTimeout(() => {
          const p = pts.get(e.pointerId);
          if (!p || gesture !== 'none' || !this.selected.size) return;
          const g = this.groundAt(p.x, p.y);
          if (g) { this.moveTo(g.x, g.z, null, null, true); this.hud.toast('달리기 이동', 1); gesture = 'pan'; }
        }, 550);
      } else if (pts.size === 2) {
        if (longT) clearTimeout(longT);
        const [a, b] = [...pts.values()];
        pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        gesture = 'pinch';
      }
    });
    on(cv, 'pointermove', (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId)!;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 1) {
        if (gesture === 'none' && Math.hypot(p.x - p.sx, p.y - p.sy) > 12) { gesture = 'pan'; if (longT) clearTimeout(longT); }
        if (gesture === 'pan') { const k = 0.09 * this.settings.camSpeed; this.rig.pan(-dx * k * 0.35, dy * k * 0.35); }
      } else if (pts.size === 2 && gesture === 'pinch') {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (pinch0.d > 0) this.rig.zoom(pinch0.d / d);
        let da = ang - pinch0.a; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
        this.rig.rotate(da);
        this.rig.tilt = THREE.MathUtils.clamp(this.rig.tilt + (cy - pinch0.cy) * 0.004, -0.4, 0.6);
        this.rig.pan(-(cx - pinch0.cx) * 0.03, (cy - pinch0.cy) * 0.0);
        pinch0 = { d, a: ang, cx, cy };
      }
    });
    const endTouch = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
      this.lastTouch = performance.now();
      const p = pts.get(e.pointerId)!;
      pts.delete(e.pointerId);
      if (longT) clearTimeout(longT);
      if (gesture === 'none' && pts.size === 0 && performance.now() - p.t < 500 && e.type === 'pointerup') this.tap(p.x, p.y);
      if (pts.size === 0) gesture = 'none';
    };
    on(cv, 'pointerup', endTouch); on(cv, 'pointercancel', endTouch);
    on(window, 'resize', () => this.resize());
  }
  private edge: [number, number] = [0, 0];
  private lastTouch = -1e9;

  private tap(x: number, y: number) {
    if (this.targeting) { const g = this.groundAt(x, y); if (g) this.callSupport(g.x, g.z); return; }
    const u = this.pickUnit(x, y, 34);
    if (u) { this.clickUnit(u, this.hud.multi); return; }
    if (!this.selected.size) return;
    const g = this.groundAt(x, y);
    if (g) this.moveTo(g.x, g.z, null, null, [...this.selected].every((uu) => uu.run));
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const a = Math.min(x0, x1), b = Math.max(x0, x1), c = Math.min(y0, y1), d = Math.max(y0, y1);
    if (!add) this.selected.clear();
    const v = new THREE.Vector3();
    for (const u of this.battle.units) {
      if (u.side !== this.playerSide || !this.battle.active(u)) continue;
      const inside = u.soldiers.some((s) => {
        if (!s.alive) return false;
        v.set(s.x, s.y + 1, s.z).project(this.camera);
        const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
        return v.z < 1 && sx >= a && sx <= b && sy >= c && sy <= d;
      });
      if (inside) this.selected.add(u);
    }
    this.audio.play('click');
  }

  private cycleSelection() {
    const mine = this.battle.units.filter((u) => u.side === this.playerSide && this.battle.active(u) && u.mstate !== 'gone');
    if (!mine.length) return;
    const cur = [...this.selected][0];
    const next = mine[(mine.indexOf(cur as Unit) + 1) % mine.length];
    this.select(next, false);
    this.rig.focus(next.x, next.z);
  }

  /** Toggle a unit mode on the selection (all on if any is off). Melee mode needs a unit that can also fight hand to hand. */
  groupLock = false;
  private toggleMode(key: 'meleeMode' | 'guard' | 'skirmish', label: string) {
    const sel = [...this.selected].filter((u) => this.battle.active(u) && (key !== 'skirmish' || !u.meleeOnly) && (key !== 'meleeMode' || (!u.meleeOnly && !u.vehicle)));
    if (!sel.length) return;
    const on = !sel.every((u) => u[key]);
    for (const u of sel) {
      u[key] = on;
      if (key === 'meleeMode' && on) { u.skirmish = false; if (u.order.type !== 'attack') u.target = null; }
      if (key === 'skirmish' && on) u.meleeMode = false;
    }
    this.hud.toast(`${label} ${on ? '켬' : '끔'}`, 1.2);
    this.audio.play('click');
    this.hud.update(0, this.selected, this.speed, this.paused);
  }

  // ====================================================================== off-map support: air strikes and drop pods
  support = { air: 0, pods: 0 };
  private targeting: 'air' | 'pod' | null = null;
  private makePiece: (name: string) => THREE.Group = () => new THREE.Group();
  private strikes: Strike[] = [];

  private armSupport(k: 'air' | 'pod' | null) {
    if (k && this.deploying) { this.hud.toast('지원 전력은 전투가 시작된 뒤 호출할 수 있습니다', 1.8); return; }
    if (k && this.support[k === 'air' ? 'air' : 'pods'] <= 0) return;
    this.targeting = this.targeting === k ? null : k;
    document.body.style.cursor = this.targeting ? 'crosshair' : '';
    this.hud.setSupport(this.support, this.targeting);
    if (this.targeting) this.hud.toast(this.targeting === 'air' ? '공중 지원: 폭격할 지점을 누르세요 (우클릭·Esc 취소)' : '드롭 포드: 강하 지점을 누르세요 (우클릭·Esc 취소)', 2.5);
  }

  private callSupport(x: number, z: number) {
    const k = this.targeting;
    this.targeting = null; document.body.style.cursor = '';
    if (!k) return;
    if (k === 'air') {
      this.support.air--;
      // fly in from behind the player's lines toward the enemy
      const enemyZ = this.battle.units.filter((u) => u.side !== this.playerSide).reduce((s, u) => s + u.z, 0);
      const dz = enemyZ < z * this.battle.units.filter((u) => u.side !== this.playerSide).length ? -1 : 1;
      const mesh = this.makePiece('thunderbolt');
      this.scene.add(mesh);
      this.strikes.push({ kind: 'air', t: 0, x, z, dx: 0, dz, mesh, shots: 0, bombs: 0, done: false });
      this.audio.play('jet', x, z, 1);
      this.hud.toast('썬더볼트 공습 개시!', 2);
    } else {
      this.support.pods--;
      const mesh = this.makePiece('drop_pod');
      mesh.position.set(x, this.map.heightAt(x, z) + 260, z);
      this.scene.add(mesh);
      this.strikes.push({ kind: 'pod', t: 0, x, z, dx: 0, dz: 0, mesh, shots: 0, bombs: 0, done: false });
      this.audio.play('pod', x, z, 1);
      this.hud.toast('드롭 포드 강하!', 2);
    }
    this.hud.setSupport(this.support, null);
  }

  private updateStrikes(dt: number) {
    for (const s of this.strikes) {
      s.t += dt;
      if (s.kind === 'air') this.stepAir(s); else this.stepPod(s);
    }
    for (const s of this.strikes) if (s.done && s.mesh.parent && s.kind === 'air') this.scene.remove(s.mesh);
    this.strikes = this.strikes.filter((s) => !s.done || s.kind === 'pod');
  }

  private stepAir(s: Strike) {
    const V = 95, L = 170, alt = 34;
    const along = -L + V * s.t;                       // metres along the run, 0 = over the target
    const gx = s.x + s.dx * along, gz = s.z + s.dz * along;
    const gy = Math.max(this.map.heightAt(s.x, s.z), this.map.heightAt(gx, gz)) + alt - 10 * Math.max(0, 1 - Math.abs(along) / 90);
    s.mesh.position.set(gx, gy, gz);
    s.mesh.rotation.set(0.12 * Math.max(0, 1 - Math.abs(along) / 60), Math.atan2(s.dx, s.dz), 0.1 * Math.sin(s.t * 3));
    // strafing run: cannon shells walk along the line from 30 m short of the target to 15 m past it
    if (along > -95 && along < -20) {
      const want = Math.floor((along + 95) / 3.2);
      while (s.shots < want) {
        s.shots++;
        const k = -30 + s.shots * 0.8;
        const ix = s.x + s.dx * k + (Math.random() - 0.5) * 3, iz = s.z + s.dz * k + (Math.random() - 0.5) * 3;
        const iy = this.map.heightAt(ix, iz);
        this.fx.tracer(gx, gy - 0.6, gz, ix, iy, iz, 0.12, 'hbolt');
        if (s.shots % 2 === 0) this.audio.play('hbolter', gx, gz, 0.8);
        this.battle.blast(ix, iz, 2.6, 26, 0.35, this.playerSide, 0);
      }
    }
    // bombs released over the target, landing in a short stick
    if (along > -14 && s.bombs < 3) {
      const k = -9 + s.bombs * 9;
      s.bombs++;
      const bx = s.x + s.dx * k, bz = s.z + s.dz * k;
      (s.pending ??= []).push({ t: s.t + 0.35 + s.bombs * 0.12, x: bx, z: bz });   // fall time, on the game clock
    }
    for (const b of s.pending ?? []) if (b.t <= s.t && b.t > -1) { this.battle.blast(b.x, b.z, 7.5, 75, 0.45, this.playerSide, 0.6); b.t = -2; }
    if (along > L && (s.pending ?? []).every((b) => b.t < -1)) s.done = true;
  }

  private stepPod(s: Strike) {
    const T = 2.3;
    const g = this.map.heightAt(s.x, s.z);
    if (s.t < T) {
      const k = s.t / T;
      s.mesh.position.set(s.x, g + 260 * (1 - k * k), s.z);
      s.mesh.rotation.y = s.t * 0.6;
      // re-entry trail
      const p = s.mesh.position;
      this.fx.spawn(p.x, p.y - 0.5, p.z, { size: 2.6, grow: -2, life: 0.25, color: 0xff9a40, frame: 2, add: true, vy: 4 });
      this.fx.spawn(p.x + (Math.random() - 0.5), p.y + 2, p.z + (Math.random() - 0.5), { size: 2.2, grow: 4, life: 2.6, color: 0x3a3430, alpha: 0.6, frame: 1, vy: 2 });
      return;
    }
    if (s.shots === 0) {
      // impact: blast wave knocks enemies down, the hatches drop and the squad deploys
      s.shots = 1;
      this.scene.remove(s.mesh);
      const open = this.makePiece('drop_pod_open');
      open.position.set(s.x, g, s.z); open.rotation.y = s.mesh.rotation.y;
      this.scene.add(open); s.mesh = open;
      this.battle.blast(s.x, s.z, 8, 55, 0.35, this.playerSide, 0.75);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        this.fx.spawn(s.x + Math.cos(a) * 2, g + 0.4, s.z + Math.sin(a) * 2, { size: 2.4, grow: 5, life: 1.8, color: 0x7a6a58, alpha: 0.55, frame: 1, vx: Math.cos(a) * 9, vz: Math.sin(a) * 9, vy: 0.8, drag: 2 });
      }
      this.rig.shake = 1;
    }
    if (s.t > T + 0.7 && s.bombs === 0) {
      s.bombs = 1;
      const enemy = this.battle.units.filter((u) => u.side !== this.playerSide && this.battle.active(u));
      const ex = enemy.length ? enemy.reduce((a, u) => a + u.x, 0) / enemy.length : s.x, ez = enemy.length ? enemy.reduce((a, u) => a + u.z, 0) / enemy.length : s.z - 10;
      const yaw = Math.atan2(ex - s.x, ez - s.z);
      const u = this.battle.deepStrike('tactical', this.playerSide, s.x + Math.sin(yaw) * 6, s.z + Math.cos(yaw) * 6, yaw);
      this.addUnitView(u);
      this.hud.toast(`${u.name} 전장에 강하!`, 2.5);
      this.audio.play('horn', s.x, s.z, 0.7);
      s.done = true;
    }
  }

  /** Figures, card and banner for a unit that joined mid-battle. */
  private addUnitView(u: Unit) {
    for (const s of u.soldiers) {
      if (s.def.vehicle) { this.vehicles.add(s); continue; }
      if (this.figOf.has(s)) continue;
      const f: Figure = { variant: s.def.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, scale: s.def.scale, tint: s.tint, anim: s.anim, visible: true };
      this.figures.push(f); this.figOf.set(s, f);
    }
    this.hud.addUnit(u);
  }

  // ====================================================================== deployment and control groups
  beginDeployment() {
    const mine = this.battle.units.filter((u) => u.side === this.playerSide);
    const zs = mine.flatMap((u) => u.soldiers.map((s) => s.z));
    const zMin = Math.min(...zs), zMax = Math.max(...zs);
    const toward = zMin + zMax > 0 ? 1 : -1; // + when the player starts on the +z half
    const lim = PLAY - 6;
    let z0 = Math.max(-lim, zMin - 28), z1 = Math.min(lim, zMax + 28);
    if (toward > 0) z0 = Math.max(z0, 12); else z1 = Math.min(z1, -12);
    this.deployZone = { x0: -lim, x1: lim, z0, z1 };
    this.deploying = true;
    this.zoneMesh = this.makeZoneMesh();
    this.scene.add(this.zoneMesh);
    this.hud.hint('');
    this.hud.showDeploy(() => this.startBattle());
  }

  clampToZone(x: number, z: number): [number, number] {
    const d = this.deployZone;
    return [THREE.MathUtils.clamp(x, d.x0 + 4, d.x1 - 4), THREE.MathUtils.clamp(z, d.z0 + 4, d.z1 - 4)];
  }

  startBattle() {
    if (!this.deploying) return;
    this.deploying = false;
    if (this.zoneMesh) { this.scene.remove(this.zoneMesh); this.zoneMesh.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); }); this.zoneMesh = null; }
    this.hud.hideDeploy();
    this.hud.toast('전투 개시!', 1.8);
    this.audio.play('horn', this.rig.focusPoint.x, this.rig.focusPoint.z, 0.8);
  }

  /** Translucent terrain-hugging rectangle with a bright border showing where the player may deploy. */
  private makeZoneMesh() {
    const d = this.deployZone, g = new THREE.Group();
    const nx = 48, nz = Math.max(6, Math.round((d.z1 - d.z0) / 8));
    const geo = new THREE.PlaneGeometry(d.x1 - d.x0, d.z1 - d.z0, nx, nz); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (d.x0 + d.x1) / 2, z = p.getZ(i) + (d.z0 + d.z1) / 2; p.setXYZ(i, x, this.map.heightAt(x, z) + 0.25, z); }
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x4f7fd0, transparent: true, opacity: 0.045, depthWrite: false, fog: false })));
    const pts: THREE.Vector3[] = [];
    const edge = (ax: number, az: number, bx: number, bz: number) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4); for (let i = 0; i < n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; pts.push(new THREE.Vector3(x, this.map.heightAt(x, z) + 0.4, z)); } };
    edge(d.x0, d.z0, d.x1, d.z0); edge(d.x1, d.z0, d.x1, d.z1); edge(d.x1, d.z1, d.x0, d.z1); edge(d.x0, d.z1, d.x0, d.z0);
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.85, fog: false })));
    g.renderOrder = 2; g.name = 'deployZone';
    return g;
  }

  private assignGroup(n: number) {
    const list = [...this.selected].filter((u) => u.side === this.playerSide);
    if (!list.length) { this.groups.delete(n); return; }
    this.groups.set(n, list);
    this.hud.toast(`부대 그룹 ${n} 지정 (${list.length}개 부대)`, 1.4);
  }

  private selectGroup(n: number) {
    const list = (this.groups.get(n) ?? []).filter((u) => this.battle.active(u));
    if (!list.length) return;
    this.selected.clear();
    for (const u of list) this.selected.add(u);
    const now = performance.now();
    if (this.groupTap.n === n && now - this.groupTap.t < 400) {
      const cx = list.reduce((s, u) => s + u.x, 0) / list.length, cz = list.reduce((s, u) => s + u.z, 0) / list.length;
      this.rig.focus(cx, cz, Math.min(this.rig.dist, 80));
    }
    this.groupTap = { n, t: now };
    this.audio.play('click');
    this.hud.update(0, this.selected, this.speed, this.paused);
  }

  /** Cinematic mode on/off (K): with a unit selected the camera follows it, otherwise it directs itself. */
  toggleCinematic() {
    const on = this.cine.toggle([...this.selected][0] ?? null);
    if (!on) this.hud.toast('시네마틱 모드 끔', 1.2);
  }

  togglePause() { this.paused = !this.paused; this.hud.toast(this.paused ? '일시정지 — 일시정지 중에도 명령 가능' : '전투 재개', 1.2); }
  cycleSpeed() { this.speed = this.speed >= 3 ? 1 : this.speed + 1; }
  openMenu() { this.paused = true; (this as { onMenu?: () => void }).onMenu?.(); }
  onMenu?: () => void;

  resize() {
    const P = this.preset;
    const dpr = Math.min(devicePixelRatio, P.maxDpr) * P.pixelRatio;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(dpr); this.composer.setSize(innerWidth, innerHeight); }
  }

  /** Render-target pixels (linear) -> filmic curve, sRGB, rows flipped -> PNG data URL. */
  private encodePortrait(px: Uint8Array, S: number, g: CanvasRenderingContext2D, cv: HTMLCanvasElement) {
    const img = g.createImageData(S, S);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 1.25; const t = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); lut[i] = 255 * Math.pow(Math.min(1, Math.max(0, t)), 1 / 2.2); }
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4, dst = y * S * 4;
      for (let x = 0; x < S * 4; x += 4) { img.data[dst + x] = lut[px[src + x]]; img.data[dst + x + 1] = lut[px[src + x + 1]]; img.data[dst + x + 2] = lut[px[src + x + 2]]; img.data[dst + x + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  /** Render a close-up portrait of each unit type's main soldier model for the unit cards. */
  private renderPortraits(): Map<string, string> {
    const out = new Map<string, string>();
    const S = 96;
    const rt = new THREE.WebGLRenderTarget(S, S, { samples: 4 });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x231e1a);
    scene.add(new THREE.HemisphereLight(0xd8d0c0, 0x40342a, 1.6));
    const key = new THREE.DirectionalLight(0xffe0b8, 3.2); key.position.set(-2, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ab0ff, 2.0); rim.position.set(3, 2, -3); scene.add(rim);
    scene.environment = this.scene.environment;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    const px = new Uint8Array(S * S * 4);
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d')!;
    const prevTone = this.renderer.toneMapping;
    const done = new Set<string>();
    for (const u of this.battle.units) {
      if (u.side !== this.playerSide || done.has(u.tpl.id)) continue;
      done.add(u.tpl.id);
      const trooper = u.soldiers.find((s) => s.def.role === 'trooper' || s.def.role === 'heavy') ?? u.soldiers[0];
      const lead = u.leader ?? trooper;
      const pick = u.tpl.id === 'command' || u.tpl.id === 'nobz' ? lead : trooper;
      const id = pick.def.id;
      if (pick.def.vehicle) {
        const a = this.vehicles.assemble(pick.def.vehicle.model, pick.def.faction);
        a.root.rotation.y = 0.75 + Math.PI;
        scene.add(a.root);
        cam.position.set(7.5, 5.2, 9.5); cam.lookAt(0, 1.4, 0); cam.updateMatrixWorld();
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.setRenderTarget(rt); this.renderer.render(scene, cam); this.renderer.readRenderTargetPixels(rt, 0, 0, S, S, px); this.renderer.setRenderTarget(null);
        scene.remove(a.root);
        out.set(u.tpl.id, this.encodePortrait(px, S, g, cv));
        continue;
      }
      const asset = this.lib.variants.get(id);
      if (!asset) continue;
      const ur = new UnitRenderer(this.lib, { [id]: 1 }, false);
      ur.lodDist = [1000, 2000];
      scene.add(ur.group);
      const h = asset.height * pick.def.scale;
      const fig: Figure = { variant: id, x: 0, y: 0, z: 0, yaw: 0.45, scale: pick.def.scale, tint: 1, anim: { clip: 'aim', t: 0.4, rate: 1, prev: null, pt: 0, prate: 1, blend: 0, fade: 0, up: null, ut: 0, urate: 1, udur: 0, uw: 0 }, visible: true };
      cam.position.set(0.55, h * 0.78, 2.1 + h * 0.15);
      cam.lookAt(0, h * 0.72, 0);
      cam.updateMatrixWorld();
      ur.update(cam, [fig]);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
      this.renderer.setRenderTarget(null);
      out.set(u.tpl.id, this.encodePortrait(px, S, g, cv));
      scene.remove(ur.group);
      ur.group.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
    }
    this.renderer.toneMapping = prevTone;
    rt.dispose();
    return out;
  }

  // ====================================================================== minimap
  private buildMinimapBg() {
    const S = 200, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = (i / S) * PLAY * 2 - PLAY, z = (j / S) * PLAY * 2 - PLAY;
      const h = this.map.heightAt(x, z);
      const ci = this.map.cellOf(x, z);
      let r = 70 + h * 6, gg = 62 + h * 5, b = 50 + h * 4;
      if (ci >= 0 && this.map.blocked[ci]) { r = 150; gg = 140; b = 120; }
      else if (ci >= 0 && this.map.trench[ci]) { r = 40; gg = 32; b = 24; }
      const o = (j * S + i) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.miniBg = c;
    const mm = this.hud.minimap;
    const pick = (e: PointerEvent) => {
      const r = mm.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * PLAY * 2 - PLAY, z = ((e.clientY - r.top) / r.height) * PLAY * 2 - PLAY;
      this.rig.focus(x, z);
    };
    mm.addEventListener('pointerdown', (e) => { e.stopPropagation(); pick(e); });
    void GN; void CELL; void HALF;
  }

  private drawMinimap() {
    const c = this.hud.minimap, g = c.getContext('2d')!;
    const S = c.width;
    if (this.miniBg) g.drawImage(this.miniBg, 0, 0);
    const m = (x: number) => ((x + PLAY) / (PLAY * 2)) * S;
    for (const s of this.battle.soldiers) {
      if (!s.alive) continue;
      g.fillStyle = s.side === this.playerSide ? (this.selected.has(s.unit) ? '#ffe08a' : FACTIONS[s.unit.faction].color) : '#e0402a';
      g.fillRect(m(s.x) - 1, m(s.z) - 1, 2.5, 2.5);
    }
    // camera footprint
    const f = this.rig.focusPoint;
    g.strokeStyle = '#ffffffaa'; g.lineWidth = 1;
    const r = this.rig.dist * 0.7;
    g.save(); g.translate(m(f.x), m(f.z)); g.rotate(-this.rig.yaw + Math.PI);
    g.strokeRect(-r / (PLAY * 2) * S, -r / (PLAY * 2) * S * 0.7, (r * 2) / (PLAY * 2) * S, (r * 1.4) / (PLAY * 2) * S);
    g.restore();
  }

  // ====================================================================== results
  private showResults() {
    this.resultsShown = true;
    const b = this.battle;
    const won = b.winner === this.playerSide;
    this.onResult?.(won);
    const rows = b.units.filter((u) => u.side === this.playerSide).map((u) => `<tr><td>${u.name}</td><td>${u.soldiers.filter((s) => s.alive).length}/${u.initial}</td><td>${u.kills}</td><td>${u.mstate === 'routing' || u.mstate === 'gone' && u.soldiers.some((s) => (s as Soldier & { fled?: boolean }).fled) ? '패주' : u.soldiers.some((s) => s.alive) ? '건재' : '전멸'}</td></tr>`).join('');
    const d = document.createElement('div');
    d.className = 'screen bg';
    const lost0 = b.soldiers.filter((s) => s.side === this.playerSide && !s.alive).length;
    const lost1 = b.soldiers.filter((s) => s.side !== this.playerSide && !s.alive).length;
    d.innerHTML = `<div class="panel results"><h1>${won ? '승리' : b.winner === -1 ? '무승부' : '패배'}</h1>
      <div class="serif" style="color:var(--dim)">${this.opts.scenario.ko} · 전투 시간 ${Math.floor(b.time / 60)}분 ${Math.floor(b.time % 60)}초</div>
      <div class="row"><span>아군 손실 ${lost0}</span> · <span>적군 손실 ${lost1}</span></div>
      <table><tr><th>부대</th><th>생존</th><th>처치</th><th>상태</th></tr>${rows}</table>
      <div class="row"><button class="btn big" id="r-retry">다시 싸우기</button><button class="btn big" id="r-menu">메인 메뉴</button><button class="btn" id="r-watch">전장 계속 보기</button></div></div>`;
    this.ui.appendChild(d);
    d.querySelector('#r-retry')!.addEventListener('click', () => { d.remove(); (this as { onRetry?: () => void }).onRetry?.(); });
    d.querySelector('#r-menu')!.addEventListener('click', () => { d.remove(); this.onExit?.(); });
    d.querySelector('#r-watch')!.addEventListener('click', () => d.remove());
  }
  onRetry?: () => void;

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.hud?.destroy();
    this.audio.stopAmbience();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    });
    this.composer?.dispose();
    this.cine?.dispose();
    this.renderer.renderLists.dispose();
  }
}

function soundOf(s: string): 'las' | 'bolter' | 'hbolter' | 'stubber' | 'plasma' | 'slugga' | 'shoota' | 'cannon' | 'lascannon' {
  return (['las', 'bolter', 'hbolter', 'stubber', 'plasma', 'slugga', 'shoota', 'cannon', 'lascannon'].includes(s) ? s : 'las') as 'las';
}
const tick = () => new Promise((r) => setTimeout(r, 0));
void SOLDIERS;
