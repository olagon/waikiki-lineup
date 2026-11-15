// The wave model: a pure function of (room seed, time). Waves never go over the network.
// Clients and the server each compute the same waves. Arithmetic and sqrt only, so every engine agrees.
import { hash32, rand01, randRange } from './rng';
import { TUNING as T } from './tuning';

export interface BreakSpec {
  id: number; name: string;
  centerX: number; zb: number; // peak position along the shore and the reef line where waves start to break
  halfWidth: number; // reef half-width; outside it waves are small and close out on the sand
  peelL: [number, number]; peelR: [number, number]; // peel speed ranges toward -x and +x (m/s)
  steep: number; // face steepness factor
  size: number; // multiplier on the day's size
  twoPeak: number; // chance a set wave has a second peak
}
export const BREAKS: Record<string, BreakSpec> = {
  canoes: { id: 0, name: 'Canoes', centerX: 0, zb: 110, halfWidth: 125, peelL: [4, 6], peelR: [3.2, 5], steep: 1, size: 0.9, twoPeak: 0.65 },
  queens: { id: 1, name: 'Queens', centerX: 0, zb: 112, halfWidth: 105, peelL: [5.5, 7], peelR: [3, 4.2], steep: 1.3, size: 1, twoPeak: 0.25 },
};

export interface Peak { x: number; dt: number; vl: number; vr: number } // dt: seconds after wave.tb this peak starts to break
export interface Wave {
  id: number; // unique among active waves; fits in 16 bits
  tb: number; // time (s since epoch) the crest reaches the reef line and the first peak breaks
  h: number; // face height at breaking (m)
  reach: number; // how far the whitewater runs before it dies (m)
  set: boolean;
  peaks: Peak[];
}

export const C0 = T.waves.speed; // open-water crest speed
const C1 = 3; // crest speed as it reaches the sand
const Z_END = 6; // waves die here
const Z_SPAWN = 310; // crests are first drawn this far out
const BLOCK = 1800; // the schedule is laid out in half-hour blocks so it is a pure function of time
const T_SHOAL = 14; // seconds of standing up before a section breaks
export const T_CURL = 1.2; // seconds a section spends pitching over before it is whitewater
const W_OFF = 10; // half-width of the swell hump in open water (m)
const NO_PEAK = 1e6;
const PEAKED = 1.2; // how sharply the front face rises into the crest at the moment of breaking

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Timing of the crest once it is inside the reef line: it slows steadily from C0 to C1. */
export const inside = (b: BreakSpec) => { const tin = (2 * (b.zb - Z_END)) / (C0 + C1); return { tin, dec: (C0 - C1) / tin }; };
/** Seconds a wave is alive before and after tb. */
export const lifetime = (b: BreakSpec) => ({ pre: (Z_SPAWN - b.zb) / C0, post: inside(b).tin });

/** The day's wave size (face height of the bigger set waves), from the room seed and the Hawaiʻi calendar day. */
export function dayHeight(seed: number, t: number, b: BreakSpec): number {
  const day = Math.floor((t - 36000) / 86400);
  const h = randRange(1.15, T.waves.face[1], seed, day, 77) * b.size;
  return Math.min(T.waves.face[1], Math.max(1.1, h));
}

function makePeaks(seed: number, key: number, b: BreakSpec, set: boolean): Peak[] {
  const r = (i: number) => rand01(seed, key, i);
  const peel = (range: [number, number], i: number) => lerp(range[0], range[1], r(i));
  const main: Peak = { x: b.centerX + lerp(-22, 28, r(1)), dt: 0, vl: peel(b.peelL, 2), vr: peel(b.peelR, 3) };
  if (r(4) >= (set ? b.twoPeak : b.twoPeak * 0.5)) return [main];
  const side = r(5) < 0.6 ? 1 : -1;
  return [main, { x: main.x + side * lerp(70, 105, r(6)), dt: lerp(0.4, 2.6, r(7)), vl: peel(b.peelL, 8), vr: peel(b.peelR, 9) }];
}

const blocks = new Map<string, Wave[]>();
const blockStart = (seed: number, blk: number) => blk * BLOCK + randRange(20, 50, seed, blk, 10);
/**
 * All set waves whose block is `blk`. Sets follow one another: 3-5 waves 10-14 s apart, then a 45-75 s lull.
 * Each block fits a whole number of sets between its own start and the next block's, so the layout
 * depends only on (seed, block, break) and blocks join without a gap. Memoized.
 */
function blockSets(seed: number, blk: number, b: BreakSpec): Wave[] {
  const key = seed + ':' + blk + ':' + b.id;
  let out = blocks.get(key);
  if (out) return out;
  out = [];
  const hDay = dayHeight(seed, blk * BLOCK, b), span = blockStart(seed, blk + 1) - blockStart(seed, blk);
  const lullMid = (T.waves.setEvery[0] + T.waves.setEvery[1]) / 2;
  // Lay out sets (offsets from the set's first wave) until the block is full at the mid lull length.
  const sets: number[][] = [];
  let used = 0;
  for (let k = 0; k < 64; k++) {
    const n = T.waves.perSet[0] + Math.floor(rand01(seed, blk, k, 11) * (T.waves.perSet[1] - T.waves.perSet[0] + 1));
    const offs = [0];
    for (let j = 1; j < n; j++) offs.push(offs[j - 1] + randRange(T.waves.setSpacing[0], T.waves.setSpacing[1], seed, blk, k, 20 + j));
    if (used + offs[n - 1] + lullMid > span + lullMid / 2 && sets.length) break;
    sets.push(offs); used += offs[n - 1] + lullMid;
  }
  // Share the remaining time among the lulls: each sits near the mean, inside 45-75 s.
  let dur = 0;
  for (const o of sets) dur += o[o.length - 1];
  const mean = (span - dur) / sets.length, room = Math.max(0, Math.min(mean - T.waves.setEvery[0], T.waves.setEvery[1] - mean));
  const jit = sets.map((_, k) => rand01(seed, blk, k, 13) - 0.5);
  const jm = jit.reduce((a, c) => a + c, 0) / jit.length;
  let t0 = blockStart(seed, blk);
  sets.forEach((offs, k) => {
    offs.forEach((off, j) => {
      const shape = j === 0 ? 0.82 : j < 3 ? 1 : 0.9; // the second and third waves are usually the biggest
      const h = Math.max(T.waves.face[0], hDay * shape * randRange(0.9, 1.03, seed, blk, k, 30 + j));
      const id = (((blk & 0x3f) << 9) | (k << 3) | j) & 0x7fff;
      out!.push({ id, tb: t0 + off, h, reach: randRange(T.waves.whitewaterReach[0], T.waves.whitewaterReach[1], seed, blk, k, 40 + j), set: true, peaks: makePeaks(seed, blk * 512 + k * 8 + j, b, true) });
    });
    t0 += offs[offs.length - 1] + mean + (jit[k] - jm) * 2 * room * 0.9;
  });
  if (blocks.size > 32) blocks.clear();
  blocks.set(key, out);
  return out;
}

/** Every wave alive at time t (seconds since epoch), oldest first. Deterministic in (seed, t). */
export function activeWaves(seed: number, t: number, b: BreakSpec): Wave[] {
  const { pre, post } = lifetime(b), out: Wave[] = [];
  const blk = Math.floor(t / BLOCK);
  const sets = [...blockSets(seed, blk - 1, b), ...blockSets(seed, blk, b), ...blockSets(seed, blk + 1, b)];
  for (const w of sets) if (t >= w.tb - pre && t <= w.tb + post) out.push(w);
  // Smaller waves between sets, about every 15 s, never crowding a set wave.
  const L = T.waves.lullEvery;
  for (let m = Math.floor((t - post) / L) - 1; m <= Math.floor((t + pre) / L) + 1; m++) {
    const tb = m * L + randRange(-3, 3, seed, m, 50);
    if (t < tb - pre || t > tb + post) continue;
    let clear = true;
    for (const s of sets) if (Math.abs(s.tb - tb) < 8) clear = false;
    if (!clear) continue;
    const hDay = dayHeight(seed, Math.floor(tb / BLOCK) * BLOCK, b);
    const h = Math.max(T.waves.face[0], hDay * randRange(0.5, 0.68, seed, m, 51));
    out.push({ id: 0x8000 | (m & 0x7fff), tb, h, reach: randRange(26, 40, seed, m, 52), set: false, peaks: makePeaks(seed ^ 0x5bd1, m, b, false) });
  }
  out.sort((a, c) => a.tb - c.tb);
  return out;
}

/** z of the crest line at time t. */
export function crestZ(w: Wave, b: BreakSpec, t: number): number {
  const tau = t - w.tb;
  if (tau <= 0) return b.zb - C0 * tau;
  const { tin, dec } = inside(b), tt = Math.min(tau, tin);
  return b.zb - C0 * tt + (dec * tt * tt) / 2;
}
/** Shoreward speed of the crest at time t (m/s). */
export function crestSpeed(w: Wave, b: BreakSpec, t: number): number {
  const tau = t - w.tb, { tin, dec } = inside(b);
  return tau <= 0 ? C0 : C0 - dec * Math.min(tau, tin);
}
/** Seconds after w.tb at which the section at alongshore position x starts to break. */
export function breakDelay(w: Wave, x: number): number {
  let best = NO_PEAK;
  for (const p of w.peaks) { const dx = x - p.x, d = p.dt + (dx < 0 ? -dx / p.vl : dx / p.vr); if (d < best) best = d; }
  return best;
}
/** Which way the break is peeling at x: +1 toward +x, -1 toward -x. */
export function peelDir(w: Wave, x: number): number {
  let best = NO_PEAK, dir = 1;
  for (const p of w.peaks) { const dx = x - p.x, d = p.dt + (dx < 0 ? -dx / p.vl : dx / p.vr); if (d < best) { best = d; dir = dx < 0 ? -1 : 1; } }
  return dir;
}

export interface WaveSample {
  d: number; // meters behind the crest (negative = in front of it, on the face side)
  tau: number; // seconds since this section started breaking (negative = not yet)
  eta: number; // surface height contribution (m)
  slope: number; // d(eta)/dz; positive on the face
  amp: number; // crest height here
  strength: number; // 0..1 whitewater power at this point (strongest in the churning front)
  power: number; // 0..1 whitewater power of this section of the wave, wherever you are relative to it
  broken: number; // 0 unbroken .. 1 fully whitewater
}
export const newSample = (): WaveSample => ({ d: 0, tau: 0, eta: 0, slope: 0, amp: 0, strength: 0, power: 0, broken: 0 });

/** Everything one wave does at a point. The GPU ocean shader mirrors this function term for term. */
export function sampleWave(w: Wave, b: BreakSpec, x: number, z: number, t: number, out: WaveSample): WaveSample {
  const zc = crestZ(w, b, t), d = z - zc, delay = breakDelay(w, x), tau = t - w.tb - delay;
  const edge = Math.abs(x - b.centerX) - b.halfWidth;
  const taper = 1 - 0.7 * smooth(clamp01(edge / 60));
  const wfBreak = Math.max(2.2, (w.h * 2.4) / b.steep);
  let amp: number, wf: number, wb: number, peak: number, strength = 0, power = 0, broken = 0;
  if (tau < 0) {
    const s = smooth(clamp01(-tau / T_SHOAL));
    amp = w.h * taper * (1 - 0.72 * s); wf = lerp(wfBreak, W_OFF, s); wb = W_OFF; peak = PEAKED * (1 - s);
  } else {
    broken = smooth(clamp01(tau / T_CURL));
    const run = crestZ(w, b, w.tb + delay) - zc; // meters travelled since this section broke
    const sigma = clamp01(1 - run / w.reach);
    amp = w.h * taper * lerp(1, (0.3 + 0.45 * sigma) * Math.min(1, sigma * 4), broken);
    wf = lerp(wfBreak, 1.6, broken); wb = lerp(W_OFF, 13, broken); peak = lerp(PEAKED, 0.5, broken);
    const band = d < 0 ? clamp01(1 + d / 2.5) : clamp01(1 - d / 5); // the churning front of the bore
    power = taper * Math.min(1, w.h / 1.8) * lerp(1, sigma, broken);
    strength = power * band;
  }
  // Profile: a rounded hump behind the crest; in front, a face that steepens to a ridge as the section stands up.
  const wd = d < 0 ? wf : wb, u = d / wd, a = d < 0 ? peak : 0, q = 1 / (1 + a * Math.abs(u) + u * u), p = q * q;
  out.d = d; out.tau = tau; out.amp = amp; out.eta = amp * p; out.slope = (2 * amp * (a - 2 * u) * p * q) / wd;
  out.strength = strength; out.power = power; out.broken = broken;
  return out;
}

const tmp = newSample();
/** Height of the swell-and-surf surface above mean sea level. */
export function surfaceHeight(waves: Wave[], b: BreakSpec, x: number, z: number, t: number): number {
  let h = 0;
  for (const w of waves) h += sampleWave(w, b, x, z, t, tmp).eta;
  return h;
}
/** d(height)/dz. Positive where the water rises toward the sea, i.e. on a wave face. */
export function faceSlope(waves: Wave[], b: BreakSpec, x: number, z: number, t: number): number {
  let s = 0;
  for (const w of waves) s += sampleWave(w, b, x, z, t, tmp).slope;
  return s;
}
export const Brk = { Flat: 0, Unbroken: 1, Breaking: 2, Whitewater: 3 } as const;
export type Brk = (typeof Brk)[keyof typeof Brk];
/** What the nearest wave is doing at this point. */
export function breakState(waves: Wave[], b: BreakSpec, x: number, z: number, t: number): Brk {
  let st: Brk = Brk.Flat, near = 12;
  for (const w of waves) {
    const s = sampleWave(w, b, x, z, t, tmp), ad = Math.abs(s.d);
    if (ad >= near || s.amp < 0.05) continue;
    near = ad;
    st = s.tau < 0 ? Brk.Unbroken : s.tau < T_CURL ? Brk.Breaking : s.strength > 0.02 || ad < 4 ? Brk.Whitewater : Brk.Flat;
  }
  return st;
}
/** 0..1 power of whitewater at this point. */
export function whitewaterStrength(waves: Wave[], b: BreakSpec, x: number, z: number, t: number): number {
  let m = 0;
  for (const w of waves) { const s = sampleWave(w, b, x, z, t, tmp).strength; if (s > m) m = s; }
  return m;
}

/** Stable per-room seed from a room id string. */
export function roomSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return hash32(h);
}
