import { SCENARIOS, UNITS, FACTIONS, unitSize, type Scenario } from '../sim/data';
import type { Settings } from '../core/Settings';
import { el } from './Hud';

export class Menu {
  constructor(private ui: HTMLElement) {}

  clear() { this.ui.querySelectorAll('.screen, .loading').forEach((e) => e.remove()); }

  title(on: { battle: () => void; settings: () => void; help: () => void; about: () => void }) {
    this.clear();
    const s = el('div', 'screen bg');
    s.innerHTML = `<div class="title">
      <h1>GRIMDARK TACTICS</h1>
      <h2>WARHAMMER 40,000 · 팬 메이드 실시간 전술 전투</h2>
      <div class="menu-col">
        <button class="btn big" id="m-battle">전투 시작</button>
        <button class="btn" id="m-settings">그래픽 · 소리 설정</button>
        <button class="btn" id="m-help">조작법</button>
        <button class="btn" id="m-about">제작 정보 · 라이선스</button>
      </div>
      <div class="disclaimer">비공식 팬 제작 프로젝트입니다. Games Workshop, Creative Assembly, SEGA와 관련이 없습니다.<br/>모든 3D 모델·텍스처·애니메이션·사운드는 이 프로젝트에서 직접 제작했습니다.</div>
    </div>`;
    this.ui.appendChild(s);
    s.querySelector('#m-battle')!.addEventListener('click', on.battle);
    s.querySelector('#m-settings')!.addEventListener('click', on.settings);
    s.querySelector('#m-help')!.addEventListener('click', on.help);
    s.querySelector('#m-about')!.addEventListener('click', on.about);
  }

  scenarios(onStart: (sc: Scenario, difficulty: number, scale: number) => void, onBack: () => void) {
    this.clear();
    const s = el('div', 'screen bg');
    s.style.flexDirection = 'column';
    let sel = SCENARIOS[0], diff = 1, scale = 1;
    const cards = SCENARIOS.map((sc) => {
      const side = (list: typeof sc.side0) => {
        const m = new Map<string, number>();
        for (const d of list) { const t = UNITS[d.unit]; m.set(t.faction, (m.get(t.faction) ?? 0) + unitSize(t)); }
        return [...m.entries()].map(([f, n]) => `<span class="chip" style="border-color:${FACTIONS[f as keyof typeof FACTIONS].color}">${FACTIONS[f as keyof typeof FACTIONS].ko} ${n}</span>`).join('');
      };
      return `<div class="scen panel" data-id="${sc.id}"><h3>${sc.ko}</h3><p>${sc.desc}</p><div class="chips">${side(sc.side0)}<span class="chip">VS</span>${side(sc.side1)}</div></div>`;
    }).join('');
    s.innerHTML = `<div class="title" style="max-width:1120px"><h1 style="font-size:clamp(24px,4vw,40px)">전투 선택</h1><h2>지휘할 전장을 고르십시오</h2></div>
      <div class="scen-grid">${cards}</div>
      <div class="row panel" style="padding:10px 14px;margin-top:12px">
        <span>난이도</span><button class="btn" data-d="0">쉬움</button><button class="btn on" data-d="1">보통</button><button class="btn" data-d="2">어려움</button>
        <span style="margin-left:10px">병력 규모</span><button class="btn on" data-s="1">기본</button><button class="btn" data-s="2">2배 (대규모 시험)</button>
      </div>
      <div class="row"><button class="btn" id="sc-back">← 뒤로</button><button class="btn big" id="sc-go">출전</button></div>`;
    this.ui.appendChild(s);
    const mark = () => s.querySelectorAll('.scen').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.id === sel.id));
    mark();
    s.querySelectorAll('.scen').forEach((c) => c.addEventListener('click', () => { sel = SCENARIOS.find((x) => x.id === (c as HTMLElement).dataset.id)!; mark(); }));
    s.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { diff = Number((b as HTMLElement).dataset.d); s.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x === b)); }));
    s.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { scale = Number((b as HTMLElement).dataset.s); s.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); }));
    s.querySelector('#sc-back')!.addEventListener('click', onBack);
    s.querySelector('#sc-go')!.addEventListener('click', () => onStart(sel, diff, scale));
  }

  settings(st: Settings, detected: string, onSave: (s: Settings) => void, onBack: () => void) {
    this.clear();
    const s = el('div', 'screen bg');
    s.innerHTML = `<div class="panel" style="padding:20px;width:min(520px,94vw)">
      <h2 class="serif" style="color:var(--brass);margin-top:0">설정</h2>
      <div class="opt-grid">
        <label>그래픽 품질</label><select id="o-q"><option value="auto">자동 (감지: ${detected})</option><option value="low">낮음 (디벗·저사양)</option><option value="medium">중간</option><option value="high">높음 (PC)</option></select>
        <label>그림자</label><select id="o-sh"><option value="1">켜기</option><option value="0">끄기</option></select>
        <label>후처리 (블룸·색보정)</label><select id="o-pp"><option value="1">켜기</option><option value="0">끄기</option></select>
        <label>FPS 표시</label><select id="o-fps"><option value="0">끄기</option><option value="1">켜기</option></select>
        <label>효과음</label><input id="o-v" type="range" min="0" max="1" step="0.05" />
        <label>배경음</label><input id="o-m" type="range" min="0" max="1" step="0.05" />
        <label>카메라 속도</label><input id="o-c" type="range" min="0.4" max="2" step="0.1" />
        <label>화면 가장자리 스크롤</label><select id="o-e"><option value="0">끄기</option><option value="1">켜기</option></select>
      </div>
      <div class="row"><button class="btn" id="o-back">취소</button><button class="btn big" id="o-save">저장</button></div></div>`;
    this.ui.appendChild(s);
    const q = (id: string) => s.querySelector(id) as HTMLInputElement;
    q('#o-q').value = st.quality; q('#o-sh').value = st.shadows ? '1' : '0'; q('#o-pp').value = st.post ? '1' : '0'; q('#o-fps').value = st.showFps ? '1' : '0';
    q('#o-v').value = String(st.volume); q('#o-m').value = String(st.music); q('#o-c').value = String(st.camSpeed); q('#o-e').value = st.edgePan ? '1' : '0';
    s.querySelector('#o-back')!.addEventListener('click', onBack);
    s.querySelector('#o-save')!.addEventListener('click', () => onSave({
      quality: q('#o-q').value as Settings['quality'], shadows: q('#o-sh').value === '1', post: q('#o-pp').value === '1', showFps: q('#o-fps').value === '1',
      volume: Number(q('#o-v').value), music: Number(q('#o-m').value), camSpeed: Number(q('#o-c').value), edgePan: q('#o-e').value === '1',
    }));
  }

  info(html: string, onBack: () => void) {
    this.clear();
    const s = el('div', 'screen bg');
    s.innerHTML = `<div class="panel help" style="padding:20px;width:min(760px,94vw)">${html}<div class="row"><button class="btn big" id="i-back">돌아가기</button></div></div>`;
    this.ui.appendChild(s);
    s.querySelector('#i-back')!.addEventListener('click', onBack);
  }

  loading() {
    this.clear();
    const s = el('div', 'loading');
    s.innerHTML = `<div class="serif" style="font-size:28px;color:var(--brass)">GRIMDARK TACTICS</div><div class="bar"><div></div></div><div class="msg">준비 중</div>`;
    this.ui.appendChild(s);
    return (p: number, msg: string) => { (s.querySelector('.bar > div') as HTMLDivElement).style.width = `${Math.round(p * 100)}%`; (s.querySelector('.msg') as HTMLDivElement).textContent = msg; };
  }

  pause(on: { resume: () => void; settings: () => void; restart: () => void; quit: () => void; help: () => void }) {
    const s = el('div', 'screen bg');
    s.innerHTML = `<div class="panel" style="padding:22px;width:min(360px,92vw);text-align:center"><h2 class="serif" style="color:var(--brass);margin-top:0">일시정지</h2>
      <div class="menu-col" style="width:100%"><button class="btn big" id="p-res">전투 계속</button><button class="btn" id="p-help">조작법</button><button class="btn" id="p-set">설정</button><button class="btn" id="p-re">다시 시작</button><button class="btn" id="p-quit">메인 메뉴로</button></div></div>`;
    this.ui.appendChild(s);
    const close = (fn: () => void) => () => { s.remove(); fn(); };
    s.querySelector('#p-res')!.addEventListener('click', close(on.resume));
    s.querySelector('#p-help')!.addEventListener('click', close(on.help));
    s.querySelector('#p-set')!.addEventListener('click', close(on.settings));
    s.querySelector('#p-re')!.addEventListener('click', close(on.restart));
    s.querySelector('#p-quit')!.addEventListener('click', close(on.quit));
  }

  error(msg: string) {
    this.clear();
    const s = el('div', 'screen bg');
    s.innerHTML = `<div class="panel" style="padding:24px"><div class="err">${msg}</div><div class="row"><button class="btn" onclick="location.reload()">새로고침</button></div></div>`;
    this.ui.appendChild(s);
  }
}

export const HELP_HTML = `<h2 class="serif" style="color:var(--brass);margin-top:0">조작법</h2>
<h3>PC (마우스 · 키보드)</h3>
<div><b>좌클릭</b> 부대 선택 · <b>Shift/Ctrl+클릭</b> 다중 선택 · <b>좌클릭 드래그</b> 범위 선택 · <kbd>Ctrl</kbd>+<kbd>A</kbd> 전체 선택 · <kbd>Tab</kbd> 다음 부대</div>
<div><b>배치 단계</b> 전투 전 파란 구역 안에 부대를 자유롭게 배치하고 <b>전투 시작</b>(Enter)</div>
<div><b>우클릭 (땅)</b> 이동 · <b>우클릭 드래그</b> 전선의 방향과 <b>폭</b> 지정(길게 끌면 얇고 넓은 전열, 짧게 끌면 두꺼운 대형) · <b>우클릭 (적)</b> 공격 (근접 부대는 돌격) · <b>더블 우클릭</b> 달려서 이동/공격</div>
<div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>/화살표 카메라 이동 · <kbd>Q</kbd><kbd>E</kbd> 회전 · 마우스 휠/<kbd>Z</kbd><kbd>X</kbd> 확대·축소 · 휠 클릭 드래그 회전·기울기</div>
<div><kbd>H</kbd> 정지 · <kbd>R</kbd> 달리기 · <kbd>C</kbd> 돌격 · <kbd>F</kbd> 자유 사격 · <kbd>G</kbd> 특수 능력 · <kbd>Alt</kbd>+<kbd>1</kbd>~<kbd>4</kbd> 전열/종대/산개/방어 진형 (그룹이 없을 때는 <kbd>1</kbd>~<kbd>4</kbd>만으로도) · <kbd>Ctrl</kbd>+<kbd>숫자</kbd> 부대 그룹 지정 · <kbd>숫자</kbd> 그룹 선택(두 번: 카메라 이동)</div>
<div><kbd>Space</kbd> 일시정지 (일시정지 중에도 명령 가능) · <kbd>+</kbd><kbd>-</kbd> 배속 · <kbd>Esc</kbd> 메뉴</div>
<h3>모바일 · 태블릿 (디벗)</h3>
<div>부대 카드나 부대 깃발을 <b>탭</b>해 선택 → <b>땅을 탭</b>해 이동, <b>적을 탭</b>해 공격 · 땅을 <b>길게 누르면</b> 달려서 이동</div>
<div><b>한 손가락 드래그</b> 카메라 이동 · <b>두 손가락</b> 벌리기/오므리기 확대·축소, 비틀기 회전, 위아래 기울기 · 미니맵 탭으로 이동</div>
<div>하단 명령 버튼: 정지 · 달리기 · 돌격 · 자유사격 · 진형 · 능력 · 전체 선택. 가로 화면을 권장합니다.</div>
<h3>전투 규칙</h3>
<div>병사마다 개별적으로 표적을 고르고 사격·근접전을 벌이며, 부대는 진형과 명령을 따릅니다. 정지한 부대는 주변 참호·모래주머니·벽 뒤로 엄폐합니다.</div>
<div><b>사기</b>: 손실·제압·측면/후방 공격으로 떨어지고 지휘관 근처에서 오릅니다. 바닥나면 부대가 패주합니다. <b>제압</b>: 집중 사격을 받으면 명중률·속도가 떨어지고 병사들이 몸을 숙입니다. <b>피로</b>: 달리기·근접전으로 쌓입니다.</div>
<div>스페이스 마린은 패주하지 않고, 크리그는 참호에서 강하며, 오크는 수가 많을수록 사기가 오르고 와아아그로 돌격합니다.</div>`;

export const ABOUT_HTML = `<h2 class="serif" style="color:var(--brass);margin-top:0">제작 정보</h2>
<div>Grimdark Tactics는 Warhammer 40,000 세계관의 비공식 팬 메이드 웹 전술 게임입니다. Games Workshop, Creative Assembly, SEGA와 관계가 없으며 원작의 모델·영상·사운드를 사용하지 않았습니다.</div>
<h3>직접 제작한 에셋</h3>
<div>스페이스 마린·아스트라 밀리타룸·데스 코어 오브 크리그·오크의 모든 3D 모델, 리깅, 애니메이션, 텍스처, 건물은 Blender 스크립트로 이 프로젝트에서 새로 만들었습니다. 지형 텍스처와 효과음은 실행 중 절차적으로 생성됩니다.</div>
<h3>사용한 오픈소스</h3>
<div>three.js (MIT) · meshoptimizer (MIT) · glTF-Transform (MIT) · Vite (MIT) · Blender (GPL, 제작 도구로만 사용)</div>`;
