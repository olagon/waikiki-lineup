import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { BREAKS, activeWaves, crestZ, faceSlope, roomSeed, sampleWave, newSample, surfaceHeight, type Wave } from '../../shared/waves';
import { rngStream } from '../../shared/rng';

const spot = BREAKS.canoes, seed = roomSeed('test-room'), T0 = 1794700000;

describe('wave schedule', () => {
  const all = new Map<number, Wave>();
  for (let t = T0; t < T0 + 1500; t += 2) for (const w of activeWaves(seed, t, spot)) {
    const prev = all.get(w.id);
    if (prev) expect(w).toEqual(prev); // a wave never changes while it is alive
    all.set(w.id, w);
  }
  const sets = [...all.values()].filter((w) => w.set).sort((a, b) => a.tb - b.tb);

  it('sets have 3-5 waves 10-14 s apart, with 45-75 s lulls between sets', () => {
    let run = 1;
    const sizes: number[] = [];
    for (let i = 1; i < sets.length; i++) {
      const gap = sets[i].tb - sets[i - 1].tb;
      if (gap <= 14.0001) { expect(gap).toBeGreaterThanOrEqual(10); run++; }
      else { expect(gap).toBeGreaterThanOrEqual(45); expect(gap).toBeLessThanOrEqual(75.0001); sizes.push(run); run = 1; }
    }
    expect(sizes.length).toBeGreaterThan(8);
    for (const n of sizes.slice(1)) { expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(5); }
  });
  it('faces are 0.8-2.2 m and smaller waves fill the lulls', () => {
    for (const w of all.values()) { expect(w.h).toBeGreaterThanOrEqual(0.8); expect(w.h).toBeLessThanOrEqual(2.2); }
    expect([...all.values()].filter((w) => !w.set).length).toBeGreaterThan(15);
  });
  it('never has more waves alive than the shader can draw', () => {
    for (let t = T0; t < T0 + 1500; t += 1) expect(activeWaves(seed, t, spot).length).toBeLessThanOrEqual(8);
  });
});

describe('wave shape', () => {
  const w = [...activeWaves(seed, T0 + 300, spot)].find((x) => x.set) ?? activeWaves(seed, T0 + 300, spot)[0];
  it('the face rises toward the crest and the surface is continuous', () => {
    const t = w.tb - 1, zc = crestZ(w, spot, t), x = w.peaks[0].x;
    expect(faceSlope([w], spot, x, zc - 2, t)).toBeGreaterThan(0.1);
    expect(faceSlope([w], spot, x, zc + 3, t)).toBeLessThan(0);
    let prev = surfaceHeight([w], spot, x, zc - 30, t);
    for (let z = zc - 30; z < zc + 30; z += 0.05) { const h = surfaceHeight([w], spot, x, z, t); expect(Math.abs(h - prev)).toBeLessThan(0.12); prev = h; }
  });
  it('breaks at the peak first, then peels, then the whitewater dies out', () => {
    const s = newSample(), x = w.peaks[0].x;
    expect(sampleWave(w, spot, x, crestZ(w, spot, w.tb - 2), w.tb - 2, s).broken).toBe(0);
    expect(sampleWave(w, spot, x, crestZ(w, spot, w.tb + 3), w.tb + 3, s).broken).toBe(1);
    expect(sampleWave(w, spot, x + 40, crestZ(w, spot, w.tb + 3), w.tb + 3, s).tau).toBeLessThan(0); // the shoulder is still open
    expect(sampleWave(w, spot, x, crestZ(w, spot, w.tb + 3) - 0.5, w.tb + 3, s).strength).toBeGreaterThan(0.3);
    expect(sampleWave(w, spot, x, crestZ(w, spot, w.tb + 22) - 0.5, w.tb + 22, s).strength).toBeLessThan(0.05);
  });
});

describe('determinism across builds', () => {
  let client: typeof import('../../shared/waves'), worker: typeof import('../../shared/waves');
  beforeAll(async () => {
    // The client is built by Vite, the Worker by esbuild (as wrangler does). Build the wave model both ways.
    await build({ configFile: false, logLevel: 'silent', build: { lib: { entry: 'shared/waves.ts', formats: ['es'], fileName: 'waves-client' }, outDir: '.look/det', emptyOutDir: false, minify: true } });
    execFileSync('node_modules/.bin/esbuild', ['shared/waves.ts', '--bundle', '--format=esm', '--target=es2022', '--log-level=error', '--outfile=.look/det/waves-worker.mjs']);
    const base = new URL('../../.look/det/', import.meta.url).href;
    client = await import(/* @vite-ignore */ base + 'waves-client.js');
    worker = await import(/* @vite-ignore */ base + 'waves-worker.mjs');
  }, 60000);

  it('gives identical outputs for 10,000 random samples', () => {
    const r = rngStream(42), a = client.newSample(), b = worker.newSample();
    for (let i = 0; i < 10000; i++) {
      const t = T0 + r() * 3600, x = (r() - 0.5) * 500, z = r() * 320;
      const wa = client.activeWaves(seed, t, client.BREAKS.canoes), wb = worker.activeWaves(seed, t, worker.BREAKS.canoes);
      expect(wa).toEqual(wb);
      expect(Object.is(client.surfaceHeight(wa, client.BREAKS.canoes, x, z, t), worker.surfaceHeight(wb, worker.BREAKS.canoes, x, z, t))).toBe(true);
      if (wa.length) expect({ ...client.sampleWave(wa[0], client.BREAKS.canoes, x, z, t, a) }).toEqual({ ...worker.sampleWave(wb[0], worker.BREAKS.canoes, x, z, t, b) });
      expect(client.breakState(wa, client.BREAKS.canoes, x, z, t)).toBe(worker.breakState(wb, worker.BREAKS.canoes, x, z, t));
    }
  });
});
