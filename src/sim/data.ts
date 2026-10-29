// Game data: weapons, soldier types, unit templates, armies and scenarios.
// Numbers are tuned for Total War-like pacing (battles of a few minutes), not tabletop rules.

export type FactionId = 'marines' | 'guard' | 'krieg' | 'orks';
export type Tracer = 'las' | 'bolt' | 'hbolt' | 'stub' | 'plasma' | 'slug' | 'none';

export interface WeaponDef {
  id: string; ko: string;
  range: number;       // metres
  burst: number;       // shots per trigger pull
  gap: number;         // seconds between shots in a burst
  cycle: number;       // seconds between bursts (incl. aiming)
  dmg: number; ap: number;
  acc: number;         // hit chance at close range
  falloff: number;     // fraction of accuracy lost at max range
  suppress: number;    // suppression added to the target unit per shot
  splash?: number;     // splash radius (m)
  speed: number;       // projectile speed m/s (visual + hit delay)
  tracer: Tracer;
  moveFire: boolean;   // can fire while walking
  reload?: number;     // extra pause every `mag` bursts
  mag?: number;
  sound: string;
}

export interface MeleeDef { atk: number; def: number; dmg: number; ap: number; rate: number; mass: number; reach: number }

export interface SoldierDef {
  id: string;            // render variant id
  faction: FactionId;
  ko: string;
  hp: number;
  armor: number;         // save fraction 0..1 against ap 0
  walk: number; run: number; charge: number;
  weapon?: string;       // main ranged weapon
  pistol?: string;       // sidearm used by leaders (fires the off-hand muzzle)
  melee: MeleeDef;
  scale: number;
  role: 'trooper' | 'leader' | 'heavy' | 'special' | 'officer' | 'boss';
  aura?: number;         // morale aura radius
}

export const WEAPONS: Record<string, WeaponDef> = {
  bolter: { id: 'bolter', ko: '볼터', range: 62, burst: 3, gap: 0.13, cycle: 4.6, dmg: 18, ap: 0.35, acc: 0.55, falloff: 0.55, suppress: 0.010, speed: 140, tracer: 'bolt', moveFire: true, sound: 'bolter' },
  heavy_bolter: { id: 'heavy_bolter', ko: '헤비 볼터', range: 95, burst: 7, gap: 0.11, cycle: 4.8, dmg: 17, ap: 0.45, acc: 0.38, falloff: 0.45, suppress: 0.03, speed: 150, tracer: 'hbolt', moveFire: false, sound: 'hbolter' },
  plasma: { id: 'plasma', ko: '플라즈마 건', range: 60, burst: 1, gap: 0, cycle: 4.2, dmg: 85, ap: 0.9, acc: 0.6, falloff: 0.4, suppress: 0.05, splash: 1.8, speed: 70, tracer: 'plasma', moveFire: true, sound: 'plasma' },
  bolt_pistol: { id: 'bolt_pistol', ko: '볼트 피스톨', range: 26, burst: 1, gap: 0, cycle: 1.8, dmg: 20, ap: 0.3, acc: 0.55, falloff: 0.5, suppress: 0.008, speed: 120, tracer: 'bolt', moveFire: true, sound: 'bolter' },
  lasgun: { id: 'lasgun', ko: '라스건', range: 72, burst: 1, gap: 0, cycle: 2.9, dmg: 10, ap: 0.05, acc: 0.44, falloff: 0.55, suppress: 0.004, speed: 220, tracer: 'las', moveFire: false, sound: 'las' },
  laspistol: { id: 'laspistol', ko: '라스피스톨', range: 22, burst: 1, gap: 0, cycle: 1.6, dmg: 8, ap: 0.0, acc: 0.5, falloff: 0.5, suppress: 0.003, speed: 220, tracer: 'las', moveFire: true, sound: 'las' },
  heavy_stubber: { id: 'heavy_stubber', ko: '헤비 스터버', range: 88, burst: 7, gap: 0.08, cycle: 3.6, dmg: 10, ap: 0.15, acc: 0.3, falloff: 0.45, suppress: 0.03, speed: 260, tracer: 'stub', moveFire: false, sound: 'stubber' },
  slugga: { id: 'slugga', ko: '슬러가', range: 22, burst: 1, gap: 0, cycle: 2.2, dmg: 10, ap: 0.1, acc: 0.24, falloff: 0.5, suppress: 0.004, speed: 160, tracer: 'slug', moveFire: true, sound: 'slugga' },
  shoota: { id: 'shoota', ko: '슈타', range: 46, burst: 4, gap: 0.12, cycle: 3.2, dmg: 11, ap: 0.1, acc: 0.3, falloff: 0.5, suppress: 0.006, speed: 170, tracer: 'slug', moveFire: true, sound: 'shoota' },
  kombi: { id: 'kombi', ko: '콤비 슈타', range: 32, burst: 4, gap: 0.1, cycle: 2.6, dmg: 16, ap: 0.2, acc: 0.36, falloff: 0.5, suppress: 0.01, speed: 170, tracer: 'slug', moveFire: true, sound: 'shoota' },
};

const M = (atk: number, def: number, dmg: number, ap: number, rate: number, mass: number, reach = 1.6): MeleeDef => ({ atk, def, dmg, ap, rate, mass, reach });

export const SOLDIERS: Record<string, SoldierDef> = {
  marine: { id: 'marine', faction: 'marines', ko: '전술 마린', hp: 130, armor: 0.84, walk: 1.25, run: 4.4, charge: 6.0, weapon: 'bolter', melee: M(66, 62, 34, 0.35, 0.85, 3.0), scale: 1, role: 'trooper' },
  marine_plasma: { id: 'marine_plasma', faction: 'marines', ko: '플라즈마 마린', hp: 130, armor: 0.84, walk: 1.25, run: 4.4, charge: 6.0, weapon: 'plasma', melee: M(66, 62, 34, 0.35, 0.85, 3.0), scale: 1, role: 'special' },
  marine_heavy: { id: 'marine_heavy', faction: 'marines', ko: '헤비 볼터 마린', hp: 130, armor: 0.84, walk: 1.15, run: 3.9, charge: 5.2, weapon: 'heavy_bolter', melee: M(60, 58, 30, 0.35, 0.8, 3.0), scale: 1, role: 'heavy' },
  marine_sergeant: { id: 'marine_sergeant', faction: 'marines', ko: '마린 서전트', hp: 160, armor: 0.86, walk: 1.25, run: 4.4, charge: 6.0, pistol: 'bolt_pistol', melee: M(78, 68, 48, 0.5, 1.1, 3.0), scale: 1.03, role: 'leader', aura: 25 },
  guardsman: { id: 'guardsman', faction: 'guard', ko: '카디안 가드맨', hp: 32, armor: 0.36, walk: 1.2, run: 4.2, charge: 5.4, weapon: 'lasgun', melee: M(28, 33, 11, 0.0, 0.85, 1.0), scale: 1, role: 'trooper' },
  guard_plasma: { id: 'guard_plasma', faction: 'guard', ko: '플라즈마 거너', hp: 32, armor: 0.36, walk: 1.2, run: 4.2, charge: 5.4, weapon: 'plasma', melee: M(26, 28, 10, 0.0, 0.8, 1.0), scale: 1, role: 'special' },
  guard_heavy: { id: 'guard_heavy', faction: 'guard', ko: '헤비 스터버 거너', hp: 32, armor: 0.36, walk: 1.1, run: 3.8, charge: 4.8, weapon: 'heavy_stubber', melee: M(24, 26, 10, 0.0, 0.8, 1.0), scale: 1, role: 'heavy' },
  guard_sergeant: { id: 'guard_sergeant', faction: 'guard', ko: '가드 서전트', hp: 40, armor: 0.34, walk: 1.2, run: 4.2, charge: 5.4, pistol: 'laspistol', melee: M(38, 34, 16, 0.2, 1.0, 1.1), scale: 1, role: 'leader', aura: 20 },
  guard_officer: { id: 'guard_officer', faction: 'guard', ko: '카디안 장교', hp: 55, armor: 0.36, walk: 1.2, run: 4.2, charge: 5.4, pistol: 'bolt_pistol', melee: M(48, 42, 30, 0.6, 1.0, 1.1), scale: 1.02, role: 'officer', aura: 45 },
  krieg: { id: 'krieg', faction: 'krieg', ko: '크리그 근위병', hp: 34, armor: 0.42, walk: 1.15, run: 4.0, charge: 5.4, weapon: 'lasgun', melee: M(42, 44, 20, 0.1, 0.95, 1.15, 1.9), scale: 1, role: 'trooper' },
  krieg_heavy: { id: 'krieg_heavy', faction: 'krieg', ko: '크리그 중화기병', hp: 34, armor: 0.42, walk: 1.05, run: 3.7, charge: 4.8, weapon: 'heavy_stubber', melee: M(28, 30, 10, 0.0, 0.8, 1.1), scale: 1, role: 'heavy' },
  krieg_watchmaster: { id: 'krieg_watchmaster', faction: 'krieg', ko: '워치마스터', hp: 46, armor: 0.44, walk: 1.15, run: 4.0, charge: 5.4, pistol: 'laspistol', melee: M(46, 40, 20, 0.3, 1.0, 1.2), scale: 1, role: 'leader', aura: 25 },
  ork_boy: { id: 'ork_boy', faction: 'orks', ko: '오크 보이', hp: 66, armor: 0.12, walk: 1.3, run: 5.0, charge: 6.8, pistol: 'slugga', melee: M(54, 30, 15, 0.3, 0.95, 1.8), scale: 1, role: 'trooper' },
  ork_shoota: { id: 'ork_shoota', faction: 'orks', ko: '슈타 보이', hp: 66, armor: 0.12, walk: 1.3, run: 5.0, charge: 6.6, weapon: 'shoota', melee: M(44, 28, 12, 0.1, 0.9, 1.8), scale: 1, role: 'trooper' },
  ork_nob: { id: 'ork_nob', faction: 'orks', ko: '오크 놉', hp: 150, armor: 0.25, walk: 1.3, run: 4.9, charge: 6.6, melee: M(60, 42, 26, 0.55, 0.72, 2.8, 2.1), scale: 1.14, role: 'leader', aura: 22 },
  ork_warboss: { id: 'ork_warboss', faction: 'orks', ko: '오크 워보스', hp: 700, armor: 0.5, walk: 1.25, run: 4.7, charge: 6.4, pistol: 'kombi', melee: M(80, 62, 55, 0.6, 0.6, 6.0, 2.6), scale: 1.32, role: 'boss', aura: 55 },
};

export type FormationId = 'line' | 'column' | 'loose' | 'defensive';
export type AbilityId = 'bolter_drill' | 'volley' | 'bayonet' | 'waaagh' | 'take_aim';

export interface UnitTemplate {
  id: string; faction: FactionId; ko: string; short: string;
  members: [string, number][];   // [soldier id, count]; first member type with role leader/officer/boss leads
  formation: FormationId;
  spacing: number;
  morale: number;                 // base morale 0..100
  fearless?: boolean;             // never routs (falls back instead)
  ability?: AbilityId;
  icon: string;                   // short glyph for unit cards
  desc: string;
}

export const UNITS: Record<string, UnitTemplate> = {
  tactical: { id: 'tactical', faction: 'marines', ko: '전술 분대', short: '전술', members: [['marine_sergeant', 1], ['marine_plasma', 1], ['marine_heavy', 1], ['marine', 7]], formation: 'line', spacing: 1.7, morale: 95, fearless: true, ability: 'bolter_drill', icon: 'Ⅰ', desc: '볼터 일제사격과 강력한 근접전. 결코 패주하지 않는다.' },
  devastator: { id: 'devastator', faction: 'marines', ko: '데바스테이터 분대', short: '중화기', members: [['marine_sergeant', 1], ['marine_heavy', 4], ['marine', 5]], formation: 'line', spacing: 1.8, morale: 95, fearless: true, ability: 'bolter_drill', icon: 'Ⅲ', desc: '헤비 볼터 4정의 강력한 제압 사격.' },
  infantry: { id: 'infantry', faction: 'guard', ko: '카디안 보병 소대', short: '보병', members: [['guard_sergeant', 1], ['guard_plasma', 1], ['guard_heavy', 1], ['guardsman', 22]], formation: 'line', spacing: 1.25, morale: 62, ability: 'volley', icon: '✦', desc: '라스건 일제사격. 근접전에 약하다.' },
  heavy_platoon: { id: 'heavy_platoon', faction: 'guard', ko: '카디안 중화기 소대', short: '중화기', members: [['guard_sergeant', 1], ['guard_heavy', 8], ['guardsman', 16]], formation: 'line', spacing: 1.35, morale: 60, ability: 'volley', icon: '✚', desc: '헤비 스터버 8정으로 적 돌격을 제압한다.' },
  command: { id: 'command', faction: 'guard', ko: '카디안 지휘 소대', short: '지휘', members: [['guard_officer', 1], ['guard_plasma', 2], ['guardsman', 22]], formation: 'line', spacing: 1.25, morale: 70, ability: 'take_aim', icon: '★', desc: '장교가 주변 부대의 사기와 명중률을 올린다.' },
  krieg_line: { id: 'krieg_line', faction: 'krieg', ko: '크리그 전열 중대', short: '전열', members: [['krieg_watchmaster', 1], ['krieg_heavy', 2], ['krieg', 22]], formation: 'line', spacing: 1.25, morale: 86, ability: 'bayonet', icon: '☩', desc: '총검 돌격과 참호 방어. 죽음을 두려워하지 않는다.' },
  krieg_heavy_co: { id: 'krieg_heavy_co', faction: 'krieg', ko: '크리그 중화기 중대', short: '중화기', members: [['krieg_watchmaster', 1], ['krieg_heavy', 10], ['krieg', 14]], formation: 'line', spacing: 1.3, morale: 84, ability: 'volley', icon: '☨', desc: '참호에서 헤비 스터버로 적을 갈아 넣는다.' },
  boyz: { id: 'boyz', faction: 'orks', ko: '오크 보이즈 몹', short: '보이즈', members: [['ork_nob', 1], ['ork_boy', 39]], formation: 'loose', spacing: 1.45, morale: 78, ability: 'waaagh', icon: '☠', desc: '거대한 무리로 돌격해 적을 짓밟는다.' },
  boyz_small: { id: 'boyz_small', faction: 'orks', ko: '오크 보이즈', short: '보이즈', members: [['ork_nob', 1], ['ork_boy', 19]], formation: 'loose', spacing: 1.45, morale: 74, ability: 'waaagh', icon: '☠', desc: '돌격 보이즈.' },
  shootas: { id: 'shootas', faction: 'orks', ko: '슈타 보이즈', short: '슈타', members: [['ork_nob', 1], ['ork_shoota', 29]], formation: 'loose', spacing: 1.5, morale: 72, ability: 'waaagh', icon: '✸', desc: '시끄럽고 부정확하지만 탄막이 많다.' },
  nobz: { id: 'nobz', faction: 'orks', ko: '워보스와 놉즈', short: '워보스', members: [['ork_warboss', 1], ['ork_nob', 9]], formation: 'loose', spacing: 1.9, morale: 96, ability: 'waaagh', icon: '♛', desc: '워보스와 근위 놉즈. 주변 오크의 사기를 크게 올린다.' },
};

export const FACTIONS: Record<FactionId, { ko: string; color: string; side: 'imperium' | 'orks' }> = {
  marines: { ko: '스페이스 마린', color: '#3a6fd8', side: 'imperium' },
  guard: { ko: '아스트라 밀리타룸', color: '#8f9a5a', side: 'imperium' },
  krieg: { ko: '데스 코어 오브 크리그', color: '#8a8f86', side: 'imperium' },
  orks: { ko: '오크', color: '#6aa832', side: 'orks' },
};

export const ABILITIES: Record<AbilityId, { ko: string; dur: number; cd: number; desc: string }> = {
  bolter_drill: { ko: '볼터 드릴', dur: 12, cd: 50, desc: '12초간 사격 속도 +60%, 명중 +10%' },
  volley: { ko: '1열 사격, 2열 사격!', dur: 12, cd: 45, desc: '정지 상태에서 12초간 사격 속도 2배' },
  bayonet: { ko: '총검 돌격', dur: 15, cd: 50, desc: '15초간 근접 공격 +25, 돌격 속도 +20%, 사기 고정' },
  waaagh: { ko: '와아아그!', dur: 15, cd: 70, desc: '주변 오크 15초간 이동 +25%, 근접 피해 +20%, 사기 +30' },
  take_aim: { ko: '조준하라!', dur: 15, cd: 50, desc: '주변 40m 아군 15초간 명중 +15%, 사기 +15' },
};

export interface Deploy { unit: string; x: number; z: number; yaw?: number }
export interface Scenario {
  id: string; ko: string; desc: string;
  player: FactionId[];     // factions on the player's side (side 0)
  enemy: FactionId[];
  side0: Deploy[]; side1: Deploy[];
  map: 'ruins' | 'trenches';
}

// side 0 deploys in the south (z > 0) facing north (-z, yaw = PI); side 1 in the north facing south (yaw = 0).
export const SCENARIOS: Scenario[] = [
  {
    id: 'marines_vs_orks', ko: '불굴의 30인', desc: '스페이스 마린 30명이 오크 100마리의 와아아그를 막아낸다. (기본 검증 전투 30 대 100)',
    player: ['marines'], enemy: ['orks'], map: 'ruins',
    side0: [{ unit: 'tactical', x: -22, z: 70 }, { unit: 'devastator', x: 0, z: 82 }, { unit: 'tactical', x: 22, z: 70 }],
    side1: [{ unit: 'boyz', x: -30, z: -120 }, { unit: 'shootas', x: 25, z: -125 }, { unit: 'nobz', x: 0, z: -140 }, { unit: 'boyz_small', x: 55, z: -115 }],
  },
  {
    id: 'cadia_line', ko: '카디아의 방어선', desc: '아스트라 밀리타룸 100명이 폐허 지구에서 오크 100마리를 상대한다.',
    player: ['guard'], enemy: ['orks'], map: 'ruins',
    side0: [{ unit: 'infantry', x: -40, z: 70 }, { unit: 'heavy_platoon', x: 0, z: 78 }, { unit: 'infantry', x: 40, z: 70 }, { unit: 'command', x: 0, z: 100 }],
    side1: [{ unit: 'boyz', x: -30, z: -120 }, { unit: 'shootas', x: 25, z: -125 }, { unit: 'nobz', x: 0, z: -140 }, { unit: 'boyz_small', x: 55, z: -115 }],
  },
  {
    id: 'krieg_trench', ko: '크리그의 참호', desc: '데스 코어 오브 크리그 100명이 참호선을 지킨다. 오크 100마리가 몰려온다.',
    player: ['krieg'], enemy: ['orks'], map: 'trenches',
    side0: [{ unit: 'krieg_line', x: -38, z: 57 }, { unit: 'krieg_heavy_co', x: 0, z: 57 }, { unit: 'krieg_line', x: 38, z: 57 }, { unit: 'krieg_line', x: 0, z: 89 }],
    side1: [{ unit: 'boyz', x: -30, z: -120 }, { unit: 'shootas', x: 25, z: -125 }, { unit: 'nobz', x: 0, z: -140 }, { unit: 'boyz_small', x: 55, z: -115 }],
  },
  {
    id: 'grand_waaagh', ko: '대 와아아그', desc: '제국 연합군(마린 30 · 카디안 100 · 크리그 100)과 오크 대군 300의 대규모 전투.',
    player: ['marines', 'guard', 'krieg'], enemy: ['orks'], map: 'trenches',
    side0: [
      { unit: 'krieg_line', x: -70, z: 57 }, { unit: 'krieg_heavy_co', x: -35, z: 57 }, { unit: 'krieg_line', x: -105, z: 57 }, { unit: 'krieg_line', x: -55, z: 89 },
      { unit: 'infantry', x: 30, z: 66 }, { unit: 'heavy_platoon', x: 62, z: 70 }, { unit: 'infantry', x: 95, z: 66 }, { unit: 'command', x: 62, z: 96 },
      { unit: 'tactical', x: -10, z: 80 }, { unit: 'devastator', x: 5, z: 98 }, { unit: 'tactical', x: 12, z: 82 },
    ],
    side1: [
      { unit: 'boyz', x: -90, z: -95 }, { unit: 'boyz', x: -45, z: -100 }, { unit: 'boyz', x: 0, z: -92 }, { unit: 'boyz', x: 45, z: -100 }, { unit: 'boyz', x: 90, z: -95 },
      { unit: 'shootas', x: -60, z: -125 }, { unit: 'shootas', x: 0, z: -125 }, { unit: 'shootas', x: 60, z: -125 }, { unit: 'nobz', x: 0, z: -145 },
    ],
  },
  {
    id: 'orks_vs_imperium', ko: '와아아그를 이끌어라', desc: '오크 워보스가 되어 카디안 방어선을 짓밟아라.',
    player: ['orks'], enemy: ['guard'], map: 'ruins',
    side0: [{ unit: 'boyz', x: -30, z: 95 }, { unit: 'shootas', x: 25, z: 100 }, { unit: 'nobz', x: 0, z: 115 }, { unit: 'boyz_small', x: 55, z: 90 }],
    side1: [{ unit: 'infantry', x: -40, z: -70 }, { unit: 'heavy_platoon', x: 0, z: -78 }, { unit: 'infantry', x: 40, z: -70 }, { unit: 'command', x: 0, z: -100 }],
  },
];

export const unitSize = (t: UnitTemplate) => t.members.reduce((s, [, n]) => s + n, 0);
