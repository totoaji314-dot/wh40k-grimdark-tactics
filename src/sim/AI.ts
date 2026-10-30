import type { Battle, Unit } from './Battle';
import { dist } from './Battle';

/**
 * Army-level tactical AI. Every second it looks at each unit and issues orders like a player would:
 * orks swarm and charge with a WAAAGH!, shootas stop at range, the warboss follows the first wave;
 * imperial units hold good ground and shoot, counter-charge when they are strong in melee
 * (marines, krieg bayonets) and brace (defensive formation) when lighter troops are charged.
 */
export class Commander {
  private t = 0;
  private idleT = new Map<number, number>();
  constructor(private b: Battle, public side: number, public difficulty = 1) {}

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1.0;
    const b = this.b;
    const mine = b.units.filter((u) => u.side === this.side && b.active(u) && u.mstate !== 'routing' && u.mstate !== 'gone');
    const foes = b.units.filter((u) => u.side !== this.side && b.active(u) && u.mstate !== 'gone');
    if (!foes.length) return;
    for (const u of mine) this.think(u, mine, foes);
  }

  private centre(u: Unit) {
    let x = 0, z = 0, n = 0;
    for (const s of u.soldiers) if (s.alive) { x += s.x; z += s.z; n++; }
    return n ? { x: x / n, z: z / n } : { x: u.x, z: u.z };
  }

  private nearest(u: Unit, foes: Unit[], pred: (v: Unit) => boolean = () => true) {
    const c = this.centre(u);
    let best: Unit | null = null, bd = 1e9;
    for (const v of foes) {
      if (!pred(v)) continue;
      let d = dist(c, this.centre(v));
      if (v.mstate === 'routing') d += 60;
      if (d < bd) { bd = d; best = v; }
    }
    return { v: best, d: bd };
  }

  private strength(u: Unit) { return u.soldiers.filter((s) => s.alive).length / u.initial; }

  private think(u: Unit, mine: Unit[], foes: Unit[]) {
    const b = this.b;
    // hero powers that matter most in the thick of it
    const L = u.leader?.alive ? u.leader : null;
    if (L && u.abilityCd <= 0 && (u.tpl.ability === 'fury' || u.tpl.ability === 'emperor_light')) {
      let close = 0;
      b.near(L.x, L.z, 20, (o) => { if (o.alive && o.side !== u.side) close++; });
      if (u.tpl.ability === 'fury' ? (u.inMelee || L.hp < L.maxHp * 0.6) && close > 0 : close >= 6) b.useAbility(u);
    }
    if (u.inMelee) return;
    const { v: tgt, d } = this.nearest(u, foes);
    if (!tgt) return;
    const busy = u.order.type === 'attack' && u.order.target === tgt;
    if (u.faction === 'orks') {
      if (u.tpl.ability === 'waaagh' && u.abilityCd <= 0 && d < 55 && u.leader?.def.role === 'boss') b.useAbility(u);
      else if (u.tpl.ability === 'waaagh' && u.abilityCd <= 0 && d < 40 && this.strength(u) > 0.4 && !mine.some((m) => m.buffs.waaagh > 0)) b.useAbility(u);
      if (u.meleeOnly) {
        // the warboss mob waits until the first wave is close, then commits
        if (u.leader?.def.role === 'boss') {
          const lead = mine.filter((m) => m !== u && m.meleeOnly).map((m) => this.nearest(m, foes).d);
          const ready = !lead.length || Math.min(...lead) < 55 || d < 70;
          if (!ready) { this.advance(u, tgt, 26, false); return; }
        }
        if (!busy) b.order(u, { type: 'attack', target: tgt, run: true, charge: true });
        return;
      }
      // shoota boyz: shoot from range, charge anything that gets close
      if (d < 16 && !busy) { b.order(u, { type: 'attack', target: tgt, run: true, charge: true }); return; }
      if (!busy || u.order.charge) b.order(u, { type: 'attack', target: tgt, run: d > u.maxRange * 1.6 });
      return;
    }
    // ---------------- imperium
    const charging = foes.filter((f) => f.charging && f.target && mine.includes(f.target));
    const threatened = charging.find((f) => f.target === u);
    const myStrength = this.strength(u);
    const goodMelee = !u.vehicle && (u.faction === 'marines' || (u.faction === 'krieg' && myStrength > 0.5));
    if (threatened && !goodMelee && u.formation !== 'defensive' && dist(this.centre(u), this.centre(threatened)) < 30) b.setFormation(u, 'defensive');
    if (!threatened && u.formation === 'defensive' && !u.inMelee) b.setFormation(u, u.tpl.formation);
    // abilities when there is something to shoot
    if (u.tpl.ability && u.tpl.ability !== 'fury' && u.tpl.ability !== 'emperor_light' && u.abilityCd <= 0 && d < u.maxRange * 0.9) {
      if (u.tpl.ability === 'bayonet') { if (d < 30 && this.strength(tgt) < 0.6) { b.useAbility(u); b.order(u, { type: 'attack', target: tgt, run: true, charge: true }); return; } }
      else b.useAbility(u);
    }
    // counter-charge: marines into anything close, krieg into weakened or routing enemies
    const inTrench = u.soldiers.filter((s) => s.alive && b.map.inTrench(s.x, s.z)).length > u.soldiers.filter((s) => s.alive).length * 0.4;
    if (goodMelee && d < 26 && (u.faction === 'marines' || tgt.mstate === 'routing' || (!inTrench && (this.strength(tgt) < 0.35 || tgt.mstate !== 'steady')))) {
      if (!(busy && u.order.charge)) b.order(u, { type: 'attack', target: tgt, run: true, charge: true });
      return;
    }
    if (d <= u.maxRange * 0.95) {
      // hold and shoot (fire at will picks the target); keep explicit focus on the closest threat
      if (!busy || u.order.charge) b.order(u, { type: 'attack', target: tgt });
      this.idleT.set(u.id, 0);
      return;
    }
    // nothing in range for a while: advance carefully
    const it = (this.idleT.get(u.id) ?? 0) + 1;
    this.idleT.set(u.id, it);
    if (it > (u.faction === 'krieg' ? 40 : 16) && u.order.type === 'idle' && !inTrench) this.advance(u, tgt, 30, false);
  }

  private advance(u: Unit, tgt: Unit, step: number, run: boolean) {
    const c = this.centre(u), t = this.centre(tgt);
    const d = Math.hypot(t.x - c.x, t.z - c.z) || 1;
    const k = Math.min(step, d - 20) / d;
    if (k <= 0) return;
    if (u.order.type === 'move' && u.moving) return;
    this.b.order(u, { type: 'move', x: c.x + (t.x - c.x) * k, z: c.z + (t.z - c.z) * k, yaw: Math.atan2(t.x - c.x, t.z - c.z), run });
  }
}
