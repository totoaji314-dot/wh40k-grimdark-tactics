// Headless battle tests: every scenario is played out AI vs AI with the real simulation and map.
// Checks that battles resolve, nothing goes NaN, soldiers stay out of walls, and prints balance stats.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { BattleMap, type MapType } from '../src/world/MapGen';
import { Battle } from '../src/sim/Battle';
import { Commander } from '../src/sim/AI';
import { SCENARIOS, type Scenario } from '../src/sim/data';
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

const maps = new Map<string, BattleMap>();
function mapFor(type: MapType) {
  if (!maps.has(type)) maps.set(type, new BattleMap(type, foot));
  return maps.get(type)!;
}

describe('battle simulation', () => {
  const seeds = (process.env.SEEDS ?? '7').split(',').map(Number);
  // a custom battle on the Holy Terra map: Cadian lines and a tactical squad before the palace bastion, orks attacking from the north
  const terra: Scenario = {
    id: 'terra_test', ko: '홀리 테라 시험', desc: '', player: ['marines', 'guard'], enemy: ['orks'], map: 'terra',
    side0: [{ unit: 'infantry', x: -60, z: 92 }, { unit: 'heavy_platoon', x: 0, z: 92 }, { unit: 'infantry', x: 60, z: 92 }, { unit: 'tactical', x: 0, z: 70 }, { unit: 'leman_russ', x: 0, z: 110 }],
    side1: [{ unit: 'boyz', x: -60, z: -120 }, { unit: 'boyz', x: 0, z: -115 }, { unit: 'boyz', x: 60, z: -120 }, { unit: 'shootas', x: -30, z: -130 }, { unit: 'shootas', x: 30, z: -130 }, { unit: 'nobz', x: 0, z: -150 }],
  };
  for (const sc of [...SCENARIOS, terra]) for (const seed of seeds) {
    it(`${sc.id} seed ${seed} resolves AI vs AI`, () => {
      const map = mapFor(sc.map);
      const b = new Battle(map, sc, clips, seed);
      const ai = [new Commander(b, 0), new Commander(b, 1)];
      const dt = 1 / 20;
      let steps = 0, stuckInWall = 0;
      const used = new Set<string>();
      const t0 = performance.now();
      while (!b.over && b.time < 900) {
        ai[0].update(dt); ai[1].update(dt);
        b.update(dt);
        b.events.length = 0;
        steps++;
        if (steps % 3 === 0) for (const s of b.soldiers) used.add(s.anim.clip);
        if (steps % 200 === 0) for (const s of b.soldiers) {
          expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
          if (s.alive && map.isBlocked(s.x, s.z)) stuckInWall++;
        }
      }
      const ms = (performance.now() - t0) / steps;
      const units = b.units.map((u) => `${u.name}[${u.soldiers.filter((s) => s.alive).length}/${u.initial} ${u.mstate} k${u.kills}]`).join(' ');
      console.log(`${sc.id}/${seed}: winner=${b.winner} time=${b.time.toFixed(0)}s alive ${b.sideCount(0)} vs ${b.sideCount(1)} | ${ms.toFixed(2)} ms/step | inWall ${stuckInWall}\n   ${units}`);
      console.log('   clips used:', [...used].sort().join(' '));
      expect(b.over).toBe(true);
      // the battle actually drives the full animation set (12 required kinds)
      for (const c of ['idle', 'aim', 'walk', 'run', 'charge', 'fire', 'reload', 'hit', 'cover', 'command']) expect(used.has(c), c).toBe(true);
      expect(used.has('melee_a') || used.has('melee_b')).toBe(true);
      expect(used.has('death_a') || used.has('death_b')).toBe(true);
      expect(stuckInWall).toBeLessThan(b.soldiers.length * 0.05);
    }, 120000);
  }
});
