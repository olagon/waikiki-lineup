// Headless clients against a running Worker, through the real network code.
//   load:  tests/run.sh tests/net/clients.mts load  [clients=16] [seconds=300] [origin]
//   chaos: tests/run.sh tests/net/clients.mts chaos [clients=4]  [seconds=120] [origin]   (150 ± 50 ms latency, 3% loss)
// Exits non-zero if an assertion from the brief fails.
import { Session } from '../../client/net/session';
import { newPilot, pilotInput } from '../../shared/autopilot';
import { activeWaves } from '../../shared/waves';
import { tickTime } from '../../shared/tuning';
import { DEFAULT_LOOK } from '../../shared/looks';
import { B, Board, newSurfer, solid, type Input } from '../../shared/physics';
import { gap } from '../../shared/collisions';
import { EvKind } from '../../shared/protocol';

const [mode = 'load', nArg, secsArg, origin = 'http://localhost:8787'] = process.argv.slice(2);
const chaosMode = mode === 'chaos', n = Number(nArg ?? (chaosMode ? 4 : 16)), secs = Number(secsArg ?? (chaosMode ? 120 : 300));
const chaos = chaosMode ? { latency: 150, jitter: 50, loss: 0.03 } : undefined;
const room = 't' + Math.random().toString(36).slice(2, 7), sessions: Session[] = [];
let agree = 0, disagree = 0;
const lastHit = new Map<string, number>(), overlapSince = new Map<string, number>(), ghost = newSurfer();

for (let i = 0; i < n; i++) {
  const s = await Session.join(origin, 'canoes', room, `tok${i}${Math.random()}`, `Test${i}`, { ...DEFAULT_LOOK, board: i % 2 ? Board.Short : Board.Long }, chaos);
  sessions.push(s);
  const pilot = newPilot((i - n / 2) * 6, 113);
  let last = Date.now();
  // Chaos mode: everyone paddles at their nearest neighbor, so there are plenty of bumps to compare.
  const bumper = (): Input => {
    let best = Infinity, tx = 0, tz = 30;
    for (const id of s.remoteIds()) { const r = s.remote(id); if (!r || r.bot) continue; const d = Math.hypot(r.x - s.me.x, r.z - s.me.z); if (d < best) { best = d; tx = r.x; tz = r.z; } }
    const want = Math.atan2(tz - s.me.z, tx - s.me.x), d = Math.atan2(Math.sin(want - s.me.heading), Math.cos(want - s.me.heading));
    return { buttons: s.me.state === 1 ? B.sit : B.paddle, steer: Math.max(-1, Math.min(1, d * 2)) };
  };
  s.onEvent = (e) => {
    if (e.kind !== EvKind.Collision || (e.a !== s.id && e.b !== s.id)) return;
    // The server says we touched. Did it look like that on this screen?
    const other = s.remote(e.a === s.id ? e.b : e.a);
    lastHit.set(`${s.id}:${e.a === s.id ? e.b : e.a}`, Date.now());
    if (other) Object.assign(ghost, { x: other.x, z: other.z, heading: other.heading, board: s.roster.get(other.id)?.look.board ?? 1 });
    if (other && gap(s.me, ghost) < 1.0) agree++; else disagree++; // within a meter of touching, given what latency hides
  };
  setInterval(() => {
    const now = Date.now(), dt = (now - last) / 1000; last = now;
    s.update(chaosMode ? bumper : () => pilotInput(s.me, { t: tickTime(s.myTick), waves: activeWaves(s.seed, tickTime(s.myTick), s.spot), spot: s.spot, night: 0 }, pilot), dt);
    if (!chaosMode || !solid(s.me)) return;
    // The reverse: this screen shows two boards well overlapped for a while, and the server never calls it.
    for (const id of s.remoteIds()) {
      const r = s.remote(id), key = `${s.id}:${id}`;
      if (!r || r.state > 1) { overlapSince.delete(key); continue; }
      Object.assign(ghost, { x: r.x, z: r.z, heading: r.heading, board: s.roster.get(id)?.look.board ?? 1 });
      if (gap(s.me, ghost) < -0.45) { const since = overlapSince.get(key) ?? now; overlapSince.set(key, since); if (now - since > 700 && now - (lastHit.get(key) ?? 0) > 2500) { disagree++; overlapSince.delete(key); lastHit.set(key, now); } } else overlapSince.delete(key);
    }
  }, 16);
}
const t0 = Date.now(), heap: number[] = [];
const sampler = setInterval(() => { (globalThis as { gc?: () => void }).gc?.(); heap.push(process.memoryUsage().heapUsed / 1e6); }, 10000);
await new Promise((r) => setTimeout(r, secs * 1000));
clearInterval(sampler);
const el = (Date.now() - t0) / 1000, pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)] ?? 0, all = sessions.flatMap((s) => s.corrections);
const server = (await (await fetch(`${origin}/api/stats?break=canoes&room=${room}`)).json()) as { p99: number; errors: number; members: number };
const out = {
  mode, clients: n, seconds: +el.toFixed(0),
  snapshotsPerSecond: +(Math.min(...sessions.map((s) => s.snapshots)) / el).toFixed(1),
  kbPerSecondPerClient: +(Math.max(...sessions.map((s) => s.bytesIn)) / el / 1000).toFixed(1),
  correctionP95: +pct(all, 0.95).toFixed(4), correctionMax: +Math.max(0, ...all).toFixed(3),
  maxRemoteStep: +Math.max(...sessions.map((s) => s.maxRemoteStep())).toFixed(2),
  bumps: agree + disagree, bumpAgreement: agree + disagree ? +(agree / (agree + disagree)).toFixed(3) : null,
  closed: sessions.filter((s) => s.closed).length, clientHeapMB: heap.map((h) => +h.toFixed(0)), server,
};
console.log(JSON.stringify(out));
const fail: string[] = [];
if (out.snapshotsPerSecond < 19) fail.push('fewer than 19 snapshots per second');
if (out.closed || server.errors) fail.push('disconnects or server exceptions');
if (server.p99 >= 10) fail.push('server tick p99 at or over 10 ms');
if (out.kbPerSecondPerClient >= 20) fail.push('downstream over 20 KB/s');
if (chaosMode && out.correctionP95 >= 0.3) fail.push('own-surfer correction p95 at or over 0.3 m');
if (chaosMode && out.maxRemoteStep > 1.5) fail.push('another surfer teleported');
if (chaosMode && (out.bumps < 10 || (out.bumpAgreement ?? 0) < 0.95)) fail.push('bump agreement under 95% (or too few bumps to tell)');
console.log(fail.length ? 'FAIL: ' + fail.join('; ') : 'PASS');
for (const s of sessions) s.close();
process.exit(fail.length ? 1 : 0);
