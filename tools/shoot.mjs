// Drive the game in a separate Chrome (real GPU) through the DevTools protocol: run a script of steps,
// take screenshots and measure frame rates. Used for visual verification and the mobile tests.
//   node tools/shoot.mjs <url> <script.json|inline-json> <outDir> [--mobile] [--tablet] [--headful]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, scriptArg, outArg] = process.argv.slice(2);
const flags = new Set(process.argv.slice(5));
const out = path.resolve(outArg ?? 'local_only/shots');
fs.mkdirSync(out, { recursive: true });
const steps = JSON.parse(fs.existsSync(scriptArg) ? fs.readFileSync(scriptArg, 'utf8') : scriptArg);
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((b) => fs.existsSync(b));
const port = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shot-'));
const W = flags.has('--mobile') ? 915 : flags.has('--tablet') ? 1280 : 1600;
const H = flags.has('--mobile') ? 412 : flags.has('--tablet') ? 800 : 900;
const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'];
if (!flags.has('--headful')) args.unshift('--headless=new');
const proc = spawn(exe, args, { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const waiting = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

async function main() {
  let ver;
  for (let i = 0; i < 40 && !ver; i++) { await sleep(250); ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
  const t = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 400));
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(msg.params.type + ' ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400));
  };
  await send('Page.enable'); await send('Runtime.enable');
  if (flags.has('--mobile') || flags.has('--tablet')) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: flags.has('--mobile') ? 2.6 : 1.5, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Network.enable');
    await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
  } else await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  const result = { url, gpu: null, steps: [] };
  for (const st of steps) {
    if (st.wait) await sleep(st.wait);
    if (st.js) {
      const v = await evaluate(st.js);
      result.steps.push({ js: st.js.slice(0, 80), v });
      if (st.print !== false) console.log('JS', JSON.stringify(v)?.slice(0, 600));
    }
    if (st.shot) {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
      fs.writeFileSync(path.join(out, st.shot + '.jpg'), Buffer.from(r.data, 'base64'));
      console.log('SHOT', st.shot);
    }
    if (st.tap) await touchTap(st.tap[0], st.tap[1]);
    if (st.drag) await touchDrag(st.drag);
  }
  console.log('LOGS', JSON.stringify(logs.slice(0, 20), null, 1));
}

async function touchTap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchDrag(d) {
  // d: { from: [[x,y],...fingers], to: [[x,y],...], steps }
  const n = d.steps ?? 10;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: d.from.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  for (let k = 1; k <= n; k++) {
    const pts = d.from.map(([x, y], i) => ({ x: x + (d.to[i][0] - x) * k / n, y: y + (d.to[i][1] - y) * k / n, id: i + 1 }));
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });
    await sleep(16);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

main().catch((e) => { console.error('FAIL', e.message, logs); process.exitCode = 1; }).finally(() => {
  try { ws?.close(); } catch { /* */ }
  proc.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* */ } process.exit(); }, 600);
});
