// Reconnect: the same session token within 30 s gets the same surfer back, still in the water. After that, a fresh one.
// usage: tests/run.sh tests/net/reconnect.mts [origin]
import { Session } from '../../client/net/session';
import { DEFAULT_LOOK } from '../../shared/looks';
import { B } from '../../shared/physics';

const origin = process.argv[2] ?? 'http://localhost:8787', room = 'rc' + Math.random().toString(36).slice(2, 7), token = 'reconnect' + Math.random();
const play = async (s: Session, ms: number, buttons: number) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { s.update(() => ({ buttons, steer: 0 }), 0.016); await new Promise((r) => setTimeout(r, 16)); } };
// A second player keeps the room ticking while the first is away.
const keeper = await Session.join(origin, 'canoes', room, 'keeper' + Math.random(), 'Keeper', DEFAULT_LOOK);
const pump = setInterval(() => keeper.update(() => ({ buttons: 0, steer: 0 }), 0.016), 16);

let s = await Session.join(origin, 'canoes', room, token, 'Reco', DEFAULT_LOOK);
await play(s, 6000, B.paddle);
const id1 = s.id, z1 = s.me.z;
s.close();
await new Promise((r) => setTimeout(r, 4000));
s = await Session.join(origin, 'canoes', room, token, 'Reco', DEFAULT_LOOK);
await play(s, 1500, 0);
const id2 = s.id, z2 = s.me.z;
s.close();
await new Promise((r) => setTimeout(r, 33000));
s = await Session.join(origin, 'canoes', room, token, 'Reco', DEFAULT_LOOK);
await play(s, 1500, 0);
const z3 = s.me.z;
const out = { paddledTo: +z1.toFixed(1), sameSurfer: id1 === id2, backAt: +z2.toFixed(1), afterThirtySeconds: +z3.toFixed(1) };
console.log(JSON.stringify(out));
const ok = z1 > 22 && out.sameSurfer && Math.abs(z2 - z1) < 4 && z3 < 20;
console.log(ok ? 'PASS' : 'FAIL');
clearInterval(pump); keeper.close(); s.close();
process.exit(ok ? 0 : 1);
