// Audio. Every sound is synthesized here; there are no sound files. Continuous layers (surf, wind, hiss, city)
// are filtered noise running live in the Web Audio graph. One-shots are rendered once into small pools of takes
// and replayed with random pitch and level, so nothing repeats exactly. No music: the ocean is the soundtrack.

export type SoundName = 'paddle' | 'splash' | 'slap' | 'popUp' | 'wipeout' | 'lift' | 'crash' | 'hoot' | 'eh' | 'go' | 'bump' | 'laugh' | 'ui';
export interface AudioFrame {
  listener: { x: number; y: number; z: number; fx: number; fy: number; fz: number }; // camera position and forward vector (world meters; +y up; the shore is toward -z, open sea toward +z)
  under: boolean; // camera is under water
  night: number; // 0 day .. 1 full night
  riding: number; // 0..1, how fast the player's board is moving on a wave (drives a rushing-water layer)
  whitewater: { x: number; z: number; power: number }[]; // up to 6 nearest patches of active whitewater, power 0..1
}

type Name = SoundName | 'gull';
type Vec = { x: number; y: number; z: number };

const SR = 32000; // one-shots are rendered at this rate whatever the device runs at; playback resamples
const PEAK = 0.4; // every rendered take is normalized to this peak (-8 dBFS)
const SLOTS = 16, HISS = 6, TAU = Math.PI * 2;

// Mix, with the sliders at 1. The shared noise is RMS 0.2 and each layer gain below folds in what its filter passes,
// so the layers land at these RMS levels at one ear: roar -31 dBFS, wind -35, city -38 at the beach, lapping -36,
// rush -24 at full speed, hiss -24 beside a patch at full power, the underwater rumble -28. In the lineup by day
// that sums to about -29 dBFS RMS (peaks near -18); with whitewater close on a fast ride it tops out near -20 RMS.
// One-shots peak at -8 dBFS times their trim in SOUNDS.
const AMB = 1; // trim for all ambience
const ROAR = AMB * 0.18, WIND = AMB * 0.25, CITY = AMB * 0.13, LAP = AMB * 0.25, DEEP = AMB * 0.22, RUSH = AMB * 0.75, FOAM = AMB * 0.64;
const LIMIT = -6; // limiter threshold (dBFS) at ratio 20; it holds even a pile-up of crashes to about -4
const MAKEUP = 10 ** ((0.6 * LIMIT * (1 - 1 / 20)) / 20); // a DynamicsCompressorNode adds makeup gain by this rule (0.6 of what it takes off at full scale); take it back out

const R = (a: number, b: number) => a + (b - a) * Math.random();
const N = () => Math.random() * 2 - 1;

// --- One-shot synthesis: plain loops over samples, no Web Audio needed ---

/** Trapezoidal state-variable filter: stable under fast sweeps. After run(): lp (resonant low-pass) and bp (band-pass, peak gain 1). */
class Svf {
  lp = 0; bp = 0; private a = 0; private b = 0;
  run(x: number, hz: number, q: number): this {
    const w = (Math.PI * hz) / SR, g = w * (1 + w * w * (1 / 3 + (2 / 15) * w * w)), k = 1 / q; // g = tan(w), near enough below 8 kHz
    const v1 = (this.a + g * (x - this.b)) / (1 + g * (g + k)), v2 = this.b + g * v1;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    this.lp = v2; this.bp = v1 * k;
    return this;
  }
}
/** Fill a buffer from a function of time (s). */
const fill = (dur: number, f: (t: number) => number) => { const o = new Float32Array((dur * SR) | 0); for (let i = 0; i < o.length; i++) o[i] = f(i / SR); return o; };
/** Linear attack over a seconds, then exponential decay with time constant d. Zero before t = 0. */
const hit = (t: number, a: number, d: number) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));
/** A dull knock: a sine that starts (1 + drop) times sharp and settles to hz within a few ms. */
const thud = (t: number, hz: number, drop: number, d: number) => (t < 0 ? 0 : Math.sin(TAU * hz * (t + drop * 0.012 * (1 - Math.exp(-t / 0.012)))) * hit(t, 0.002, d));
/** Normalize to the shared peak and close the tail, so levels are known and nothing ends on a click. */
function finish(o: Float32Array): Float32Array {
  let m = 1e-9; for (let i = 0; i < o.length; i++) m = Math.max(m, Math.abs(o[i]));
  const n = o.length, tail = Math.min(n >> 3, SR * 0.2);
  for (let i = 0; i < n; i++) o[i] *= (PEAK / m) * Math.min(1, (n - 1 - i) / tail);
  return o;
}

// Water and board. Each call draws new noise and new numbers, so every take in a pool is its own sound.
const paddle = () => { // a hand going in: a band of noise sliding down, a little spray, a small bubble
  const f = R(700, 1300), d = R(0.05, 0.09), b = R(260, 420), body = new Svf(), air = new Svf();
  return fill(0.34, (t) => { const n = N(); return body.run(n, f * (1 - 1.2 * t), 1.2).bp * hit(t, 0.006, d) + 0.2 * air.run(n, 4200, 0.7).bp * hit(t - 0.012, 0.004, d * 0.6) + 0.05 * Math.sin(TAU * b * t * (1 + 4 * t)) * hit(t - 0.03, 0.008, 0.03); });
};
const splash = () => { // low-passed noise that closes down fast, then droplets
  const f = R(1800, 2800), d = R(0.12, 0.2), lo = new Svf(), hi = new Svf();
  return fill(0.8, (t) => { const n = N(); return lo.run(n, 300 + f * Math.exp(-t / 0.15), 0.7).lp * hit(t, 0.008, d) + 0.25 * hi.run(n, 5200, 0.6).bp * hit(t - 0.03, 0.03, d * 1.5); });
};
const slap = () => { // board flat on the water: click, mid smack, hollow thump
  const f = R(900, 1500), th = R(120, 170), bp = new Svf();
  return fill(0.22, (t) => { const n = N(); return bp.run(n, f, 0.8).bp * hit(t, 0.001, 0.022) + 0.3 * n * hit(t, 0.0005, 0.003) + 0.18 * thud(t, th, 1, 0.045); });
};
const popUp = () => { // two feet landing on the deck with a scuff of wax between
  const gap = R(0.07, 0.11), th = R(140, 190), sc = new Svf();
  return fill(0.36, (t) => thud(t, th, 0.6, 0.04) + 0.8 * thud(t - gap, th * 1.15, 0.6, 0.035) + 1.5 * sc.run(N(), 2200, 1).bp * hit(t - gap * 0.4, 0.02, 0.05));
};
const bump = () => { // boards or bodies knocking: dull thud, a hollow overtone, a short knock
  const th = R(110, 150), kn = new Svf();
  return fill(0.26, (t) => thud(t, th, 1.2, 0.05) + 0.7 * thud(t, th * 2.7, 0.3, 0.03) + 2 * kn.run(N(), 650, 1.5).bp * hit(t, 0.001, 0.012));
};
const lift = () => { // the wave picking you up: a quick swell of rising noise over a low rumble
  const up = R(0.2, 0.28), sw = new Svf(), lo = new Svf();
  return fill(0.95, (t) => { const u = Math.min(1, t / up), n = N(); return (sw.run(n, 200 * 7 ** u, 1.4).lp + 2 * lo.run(n, 90, 1).lp) * (t < up ? u * u : Math.exp(-(t - up) / 0.22)); });
};
const wipeout = () => { // body hits, big splash, then a gurgle as you go under
  const f = R(2400, 3400), wob = R(9, 13), lo = new Svf(), gl = new Svf();
  return fill(1.6, (t) => { const n = N(); return 0.45 * thud(t, 80, 1, 0.09) + lo.run(n, 250 + f * Math.exp(-t / 0.25), 0.7).lp * hit(t, 0.01, 0.3) + 1.5 * gl.run(n, 550 + 260 * Math.sin(TAU * wob * t + 3 * Math.sin(TAU * 3.1 * t)), 5).bp * hit(t - 0.15, 0.12, 0.4); });
};
const crash = () => { // a section breaking: bright crack closing into wash, a slower rumble under it, foam fizz after
  const f = R(2200, 3600), d = R(0.5, 0.8), top = new Svf(), low = new Svf(), fizz = new Svf(); let wob = 0;
  return fill(d * 4.2, (t) => {
    const n = N(); wob += 0.002 * (n - wob); // slow random wobble (about 10 Hz) so the wash is uneven
    return (top.run(n, 500 + f * Math.exp(-t / 0.35), 0.6).lp * hit(t, 0.03, d) + 1.6 * low.run(n, 150, 0.9).lp * hit(t, 0.08, d * 1.4) + 0.15 * fizz.run(n, 2800, 0.5).bp * hit(t - 0.15, 0.25, d * 1.6)) * (1 + 12 * wob) + 0.3 * thud(t, 55, 0.8, 0.2);
  });
};
const ui = () => { const f = R(900, 1100); return fill(0.09, (t) => Math.sin(TAU * f * t * (1 + 3 * t)) * hit(t, 0.002, 0.016)); }; // a soft drop of water
const gull = () => { // one to three raspy notes, each rising fast and falling slowly
  const f = R(780, 1050), rasp = R(70, 110), len = R(0.22, 0.34), step = len + R(0.06, 0.12), notes = 1 + ((Math.random() * 3) | 0); let ph = 0;
  return fill(notes * step, (t) => {
    const k = Math.floor(t / step), u = (t - k * step) / len; if (u >= 1) return 0;
    ph += (TAU * f * (0.8 + 0.45 * Math.sin(Math.PI * u ** 0.6))) / SR;
    return (Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.35 * Math.sin(3 * ph) + 0.15 * Math.sin(4 * ph)) * (1 - 0.35 * Math.sin(TAU * rasp * t) ** 2) * Math.min(1, u / 0.08) * (1 - u) * 0.9 ** k;
  });
};

// Voices: simple formant synthesis. Sounds, not words, and nobody's accent.
type Who = { p: number; k: number }; // pitch factor and vocal-tract scale: a different person for every take
const who = (): Who => { const p = R(0.8, 1.25); return { p, k: 0.82 + 0.22 * p }; };
const V = { oo: [400, 900, 2400], u: [380, 780, 2300], eh: [580, 1800, 2550], e: [520, 1950, 2600], g: [260, 1250, 2150], o: [480, 880, 2450], ah: [760, 1250, 2600] }; // vowel shapes, F1..F3 in Hz
const Q = [5, 9, 10]; // formant sharpness: wide enough that a gliding harmonic does not whistle
/**
 * Add one syllable to o, starting `at` seconds in. A soft glottal pulse and a trace of breath go through three formant
 * resonators in series. Pitch runs a → b Hz with an arch on top; formants move A → B over `glide` seconds; `h` seconds of breath lead in.
 */
function syl(o: Float32Array, w: Who, at: number, dur: number, a: number, b: number, arch: number, A: number[], B: number[], h = 0, glide = dur, amp = 1): void {
  const F = [new Svf(), new Svf(), new Svf()], i0 = (at * SR) | 0, n = Math.min((dur * SR) | 0, o.length - i0), vib = R(0, TAU);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, u = i / n, m = Math.min(1, t / glide), v = h ? Math.min(1, Math.max(0, 1 + (t - h) / 0.03)) : 1; // v: voicing comes in as the breath hands over
    ph += (w.p * (a + (b - a) * u + arch * Math.sin(Math.PI * u)) * (1 + 0.012 * Math.sin(TAU * 5.5 * t + vib))) / SR; ph -= ph | 0;
    const x = ph / 0.6; // the glottis is open for 60% of each cycle; this is the slope of its flow pulse, which closes abruptly
    let y = (x < 1 ? x * (2 - 3 * x) : 0) * v + N() * (0.5 * (1 - v) + 0.06);
    for (let k = 0; k < 3; k++) y = F[k].run(y, w.k * (A[k] + (B[k] - A[k]) * m), Q[k]).lp;
    o[i0 + i] += y * amp * Math.min(1, t / 0.012, (dur - t) / (dur * 0.3));
  }
}
const hoot = () => { const d = R(0.38, 0.55), o = new Float32Array(((d + 0.02) * SR) | 0); syl(o, who(), 0, d, 300, 360, 50, V.oo, V.u, 0.06); return o; }; // "Hoo!", rising
const eh = () => { const d = R(0.16, 0.22), o = new Float32Array(((d + 0.02) * SR) | 0); syl(o, who(), 0, d, 215, 185, 22, V.eh, V.e); return o; }; // "Eh!", short and bright
const go = () => { // "Go, go!": two quick syllables, each opening from a soft g
  const w = who(), d = R(0.15, 0.18), gap = d + R(0.06, 0.1), o = new Float32Array(((gap + d * 1.1 + 0.02) * SR) | 0);
  syl(o, w, 0, d, 200, 188, 8, V.g, V.o, 0.012, 0.055); syl(o, w, gap, d * 1.1, 216, 168, 6, V.g, V.o, 0.012, 0.055);
  return o;
};
const laugh = () => { // three to five breathy "ha"s stepping down
  const w = who(), n = 3 + ((Math.random() * 3) | 0), step = R(0.17, 0.21), o = new Float32Array(((n * step + 0.05) * SR) | 0);
  for (let i = 0; i < n; i++) syl(o, w, i * step, 0.13, 265 - 16 * i, 245 - 16 * i, 12, V.ah, V.ah, 0.05, 0.13, 0.85 ** i);
  return o;
};

/** Every one-shot: [render one take, takes kept, trim (1 = -8 dBFS peak inside the reference distance), panner reference distance (m), rolloff]. */
const SOUNDS: Record<Name, [make: () => Float32Array, takes: number, trim: number, ref: number, roll: number]> = {
  ui: [ui, 3, 0.3, 4, 1], paddle: [paddle, 5, 0.35, 3, 1.2], splash: [splash, 4, 0.7, 4, 1.2], slap: [slap, 4, 0.6, 4, 1.2],
  popUp: [popUp, 3, 0.5, 3, 1.2], bump: [bump, 4, 0.7, 3, 1.2], lift: [lift, 3, 0.6, 4, 1], wipeout: [wipeout, 3, 1, 5, 1],
  crash: [crash, 5, 1, 25, 1], hoot: [hoot, 5, 0.6, 6, 0.8], eh: [eh, 4, 0.55, 6, 0.8], go: [go, 4, 0.65, 6, 0.8], laugh: [laugh, 4, 0.7, 6, 0.8],
  gull: [gull, 4, 0.3, 30, 1],
};
const NAMES = Object.keys(SOUNDS) as Name[];
const VOICES: ReadonlySet<Name> = new Set<Name>(['hoot', 'eh', 'go', 'laugh']);
const SHORE: Name[] = ['laugh', 'laugh', 'hoot', 'eh']; // what drifts out from the beach by day

// --- The live graph ---

/** A level that frame() steers every frame. It eases here and writes the AudioParam only when it has moved, so nothing is scheduled or allocated. */
class Eased {
  v = 0; private sent = 0;
  constructor(private p: AudioParam, private scale: number) {}
  to(target: number, k: number): void {
    this.v += (target - this.v) * k;
    if (target === 0 && this.v < 0.002) this.v = 0;
    if (this.v === 0 ? this.sent !== 0 : Math.abs(this.v - this.sent) > 0.004) this.p.value = (this.sent = this.v) * this.scale;
  }
}
const glide = (p: AudioParam, v: number, now: number, tau: number) => p.setTargetAtTime(v, now, tau);
const wake = (c: AudioContext) => { c.resume().catch(() => {}); };

function build(c: AudioContext) {
  const gain = (v: number, to: AudioNode) => { const g = new GainNode(c, { gain: v }); g.connect(to); return g; };
  // Master: everything → underwater low-pass → limiter → master volume. UI blips skip the low-pass.
  const out = gain(0, c.destination);
  const limiter = new DynamicsCompressorNode(c, { threshold: LIMIT, knee: 0, ratio: 20, attack: 0.003, release: 0.25 }); limiter.connect(out);
  const lowpass = new BiquadFilterNode(c, { type: 'lowpass', frequency: 20000, Q: 0 }); lowpass.connect(limiter);
  const sfx = gain(0, lowpass), dry = gain(0, limiter), duck = gain(1, lowpass), amb = gain(0, duck);
  const surfEq = new BiquadFilterNode(c, { type: 'lowshelf', frequency: 220, gain: 0 }); surfEq.connect(amb); // roar and hiss gain low end at night

  // One buffer of pink noise feeds every continuous layer. Each voice loops its own slice at its own speed, so no two are alike.
  const pink = c.createBuffer(1, c.sampleRate * 8, c.sampleRate), d = pink.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const w = N(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = b0 + b1 + b2 + w * 0.1848; sum += d[i] * d[i]; }
  const norm = 0.2 / Math.sqrt(sum / d.length); for (let i = 0; i < d.length; i++) d[i] *= norm;
  /** Slow sine added to a param, at its own random rate. */
  const lfo = (p: AudioParam, depth: number) => { const o = new OscillatorNode(c, { frequency: R(0.04, 0.2) }); o.connect(new GainNode(c, { gain: depth })).connect(p); o.start(); };
  /** One voice of filtered noise whose level breathes slowly (never below 1 - 1.6 * swell). Returns its filter. */
  const noise = (type: BiquadFilterType, hz: number, q: number, swell: number, to: AudioNode, input = 0) => {
    const src = new AudioBufferSourceNode(c, { buffer: pink, loop: true, playbackRate: R(0.85, 1.15) }), f = new BiquadFilterNode(c, { type, frequency: hz, Q: q }), g = new GainNode(c);
    src.connect(f).connect(g).connect(to, 0, input); src.start(0, Math.random() * pink.duration);
    lfo(g.gain, swell); lfo(g.gain, swell * 0.6);
    return f;
  };
  /** A panner at a spot in the world. With rolloff 0 it only gives direction. Equal-power is the cheap model: fine for wide, far beds. */
  const spot = (x: number, y: number, z: number, to: AudioNode, ref = 1, roll = 0, model: PanningModelType = 'equalpower') => { const p = new PannerNode(c, { panningModel: model, refDistance: ref, rolloffFactor: roll, positionX: x, positionY: y, positionZ: z }); p.connect(to); return p; };

  const roar = gain(0, surfEq), wind = gain(0, amb), city = gain(0, amb), lap = gain(0, amb), deep = gain(0, amb), rushG = gain(0, amb);
  const ears = new ChannelMergerNode(c, { numberOfInputs: 2 }); ears.connect(wind);
  for (const s of [0, 1]) {
    noise('lowpass', 700, -3, 0.3, spot(s ? 4000 : -4000, 0, 3000, roar)); // distant surf: two voices spread across the seaward horizon
    noise('bandpass', 240, 0.5, 0.2, spot(s ? 700 : -700, 30, -400, city)); // city hum from behind the beach
    lfo(noise('bandpass', 480, 1.1, 0.3, ears, s).frequency, 140); // wind: one voice per ear, gusting
    noise('bandpass', 1500, 0.6, 0.45, spot(s ? 40 : -40, 0.3, 2, lap, 25, 1.2)); // small waves lapping on the sand
  }
  noise('lowpass', 160, 8, 0.3, deep); // the rumble you hear held under
  const rushF = noise('bandpass', 700, 0.7, 0.15, rushG); // water rushing past the board
  const hiss = Array.from({ length: HISS }, () => { // whitewater: voices that frame() parks on the nearest patches. HRTF, so you can tell it is behind you
    const g = new GainNode(c, { gain: 0 }), pan = spot(0, 0.3, 0, surfEq, 8, 1, 'HRTF');
    g.connect(pan); noise('bandpass', 2800, 0.4, 0.25, g);
    return { pan, lvl: new Eased(g.gain, FOAM), x: 0, z: 0, want: 0 };
  });
  // One-shots share 16 slots. Each keeps an HRTF panner (built once: they are costly to make) for positional plays.
  const slots = Array.from({ length: SLOTS }, () => ({ pan: new PannerNode(c, { panningModel: 'HRTF' }), bus: null as AudioNode | null, src: null as AudioBufferSourceNode | null, amp: null as GainNode | null, end: 0 }));
  const pools = Object.fromEntries(NAMES.map((n) => [n, [] as AudioBuffer[]])) as Record<Name, AudioBuffer[]>;

  // Render the pools a few ms at a time so they never stall a frame: one take of every sound first, then the spares.
  const jobs: Name[] = [];
  for (let take = 0; take < 5; take++) for (const n of NAMES) if (take < SOUNDS[n][1]) jobs.push(n);
  const slice = () => {
    for (const until = performance.now() + 4; jobs.length && performance.now() < until; ) {
      const n = jobs.shift()!, take = finish(SOUNDS[n][0]()), buf = c.createBuffer(1, take.length, SR);
      buf.getChannelData(0).set(take); pools[n].push(buf);
    }
    if (jobs.length) setTimeout(slice, 0);
  };
  slice();
  return { c, out, sfx, dry, amb, duck, lowpass, surfEq, roar, wind, city, lap, deep, rush: new Eased(rushG.gain, RUSH), rushF, hiss, slots, pools };
}

export class GameAudio {
  private g: ReturnType<typeof build> | null = null; // null until unlock(): every method is a no-op before that
  private vol = { master: 1, sfx: 1, ambience: 1 };
  private last: Partial<Record<Name, number>> = {};
  private lx = 0; private ly = 0; private lz = 0;
  private night = 0; private under = false; private shore = -1; private rushHz = -1; private wait = 3;
  private at: Vec = { x: 0, y: 0, z: 0 };

  /** Call from the first pointer or key event (calling it on every one is fine). Browsers allow sound only after a gesture. */
  unlock(): void {
    if (!this.g) {
      if (typeof AudioContext === 'undefined') return;
      let c: AudioContext;
      try { c = new AudioContext({ latencyHint: 'interactive' }); } catch { return; } // no audio device: stay silent
      this.g = build(c);
      document.addEventListener('visibilitychange', () => { if (document.hidden) c.suspend().catch(() => {}); else wake(c); }); // a hidden tab goes quiet
      this.setVolumes(this.vol);
    }
    if (this.g.c.state !== 'running') wake(this.g.c);
  }

  /** Each 0..1, as shown on a slider; squared here so the slider feels even. Remembered if called before unlock(). */
  setVolumes(v: { master: number; sfx: number; ambience: number }): void {
    const sq = (x: number) => Math.min(1, Math.max(0, x || 0)) ** 2, g = this.g;
    this.vol = { master: v.master, sfx: v.sfx, ambience: v.ambience };
    if (!g) return;
    const now = g.c.currentTime;
    glide(g.out.gain, sq(v.master) * MAKEUP, now, 0.03); glide(g.amb.gain, sq(v.ambience), now, 0.03);
    glide(g.sfx.gain, sq(v.sfx), now, 0.03); glide(g.dry.gain, sq(v.sfx), now, 0.03);
  }

  /** Call every rendered frame: moves the listener and keeps the continuous layers in step with the world. */
  frame(dt: number, f: AudioFrame): void {
    const g = this.g, p = f.listener;
    if (!g || g.c.state !== 'running' || !Number.isFinite(p.x + p.y + p.z + p.fx + p.fy + p.fz)) return; // an AudioParam throws on NaN; a bad frame must not stop the game
    dt = dt > 0 ? Math.min(dt, 1) : 0;
    const L = g.c.listener, now = g.c.currentTime, k = Math.min(1, dt * 5);
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = p.fx; L.forwardY.value = p.fy; L.forwardZ.value = p.fz; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(p.fx, p.fy, p.fz, 0, 1, 0); } // Firefox
    this.lx = p.x; this.ly = p.y; this.lz = p.z;

    // Ambience follows time of day, being under water, and distance from the beach. Retarget only when one of them has really moved.
    const shore = 120 / (120 + Math.max(0, p.z)), night = Math.min(1, Math.max(0, f.night));
    if (f.under !== this.under || Math.abs(night - this.night) > 0.02 || Math.abs(shore - this.shore) > 0.03) {
      const dry = f.under ? 0 : 1;
      this.under = f.under; this.night = night; this.shore = shore;
      glide(g.lowpass.frequency, f.under ? 420 : 20000, now, f.under ? 0.05 : 0.12); // the whole mix goes dull under water
      glide(g.roar.gain, ROAR * (1 + 0.15 * night) * (f.under ? 0.6 : 1), now, 0.4); // at night the surf is a little louder
      glide(g.surfEq.gain, 2 * night, now, 0.4); // and fuller
      glide(g.wind.gain, WIND * dry, now, 0.2);
      glide(g.city.gain, CITY * (1 - 0.8 * night) * shore * dry, now, 0.4); // the city quiets down at night
      glide(g.lap.gain, LAP * dry, now, 0.2);
      glide(g.deep.gain, DEEP * (1 - dry), now, 0.15);
      for (let j = 0; j < HISS; j++) g.hiss[j].pan.rolloffFactor = 1 - 0.45 * night; // and the hiss carries farther
    }

    // Water rushing past the board: louder and brighter with speed.
    const r = f.under ? 0 : Math.min(1, Math.max(0, f.riding || 0));
    g.rush.to(r * Math.sqrt(r), k);
    if (Math.abs(r - this.rushHz) > 0.02) g.rushF.frequency.value = 700 + 1600 * (this.rushHz = r);

    // Whitewater hiss. A sounding voice stays with the patch within 8 m of it; a patch nobody holds takes an idle voice,
    // which jumps there and fades in. Voices left without a patch fade out where they are. Loops never restart.
    const ww = f.whitewater, hs = g.hiss;
    for (let j = 0; j < HISS; j++) hs[j].want = 0;
    for (let i = 0; i < ww.length && i < HISS; i++) {
      const w = ww[i]; if (!(w.power > 0) || !Number.isFinite(w.x + w.z)) continue;
      let best = -1, bd = 64;
      for (let j = 0; j < HISS; j++) { const v = hs[j]; if (v.want > 0) continue; const d = v.lvl.v > 0 ? (v.x - w.x) ** 2 + (v.z - w.z) ** 2 : 63; if (d < bd) { bd = d; best = j; } }
      if (best < 0) continue; // all six are busy; one frees up within a second
      const v = hs[best];
      v.x = w.x; v.z = w.z; v.want = Math.min(1, w.power);
      v.pan.positionX.value = w.x; v.pan.positionZ.value = w.z;
    }
    for (let j = 0; j < HISS; j++) hs[j].lvl.to(hs[j].want, k);

    // Life at the edges, by day and above water: a gull somewhere overhead, or a voice from the beach.
    if (!f.under && (this.wait -= dt) < 0) {
      this.wait = R(4, 14);
      if (Math.random() > night * 2) { // thins out through dusk; gone by night
        const a = this.at, bird = Math.random() < 0.6;
        a.x = bird ? p.x + R(-90, 90) : R(-70, 70); a.y = bird ? R(12, 40) : 1.5; a.z = bird ? p.z + R(-60, 90) : R(-12, -2);
        if (bird) this.fire('gull', g.amb, SOUNDS.gull[2] * R(0.5, 1), R(0.88, 1.12), a);
        else this.fire(SHORE[(Math.random() * SHORE.length) | 0], g.amb, R(0.6, 1), R(1.15, 1.45), a); // pitched up: kids playing
      }
    }
  }

  /** One-shot, positional if `at` is given. For 'crash', gain is the size of the wave. */
  play(name: SoundName, at?: Vec, gain = 1): void {
    const g = this.g;
    if (!g || g.c.state !== 'running') return;
    const [, , trim, ref, roll] = SOUNDS[name], level = Math.min(2, Math.max(0, gain));
    // Bigger waves break lower, and at night the surf has a little more low end.
    const rate = R(0.94, 1.06) * (name === 'crash' ? (1.1 - 0.12 * Math.min(1, level)) * (1 - 0.06 * this.night) : 1);
    const dur = this.fire(name, name === 'ui' ? g.dry : g.sfx, trim * level * R(0.75, 1), rate, at);
    if (dur && VOICES.has(name)) { // the ambience steps back while someone calls out, less so the farther off they are
      const d = at ? Math.hypot(at.x - this.lx, at.y - this.ly, at.z - this.lz) : 0, now = g.c.currentTime;
      const depth = 0.5 * Math.min(1, (2 * level * ref) / (ref + roll * Math.max(0, d - ref)));
      g.duck.gain.cancelScheduledValues(now); glide(g.duck.gain, 1 - depth, now, 0.04); glide(g.duck.gain, 1, now + dur, 0.3);
    }
  }

  /** Start one take in a free slot. Returns its length in seconds, or 0 if the sound has no takes yet. */
  private fire(name: Name, bus: AudioNode, gain: number, rate: number, at?: Vec): number {
    const g = this.g!, c = g.c, pool = g.pools[name], now = c.currentTime;
    if (!pool.length || !(gain > 0) || (at && !Number.isFinite(at.x + at.y + at.z))) return 0;
    let i = (Math.random() * pool.length) | 0;
    if (i === this.last[name]) i = (i + 1) % pool.length; // never the same take twice running
    this.last[name] = i;
    let s = g.slots[0];
    for (const o of g.slots) if (o.end < s.end) s = o;
    if (s.end > now) { s.amp!.gain.setTargetAtTime(0, now, 0.01); s.src!.stop(now + 0.06); } // all 16 busy: the one nearest its end bows out
    const src = new AudioBufferSourceNode(c, { buffer: pool[i], playbackRate: rate }), amp = new GainNode(c, { gain });
    src.connect(amp); src.onended = () => amp.disconnect();
    if (at) {
      const p = s.pan, [, , , ref, roll] = SOUNDS[name];
      p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z;
      p.refDistance = ref; p.rolloffFactor = name === 'crash' ? roll * (1 - 0.45 * this.night) : roll; // breaking waves carry farther at night
      if (s.bus !== bus) { p.disconnect(); p.connect(bus); s.bus = bus; }
      amp.connect(p);
    } else amp.connect(bus);
    src.start();
    s.src = src; s.amp = amp; s.end = now + pool[i].duration / rate;
    return pool[i].duration / rate;
  }
}
