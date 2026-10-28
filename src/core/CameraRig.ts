import * as THREE from 'three';
import { PLAY } from '../world/MapGen';

/**
 * Total War style battle camera: orbits a ground target. Zooming in lowers the pitch toward a
 * cinematic over-the-shoulder view; zooming out rises to a tactical overview.
 */
export class CameraRig {
  target = new THREE.Vector3(0, 0, 60);
  dist = 70;
  yaw = Math.PI;   // camera looks toward -z (north) at yaw PI
  tilt = 0;        // user tilt offset
  minDist = 9;
  maxDist = 300;
  private smoothT = new THREE.Vector3();
  private smoothD = 70;
  private smoothYaw = Math.PI;
  shake = 0;

  constructor(public camera: THREE.PerspectiveCamera, private heightAt: (x: number, z: number) => number) {
    this.smoothT.copy(this.target);
  }

  pitch(d = this.smoothD) {
    const t = (d - this.minDist) / (this.maxDist - this.minDist);
    return THREE.MathUtils.clamp(0.22 + Math.pow(t, 0.6) * 0.95 + this.tilt, 0.12, 1.45);
  }

  pan(dx: number, dz: number) {
    // dx: right, dz: forward (screen space), scaled by zoom
    const k = 0.6 + this.dist / 60;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    this.target.x += (rx * dx + fx * dz) * k;
    this.target.z += (rz * dx + fz * dz) * k;
    this.clamp();
  }

  zoom(f: number) { this.dist = THREE.MathUtils.clamp(this.dist * f, this.minDist, this.maxDist); }
  rotate(a: number) { this.yaw += a; }
  focus(x: number, z: number, d?: number) { this.target.set(x, 0, z); if (d) this.dist = d; this.clamp(); }

  private clamp() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -PLAY - 20, PLAY + 20);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -PLAY - 20, PLAY + 20);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    this.smoothT.lerp(this.target, k);
    this.smoothT.y = this.heightAt(this.smoothT.x, this.smoothT.z);
    this.smoothD += (this.dist - this.smoothD) * k;
    let dy = this.yaw - this.smoothYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.smoothYaw += dy * k;
    const p = this.pitch();
    const d = this.smoothD;
    const c = this.camera;
    const look = this.smoothT.clone();
    look.y += Math.min(2.2, d * 0.03);
    c.position.set(
      look.x + Math.sin(this.smoothYaw) * Math.cos(p) * d,
      look.y + Math.sin(p) * d,
      look.z + Math.cos(this.smoothYaw) * Math.cos(p) * d,
    );
    const ground = this.heightAt(c.position.x, c.position.z) + 1.5;
    if (c.position.y < ground) c.position.y = ground;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      c.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      c.position.y += (Math.random() - 0.5) * this.shake * 0.3;
    }
    c.lookAt(look);
    // closer views get a narrower lens for a more cinematic perspective
    const fov = THREE.MathUtils.lerp(38, 50, THREE.MathUtils.clamp((d - 15) / 150, 0, 1));
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  }

  get focusPoint() { return this.smoothT; }
}
