import { BattleMap, PLAY } from '../world/MapGen';
import { mulberry32 } from '../world/noise';
import { Nav } from './Nav';
import { WEAPONS, SOLDIERS, UNITS, ABILITIES, FACTIONS, type Scenario, type SoldierDef, type UnitTemplate, type WeaponDef, type FormationId, type FactionId, type AbilityId } from './data';
import { newAnim, play, type Anim, type ClipTable, type ClipMeta } from './anim';

// ============================================================================ types
export type SState = 'idle' | 'move' | 'melee' | 'hit' | 'dead';

export interface Soldier {
  id: number;
  unit: Unit;
  def: SoldierDef;
  side: number;
  x: number; z: number; y: number;
  vx: number; vz: number;
  yaw: number;
  hp: number; maxHp: number;
  alive: boolean;
  deadT: number;
  state: SState;
  slotX: number; slotZ: number;     // local formation offset
  jx: number; jz: number;           // mob jitter
  target: Soldier | null;
  losT: number; losOk: boolean;
  cool: number; burst: number; gapT: number; usingPistol: boolean;
  foe: Soldier | null;
  meleeT: number; strikeT: number; strikeFoe: Soldier | null;
  hitT: number;
  chargeT: number;                  // charge bonus remaining
  stuckT: number; pathClear: boolean; pathT: number;
  route: [number, number][]; routeI: number; routeTx: number; routeTz: number;
  coverX: number; coverZ: number; coverT: number; coverOk: boolean; coverSX: number; coverSZ: number;
  firingT: number;                  // recently fired (keeps aim pose)
  bursts: number;                   // bursts fired since the last reload
  turning: number;                  // how much the soldier is turning in place this tick
  anim: Anim;
  tint: number;
  crouch: boolean;
}

export interface Order { type: 'idle' | 'move' | 'attack' | 'halt'; x?: number; z?: number; yaw?: number; target?: Unit | null; run?: boolean; charge?: boolean; files?: number }

export type MoraleState = 'steady' | 'wavering' | 'routing' | 'shattered' | 'gone';

export interface Unit {
  id: number;
  side: number;
  tpl: UnitTemplate;
  faction: FactionId;
  name: string;
  soldiers: Soldier[];
  initial: number;
  leader: Soldier | null;
  formation: FormationId;
  /** soldiers per rank chosen by the player's drag (0 = automatic for the formation) */
  files: number;
  spacing: number;
  x: number; z: number; yaw: number;
  order: Order;
  path: [number, number][];
  pathI: number;
  repathT: number;
  run: boolean;
  fireAtWill: boolean;
  target: Unit | null;          // current engagement (ranged or melee)
  charging: boolean;
  morale: number;
  mstate: MoraleState;
  routs: number;
  routT: number;
  suppression: number;
  fatigue: number;
  inMelee: boolean;
  kills: number;
  losses: number;
  lossLog: number[];            // timestamps of recent losses
  killLog: number[];
  abilityCd: number;
  abilityT: number;
  buffs: { waaagh: number; aim: number };
  attackedRear: number;
  maxRange: number;
  meleeOnly: boolean;
  moving: boolean;
  selected: boolean;
  label: string;
}

export interface Shot { from: Soldier; target: Soldier; tx: number; ty: number; tz: number; t: number; hit: boolean; w: WeaponDef; pistol: boolean }

export type BattleEvent =
  | { type: 'shot'; s: Soldier; w: WeaponDef; pistol: boolean; tx: number; ty: number; tz: number; dur: number }
  | { type: 'impact'; x: number; y: number; z: number; w: WeaponDef; hit: boolean; target: Soldier | null }
  | { type: 'death'; s: Soldier }
  | { type: 'melee'; s: Soldier; foe: Soldier; hit: boolean }
  | { type: 'charge'; u: Unit; target: Unit }
  | { type: 'rout'; u: Unit }
  | { type: 'rally'; u: Unit }
  | { type: 'ability'; u: Unit; id: AbilityId }
  | { type: 'explosion'; x: number; y: number; z: number; r: number }
  | { type: 'order'; u: Unit; kind: string };

const SPATIAL = 3; // spatial hash cell (m)
/** Bursts per magazine before a reload animation. */
const MAG_BURSTS: Record<string, number> = { bolter: 6, heavy_bolter: 4, plasma: 5, lasgun: 10, heavy_stubber: 4, shoota: 5, slugga: 6, bolt_pistol: 7, laspistol: 10, kombi: 5 };
const reloadAt = new WeakMap<Soldier, number>();
/** soldiers lying on the ground after a knockdown (they play 'getup' when the fall finishes) */
const knocked = new WeakMap<Soldier, number>(); // value: battle time when the soldier hits the ground
/** soldiers whose current swing is a power attack (melee_c) */
const heavyStrike = new WeakSet<Soldier>();
/** reaction / one-shot clips that must finish before locomotion takes over again */
const REACTIONS = ['hit', 'stagger', 'block', 'knockdown', 'getup'];
function setReload(s: Soldier, delay: number) { reloadAt.set(s, delay); }
/** Global melee damage scale: Total War-style melee grinds on for tens of seconds instead of resolving instantly. */
export const MELEE_SCALE = 0.5;
/** Most enemies that can press one soldier at once, by body mass: a guardsman 2, an ork 3, a marine or nob 4, a warboss 6. */
export const meleeCap = (o: { def: { melee: { mass: number } } }) => { const m = o.def.melee.mass; return m >= 5 ? 6 : m >= 2.5 ? 4 : m >= 1.5 ? 3 : 2; };

// ============================================================================ battle
export class Battle {
  units: Unit[] = [];
  soldiers: Soldier[] = [];
  shots: Shot[] = [];
  events: BattleEvent[] = [];
  time = 0;
  rnd: () => number;
  nav: Nav;
  over = false;
  winner = -1;
  private hash = new Map<number, Soldier[]>();
  private nid = 1;
  private moraleT = 0;
  private routeBudget = 0;
  /** how many enemies are currently fighting each soldier (rebuilt every tick, bumped as foes are picked) */
  attackers = new Map<Soldier, number>();
  /** melee statistics for tests: engagements made, picks that skipped a crowded enemy, soldiers waiting for an opening */
  meleeStats = { picks: 0, spread: 0, waiting: 0 };

  constructor(public map: BattleMap, public scenario: Scenario, public clips: ClipTable, seed = 42, public scale = 1) {
    this.rnd = mulberry32(seed);
    this.nav = new Nav(map);
    let k = 0;
    const counts = new Map<string, number>();
    for (const [side, list] of [[0, scenario.side0], [1, scenario.side1]] as const) {
      for (const d of list) {
        const reps = scale > 1 ? Math.round(scale) : 1;
        for (let r = 0; r < reps; r++) {
          const off = r === 0 ? 0 : (r % 2 ? 1 : -1) * Math.ceil(r / 2) * 18;
          const tpl = UNITS[d.unit];
          const n = (counts.get(d.unit + side) ?? 0) + 1; counts.set(d.unit + side, n);
          this.spawnUnit(tpl, side, d.x + off, d.z + (r ? 14 : 0), d.yaw ?? (side === 0 ? (d.z > 0 ? Math.PI : 0) : (d.z < 0 ? 0 : Math.PI)), `${tpl.ko} ${n}`);
          k++;
        }
      }
    }
    void k;
  }

  clip(s: Soldier, name: string): ClipMeta {
    return this.clips[s.def.id]?.[name] ?? { dur: 1, loop: true, speed: 1, event: 0.5 };
  }

  spawnUnit(tpl: UnitTemplate, side: number, x: number, z: number, yaw: number, name: string) {
    const [px, pz] = this.nav.nearestWalkable(x, z);
    const u: Unit = {
      id: this.nid++, side, tpl, faction: tpl.faction, name, soldiers: [], initial: 0, leader: null,
      formation: tpl.formation, files: 0, spacing: tpl.spacing, x: px, z: pz, yaw,
      order: { type: 'idle' }, path: [], pathI: 0, repathT: 0, run: false, fireAtWill: true, target: null, charging: false,
      morale: tpl.morale, mstate: 'steady', routs: 0, routT: 0, suppression: 0, fatigue: 0, inMelee: false,
      kills: 0, losses: 0, lossLog: [], killLog: [], abilityCd: 0, abilityT: 0, buffs: { waaagh: 0, aim: 0 }, attackedRear: 0,
      maxRange: 0, meleeOnly: true, moving: false, selected: false, label: tpl.short,
    };
    const defs: SoldierDef[] = [];
    for (const [id, n] of tpl.members) for (let i = 0; i < n; i++) defs.push(SOLDIERS[id]);
    // order: leader first, then troopers, specials, heavies (heavies end up in the rear ranks)
    const rank = (d: SoldierDef) => ({ boss: 0, officer: 0, leader: 0, trooper: 1, special: 2, heavy: 3 }[d.role]);
    defs.sort((a, b) => rank(a) - rank(b));
    for (const d of defs) {
      const s: Soldier = {
        id: this.nid++, unit: u, def: d, side, x: px, z: pz, y: 0, vx: 0, vz: 0, yaw,
        hp: d.hp, maxHp: d.hp, alive: true, deadT: 0, state: 'idle', slotX: 0, slotZ: 0,
        jx: (this.rnd() - 0.5), jz: (this.rnd() - 0.5),
        target: null, losT: this.rnd(), losOk: false, cool: this.rnd() * 2, burst: 0, gapT: 0, usingPistol: false,
        foe: null, meleeT: 0, strikeT: -1, strikeFoe: null, hitT: 0, chargeT: 0, stuckT: 0, pathClear: true, pathT: this.rnd(),
        firingT: 0, anim: newAnim('idle', this.rnd() * 2), tint: 0.9 + this.rnd() * 0.2, crouch: false,
        route: [], routeI: 0, routeTx: 0, routeTz: 0, bursts: 0, turning: 0, coverX: 0, coverZ: 0, coverT: 0, coverOk: false, coverSX: 1e9, coverSZ: 1e9,
      };
      if (!u.leader && (d.role === 'leader' || d.role === 'officer' || d.role === 'boss')) u.leader = s;
      const w = d.weapon ? WEAPONS[d.weapon] : d.pistol ? WEAPONS[d.pistol] : null;
      if (d.weapon) { u.meleeOnly = false; u.maxRange = Math.max(u.maxRange, WEAPONS[d.weapon].range); }
      void w;
      u.soldiers.push(s);
      this.soldiers.push(s);
    }
    u.initial = u.soldiers.length;
    this.layout(u, true);
    for (const s of u.soldiers) {
      const [wx, wz] = this.slotWorld(u, s);
      const [ax, az] = this.nav.nearestWalkable(wx, wz);
      s.x = ax; s.z = az; s.y = this.map.heightAt(ax, az);
    }
    this.units.push(u);
    return u;
  }

  // ------------------------------------------------------------------ orders (player + AI)
  order(u: Unit, o: Order) {
    if (u.mstate === 'routing' || u.mstate === 'gone' || u.mstate === 'shattered') return;
    const L = u.leader;
    if (L && L.alive && !L.foe && o.type !== 'idle' && (u.order.type !== o.type || u.order.target !== o.target)) play(L.anim, 'command', 1.15, 0.15, true);
    u.order = o;
    u.charging = false;
    if (o.files !== undefined && o.files !== u.files) { u.files = o.files; this.layout(u, false); }
    if (o.type === 'move') {
      u.target = null;
      u.run = !!o.run;
      u.path = this.nav.path(u.x, u.z, o.x!, o.z!);
      u.pathI = 0;
      u.moving = true;
      for (const s of u.soldiers) if (s.state !== 'melee') s.foe = null;
      this.events.push({ type: 'order', u, kind: 'move' });
    } else if (o.type === 'attack' && o.target) {
      u.target = o.target;
      u.run = o.run ?? u.meleeOnly;
      u.path = []; u.pathI = 0; u.repathT = 0;
      u.moving = true;
      this.events.push({ type: 'order', u, kind: o.charge || u.meleeOnly ? 'charge' : 'attack' });
    } else if (o.type === 'halt') {
      u.target = null; u.path = []; u.moving = false; u.run = false;
      u.order = { type: 'idle' };
      this.events.push({ type: 'order', u, kind: 'halt' });
    }
  }

  /** Attackers that can reach a soldier at once; a man down in a trench can only be hit from the parapet in front. */
  capFor(o: Soldier) { const c = meleeCap(o); return this.map.inTrench(o.x, o.z) ? Math.max(1, c - 1) : c; }

  setFormation(u: Unit, f: FormationId) { u.formation = f; this.layout(u, false); }

  /** Soldiers per rank the formation would use on its own (no player-dragged frontage). */
  autoFiles(u: Unit) {
    const n = Math.max(1, u.soldiers.filter((s) => s.alive && s !== u.leader).length);
    const ranks = u.formation === 'column' ? Math.ceil(n / Math.min(5, n)) : u.formation === 'defensive' ? Math.max(1, Math.round(Math.sqrt(n) * 0.8)) : n <= 12 ? 2 : n <= 30 ? 3 : 4;
    return Math.max(1, Math.ceil(n / ranks));
  }

  /** Lateral spacing between files for the unit's current formation. */
  fileSpacing(u: Unit) { return u.spacing * (u.formation === 'loose' ? 1.9 : u.formation === 'defensive' ? 0.85 : 1); }

  /** Deployment: put a unit straight onto a spot (no marching), soldiers snapped into their slots. */
  place(u: Unit, x: number, z: number, yaw: number, files?: number) {
    const [px, pz] = this.nav.nearestWalkable(x, z);
    u.x = px; u.z = pz; u.yaw = yaw;
    if (files !== undefined) u.files = files;
    u.order = { type: 'idle' }; u.path = []; u.pathI = 0; u.moving = false; u.target = null; u.charging = false;
    this.layout(u, false);
    for (const s of u.soldiers) {
      if (!s.alive) continue;
      const [wx, wz] = this.slotWorld(u, s);
      const [ax, az] = this.nav.nearestWalkable(wx, wz);
      s.x = ax; s.z = az; s.y = this.map.heightAt(ax, az); s.yaw = yaw; s.vx = 0; s.vz = 0;
      s.route = []; s.routeI = 0; s.coverOk = false; s.coverSX = 1e9; s.coverSZ = 1e9; s.state = 'idle';
    }
  }

  useAbility(u: Unit): boolean {
    const id = u.tpl.ability;
    if (!id || u.abilityCd > 0 || u.mstate === 'routing') return false;
    const a = ABILITIES[id];
    u.abilityCd = a.cd; u.abilityT = a.dur;
    if (id === 'waaagh' || id === 'take_aim') {
      const R = id === 'waaagh' ? 70 : 45;
      for (const v of this.units) if (v.side === u.side && Math.hypot(v.x - u.x, v.z - u.z) < R) {
        if (id === 'waaagh') v.buffs.waaagh = a.dur; else v.buffs.aim = a.dur;
        v.morale = Math.min(100, v.morale + (id === 'waaagh' ? 30 : 15));
      }
    }
    if (u.leader?.alive) play(u.leader.anim, 'command', 1, 0.15, true);
    this.events.push({ type: 'ability', u, id });
    return true;
  }

  // ------------------------------------------------------------------ formation
  layout(u: Unit, _init: boolean) {
    const alive = u.soldiers.filter((s) => s.alive);
    const N = alive.length;
    if (!N) return;
    let sp = u.spacing;
    let ranks: number;
    if (u.formation === 'column') ranks = Math.ceil(N / Math.min(5, N));
    else if (u.formation === 'defensive') ranks = Math.max(1, Math.round(Math.sqrt(N) * 0.8));
    else ranks = N <= 12 ? 2 : N <= 30 ? 3 : 4;
    if (u.formation === 'loose') sp *= 1.9;
    if (u.formation === 'defensive') sp *= 0.85;
    const leader = u.leader && u.leader.alive ? u.leader : null;
    const rest = alive.filter((s) => s !== leader);
    const files = u.files > 0 && u.formation !== 'column' ? Math.min(u.files, Math.max(1, rest.length)) : Math.max(1, Math.ceil(rest.length / ranks));
    rest.forEach((s, i) => {
      const r = Math.floor(i / files), c = i % files;
      const inRow = Math.min(files, rest.length - r * files);
      s.slotX = (c - (inRow - 1) / 2) * sp;
      s.slotZ = -r * sp * 1.15;
      if (u.faction === 'orks') { s.slotX += s.jx * sp * 0.8; s.slotZ += s.jz * sp * 0.9; }
    });
    if (leader) { leader.slotX = 0; leader.slotZ = sp * 1.1; }
  }

  slotWorld(u: Unit, s: Soldier): [number, number] {
    const c = Math.cos(u.yaw), sn = Math.sin(u.yaw);
    // forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw)
    return [u.x + sn * s.slotZ - c * s.slotX, u.z + c * s.slotZ + sn * s.slotX];
  }

  // ------------------------------------------------------------------ main update (fixed step)
  update(dt: number) {
    if (this.over) { this.updateSoldiersDead(dt); return; }
    this.time += dt;
    this.rebuildHash();
    this.attackers.clear();
    for (const o of this.soldiers) if (o.alive && o.foe && o.foe.alive) this.attackers.set(o.foe, (this.attackers.get(o.foe) ?? 0) + 1);
    this.routeBudget = 14;
    for (const u of this.units) this.updateUnit(u, dt);
    for (const s of this.soldiers) this.updateSoldier(s, dt);
    this.updateShots();
    this.moraleT -= dt;
    if (this.moraleT <= 0) { this.moraleT = 0.5; for (const u of this.units) this.updateMorale(u, 0.5); this.checkVictory(); }
  }

  private updateSoldiersDead(dt: number) { for (const s of this.soldiers) if (!s.alive) s.deadT += dt; }

  private rebuildHash() {
    this.hash.clear();
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      const k = Math.floor((s.x + 300) / SPATIAL) * 1000 + Math.floor((s.z + 300) / SPATIAL);
      const b = this.hash.get(k);
      if (b) b.push(s); else this.hash.set(k, [s]);
    }
  }

  near(x: number, z: number, r: number, fn: (s: Soldier) => void) {
    const x0 = Math.floor((x - r + 300) / SPATIAL), x1 = Math.floor((x + r + 300) / SPATIAL);
    const z0 = Math.floor((z - r + 300) / SPATIAL), z1 = Math.floor((z + r + 300) / SPATIAL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const b = this.hash.get(i * 1000 + j);
      if (b) for (const s of b) fn(s);
    }
  }

  alive(u: Unit) { return u.soldiers.filter((s) => s.alive); }
  active(u: Unit) { return u.mstate !== 'gone' && u.soldiers.some((s) => s.alive); }

  private centre(u: Unit): [number, number] {
    let x = 0, z = 0, n = 0;
    for (const s of u.soldiers) if (s.alive) { x += s.x; z += s.z; n++; }
    return n ? [x / n, z / n] : [u.x, u.z];
  }

  moveSpeed(u: Unit, s: Soldier | null, mode: 'walk' | 'run' | 'charge') {
    const d = s ? s.def : u.soldiers[0].def;
    let v = mode === 'walk' ? d.walk : mode === 'run' ? d.run : d.charge;
    v *= 1 - Math.max(0, u.fatigue - 0.5) * 0.5;
    v *= 1 - u.suppression * 0.35;
    if (u.buffs.waaagh > 0 && mode !== 'walk') v *= 1.25;
    if (u.abilityT > 0 && u.tpl.ability === 'bayonet' && mode === 'charge') v *= 1.2;
    return v;
  }

  // ------------------------------------------------------------------ units
  private updateUnit(u: Unit, dt: number) {
    const alive = u.soldiers.filter((s) => s.alive);
    if (!alive.length) { if (u.mstate !== 'gone') u.mstate = 'gone'; return; }
    if (u.mstate === 'gone') return;
    u.abilityCd = Math.max(0, u.abilityCd - dt);
    u.abilityT = Math.max(0, u.abilityT - dt);
    u.buffs.waaagh = Math.max(0, u.buffs.waaagh - dt);
    u.buffs.aim = Math.max(0, u.buffs.aim - dt);
    u.suppression = Math.max(0, u.suppression - dt * (u.inMelee ? 0.3 : 0.1));
    u.inMelee = alive.some((s) => s.state === 'melee' || s.foe);
    const running = u.run || u.charging || u.mstate === 'routing';
    u.fatigue = Math.min(1, Math.max(0, u.fatigue + dt * (u.inMelee ? 0.018 : u.moving ? (running ? 0.012 : -0.004) : -0.022)));
    if (alive.length !== u.soldiers.filter((s) => s.alive).length) this.layout(u, false);

    // --- routing: run for the own map edge, leave the field there
    if (u.mstate === 'routing') {
      const edgeZ = u.side === 0 ? (this.scenario.side0[0].z > 0 ? PLAY : -PLAY) : (this.scenario.side1[0].z > 0 ? PLAY : -PLAY);
      if (!u.path.length || u.repathT <= 0) { u.path = this.nav.path(u.x, u.z, u.x * 0.6, edgeZ * 0.98); u.pathI = 0; u.repathT = 4; }
      u.repathT -= dt;
      u.run = true; u.moving = true; u.target = null; u.charging = false;
      this.advanceAnchor(u, dt, this.moveSpeed(u, null, 'run'));
      if (Math.abs(u.z) > PLAY - 6) {
        u.mstate = 'gone';
        for (const s of alive) { s.alive = false; s.state = 'dead'; s.hp = 0; s.deadT = 99; (s as Soldier & { fled?: boolean }).fled = true; }
      }
      return;
    }

    // --- target validity
    if (u.target && (!this.active(u.target) || u.target.mstate === 'routing' && !u.charging && u.order.type !== 'attack')) u.target = null;
    if (u.target && u.target.mstate === 'gone') u.target = null;
    if (u.order.type === 'attack' && (!u.order.target || !this.active(u.order.target) || u.order.target.mstate === 'gone')) { u.order = { type: 'idle' }; u.target = null; u.moving = false; u.charging = false; }

    // --- auto engagement when idle (fire at will / defend)
    if (u.order.type === 'idle' && !u.inMelee) {
      const near = this.nearestEnemyUnit(u);
      if (near) {
        const [d] = near;
        if (!u.meleeOnly && u.fireAtWill && d < u.maxRange * 0.98) u.target = near[1];
        else if (u.meleeOnly && d < 18) u.target = near[1];
        else if (!u.target || !this.active(u.target)) u.target = null;
      }
    }

    // --- movement planning
    const [cx, cz] = this.centre(u);
    if (u.inMelee) {
      u.moving = false; u.path = [];
      // drift the anchor toward the fight so idle soldiers close in
      u.x += (cx - u.x) * dt * 0.5; u.z += (cz - u.z) * dt * 0.5;
      if (u.target) u.yaw = turn(u.yaw, Math.atan2(u.target.x - u.x, u.target.z - u.z), dt * 0.8);
      return;
    }
    if (u.order.type === 'move') {
      const sp = this.moveSpeed(u, null, u.run ? 'run' : 'walk');
      const arrived = this.advanceAnchor(u, dt, sp);
      if (arrived) {
        u.moving = false; u.run = false;
        if (u.order.yaw !== undefined) u.yaw = turn(u.yaw, u.order.yaw, dt * 1.5);
        if (u.order.yaw === undefined || Math.abs(angDiff(u.yaw, u.order.yaw)) < 0.05) u.order = { type: 'idle' };
      }
      return;
    }
    if (u.order.type === 'attack' && u.order.target) {
      const t = u.order.target;
      const [tx, tz] = this.centre(t);
      const d = Math.hypot(tx - cx, tz - cz);
      const melee = u.meleeOnly || u.order.charge;
      if (melee) {
        u.repathT -= dt;
        if (u.repathT <= 0 || !u.path.length) { u.path = this.nav.path(u.x, u.z, tx, tz); u.pathI = 0; u.repathT = 1.2; }
        if (d < 32 && !u.charging) { u.charging = true; this.events.push({ type: 'charge', u, target: t }); for (const s of alive) s.chargeT = 6; }
        const sp = this.moveSpeed(u, null, u.charging ? 'charge' : 'run');
        this.advanceAnchor(u, dt, sp);
        u.target = t;
      } else {
        u.target = t;
        const want = u.maxRange * 0.82;
        const visible = alive.slice(0, 6).some((s) => this.map.los(s.x, s.z, tx, tz));
        if (d > u.maxRange * 0.95 || !visible) {
          u.repathT -= dt;
          if (u.repathT <= 0 || !u.path.length) {
            const k = visible ? Math.max(0, d - want) / Math.max(d, 1) : 0.92;
            u.path = this.nav.path(u.x, u.z, cx + (tx - cx) * k, cz + (tz - cz) * k); u.pathI = 0; u.repathT = 2.5;
          }
          this.advanceAnchor(u, dt, this.moveSpeed(u, null, u.run ? 'run' : 'walk'));
        } else {
          u.moving = false; u.path = []; u.run = false;
          u.yaw = turn(u.yaw, Math.atan2(tx - u.x, tz - u.z), dt * 0.9);
        }
      }
      return;
    }
    // idle: face current target
    u.moving = false;
    if (u.target) {
      const [tx, tz] = this.centre(u.target);
      u.yaw = turn(u.yaw, Math.atan2(tx - u.x, tz - u.z), dt * 0.7);
      if (u.meleeOnly && Math.hypot(tx - u.x, tz - u.z) < 18) { u.order = { type: 'attack', target: u.target, run: true }; }
    }
  }

  /** Move the formation anchor along its path. Returns true when the end is reached. */
  private advanceAnchor(u: Unit, dt: number, speed: number) {
    if (u.pathI >= u.path.length) return true;
    const [px, pz] = u.path[u.pathI];
    const dx = px - u.x, dz = pz - u.z;
    const d = Math.hypot(dx, dz);
    // wait for stragglers so the formation stays together
    let lag = 0, n = 0;
    for (const s of u.soldiers) if (s.alive && s.state !== 'melee') { const [wx, wz] = this.slotWorld(u, s); lag += Math.hypot(wx - s.x, wz - s.z); n++; }
    lag = n ? lag / n : 0;
    const k = lag > 6 ? 0.25 : lag > 3.5 ? 0.6 : 1;
    const step = Math.min(d, speed * k * dt);
    if (d > 0.01) {
      u.x += dx / d * step; u.z += dz / d * step;
      const wantYaw = Math.atan2(dx, dz);
      u.yaw = turn(u.yaw, wantYaw, dt * (u.charging ? 2.5 : 1.1));
    }
    if (d < 1.0) { u.pathI++; if (u.pathI >= u.path.length) return true; }
    return false;
  }

  nearestEnemyUnit(u: Unit): [number, Unit] | null {
    let best: Unit | null = null, bd = 1e9;
    for (const v of this.units) {
      if (v.side === u.side || !this.active(v) || v.mstate === 'gone') continue;
      const [vx, vz] = this.centre(v);
      let d = Math.hypot(vx - u.x, vz - u.z);
      if (v.mstate === 'routing') d += 40;
      if (d < bd) { bd = d; best = v; }
    }
    return best ? [bd, best] : null;
  }

  // ------------------------------------------------------------------ soldiers
  private updateSoldier(s: Soldier, dt: number) {
    if (!s.alive) { s.deadT += dt; return; }
    const u = s.unit;
    s.hitT = Math.max(0, s.hitT - dt);
    s.chargeT = Math.max(0, s.chargeT - dt);
    s.firingT = Math.max(0, s.firingT - dt);
    s.cool -= dt;
    s.losT -= dt;
    const rl = reloadAt.get(s);
    if (rl !== undefined) {
      const left = rl - dt;
      if (left <= 0) { reloadAt.delete(s); if (!s.foe && s.hitT <= 0) play(s.anim, 'reload', 1, 0.12, true); } else reloadAt.set(s, left);
    }
    s.pathT -= dt;

    // simulation clock, not the animation clock: headless battles never advance animations
    if (knocked.has(s) && this.time >= knocked.get(s)!) {
      knocked.delete(s);
      play(s.anim, 'getup', 1, 0.05, true);
    }
    if (knocked.has(s) || (s.hitT > 0 && s.anim.clip === 'getup')) { s.vx = 0; s.vz = 0; s.foe = null; return; }

    // ---------- melee
    if (s.foe && (!s.foe.alive || dist(s, s.foe) > s.def.melee.reach + 1.4)) s.foe = null;
    if (!s.foe && u.mstate !== 'routing') {
      const engage = u.inMelee || u.charging || u.meleeOnly || u.order.type === 'attack';
      const R = s.def.melee.reach + (engage ? 0.9 : 0.4);
      let best: Soldier | null = null, bd = 1e9, nearest: Soldier | null = null, nd = R;
      this.near(s.x, s.z, R, (o) => {
        if (o.side === s.side || !o.alive) return;
        const d = dist(s, o);
        if (d < nd) { nd = d; nearest = o; }
        const crowd = this.attackers.get(o) ?? 0;
        if (crowd >= this.capFor(o)) return;
        const score = d + crowd * 0.35;
        if (score < bd) { bd = score; best = o; }
      });
      if (!best && nearest && (this.attackers.get(nearest) ?? 0) < this.capFor(nearest) + 1 && (nearest as Soldier).foe === s) best = nearest; // always answer whoever is hitting you
      if (best) {
        this.meleeStats.picks++;
        if (nearest && best !== nearest) this.meleeStats.spread++;
        s.foe = best;
        const o = best as Soldier;
        this.attackers.set(o, (this.attackers.get(o) ?? 0) + 1);
        // first blows are staggered so a whole rank never swings in lockstep
        s.meleeT = Math.max(s.meleeT, this.rnd() * 0.7);
        if (s.chargeT > 0 && u.charging) this.chargeImpact(s, o);
        if (!o.foe) o.foe = s;
        const ang = Math.abs(angDiff(o.unit.yaw, Math.atan2(s.x - o.x, s.z - o.z)));
        if (ang > 2.2) o.unit.attackedRear = 3;
      }
    }
    if (s.strikeT >= 0) {
      s.strikeT -= dt;
      if (s.strikeT < 0) this.resolveStrike(s);
    }
    if (s.foe) {
      s.state = 'melee';
      const f = s.foe;
      const d = dist(s, f);
      s.yaw = turn(s.yaw, Math.atan2(f.x - s.x, f.z - s.z), dt * 7);
      // keep at striking distance
      const want = s.def.melee.reach * 0.75;
      const k = (d - want) * 2.5;
      this.moveToward(s, s.x + (f.x - s.x) / Math.max(d, 0.01) * k * 0.5, s.z + (f.z - s.z) / Math.max(d, 0.01) * k * 0.5, Math.min(2.5, Math.abs(k)), dt, true);
      s.meleeT -= dt;
      if (s.meleeT <= 0 && s.hitT <= 0 && s.strikeT < 0) {
        const heavyChance = s.def.role === 'boss' || s.def.role === 'leader' || s.def.role === 'officer' ? 0.3 : s.def.melee.mass >= 2.5 ? 0.12 : 0.04;
        const power = this.rnd() < heavyChance;
        const clip = power ? 'melee_c' : this.rnd() < 0.5 ? 'melee_a' : 'melee_b';
        if (power) heavyStrike.add(s); else heavyStrike.delete(s);
        const m = this.clip(s, clip);
        play(s.anim, clip, 1.0, 0.1, true);
        s.strikeT = m.dur * m.event;
        s.strikeFoe = f;
        s.meleeT = (1 / s.def.melee.rate) * (0.85 + this.rnd() * 0.3);
      }
      if (s.strikeT < 0 && s.hitT <= 0 && s.anim.t > this.clip(s, s.anim.clip).dur * 0.95 && !s.anim.clip.startsWith('melee')) play(s.anim, 'aim', 1, 0.2);
      if (s.strikeT < 0 && (s.anim.clip.startsWith('melee') || s.anim.clip === 'block') && s.anim.t >= this.clip(s, s.anim.clip).dur) play(s.anim, 'aim', 1, 0.2);
      return;
    }
    if (s.state === 'melee') s.state = 'idle';

    // ---------- movement target
    let tx: number, tz: number, mode: 'walk' | 'run' | 'charge' = u.run ? 'run' : 'walk';
    if (u.mstate === 'routing') mode = 'run';
    let seek: Soldier | null = null;
    let waitSpot = false;
    tx = 0; tz = 0;
    // defenders holding a trench do not climb out to chase: they gang up on enemies that reach the line and keep shooting
    const holdTrench = !u.charging && !u.order.charge && !u.meleeOnly && this.map.inTrench(s.x, s.z);
    if ((u.charging || u.inMelee || (u.meleeOnly && u.target && u.order.type === 'attack')) && u.target) {
      // fight: go for the nearest enemy of the target unit (or anyone close)
      let bd = holdTrench ? 4.5 : u.charging ? 40 : 18, crowdedSeek: Soldier | null = null, cd = bd;
      const consider = (o: Soldier) => {
        if (!o.alive) return;
        const d = dist(s, o), crowd = this.attackers.get(o) ?? 0;
        if (crowd >= this.capFor(o)) { if (d < cd) { cd = d; crowdedSeek = o; } return; }
        const score = d + crowd * 0.6;
        if (score < bd) { bd = score; seek = o; }
      };
      for (const o of u.target.soldiers) consider(o);
      if (!seek) this.near(s.x, s.z, holdTrench ? 4.5 : 10, (o) => { if (o.side !== s.side) consider(o); });
      if (!seek && crowdedSeek && !holdTrench) {
        // every reachable enemy is already swarmed: hold a step outside the scrum and wait for an opening
        const o = crowdedSeek as Soldier, d = Math.max(dist(s, o), 0.01), hold = o.def.melee ? s.def.melee.reach + 1.6 : 2.5;
        tx = o.x + (s.x - o.x) / d * hold; tz = o.z + (s.z - o.z) / d * hold;
        mode = 'walk'; this.meleeStats.waiting++;
        seek = null;
        waitSpot = true;
      }
    }
    if (seek) {
      const o = seek as Soldier, crowd = this.attackers.get(o) ?? 0;
      tx = o.x; tz = o.z;
      if (crowd > 0) {
        // later arrivals swing out to the sides instead of queueing behind the first attacker (rear attacks come from unit manoeuvre, not from individuals wrapping round)
        const base = Math.atan2(s.x - o.x, s.z - o.z), side = (s.id & 1) ? 1 : -1;
        const a = base + side * Math.min(1.2, 0.6 * crowd), r = s.def.melee.reach * 0.9;
        tx = o.x + Math.sin(a) * r; tz = o.z + Math.cos(a) * r;
      }
      mode = u.charging ? 'charge' : 'run';
    } else if (waitSpot) {
      // keep tx / tz from the waiting spot
    } else {
      [tx, tz] = this.slotWorld(u, s);
      // halted units take cover: trench cells, sandbags, walls, craters near the formation slot
      const holding = !u.moving && !u.charging && u.mstate !== 'routing' && (u.order.type === 'idle' || u.order.type === 'attack');
      if (holding) {
        s.coverT -= dt;
        // commit to a cover spot; only look again when the formation slot itself moved
        if (Math.hypot(s.coverSX - tx, s.coverSZ - tz) > 2.5 || (s.coverT <= 0 && !s.coverOk)) { s.coverT = 3 + this.rnd() * 2; s.coverSX = tx; s.coverSZ = tz; this.findCover(s, tx, tz); }
        if (s.coverOk) { tx = s.coverX; tz = s.coverZ; }
      } else s.coverOk = false;
      const slotD = Math.hypot(tx - s.x, tz - s.z);
      if (!u.moving && slotD > 4) mode = 'run';
    }
    // walk around obstacles: personal A* route when the straight line is blocked
    if (s.pathT <= 0) { s.pathT = 0.5 + this.rnd() * 0.3; s.pathClear = this.nav.clear(s.x, s.z, tx, tz); }
    if (!s.pathClear) {
      const stale = !s.route.length || Math.hypot(s.routeTx - tx, s.routeTz - tz) > 4 || s.routeI >= s.route.length;
      if (stale && this.routeBudget > 0) { this.routeBudget--; s.route = this.nav.path(s.x, s.z, tx, tz); s.routeI = 0; s.routeTx = tx; s.routeTz = tz; }
      if (s.route.length && s.routeI < s.route.length) {
        const [rx, rz] = s.route[s.routeI];
        if (Math.hypot(rx - s.x, rz - s.z) < 1.2 && s.routeI < s.route.length - 1) s.routeI++;
        tx = s.route[s.routeI][0]; tz = s.route[s.routeI][1];
      }
    } else if (s.route.length) s.route = [];
    const sp = s.hitT > 0 ? 0 : this.moveSpeed(u, s, mode);
    this.moveToward(s, tx, tz, sp, dt, false);
    const moving = Math.hypot(s.vx, s.vz) > 0.9;

    // ---------- ranged combat
    let fired = false;
    if (u.target && u.mstate !== 'routing' && s.hitT <= 0) fired = this.updateFire(s, u, dt, moving);

    // ---------- facing
    const spd = Math.hypot(s.vx, s.vz);
    const yaw0 = s.yaw;
    if (s.target && (fired || s.firingT > 0 || spd < 1.6)) s.yaw = turn(s.yaw, Math.atan2(s.target.x - s.x, s.target.z - s.z), dt * 6);
    else if (spd > 0.4) s.yaw = turn(s.yaw, Math.atan2(s.vx, s.vz), dt * 6);
    else s.yaw = turn(s.yaw, u.yaw, dt * 3);
    s.turning = s.turning * 0.8 + Math.abs(angDiff(yaw0, s.yaw)) / Math.max(dt, 1e-3) * 0.2;
    s.state = spd > 0.35 ? 'move' : 'idle';
    this.pickAnim(s, spd, mode);
  }

  /** Best cover point within ~4 m of the slot (cells already taken by friends are avoided). */
  private findCover(s: Soldier, sx: number, sz: number) {
    const map = this.map;
    let best = map.coverAt(sx, sz) + 0.05, bx = sx, bz = sz;
    for (let dz = -4; dz <= 4; dz += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const x = sx + dx, z = sz + dz;
      if (map.isBlocked(x, z)) continue;
      let c = map.coverAt(x, z) + (map.inTrench(x, z) ? 0.25 : 0) - Math.hypot(dx, dz) * 0.04;
      if (c <= best) continue;
      let crowded = false;
      this.near(x, z, 0.8, (o) => { if (o !== s && o.side === s.side && o.alive) crowded = true; });
      if (crowded) continue;
      best = c; bx = x; bz = z;
    }
    s.coverOk = best > 0.3 && (bx !== sx || bz !== sz);
    s.coverX = bx; s.coverZ = bz;
  }

  /** Steer toward a point with separation and wall sliding. Returns true if moving. */
  private moveToward(s: Soldier, tx: number, tz: number, maxSpeed: number, dt: number, melee: boolean) {
    const dx = tx - s.x, dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    let vx = 0, vz = 0;
    if (d > 0.15 && maxSpeed > 0) {
      const sp = Math.min(maxSpeed, d * 2.2 + 0.2);
      vx = dx / d * sp; vz = dz / d * sp;
    }
    // separation (keeps figures from overlapping)
    const R = Math.max(0.85, s.def.scale * 0.85) * (s.def.role === 'boss' ? 1.5 : 1);
    let px = 0, pz = 0;
    this.near(s.x, s.z, R + 0.6, (o) => {
      if (o === s || !o.alive) return;
      const ox = s.x - o.x, oz = s.z - o.z;
      const od = Math.hypot(ox, oz);
      const rr = R * 0.5 + Math.max(0.85, o.def.scale * 0.85) * (o.def.role === 'boss' ? 1.5 : 1) * 0.5 + 0.1;
      if (od < rr && od > 1e-4) { const k = (rr - od) / rr; px += ox / od * k; pz += oz / od * k; }
      else if (od <= 1e-4) { px += this.rnd() - 0.5; pz += this.rnd() - 0.5; }
    });
    vx += px * (melee ? 3 : 2.6); vz += pz * (melee ? 3 : 2.6);
    const lim = Math.max(maxSpeed, 1.2) * 1.15;
    const L = Math.hypot(vx, vz);
    if (L > lim) { vx = vx / L * lim; vz = vz / L * lim; }
    const a = Math.min(1, dt * 7);
    s.vx += (vx - s.vx) * a; s.vz += (vz - s.vz) * a;
    let nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
    const r = 0.3 * s.def.scale * (s.def.role === 'boss' ? 1.5 : 1);
    const bad = (x: number, z: number) => this.map.isBlocked(x, z) || this.map.isSolid(x, z, r);
    if (bad(nx, nz)) {
      if (!bad(nx, s.z)) nz = s.z;
      else if (!bad(s.x, nz)) nx = s.x;
      else if (bad(s.x, s.z)) {
        // already overlapping (pushed in by the crowd): step out along the shortest way
        for (const [ox, oz] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) if (!bad(s.x + ox, s.z + oz)) { nx = s.x + ox; nz = s.z + oz; break; }
      } else { nx = s.x; nz = s.z; s.vx *= 0.2; s.vz *= 0.2; }
    }
    s.x = nx; s.z = nz;
    s.y = this.map.heightAt(s.x, s.z);
    return Math.hypot(s.vx, s.vz) > 0.35;
  }

  private updateFire(s: Soldier, u: Unit, dt: number, moving: boolean): boolean {
    const t = u.target!;
    const main = s.def.weapon ? WEAPONS[s.def.weapon] : null;
    const pistol = s.def.pistol ? WEAPONS[s.def.pistol] : null;
    if (!main && !pistol) return false;
    // soldiers locked in melee fight instead of shooting; the rest of a melee-locked unit only keeps firing from a trench line
    if (s.foe || u.charging) return false;
    const trenchLine = u.inMelee && !u.order.charge && this.map.inTrench(s.x, s.z);
    if (u.inMelee && !trenchLine) return false;
    // pick / refresh a target soldier with line of sight
    if (!s.target || !s.target.alive || s.target.unit !== t || s.losT <= 0) {
      s.losT = 0.8 + this.rnd() * 0.6;
      let best: Soldier | null = null, bd = 1e9;
      for (const o of t.soldiers) {
        if (!o.alive) continue;
        let d = dist(s, o);
        if (o.foe) { if (trenchLine) continue; d += 25; } // avoid shooting into melee (never from a trench line into the scrum)
        if (d < bd) { bd = d; best = o; }
      }
      s.target = best;
      s.losOk = best ? this.map.los(s.x, s.z, best.x, best.z) : false;
    }
    const o = s.target;
    if (!o || !s.losOk) return false;
    const d = dist(s, o);
    let w = main && d <= main.range ? main : pistol && d <= pistol.range ? pistol : null;
    if (!w) return false;
    if (moving && (!w.moveFire || u.run || u.charging)) return false;
    if (u.charging && w === pistol && d > 14) return false;
    // facing check
    const want = Math.atan2(o.x - s.x, o.z - s.z);
    if (Math.abs(angDiff(s.yaw, want)) > 0.5) return false;
    if (s.burst > 0) {
      s.gapT -= dt;
      if (s.gapT <= 0) { this.fireShot(s, o, w, w === pistol && w !== main, moving); s.burst--; s.gapT = w.gap; }
      return true;
    }
    if (s.cool > 0) return false;
    let rof = 1;
    if (u.abilityT > 0 && u.tpl.ability === 'bolter_drill') rof = 1.6;
    if (u.abilityT > 0 && u.tpl.ability === 'volley' && !u.moving) rof = 2.0;
    s.cool = w.cycle * (0.85 + this.rnd() * 0.3) / rof;
    s.burst = w.burst - 1; s.gapT = w.gap;
    s.bursts++;
    if (s.bursts >= (MAG_BURSTS[w.id] ?? 6)) {
      // reload once this burst is out: play the clip and hold fire for its length
      s.bursts = 0;
      const rc = this.clip(s, 'reload');
      s.cool = Math.max(s.cool, rc.dur + w.burst * w.gap);
      setReload(s, w.burst * w.gap + 0.15);
    }
    this.fireShot(s, o, w, w === pistol && w !== main, moving);
    return true;
  }

  private fireShot(s: Soldier, o: Soldier, w: WeaponDef, pistol: boolean, moving: boolean) {
    const u = s.unit;
    const d = dist(s, o);
    let acc = w.acc * (1 - w.falloff * Math.pow(Math.min(1, d / w.range), 1.4));
    acc *= 1 - u.suppression * 0.5;
    if (moving) acc *= 0.6;
    if (u.fatigue > 0.7) acc *= 0.85;
    if (u.abilityT > 0 && u.tpl.ability === 'bolter_drill') acc += 0.1;
    if (u.buffs.aim > 0) acc += 0.15;
    if (u.mstate === 'wavering') acc *= 0.8;
    acc *= 1 - this.map.coverAt(o.x, o.z) * 0.62;
    if (o.crouch) acc *= 0.85;
    if (o.def.role === 'boss') acc *= 1.3;
    const hit = this.rnd() < acc;
    let tx = o.x, tz = o.z, ty = o.y + 1.0 * o.def.scale;
    if (!hit) { const a = this.rnd() * Math.PI * 2, r = 0.6 + this.rnd() * 2.2; tx += Math.cos(a) * r; tz += Math.sin(a) * r; ty = this.map.heightAt(tx, tz) + this.rnd() * 0.6; }
    const dur = d / w.speed;
    this.shots.push({ from: s, target: o, tx, ty, tz, t: this.time + dur, hit, w, pistol });
    this.events.push({ type: 'shot', s, w, pistol, tx, ty, tz, dur });
    s.firingT = 1.2;
    const clip = s.crouch ? 'cover_fire' : 'fire';
    if (!s.anim.clip.startsWith('melee') && s.hitT <= 0 && !(moving)) play(s.anim, clip, 1, 0.05, true);
  }

  private updateShots() {
    const now = this.time;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      if (sh.t > now) continue;
      this.shots.splice(i, 1);
      const o = sh.target;
      const tu = o.unit;
      const resist = tu.tpl.fearless ? 0.4 : tu.faction === 'krieg' ? 0.7 : tu.faction === 'orks' ? 0.45 : 1;
      tu.suppression = Math.min(1, tu.suppression + sh.w.suppress * (sh.hit ? 1.5 : 1) * resist);
      if (sh.w.splash) {
        this.events.push({ type: 'explosion', x: sh.tx, y: sh.ty, z: sh.tz, r: sh.w.splash });
        this.near(sh.tx, sh.tz, sh.w.splash, (v) => {
          if (v.side === sh.from.side || !v.alive || v === o) return;
          if (Math.hypot(v.x - sh.tx, v.z - sh.tz) < sh.w.splash!) this.damage(v, sh.w.dmg * 0.5, sh.w.ap, sh.from);
        });
      }
      this.events.push({ type: 'impact', x: sh.tx, y: sh.ty, z: sh.tz, w: sh.w, hit: sh.hit && o.alive, target: sh.hit ? o : null });
      if (sh.hit && o.alive) this.damage(o, sh.w.dmg * (0.85 + this.rnd() * 0.3), sh.w.ap, sh.from);
    }
  }

  damage(o: Soldier, dmg: number, ap: number, by: Soldier | null) {
    if (!o.alive) return;
    const save = Math.max(0, Math.min(0.95, o.def.armor - ap));
    o.hp -= dmg * (1 - save);
    if (o.hp <= 0) this.kill(o, by);
    else if (dmg * (1 - save) > o.maxHp * 0.35 && o.hitT <= 0 && !knocked.has(o)) {
      o.hitT = 0.75;
      play(o.anim, 'stagger', 1, 0.06, true);
    } else if (dmg * (1 - save) > o.maxHp * 0.18 && o.hitT <= 0 && !knocked.has(o) && this.rnd() < 0.6) {
      o.hitT = 0.45;
      if (!o.anim.clip.startsWith('death')) play(o.anim, 'hit', 1, 0.08, true);
    }
  }

  private kill(o: Soldier, by: Soldier | null) {
    o.alive = false; o.hp = 0; o.state = 'dead'; o.deadT = 0; o.foe = null; o.target = null;
    o.vx = o.vz = 0;
    let death = this.rnd() < 0.5 ? 'death_a' : 'death_b';
    if (by) {
      const ang = Math.abs(angDiff(o.yaw, Math.atan2(by.x - o.x, by.z - o.z)));
      death = ang < 0.9 ? 'death_a' : ang > 2.2 ? 'death_b' : 'death_c';
    }
    knocked.delete(o);
    play(o.anim, death, 0.9 + this.rnd() * 0.2, 0.1);
    const u = o.unit;
    u.losses++; u.lossLog.push(this.time);
    if (o === u.leader) { u.leader = null; u.morale -= 12; }
    if (by) { by.unit.kills++; by.unit.killLog.push(this.time); }
    for (const s of this.soldiers) if (s.foe === o) s.foe = null;
    this.events.push({ type: 'death', s: o });
    this.layout(u, false);
  }

  private chargeImpact(s: Soldier, o: Soldier) {
    const ms = s.def.melee.mass, mo = o.def.melee.mass;
    if (ms > mo * 1.25 && this.rnd() < 0.5) {
      // knock back + impact damage
      const d = Math.max(0.01, dist(s, o));
      const nx = (o.x - s.x) / d, nz = (o.z - s.z) / d;
      const push = Math.min(1.6, (ms / mo) * 0.5);
      const px = o.x + nx * push, pz = o.z + nz * push;
      if (!this.map.isBlocked(px, pz)) { o.x = px; o.z = pz; }
      if (ms > mo * 2 && this.rnd() < 0.45 && o.alive) {
        knocked.set(o, this.time + this.clip(o, 'knockdown').dur);
        o.hitT = this.clip(o, 'knockdown').dur + this.clip(o, 'getup').dur;
        o.foe = null; o.strikeT = -1; o.strikeFoe = null;
        play(o.anim, 'knockdown', 1, 0.04, true);
      } else {
        o.hitT = 0.7;
        if (o.alive) play(o.anim, 'stagger', 1, 0.05, true);
      }
      this.damage(o, s.def.melee.dmg * 0.35, s.def.melee.ap, s);
    }
    o.unit.morale -= 0.6;
  }

  private resolveStrike(s: Soldier) {
    const f = s.strikeFoe;
    s.strikeFoe = null;
    if (!s.alive || !f || !f.alive || dist(s, f) > s.def.melee.reach + 1.0) return;
    const u = s.unit;
    let atk = s.def.melee.atk - u.fatigue * 15;
    let mult = 1;
    if (s.chargeT > 0) { atk += 18; mult *= u.faction === 'orks' ? 1.3 : 1.2; }
    if (u.buffs.waaagh > 0) mult *= 1.2;
    if (u.abilityT > 0 && u.tpl.ability === 'bayonet') { atk += 25; mult *= 1.25; }
    if (u.mstate === 'wavering') atk -= 10;
    let def = f.def.melee.def - f.unit.fatigue * 10;
    if (f.unit.formation === 'defensive') def += 12;
    if (f.unit.attackedRear > 0) def -= 18;
    // defenders fighting from a trench against attackers outside it
    // (attackers outside strike down from the parapet at a disadvantage; ones who dropped in still face a prepared defender)
    if (this.map.inTrench(f.x, f.z)) { if (!this.map.inTrench(s.x, s.z)) { def += 30; atk -= 15; } else def += 12; }
    const p = Math.max(0.08, Math.min(0.92, atk / (atk + Math.max(5, def))));
    const hit = this.rnd() < p;
    if (heavyStrike.has(s)) { mult *= 1.35; heavyStrike.delete(s); }
    if (!hit && f.foe === s && f.hitT <= 0 && f.strikeT < 0 && !knocked.has(f) && this.rnd() < 0.55) {
      play(f.anim, 'block', 1, 0.06, true);
      f.meleeT = Math.max(f.meleeT, 0.3);
    }
    this.events.push({ type: 'melee', s, foe: f, hit });
    if (hit) {
      this.damage(f, s.def.melee.dmg * mult * MELEE_SCALE * (0.85 + this.rnd() * 0.3), s.def.melee.ap, s);
      if ((s.def.role === 'boss' && this.rnd() < 0.5) || (s.def.melee.mass >= 2.8 && s.def.role !== 'boss' && this.rnd() < 0.25)) {
        // big hitters cleave a second victim
        let other: Soldier | null = null;
        this.near(s.x, s.z, s.def.melee.reach + 0.5, (o) => { if (!other && o !== f && o.alive && o.side !== s.side) other = o; });
        if (other) this.damage(other, s.def.melee.dmg * mult * MELEE_SCALE * 0.6, s.def.melee.ap, s);
      }
    }
  }

  private pickAnim(s: Soldier, spd: number, mode: string) {
    const a = s.anim;
    if (s.hitT > 0 && REACTIONS.includes(a.clip)) return;
    const oneShot = ['fire', 'cover_fire', 'reload', 'command', 'melee_a', 'melee_b', 'melee_c', ...REACTIONS];
    if (oneShot.includes(a.clip)) {
      const c = this.clip(s, a.clip);
      if (a.t < c.dur * 0.92 && !(spd > 1.2 && a.clip !== 'command')) return;
    }
    const u = s.unit;
    s.crouch = false;
    if (spd > 0.35) {
      const charging = mode === 'charge' && u.charging;
      const clip = charging ? 'charge' : u.mstate === 'routing' && spd > s.def.walk * 1.6 ? 'sprint' : spd > s.def.walk * 1.6 ? 'run' : (u.target && (s.def.weapon && WEAPONS[s.def.weapon].moveFire) ? 'walk_aim' : 'walk');
      const c = this.clip(s, clip);
      const rate = Math.max(0.55, Math.min(1.9, spd / Math.max(0.3, c.speed * s.def.scale)));
      play(a, clip, rate, 0.22);
      return;
    }
    if (s.turning > 1.4 && !u.target) { play(a, 'turn', 1.2, 0.18); return; }
    const supp = u.suppression > 0.45 || u.formation === 'defensive' || (this.map.inTrench(s.x, s.z) && u.target);
    if (supp && s.def.role !== 'boss') { s.crouch = true; play(a, 'cover', 1, 0.3); return; }
    if (u.target || s.firingT > 0 || u.inMelee) { play(a, 'aim', 1, 0.25); return; }
    if (a.clip === 'idle') return;
    play(a, 'idle', 1, 0.35);
  }

  // ------------------------------------------------------------------ morale
  private updateMorale(u: Unit, dt: number) {
    if (u.mstate === 'gone' || u.mstate === 'shattered') return;
    const alive = u.soldiers.filter((s) => s.alive).length;
    if (!alive) return;
    u.lossLog = u.lossLog.filter((t) => this.time - t < 9);
    u.killLog = u.killLog.filter((t) => this.time - t < 9);
    u.attackedRear = Math.max(0, u.attackedRear - dt);
    const base = u.tpl.morale;
    const lossFrac = 1 - alive / u.initial;
    let m = base - lossFrac * 45 - (u.lossLog.length / u.initial) * 90 - u.suppression * 24;
    if (u.charging) m += 18;
    if (u.attackedRear > 0) m -= 22;
    if (u.leader && u.leader.alive) m += 6;
    if (u.inMelee) m += (u.killLog.length > u.lossLog.length ? 10 : -8);
    if (u.faction === 'orks') m += alive >= 15 ? 12 : alive < 6 ? -12 : 0;
    // Krieg trait: dug in, they hold the line far beyond what other regiments would
    if (u.faction === 'krieg') { const dug = u.soldiers.filter((x) => x.alive && this.map.inTrench(x.x, x.z)).length; if (dug > alive * 0.4) m += 14; }
    // auras of officers / bosses / sergeants of nearby friendly units
    for (const v of this.units) {
      if (v.side !== u.side || !v.leader || !v.leader.alive || v.mstate === 'routing') continue;
      const L = v.leader;
      const r = L.def.aura ?? 0;
      if (v !== u && r > 0 && Math.hypot(L.x - u.x, L.z - u.z) < r) m += L.def.role === 'boss' ? 18 : L.def.role === 'officer' ? 14 : 4;
    }
    for (const v of this.units) if (v !== u && v.side === u.side && v.mstate === 'routing' && Math.hypot(v.x - u.x, v.z - u.z) < 40) m -= 8;
    for (const v of this.units) if (v.side !== u.side && v.mstate === 'routing' && Math.hypot(v.x - u.x, v.z - u.z) < 50) m += 5;
    if (u.buffs.waaagh > 0) m += 30;
    if (u.buffs.aim > 0) m += 15;
    if (u.abilityT > 0 && u.tpl.ability === 'bayonet') m = Math.max(m, 90);
    m = Math.max(0, Math.min(100, m));
    const rate = m < u.morale ? 9 : 4;
    u.morale += Math.max(-rate * dt, Math.min(rate * dt, m - u.morale));
    const routAt = u.faction === 'krieg' ? 7 : 12;
    if (u.mstate === 'routing') {
      u.routT += dt;
      const threat = this.units.some((v) => v.side !== u.side && this.active(v) && v.mstate !== 'routing' && Math.hypot(v.x - u.x, v.z - u.z) < 45);
      if (!threat && u.routT > 10) u.morale = Math.min(100, u.morale + 6 * dt);
      if (u.routT > 10 && u.morale > 34 && !threat) {
        if (u.routs >= 2) { u.mstate = 'shattered'; return; }
        u.mstate = 'steady'; u.order = { type: 'idle' }; u.path = []; u.run = false; u.moving = false;
        this.events.push({ type: 'rally', u });
      }
      return;
    }
    if (u.tpl.fearless) { u.mstate = u.morale < 30 ? 'wavering' : 'steady'; return; }
    if (u.morale < routAt) {
      u.mstate = 'routing'; u.routs++; u.routT = 0; u.path = []; u.repathT = 0; u.target = null; u.charging = false;
      for (const s of u.soldiers) { s.foe = null; s.target = null; }
      this.events.push({ type: 'rout', u });
    } else u.mstate = u.morale < 30 ? 'wavering' : 'steady';
  }

  private checkVictory() {
    const fighting = (side: number) => this.units.some((u) => u.side === side && this.active(u) && (u.mstate === 'steady' || u.mstate === 'wavering'));
    const a = fighting(0), b = fighting(1);
    if (!a || !b) { this.over = true; this.winner = a ? 0 : b ? 1 : -1; }
  }

  // ------------------------------------------------------------------ stats
  sideStrength(side: number) {
    let hp = 0, max = 0;
    for (const s of this.soldiers) if (s.side === side) { max += s.maxHp; if (s.alive) hp += s.hp; }
    return max ? hp / max : 0;
  }
  sideCount(side: number) { return this.soldiers.filter((s) => s.side === side && s.alive).length; }
  factionColor(u: Unit) { return FACTIONS[u.faction].color; }
}

// ============================================================================ helpers
export function dist(a: { x: number; z: number }, b: { x: number; z: number }) { return Math.hypot(a.x - b.x, a.z - b.z); }
export function angDiff(a: number, b: number) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export function turn(a: number, b: number, max: number) { const d = angDiff(a, b); return a + Math.max(-max, Math.min(max, d)); }
