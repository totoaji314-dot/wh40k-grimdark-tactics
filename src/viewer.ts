// Model viewer used to check unit models + animations in the real renderer (?viewer).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { UnitLibrary } from './render/UnitLibrary';
import { UnitRenderer, newAnim, stepAnim, type Figure } from './render/UnitRenderer';

export async function startViewer(canvas: HTMLCanvasElement) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio));
  r.setSize(innerWidth, innerHeight);
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a30);
  scene.fog = new THREE.Fog(0x2a2a30, 30, 90);
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 400);
  cam.position.set(6, 4.5, 11);
  const ctl = new OrbitControls(cam, canvas); ctl.target.set(0, 1.1, 0); ctl.update();
  scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x3a3028, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.position.set(8, 14, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x4a4740, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const lib = new UnitLibrary(import.meta.env.BASE_URL + 'assets/units/');
  const q = new URLSearchParams(location.search);
  const factions = (q.get('f') ?? 'marines').split(',');
  for (const f of factions) await lib.loadFaction(f, false);
  const ids = [...lib.variants.keys()];
  const clipNames = Object.keys(lib.variants.get(ids[0])!.clips);
  const only = q.get('clip');
  const figs: Figure[] = [];
  const cols = Math.max(ids.length, 1);
  let k = 0;
  const per = Number(q.get('n') ?? 8);
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < per; j++) {
    const clip = only ?? clipNames[(k++) % clipNames.length];
    figs.push({ variant: ids[i], x: (i - (cols - 1) / 2) * 2.4, y: 0, z: -j * 2.4, yaw: q.has('yaw') ? Number(q.get('yaw')) : 0.4, scale: 1, tint: 0.92 + Math.random() * 0.16, anim: newAnim(clip), visible: true });
  }
  const counts: Record<string, number> = {};
  for (const f of figs) counts[f.variant] = (counts[f.variant] ?? 0) + 1;
  const ur = new UnitRenderer(lib, counts, true);
  scene.add(ur.group);
  const info = document.createElement('div');
  info.style.cssText = 'position:fixed;left:8px;top:8px;color:#ddd;font:12px monospace;background:#0008;padding:6px';
  document.body.appendChild(info);
  addEventListener('resize', () => { r.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });
  let last = performance.now(), fps = 0;
  (window as any).V = { figs, ur, lib, cam, ctl, step: (n: number) => { for (let i = 0; i < n; i++) figs.forEach((f) => stepAnim(f.anim, 1 / 30)); ur.update(cam, figs); r.render(scene, cam); } };
  const loop = () => {
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    for (const f of figs) stepAnim(f.anim, dt);
    ur.update(cam, figs);
    r.render(scene, cam);
    info.textContent = `fps ${fps.toFixed(0)}  drawn ${ur.stats.drawn}  tris ${(ur.stats.tris / 1000).toFixed(0)}k  calls ${r.info.render.calls}`;
    requestAnimationFrame(loop);
  };
  loop();
}
