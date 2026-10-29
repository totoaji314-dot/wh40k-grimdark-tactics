// Procedural battle audio (WebAudio synthesis only, no sample files). Positional by distance / screen side.

type Kind = 'las' | 'bolter' | 'hbolter' | 'stubber' | 'plasma' | 'slugga' | 'shoota' | 'explosion' | 'melee' | 'chainsword' | 'waaagh' | 'whistle' | 'click' | 'horn' | 'death' | 'jet' | 'pod';

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private mus!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  private ambient: AudioNode[] = [];
  private shaper!: WaveShaperNode;
  volume = 0.8; music = 0.45;
  listener = { x: 0, z: 0, yaw: 0, dist: 60 };

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { return; }
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
      this.sfx = c.createGain(); this.sfx.connect(comp); comp.connect(this.master);
      this.mus = c.createGain(); this.mus.gain.value = this.music * 0.5; this.mus.connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.shaper = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
      this.shaper.curve = curve; this.shaper.connect(this.sfx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v: number, m: number) {
    this.volume = v; this.music = m;
    if (this.ctx) { this.master.gain.value = v; this.mus.gain.value = m * 0.5; }
  }

  private src(dur: number) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.loopStart = Math.random(); s.start(c.currentTime, Math.random() * 1.5, dur + 0.1);
    return s;
  }
  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  /** Play a sound at world position (x, z). */
  play(kind: Kind, x?: number, z?: number, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime;
    // throttle identical sounds so 100 lasguns do not clip
    const gap = { las: 0.03, bolter: 0.04, hbolter: 0.035, stubber: 0.03, plasma: 0.08, slugga: 0.04, shoota: 0.04, explosion: 0.08, melee: 0.05, chainsword: 0.12, waaagh: 1.5, whistle: 1, click: 0.02, horn: 2, death: 0.12, jet: 1, pod: 1 }[kind];
    if (t - (this.last.get(kind) ?? -1) < gap) return;
    this.last.set(kind, t);
    let g = vol, pan = 0;
    if (x !== undefined && z !== undefined) {
      const dx = x - this.listener.x, dz = z - this.listener.z;
      const d = Math.hypot(dx, dz);
      g *= 1 / (1 + Math.max(0, d - 10) / 35) * (1 / (1 + this.listener.dist / 200));
      const ang = Math.atan2(dx, dz) - this.listener.yaw;
      pan = Math.max(-0.9, Math.min(0.9, -Math.sin(ang)));
      if (g < 0.02) return;
    }
    const out = c.createGain(); out.gain.value = g;
    const p = c.createStereoPanner(); p.pan.value = pan;
    out.connect(p); p.connect(kind === 'slugga' || kind === 'shoota' ? this.shaper : this.sfx);
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, a = 0.004) => {
      const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const e = c.createGain(); this.env(e, t, a, peak, dur); o.connect(e); e.connect(out); o.start(t); o.stop(t + dur + 0.05);
    };
    const nz = (type: BiquadFilterType, f: number, q: number, dur: number, peak: number, a = 0.002) => {
      const s = this.src(dur); const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const e = c.createGain(); this.env(e, t, a, peak, dur); s.connect(fl); fl.connect(e); e.connect(out);
    };
    switch (kind) {
      case 'las': osc('sine', 1700 + Math.random() * 300, 260, 0.13, 0.22); nz('bandpass', 3000, 2, 0.05, 0.12); break;
      case 'bolter': nz('lowpass', 1600, 0.7, 0.22, 0.7); osc('sine', 110, 45, 0.25, 0.6); nz('highpass', 4000, 0.7, 0.03, 0.3); break;
      case 'hbolter': nz('lowpass', 1300, 0.7, 0.28, 0.85); osc('sine', 85, 38, 0.3, 0.8); nz('highpass', 3000, 0.7, 0.04, 0.3); break;
      case 'stubber': nz('bandpass', 1100, 1.2, 0.07, 0.6); osc('square', 160, 80, 0.05, 0.15); break;
      case 'plasma': {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.45);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.45);
        const e = c.createGain(); this.env(e, t, 0.01, 0.35, 0.45); o.connect(f); f.connect(e); e.connect(out); o.start(t); o.stop(t + 0.5);
        nz('bandpass', 2500, 1, 0.3, 0.25); break;
      }
      case 'slugga': case 'shoota': nz('lowpass', 1400, 0.8, 0.16, 0.8); osc('square', 140, 50, 0.08, 0.25); break;
      case 'explosion': nz('lowpass', 500, 0.6, 1.3, 1.0, 0.01); osc('sine', 60, 25, 0.9, 0.9, 0.01); nz('bandpass', 1500, 0.8, 0.25, 0.4); break;
      case 'melee': [720, 1110, 1530].forEach((f) => osc('square', f * (0.95 + Math.random() * 0.1), f * 0.9, 0.16, 0.06)); nz('lowpass', 600, 1, 0.08, 0.35); break;
      case 'chainsword': {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(150, t + 0.35);
        const e = c.createGain(); this.env(e, t, 0.02, 0.18, 0.4); o.connect(e); e.connect(out); o.start(t); o.stop(t + 0.45);
        nz('bandpass', 1800, 2, 0.35, 0.15); break;
      }
      case 'waaagh': {
        // a crowd of low voices sliding "waaa-gh" through vowel formants
        for (let v = 0; v < 7; v++) {
          const o = c.createOscillator(); o.type = 'sawtooth';
          const f0 = 85 + Math.random() * 50, st = t + Math.random() * 0.12;
          o.frequency.setValueAtTime(f0 * 0.9, st); o.frequency.linearRampToValueAtTime(f0 * 1.15, st + 0.5); o.frequency.linearRampToValueAtTime(f0 * 0.8, st + 1.6);
          const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.setValueAtTime(400, st); f1.frequency.linearRampToValueAtTime(800, st + 0.35); f1.frequency.linearRampToValueAtTime(350, st + 1.5);
          const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 8; f2.frequency.setValueAtTime(900, st); f2.frequency.linearRampToValueAtTime(1250, st + 0.4); f2.frequency.linearRampToValueAtTime(700, st + 1.5);
          const e = c.createGain(); e.gain.setValueAtTime(0.0001, st); e.gain.exponentialRampToValueAtTime(0.22, st + 0.15); e.gain.setValueAtTime(0.22, st + 1.1); e.gain.exponentialRampToValueAtTime(0.0001, st + 1.8);
          o.connect(f1); o.connect(f2); f1.connect(e); f2.connect(e); e.connect(out); o.start(st); o.stop(st + 1.9);
        }
        nz('lowpass', 600, 0.5, 1.6, 0.2, 0.2); break;
      }
      case 'whistle': for (let k = 0; k < 3; k++) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 2300 + (k % 2) * 180; const e = c.createGain(); const st = t + k * 0.18; e.gain.setValueAtTime(0.0001, st); e.gain.exponentialRampToValueAtTime(0.2, st + 0.02); e.gain.exponentialRampToValueAtTime(0.0001, st + 0.16); o.connect(e); e.connect(out); o.start(st); o.stop(st + 0.2); } break;
      case 'horn': osc('sawtooth', 110, 104, 1.6, 0.25, 0.15); osc('sawtooth', 165, 158, 1.6, 0.18, 0.15); break;
      case 'click': osc('square', 1200, 900, 0.04, 0.08); break;
      case 'jet': nz('bandpass', 650, 0.45, 2.4, 0.9, 0.5); nz('lowpass', 260, 0.7, 2.6, 0.7, 0.6); osc('sawtooth', 230, 75, 2.3, 0.07, 0.4); break;
      case 'pod': nz('highpass', 1800, 0.6, 2.2, 0.5, 1.6); osc('sawtooth', 900, 140, 2.3, 0.06, 1.8); break;
      case 'death': nz('lowpass', 700, 1, 0.25, 0.2); osc('sawtooth', 160, 80, 0.3, 0.06, 0.02); break;
    }
  }

  /** Battlefield ambience + slow drone score. */
  startAmbience() {
    if (!this.ctx || this.ambient.length) return;
    const c = this.ctx;
    const wind = c.createBufferSource(); wind.buffer = this.noise; wind.loop = true;
    const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380;
    const wg = c.createGain(); wg.gain.value = 0.06;
    wind.connect(wf); wf.connect(wg); wg.connect(this.sfx); wind.start();
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 160; lfo.connect(lg); lg.connect(wf.frequency); lfo.start();
    const notes = [55, 82.4, 110, 65.4];
    for (const f of notes) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.004;
      const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 340;
      const g = c.createGain(); g.gain.value = 0.05;
      const l2 = c.createOscillator(); l2.frequency.value = 0.03 + Math.random() * 0.05; const lg2 = c.createGain(); lg2.gain.value = 0.04; l2.connect(lg2); lg2.connect(g.gain); l2.start();
      o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(this.mus); o.start(); o2.start();
      this.ambient.push(o, o2, l2);
    }
    this.ambient.push(wind, lfo);
    // distant artillery
    const boom = () => {
      if (!this.ctx) return;
      const tt = this.ctx.currentTime;
      const s = this.src(2.5); const fl = this.ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 160;
      const e = this.ctx.createGain(); this.env(e, tt, 0.02, 0.25 + Math.random() * 0.2, 2.2);
      s.connect(fl); fl.connect(e); e.connect(this.sfx);
      this.onDistantBoom?.();
      setTimeout(boom, 3000 + Math.random() * 9000);
    };
    setTimeout(boom, 2500);
  }
  onDistantBoom?: () => void;

  stopAmbience() { for (const n of this.ambient) { try { (n as OscillatorNode).stop(); } catch { /* */ } } this.ambient = []; }
}
