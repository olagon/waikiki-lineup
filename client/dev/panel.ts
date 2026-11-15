import type { App } from '../app';
import { TUNING } from '../../shared/tuning';
import { hstTime, hstToUtcMs } from '../../shared/sun';
import type { PerfStats } from './perf';

/** Dev-only panel (backtick): live tuning, Hawaiʻi clock, frame stats. */
export function installPanel(app: App, perf: () => PerfStats): void {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:300px;overflow:auto;background:rgba(8,30,40,.82);backdrop-filter:blur(16px);padding:12px;font:12px/1.5 ui-monospace,monospace;color:#f4efe6;display:none;pointer-events:auto;z-index:10';
  document.body.append(el);
  addEventListener('keydown', (e) => { if (e.code === 'Backquote') el.style.display = el.style.display === 'none' ? 'block' : 'none'; });
  const row = (label: string, ...kids: HTMLElement[]) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;gap:6px;align-items:center;margin:2px 0'; const s = document.createElement('span'); s.textContent = label; s.style.flex = '1'; r.append(s, ...kids); el.append(r); };
  const num = (get: () => number, set: (v: number) => void) => { const i = document.createElement('input'); i.type = 'number'; i.step = 'any'; i.value = String(get()); i.style.cssText = 'width:64px;background:#0b2a3a;color:inherit;border:1px solid #2a5566;border-radius:4px;padding:1px 4px'; i.oninput = () => { const v = Number(i.value); if (Number.isFinite(v)) set(v); }; i.onkeydown = (e) => e.stopPropagation(); return i; };
  const head = (t: string) => { const h = document.createElement('div'); h.textContent = t; h.style.cssText = 'margin:10px 0 2px;color:#ffc46b;font-weight:600'; el.append(h); };

  // Clock
  head('Hawaiʻi clock');
  const stats = document.createElement('div');
  const date = document.createElement('input'); date.type = 'date';
  const hour = document.createElement('input'); hour.type = 'range'; hour.min = '0'; hour.max = '24'; hour.step = '0.02'; hour.style.flex = '2';
  const live = document.createElement('button'); live.textContent = 'live';
  const now = hstTime(Date.now());
  date.value = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`; hour.value = String(now.hours);
  const apply = () => { const [y, m, d] = date.value.split('-').map(Number); app.timeOffset = hstToUtcMs(y, m, d, Number(hour.value)) - Date.now(); };
  date.oninput = hour.oninput = apply; live.onclick = () => { app.timeOffset = 0; };
  row('date', date, live); row('hour', hour);
  el.append(stats);
  setInterval(() => { if (el.style.display === 'none') return; const p = perf(), h = hstTime(app.now()); stats.textContent = `${h.hours.toFixed(2)} HST · sun ${app.env.sunElevation.toFixed(1)}° · ${app.backend}\n${(1000 / (p.p50 || 16.7)).toFixed(0)} fps · p95 ${p.p95} ms · ${p.drawCalls} calls · ${(p.triangles / 1000).toFixed(0)}k tris · ${p.pipelines} pipelines`; stats.style.whiteSpace = 'pre'; }, 500);

  // Tuning
  const walk = (obj: Record<string, unknown>, path: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') row(k, num(() => obj[k] as number, (x) => { obj[k] = x; }));
      else if (Array.isArray(v)) row(k, ...v.map((_, i) => num(() => v[i] as number, (x) => { v[i] = x; })));
      else if (v && typeof v === 'object') { head(path + k); walk(v as Record<string, unknown>, ''); }
    }
  };
  walk(TUNING as unknown as Record<string, unknown>, '');
}
