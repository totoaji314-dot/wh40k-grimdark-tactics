import type { Battle, Unit } from '../sim/Battle';
import { ABILITIES, FACTIONS, type FormationId } from '../sim/data';

const FORMS: [FormationId, string][] = [['line', '전열'], ['column', '종대'], ['loose', '산개'], ['defensive', '방어']];

export interface HudActions {
  select(u: Unit, add: boolean): void;
  focus(u: Unit): void;
  halt(): void;
  run(): void;
  charge(): void;
  fireAtWill(): void;
  meleeMode(): void;
  guard(): void;
  skirmish(): void;
  groupLock(): void;
  formation(f: FormationId): void;
  ability(): void;
  selectAll(): void;
  pause(): void;
  speed(): void;
  menu(): void;
}

export class Hud {
  root: HTMLDivElement;
  private cards = new Map<number, HTMLDivElement>();
  private banners = new Map<number, HTMLDivElement>();
  private cardBox: HTMLDivElement;
  private bannerBox: HTMLDivElement;
  private orders: HTMLDivElement;
  private timer: HTMLDivElement;
  private s0: HTMLDivElement; private s1: HTMLDivElement; private c0: HTMLSpanElement; private c1: HTMLSpanElement;
  private toastEl: HTMLDivElement; private toastT = 0;
  private hintEl: HTMLDivElement;
  fpsEl: HTMLDivElement;
  minimap: HTMLCanvasElement;
  selBox: HTMLDivElement;
  pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement;
  private obtn: Record<string, HTMLButtonElement> = {};

  constructor(ui: HTMLElement, private b: Battle, private side: number, private act: HudActions) {
    this.root = el('div', 'hud');
    ui.appendChild(this.root);
    this.bannerBox = el('div', 'banners'); this.root.appendChild(this.bannerBox);
    const top = el('div', 'topbar panel pe');
    const mk = (cls: string, col: string) => { const w = el('div', 'strength'); const bar = el('div', 'sbar'); const fill = el('div'); fill.style.background = col; fill.style[cls === 'l' ? 'right' : 'left'] = '0'; bar.appendChild(fill); const c = el('span'); w.append(...(cls === 'l' ? [c, bar] : [bar, c])); return [w, fill, c] as const; };
    const myCol = FACTIONS[b.units.find((u) => u.side === side)!.faction].color;
    const enCol = '#b3261e';
    const [w0, f0, c0] = mk('l', myCol); const [w1, f1, c1] = mk('r', enCol);
    this.timer = el('div', 'timer'); this.timer.textContent = '0:00';
    top.append(w0, this.timer, w1);
    this.s0 = f0; this.s1 = f1; this.c0 = c0; this.c1 = c1;
    this.root.appendChild(top);
    const tr = el('div', 'tr-buttons');
    this.pauseBtn = btn('❚❚', () => act.pause(), '일시정지 (Space)');
    this.speedBtn = btn('1×', () => act.speed(), '배속 (+/-)');
    tr.append(this.pauseBtn, this.speedBtn, btn('☰', () => act.menu(), '메뉴 (Esc)'));
    this.root.appendChild(tr);
    this.fpsEl = el('div', 'fps'); this.fpsEl.style.display = 'none'; this.root.appendChild(this.fpsEl);
    this.cardBox = el('div', 'cards'); this.root.appendChild(this.cardBox);
    this.orders = el('div', 'orders panel'); this.root.appendChild(this.orders);
    const o = (key: string, label: string, sub: string, fn: () => void, tip: string) => { const bb = btn(`${label}<small>${sub}</small>`, fn, tip); this.obtn[key] = bb; this.orders.appendChild(bb); return bb; };
    o('halt', '정지', 'H', () => act.halt(), '정지 (H)');
    o('run', '달리기', 'R', () => act.run(), '달리기 전환 (R)');
    o('charge', '돌격', 'C', () => act.charge(), '가장 가까운 적에게 돌격 (C)');
    o('fire', '자유사격', 'F', () => act.fireAtWill(), '자유 사격 전환 (F)');
    o('melee', '근접전', 'M', () => act.meleeMode(), '근접전 모드: 사격하지 않고 백병전으로 싸움 (M)');
    o('guard', '경계', 'V', () => act.guard(), '경계 모드: 자리를 지키며 추격하지 않음 (V)');
    o('skirm', '견제', 'X', () => act.skirmish(), '견제 모드: 적이 달려들면 물러나며 사격 (X)');
    o('lock', '그룹고정', 'L', () => act.groupLock(), '그룹 진형 고정: 여러 부대가 서로의 배치를 유지하며 이동 (L)');
    for (const [f, n] of FORMS) o('f_' + f, n, f === 'line' ? '1' : f === 'column' ? '2' : f === 'loose' ? '3' : '4', () => act.formation(f), `${n} 진형`);
    o('ability', '능력', 'G', () => act.ability(), '부대 특수 능력 (G)');
    o('all', '전체', 'Ctrl+A', () => act.selectAll(), '모든 부대 선택');
    this.orders.style.display = 'none';
    const mm = el('div', 'minimap panel pe'); this.minimap = document.createElement('canvas'); this.minimap.width = this.minimap.height = 200; mm.appendChild(this.minimap); this.root.appendChild(mm);
    this.toastEl = el('div', 'toast'); this.toastEl.style.opacity = '0'; this.root.appendChild(this.toastEl);
    this.hintEl = el('div', 'hint'); this.root.appendChild(this.hintEl);
    this.selBox = el('div', 'selbox'); this.selBox.style.display = 'none'; this.root.appendChild(this.selBox);
    const rh = el('div', 'rotate-hint'); rh.textContent = '가로 화면에서 더 넓게 지휘할 수 있습니다'; this.root.appendChild(rh);
    for (const u of b.units.filter((x) => x.side === side)) this.addCard(u);
    for (const u of b.units) this.addBanner(u);
  }

  private addCard(u: Unit) {
    const c = el('div', 'card');
    c.title = `${u.name} — ${u.tpl.desc}`;
    c.innerHTML = `<div class="st"></div><div class="cnt"></div><div class="ic" style="color:${FACTIONS[u.faction].color}">${u.tpl.icon}</div><div class="nm">${u.name}</div><div class="bars"><div class="hb"><div></div></div><div class="mb"><div></div></div></div>`;
    let lastTap = 0;
    c.addEventListener('click', (e) => {
      const now = performance.now();
      if (now - lastTap < 350) this.act.focus(u);
      lastTap = now;
      this.act.select(u, e.shiftKey || e.ctrlKey || (this as { multi?: boolean }).multi === true);
    });
    this.cardBox.appendChild(c);
    this.cards.set(u.id, c);
  }

  private addBanner(u: Unit) {
    const d = el('div', 'banner');
    const mine = u.side === this.side;
    const col = mine ? FACTIONS[u.faction].color : '#8a1c16';
    d.innerHTML = `<div class="flag" style="background:${col}">${u.tpl.icon}</div><div class="hp"><div style="background:${mine ? '#8fd05a' : '#ff6a50'}"></div></div><div class="stt"></div>`;
    d.addEventListener('pointerup', (e) => { e.stopPropagation(); (this as { onBanner?: (u: Unit, e: PointerEvent) => void }).onBanner?.(u, e); });
    d.addEventListener('pointerdown', (e) => e.stopPropagation());
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    this.bannerBox.appendChild(d);
    this.banners.set(u.id, d);
  }

  multi = false;
  groupLocked = false;
  private supportEl: HTMLDivElement | null = null;

  /** Off-map support buttons (air strike, drop pod) with remaining uses. */
  showSupport(sup: { air: number; pods: number }, arm: (k: 'air' | 'pod') => void) {
    if (sup.air <= 0 && sup.pods <= 0) return;
    const d = el('div', 'support panel pe');
    const a = btn('', () => arm('air'), '공중 지원: 썬더볼트가 지정 지점에 기총 소사와 폭격');
    a.dataset.k = 'air';
    const p = btn('', () => arm('pod'), '드롭 포드: 전술 분대가 지정 지점에 강하');
    p.dataset.k = 'pod';
    d.append(a, p);
    this.root.appendChild(d);
    this.supportEl = d;
    this.setSupport(sup, null);
  }

  setSupport(sup: { air: number; pods: number }, armed: 'air' | 'pod' | null) {
    const d = this.supportEl; if (!d) return;
    const a = d.querySelector('[data-k="air"]') as HTMLButtonElement, p = d.querySelector('[data-k="pod"]') as HTMLButtonElement;
    a.innerHTML = `✈ 공중 지원<small>${sup.air}회</small>`; a.disabled = sup.air <= 0; a.classList.toggle('on', armed === 'air'); a.style.display = sup.air > 0 || armed === 'air' ? '' : 'none';
    p.innerHTML = `⬇ 드롭 포드<small>${sup.pods}회</small>`; p.disabled = sup.pods <= 0; p.classList.toggle('on', armed === 'pod'); p.style.display = sup.pods > 0 || armed === 'pod' ? '' : 'none';
  }

  /** A unit that joined mid-battle (drop pod). */
  addUnit(u: Unit) {
    if (u.side === this.side && !this.cards.has(u.id)) this.addCard(u);
    if (!this.banners.has(u.id)) this.addBanner(u);
  }
  onBanner?: (u: Unit, e: PointerEvent) => void;
  private deployEl: HTMLDivElement | null = null;

  /** Pre-battle deployment banner with the start button. */
  showDeploy(onStart: () => void) {
    const touch = matchMedia('(pointer:coarse)').matches;
    const d = el('div', 'deploy panel pe');
    d.innerHTML = `<div class="dt">배치 단계</div><div class="dd">${touch
      ? '부대 카드/깃발을 눌러 선택 → 파란 구역 안을 눌러 배치 · 두 손가락으로 카메라'
      : '부대 선택 → 파란 구역 안에서 우클릭으로 배치 · <b>우클릭 드래그</b>로 전열의 방향과 폭 지정 · Ctrl+숫자 부대 그룹'}</div>`;
    const go = btn('전투 시작 ▶<small>Enter</small>', onStart, '배치를 마치고 전투 시작 (Enter)');
    go.id = 'deploy-go'; go.classList.add('go');
    d.appendChild(go);
    this.root.appendChild(d);
    this.deployEl = d;
    this.root.classList.add('deploying');
  }

  hideDeploy() { this.deployEl?.remove(); this.deployEl = null; this.root.classList.remove('deploying'); }

  /** Replace the glyph icons with rendered model portraits (template id -> image URL). */
  setPortraits(p: Map<string, string>) {
    for (const [id, c] of this.cards) {
      const u = this.b.units.find((x) => x.id === id)!;
      const url = p.get(u.tpl.id);
      if (!url) continue;
      const ic = c.querySelector('.ic') as HTMLDivElement;
      ic.classList.add('portrait');
      ic.style.backgroundImage = `url(${url})`;
      ic.innerHTML = `<span>${u.tpl.icon}</span>`;
    }
  }

  toast(text: string, dur = 2.5) { this.toastEl.textContent = text; this.toastEl.style.opacity = '1'; this.toastT = dur; }
  hint(text: string) { this.hintEl.textContent = text; }

  /** Update banners every frame (positions come from the caller). */
  banner(u: Unit, sx: number, sy: number, visible: boolean, selected: boolean) {
    const d = this.banners.get(u.id);
    if (!d) return;
    if (!visible) { d.style.display = 'none'; return; }
    d.style.display = '';
    d.style.left = `${sx}px`; d.style.top = `${sy}px`;
    d.classList.toggle('sel', selected);
    const alive = u.soldiers.filter((s) => s.alive).length;
    (d.querySelector('.hp > div') as HTMLDivElement).style.width = `${(alive / u.initial) * 100}%`;
    const st = d.querySelector('.stt') as HTMLDivElement;
    st.textContent = u.mstate === 'routing' ? '패주!' : u.inMelee ? '⚔' : u.mstate === 'wavering' ? '동요' : u.charging ? '돌격!' : '';
  }

  update(dt: number, selected: Set<Unit>, speed: number, paused: boolean) {
    const b = this.b;
    const t = Math.floor(b.time);
    this.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const a = b.sideStrength(this.side), e = b.sideStrength(1 - this.side);
    this.s0.style.width = `${a * 100}%`; this.s1.style.width = `${e * 100}%`;
    this.c0.textContent = String(b.sideCount(this.side)); this.c1.textContent = String(b.sideCount(1 - this.side));
    this.pauseBtn.classList.toggle('on', paused);
    this.speedBtn.textContent = `${speed}×`;
    for (const [id, c] of this.cards) {
      const u = b.units.find((x) => x.id === id)!;
      const alive = u.soldiers.filter((s) => s.alive).length;
      (c.querySelector('.hb > div') as HTMLDivElement).style.width = `${(alive / u.initial) * 100}%`;
      (c.querySelector('.mb > div') as HTMLDivElement).style.width = `${Math.max(0, u.morale)}%`;
      (c.querySelector('.cnt') as HTMLDivElement).textContent = String(alive);
      (c.querySelector('.st') as HTMLDivElement).textContent = u.mstate === 'routing' ? '⚑' : u.inMelee ? '⚔' : u.mstate === 'wavering' ? '!' : u.abilityCd <= 0 && u.tpl.ability ? '✦' : '';
      c.classList.toggle('sel', selected.has(u));
      c.classList.toggle('rout', u.mstate === 'routing' || u.mstate === 'shattered');
      c.classList.toggle('dead', alive === 0 || u.mstate === 'gone');
    }
    const sel = [...selected];
    this.orders.style.display = sel.length ? 'flex' : 'none';
    if (sel.length) this.hintEl.style.display = 'none';
    if (sel.length) {
      const u0 = sel[0];
      this.obtn.run.classList.toggle('on', sel.every((u) => u.run));
      this.obtn.fire.classList.toggle('on', sel.every((u) => u.fireAtWill));
      this.obtn.melee.classList.toggle('on', sel.every((u) => u.meleeMode || u.meleeOnly));
      this.obtn.melee.disabled = sel.every((u) => u.meleeOnly);
      this.obtn.guard.classList.toggle('on', sel.every((u) => u.guard));
      this.obtn.skirm.classList.toggle('on', sel.length > 0 && sel.every((u) => u.skirmish));
      this.obtn.skirm.disabled = sel.every((u) => u.meleeOnly);
      this.obtn.lock.classList.toggle('on', this.groupLocked);
      for (const [f] of FORMS) this.obtn['f_' + f].classList.toggle('on', sel.every((u) => u.formation === f));
      const ab = u0.tpl.ability ? ABILITIES[u0.tpl.ability] : null;
      const ready = sel.some((u) => u.tpl.ability && u.abilityCd <= 0);
      this.obtn.ability.innerHTML = `${ab ? ab.ko : '능력'}<small>${ready ? 'G' : Math.ceil(Math.min(...sel.map((u) => u.abilityCd))) + 's'}</small>`;
      this.obtn.ability.disabled = !ready;
      this.obtn.ability.title = ab ? ab.desc : '';
      this.obtn.fire.disabled = sel.every((u) => u.meleeOnly);
    }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.style.opacity = '0'; }
  }

  destroy() { this.root.remove(); }
}

export function el(tag: string, cls = ''): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (cls) e.className = cls;
  return e;
}

export function btn(html: string, fn: () => void, title = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn';
  b.innerHTML = html;
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}
