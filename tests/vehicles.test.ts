// Vehicle (Leman Russ) behaviour on the real simulation: driving to orders, armour against small arms,
// turret / sponson fire arcs, destruction leaving a wreck that blocks movement, and the AI never charging with tanks.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { BattleMap } from '../src/world/MapGen';
import { Battle, angDiff, type Soldier } from '../src/sim/Battle';
import { Commander } from '../src/sim/AI';
import { SCENARIOS, WEAPONS } from '../src/sim/data';
import type { ClipTable } from '../src/sim/anim';

const foot = JSON.parse(fs.readFileSync('public/assets/env/env.json', 'utf8'));
const clips: ClipTable = {};
for (const f of ['marines', 'guard', 'krieg', 'orks']) {
  const meta = JSON.parse(fs.readFileSync(`public/assets/units/${f}.json`, 'utf8'));
  for (const [id, v] of Object.entries<any>(meta.variants)) {
    clips[id] = {};
    for (const [c, m] of Object.entries<any>(v.clips)) clips[id][c] = { dur: (m.loop ? m.frames - 1 : m.frames) / 30, loop: m.loop, speed: m.speed ?? 0, event: m.event ?? 0.5 };
  }
}
const ruins = new BattleMap('ruins', foot);
const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const tankOf = (b: Battle, side = 0) => b.soldiers.find((s) => s.def.vehicle && s.side === side)!;

describe('vehicles', () => {
  it('drives to a move order (turns, then advances) and stops near the spot', () => {
    const b = new Battle(ruins, sc('cadia_line'), clips, 5);
    const t = tankOf(b);
    for (const u of b.units) if (u.side === 1) b.place(u, u.x, u.z - 60, 0);   // keep the orks out of the way
    const tx = t.x + 20, tz = t.z - 25;
    b.order(t.unit, { type: 'move', x: tx, z: tz, yaw: Math.PI });
    let maxSpeed = 0;
    for (let i = 0; i < 30 * 25; i++) { b.update(1 / 30); maxSpeed = Math.max(maxSpeed, Math.abs(b.vstate.get(t)!.speed)); b.events.length = 0; }
    expect(Number.isNaN(t.x) || Number.isNaN(t.z)).toBe(false);
    expect(Math.hypot(t.x - tx, t.z - tz)).toBeLessThan(4);
    expect(maxSpeed).toBeGreaterThan(1.5);
    expect(maxSpeed).toBeLessThan(t.def.run + 0.2);
  });

  it('armour: lasgun hits barely scratch a tank, a lascannon hit does full damage', () => {
    const b = new Battle(ruins, sc('cadia_line'), clips, 5);
    const t = tankOf(b);
    const las = WEAPONS.lasgun, lc = WEAPONS.lascannon;
    for (let i = 0; i < 100; i++) b.damage(t, las.dmg, las.ap, null);
    expect(t.hp).toBeGreaterThan(t.maxHp * 0.97);
    const before = t.hp;
    b.damage(t, lc.dmg, lc.ap, null);
    expect(before - t.hp).toBeGreaterThan(lc.dmg * 0.95);
  });

  it('fires every mount at an enemy in front, and side sponsons only toward their own side', () => {
    const b = new Battle(ruins, sc('cadia_line'), clips, 9);
    const t = tankOf(b);
    for (const u of b.units) if (u.side === 0 && u !== t.unit) b.place(u, u.x - 120, u.z, Math.PI);
    const orks = b.units.find((u) => u.side === 1 && u.tpl.id === 'boyz')!;
    // enemy straight ahead (the tank faces -z), others parked far away
    for (const u of b.units) if (u.side === 1 && u !== orks) b.place(u, -150, -150, 0);
    b.place(orks, t.x, t.z - 70, 0);
    const fired: Record<string, number> = {};
    const wrongSide: string[] = [];
    for (let i = 0; i < 30 * 20; i++) {
      for (const u of b.units) if (u.side === 1) { u.order = { type: 'idle' }; u.target = null; u.moving = false; }
      b.update(1 / 30);
      for (const e of b.events) if (e.type === 'shot' && e.s === t) {
        fired[e.mount!] = (fired[e.mount!] ?? 0) + 1;
        const rel = angDiff(t.yaw, Math.atan2(e.tx - t.x, e.tz - t.z));
        if (e.mount === 'sponsonL' && rel < -0.5) wrongSide.push('L ' + rel.toFixed(2));
        if (e.mount === 'sponsonR' && rel > 0.5) wrongSide.push('R ' + rel.toFixed(2));
      }
      b.events.length = 0;
    }
    expect(fired.turret ?? 0).toBeGreaterThan(0);
    expect(fired.hull ?? 0).toBeGreaterThan(0);
    expect((fired.sponsonL ?? 0) + (fired.sponsonR ?? 0)).toBeGreaterThan(0);
    expect(wrongSide).toEqual([]);
  });

  it('a destroyed tank explodes, leaves a wreck that blocks movement and stays dead', () => {
    const b = new Battle(ruins, sc('cadia_line'), clips, 5);
    const t = tankOf(b);
    b.damage(t, 1e6, 1, null);
    let explosion = false;
    b.update(1 / 30);
    for (const e of b.events) if (e.type === 'explosion' && Math.hypot(e.x - t.x, e.z - t.z) < 1) explosion = true;
    expect(t.alive).toBe(false);
    expect(explosion).toBe(true);
    expect(b.wrecks).toContain(t);
    expect(b.inWreck(t.x, t.z, 0.3)).toBe(true);
    expect(b.inWreck(t.x + 10, t.z, 0.3)).toBe(false);
    expect(b.health(t.unit)).toBe(0);
  });

  it('AI vs AI battles with tanks finish, tanks never charge and stay out of walls', () => {
    for (const id of ['cadia_line', 'krieg_trench', 'orks_vs_imperium']) {
      const b = new Battle(ruins.type === sc(id).map ? ruins : new BattleMap(sc(id).map, foot), sc(id), clips, 13);
      const ai = [new Commander(b, 0, 1), new Commander(b, 1, 1)];
      const tanks: Soldier[] = b.soldiers.filter((s) => s.def.vehicle);
      let charged = false;
      for (let i = 0; i < 30 * 400 && !b.over; i++) {
        for (const a of ai) a.update(1 / 30);
        b.update(1 / 30);
        for (const t of tanks) if (t.unit.charging || t.unit.order.charge) charged = true;
        b.events.length = 0;
      }
      expect(b.over).toBe(true);
      expect(charged).toBe(false);
      for (const t of tanks) { expect(Number.isNaN(t.x)).toBe(false); expect(b.map.isBlocked(t.x, t.z)).toBe(false); }
    }
  }, 60000);   // three full battles: several seconds on a CI runner
});
