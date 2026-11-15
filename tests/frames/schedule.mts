// Print the wave schedule around a Hawaiʻi time. usage: node tests/frames/schedule.mts 2026 11 14 17.2 [break]
import { hstToUtcMs } from '../../shared/sun';
import { BREAKS, activeWaves, roomSeed } from '../../shared/waves';
const [y, m, d, h, br = 'canoes'] = process.argv.slice(2);
const t0 = hstToUtcMs(+y, +m, +d, +h) / 1000, seen = new Map<number, string>();
for (let dt = -40; dt < 260; dt += 5) for (const w of activeWaves(roomSeed('local'), t0 + dt, BREAKS[br]))
  seen.set(w.id, `tb=${(w.tb - t0).toFixed(1).padStart(6)}s h=${w.h.toFixed(2)} ${w.set ? 'SET ' : 'lull'} reach=${w.reach.toFixed(0)} peaks=${w.peaks.map((p) => `x${p.x.toFixed(0)} +${p.dt.toFixed(1)}s L${p.vl.toFixed(1)} R${p.vr.toFixed(1)}`).join(' | ')}`);
console.log([...seen.values()].sort((a, b) => parseFloat(a.slice(3)) - parseFloat(b.slice(3))).join('\n'));
