import type { App } from '../app';

declare global { interface Window { __perf?: () => PerfStats } }
export interface PerfStats { frames: number; p50: number; p95: number; max: number; drawCalls: number; triangles: number; pipelines: number; lateCompiles: number[] }

/** Dev-only frame timing and shader-compile watch. A pipeline created after warm-up is a bug. */
export function installPerf(app: App): () => PerfStats {
  const dts = new Float32Array(600);
  let n = 0, pipelines = 0, last = performance.now();
  const late: number[] = [], start = performance.now();
  const proto = (globalThis as unknown as { GPUDevice?: { prototype: Record<string, unknown> } }).GPUDevice?.prototype;
  for (const fn of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline']) {
    const orig = proto?.[fn] as ((...a: unknown[]) => unknown) | undefined;
    if (proto && orig) proto[fn] = function (this: unknown, ...a: unknown[]) { pipelines++; const t = performance.now() - start; if (t > 8000) late.push(Math.round(t)); return orig.apply(this, a); };
  }
  app.updaters.push(() => { const now = performance.now(); dts[n++ % dts.length] = now - last; last = now; });
  const stats = (): PerfStats => {
    const s = Array.from(dts.subarray(0, Math.min(n, dts.length))).sort((a, b) => a - b);
    const info = app.renderer.info.render as unknown as { drawCalls: number; triangles: number };
    return { frames: n, p50: +(s[s.length >> 1] ?? 0).toFixed(2), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(2), drawCalls: info.drawCalls, triangles: info.triangles, pipelines, lateCompiles: late };
  };
  window.__perf = stats;
  return stats;
}
