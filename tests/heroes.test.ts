// Hero units: each single-model hero fights ork mobs on the Holy Terra map, AI vs AI, with the real simulation.
// Checks that heroes kill at the rate their tier promises, use their powers, and that the powers do what they say.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { BattleMap } from '../src/world/MapGen';
import { Battle } from '../src/sim/Battle';
import { Commander } from '../src/sim/AI';
import { HERO_UNITS, HERO_PREVIEW_VARIANT, UNITS, SOLDIERS, type Scenario, type Deploy } from '../src/sim/data';
import type { ClipTable } from '../src/sim/anim';

const foot = JSON.parse(fs.readFileSync('public/assets/env/env.json', 'utf8'));
const clips: ClipTable = {};
for (const f of ['marines', 'orks']) {
  const meta = JSON.parse(fs.readFileSync(`public/assets/units/${f}.json`, 'utf8'));
  for (const [id, v] of Object.entries<any>(meta.variants)) {
    clips[id] = {};
    for (const [c, m] of Object.entries<any>(v.clips)) clips[id][c] = { dur: (m.loop ? m.frames - 1 : m.frames) / 30, loop: m.loop, speed: m.speed ?? 0, event: m.event ?? 0.5 };
  }
}
// heroes share the marine rig, so their clip timings match the marine models
for (const [id, alt] of Object.entries(HERO_PREVIEW_VARIANT)) clips[id] ??= clips[alt];

const map = new BattleMap('terra', foot);
const scenario = (hero: string, foes: Deploy[]): Scenario => ({
  id: 'hero_' + hero, ko: hero, desc: '', player: ['marines'], enemy: ['orks'], map: 'terra',
  side0: [{ unit: hero, x: 0, z: 70 }], side1: foes,
});

function play(sc: Scenario, seed: number, limit = 400) {
  const b = new Battle(map, sc, clips, seed);
  const ai = [new Commander(b, 0), new Commander(b, 1)];
  const abilities: string[] = [];
  const dt = 1 / 20;
  while (!b.over && b.time < limit) {
    ai[0].update(dt); ai[1].update(dt);
    b.update(dt);
    for (const e of b.events) if (e.type === 'ability' && e.u.side === 0) abilities.push(e.id);
    b.events.length = 0;
    for (const s of b.soldiers) if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || !Number.isFinite(s.hp)) throw new Error('NaN soldier ' + s.def.id);
  }
  const hero = b.units[0];
  const h = hero.soldiers[0];
  const orks = b.soldiers.filter((s) => s.side === 1);
  return { b, hero, h, abilities, killed: orks.filter((s) => !s.alive).length, orks: orks.length };
}

const boyz = (n: number): Deploy[] => Array.from({ length: n }, (_, i) => ({ unit: 'boyz', x: (i - (n - 1) / 2) * 40, z: -60 - (i % 2) * 15 }));

describe('hero units', () => {
  it('six heroes exist as single-model fearless units with a power each', () => {
    expect(HERO_UNITS.sort()).toEqual(['calgar', 'chairon', 'emperor', 'gadriel', 'guilliman', 'titus']);
    for (const id of HERO_UNITS) {
      const t = UNITS[id];
      expect(t.members).toEqual([[id, 1]]);
      expect(t.fearless).toBe(true);
      expect(t.ability).toBeTruthy();
      expect(SOLDIERS[id].role).toBe('boss');
    }
  });

  // [hero, ork mobs of 40, minimum kills, must survive]
  const tiers: [string, number, number, boolean][] = [
    ['titus', 1, 32, true], ['chairon', 1, 32, true], ['gadriel', 1, 32, true],
    ['calgar', 1, 32, true], ['guilliman', 3, 100, true], ['emperor', 5, 185, true],
  ];
  const seeds = (process.env.SEEDS ?? '7').split(',').map(Number);
  for (const [id, mobs, minKills, survive] of tiers) for (const seed of seeds) {
    it(`${id} alone against ${mobs * 40} orks (seed ${seed})`, () => {
      const r = play(scenario(id, boyz(mobs)), seed);
      console.log(`${id}/${seed}: killed ${r.killed}/${r.orks} orks, hp ${Math.round(r.h.hp)}/${r.h.maxHp}, ${r.b.time.toFixed(0)}s, powers ${r.abilities.join(',') || '-'}`);
      expect(r.killed).toBeGreaterThanOrEqual(minKills);
      if (survive) expect(r.h.alive).toBe(true);
      expect(r.abilities.length).toBeGreaterThan(0);
    }, 120000);
  }

  it('the Emperor\'s light throws down and hurts the orks around him', () => {
    const b = new Battle(map, scenario('emperor', [{ unit: 'boyz', x: 0, z: 40 }]), clips, 3);
    const emp = b.units[0].soldiers[0];
    const mob = b.units[1];
    // put the mob right around him
    mob.soldiers.forEach((s, i) => { const a = (i / mob.soldiers.length) * Math.PI * 2; s.x = emp.x + Math.cos(a) * (4 + (i % 4) * 3); s.z = emp.z + Math.sin(a) * (4 + (i % 4) * 3); });
    const hp0 = mob.soldiers.reduce((a, s) => a + s.hp, 0);
    const morale0 = mob.morale;
    expect(b.useAbility(b.units[0])).toBe(true);
    const hp1 = mob.soldiers.reduce((a, s) => a + Math.max(0, s.hp), 0);
    expect(hp1).toBeLessThan(hp0 * 0.5);
    expect(mob.morale).toBeLessThanOrEqual(morale0 - 30);
    expect(b.soldiers.filter((s) => s.side === 0 && s.hp < s.maxHp).length).toBe(0);   // no harm to his own side
  });

  it('fury heals Titus and halves the damage he takes', () => {
    const b = new Battle(map, scenario('titus', [{ unit: 'boyz', x: 0, z: -60 }]), clips, 3);
    const t = b.units[0].soldiers[0];
    t.hp = 300;
    b.damage(t, 100, 0.88, null);           // armour 0.88 - ap 0.88 = no save
    const plain = 300 - t.hp;
    expect(b.useAbility(b.units[0])).toBe(true);
    expect(t.hp).toBeCloseTo(300 - plain + t.maxHp * 0.25, 0);
    const before = t.hp;
    b.damage(t, 100, 0.88, null);
    expect(before - t.hp).toBeCloseTo(plain * 0.5, 0);
  });

  it('primarch\'s majesty lifts nearby allies to full morale and steadier aim', () => {
    const sc: Scenario = { ...scenario('guilliman', [{ unit: 'boyz', x: 0, z: -80 }]), player: ['marines', 'guard'], side0: [{ unit: 'guilliman', x: 0, z: 70 }, { unit: 'infantry', x: 30, z: 80 }, { unit: 'infantry', x: 160, z: 80 }] };
    const b = new Battle(map, sc, clips, 3);
    const [g, near, far] = b.units;
    near.morale = 20; far.morale = 20;
    g.soldiers[0].hp = 1000;
    expect(b.useAbility(g)).toBe(true);
    expect(near.morale).toBe(100);
    expect(near.buffs.aim).toBeGreaterThan(0);
    expect(near.buffs.primarch).toBeGreaterThan(0);
    expect(far.morale).toBe(20);              // out of the 80 m radius
    expect(g.soldiers[0].hp).toBeCloseTo(1000 + 4200 * 0.15, 0);
  });
});
