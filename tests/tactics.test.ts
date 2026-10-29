// Command and melee behaviour checks on the real simulation: hold fire, dragged frontage, deployment
// placement, and group melee (attackers spread over the enemy line instead of piling onto one soldier).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { BattleMap } from '../src/world/MapGen';
import { Battle, meleeCap, type Soldier } from '../src/sim/Battle';
import { Commander } from '../src/sim/AI';
import { SCENARIOS } from '../src/sim/data';
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

describe('commands', () => {
  it('hold fire: a unit with fire-at-will off and no attack order never shoots', () => {
    const b = new Battle(ruins, sc('marines_vs_orks'), clips, 3);
    const mine = b.units.filter((u) => u.side === 0);
    const enemy = b.units.find((u) => u.side === 1)!;
    for (const u of mine) { u.fireAtWill = false; b.place(u, enemy.x + (u.id % 3 - 1) * 14, enemy.z + 45, Math.PI); }
    let shots = 0;
    for (let i = 0; i < 20 * 15; i++) {
      for (const u of b.units) if (u.side === 1) { u.order = { type: 'idle' }; u.target = null; u.moving = false; }
      b.update(1 / 20);
      for (const e of b.events) if (e.type === 'shot' && e.s.side === 0) shots++;
      b.events.length = 0;
    }
    expect(shots).toBe(0);
    // turning it back on makes them engage
    for (const u of mine) u.fireAtWill = true;
    for (let i = 0; i < 20 * 15; i++) { b.update(1 / 20); for (const e of b.events) if (e.type === 'shot' && e.s.side === 0) shots++; b.events.length = 0; }
    expect(shots).toBeGreaterThan(0);
  });

  it('dragged frontage sets files: a wide drag makes a single rank, a narrow one a deep block', () => {
    const b = new Battle(ruins, sc('cadia_line'), clips, 3);
    const u = b.units.find((x) => x.side === 0 && x.soldiers.length >= 20)!;
    const rows = () => new Set(u.soldiers.filter((s) => s.alive && s !== u.leader).map((s) => s.slotZ.toFixed(2))).size;
    const n = u.soldiers.filter((s) => s !== u.leader).length;
    b.order(u, { type: 'move', x: u.x, z: u.z - 10, files: n });
    expect(rows()).toBe(1);
    b.order(u, { type: 'move', x: u.x, z: u.z - 10, files: 5 });
    expect(rows()).toBe(Math.ceil(n / 5));
  });

  it('deployment placement moves a unit instantly into its slots without running the clock', () => {
    const b = new Battle(ruins, sc('marines_vs_orks'), clips, 3);
    const u = b.units.find((x) => x.side === 0)!;
    b.place(u, u.x + 20, u.z + 6, 0.4, 6);
    expect(b.time).toBe(0);
    for (const s of u.soldiers) { const [wx, wz] = b.slotWorld(u, s); expect(Math.hypot(wx - s.x, wz - s.z)).toBeLessThan(2.5); }
    expect(u.files).toBe(6);
  });
});

describe('group melee', () => {
  it('attackers spread over the enemy line and few soldiers are swarmed beyond the cap', () => {
    const b = new Battle(ruins, sc('marines_vs_orks'), clips, 7);
    const ai = [new Commander(b, 0), new Commander(b, 1)];
    let samples = 0, overCap = 0, engagedDefenders = 0, maxCrowd = 0;
    while (!b.over && b.time < 300) {
      ai[0].update(1 / 20); ai[1].update(1 / 20); b.update(1 / 20); b.events.length = 0;
      if (Math.round(b.time * 20) % 10 === 0) {
        const crowd = new Map<Soldier, number>();
        for (const s of b.soldiers) if (s.alive && s.foe && s.foe.alive) crowd.set(s.foe, (crowd.get(s.foe) ?? 0) + 1);
        for (const [o, n] of crowd) { samples++; engagedDefenders++; maxCrowd = Math.max(maxCrowd, n); if (n > meleeCap(o) + 1) overCap++; }
      }
    }
    console.log(`melee: engagements ${b.meleeStats.picks}, spread picks ${b.meleeStats.spread}, waiting ${b.meleeStats.waiting}, defender samples ${engagedDefenders}, over cap ${overCap}, max crowd ${maxCrowd}`);
    expect(samples).toBeGreaterThan(50);
    expect(b.meleeStats.spread).toBeGreaterThan(0);
    expect(overCap / samples).toBeLessThan(0.05);
  }, 120000);
});

describe('reaction animations', () => {
  it('battles use block, stagger, power attack, side death and knockdown->getup, and nobody stays down', () => {
    const used = new Set<string>();
    let stuckDown = 0;
    for (const id of ['marines_vs_orks', 'grand_waaagh']) {
      const map = new BattleMap(sc(id).map, foot);
      const b = new Battle(map, sc(id), clips, 11);
      const ai = [new Commander(b, 0), new Commander(b, 1)];
      const downSince = new Map<Soldier, number>();
      while (!b.over && b.time < 300) {
        ai[0].update(1 / 20); ai[1].update(1 / 20); b.update(1 / 20); b.events.length = 0;
        for (const s of b.soldiers) {
          used.add(s.anim.clip);
          if (s.alive && s.anim.clip === 'knockdown') { if (!downSince.has(s)) downSince.set(s, b.time); else if (b.time - downSince.get(s)! > 5) stuckDown++; }
          else downSince.delete(s);
        }
      }
    }
    console.log('reaction clips used:', ['block', 'stagger', 'melee_c', 'death_c', 'knockdown', 'getup', 'sprint'].filter((c) => used.has(c)).join(' '));
    for (const c of ['block', 'stagger', 'melee_c', 'death_c']) expect(used.has(c), c).toBe(true);
    if (used.has('knockdown')) expect(used.has('getup')).toBe(true);
    expect(stuckDown).toBe(0);
  }, 240000);
});
