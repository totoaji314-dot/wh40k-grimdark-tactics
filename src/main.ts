import * as THREE from 'three';
import './ui/style.css';
import { Game } from './Game';
import { Menu, HELP_HTML, ABOUT_HTML } from './ui/Menu';
import { Audio } from './core/Audio';
import { loadSettings, saveSettings, detectQuality, PRESETS, type QualityLevel } from './core/Settings';
import { SCENARIOS, type Scenario } from './sim/data';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const q = new URLSearchParams(location.search);

async function boot() {
  if (q.has('viewer')) { (await import('./viewer')).startViewer(canvas); return; }
  const menu = new Menu(ui);
  let renderer: THREE.WebGLRenderer;
  try {
    const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('webgl2');
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
  } catch {
    menu.error('이 기기/브라우저에서 WebGL2를 사용할 수 없습니다.<br/>최신 Chrome, Edge, Safari 또는 Samsung Internet에서 실행해 주세요.<br/>(하드웨어 가속이 꺼져 있다면 켜 주세요)');
    return;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  const settings = loadSettings();
  const detected = detectQuality(renderer.getContext() as WebGL2RenderingContext);
  const audio = new Audio();
  audio.setVolume(settings.volume, settings.music);
  let game: Game | null = null;
  const quality = (): QualityLevel => (settings.quality === 'auto' ? detected : settings.quality);

  // title backdrop: dark animated embers drawn with the renderer clear colour only
  renderer.setClearColor(0x0c0b0a);
  renderer.clear();

  const title = () => {
    menu.title({
      battle: () => { audio.unlock(); pick(); },
      settings: () => openSettings(title),
      help: () => menu.info(HELP_HTML, title),
      about: () => menu.info(ABOUT_HTML, title),
    });
  };
  const pick = () => menu.scenarios((sc, d, s) => start(sc, d, s), title);
  const openSettings = (back: () => void) => menu.settings(settings, detected, (ns) => { Object.assign(settings, ns); saveSettings(settings); audio.setVolume(settings.volume, settings.music); back(); }, back);

  const start = async (sc: Scenario, difficulty: number, scale: number) => {
    game?.dispose(); game = null;
    const progress = menu.loading();
    const g = new Game(renderer, ui, settings, audio, { scenario: sc, difficulty, scale, quality: quality() });
    try {
      g.resize();
      await g.load(progress);
    } catch (e) {
      console.error(e);
      menu.error('전투를 불러오지 못했습니다: ' + (e as Error).message);
      return;
    }
    menu.clear();
    game = g;
    (window as unknown as { __game: Game }).__game = g;
    g.onExit = () => { g.dispose(); game = null; title(); };
    g.onRetry = () => start(sc, difficulty, scale);
    g.onMenu = () => menu.pause({
      resume: () => { g.paused = false; },
      settings: () => openSettings(() => { menu.clear(); g.paused = false; }),
      restart: () => start(sc, difficulty, scale),
      quit: () => { g.dispose(); game = null; title(); },
      help: () => menu.info(HELP_HTML, () => { menu.clear(); g.paused = false; }),
    });
    g.start();
  };

  // test hooks for automated checks: ?auto=<scenario>&q=<quality>
  (window as unknown as { __app: unknown }).__app = {
    start: (id: string, diff = 1, scale = 1, qq?: QualityLevel) => { if (qq) settings.quality = qq; return start(SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0], diff, scale); },
    get game() { return game; },
    step: (n: number, dt = 1 / 30) => { for (let i = 0; i < n; i++) game?.frame(dt); },
    presets: PRESETS, detected,
  };
  if (q.has('auto')) {
    if (q.get('q')) settings.quality = q.get('q') as QualityLevel;
    start(SCENARIOS.find((s) => s.id === q.get('auto')) ?? SCENARIOS[0], 1, Number(q.get('scale') ?? 1));
  } else title();
}

boot();
