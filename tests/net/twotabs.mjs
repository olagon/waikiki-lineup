// Two real browser tabs join the same room and must see each other where each says it is.
// Later milestones add: a scripted collision must produce the same outcome event on both.
// usage: node tests/net/twotabs.mjs   (needs `npm run dev` and `npm run worker`)
import { chromium } from 'playwright';
const base = process.env.BASE ?? 'http://localhost:5173', room = 'tt' + Math.random().toString(36).slice(2, 7);
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu'] });
const errors = [];
const open = async () => {
  const p = await (await b.newContext({ viewport: { width: 800, height: 500 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`${base}/?autoplay&break=canoes&room=${room}`);
  await p.waitForFunction('window.__game && window.__game.session && window.__game.session.id > 0', null, { timeout: 60000 });
  return p;
};
const [A, B] = [await open(), await open()];
for (const p of [A, B]) await p.evaluate(() => { window.__ev = []; window.__game.onEvent = (e) => window.__ev.push(e); });
await A.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 6000));
const state = (p) => p.evaluate(() => { const g = window.__game, s = g.session, me = g.me(); return { id: s.id, x: me.x, z: me.z, heading: me.heading, roster: [...s.roster.values()].map((r) => [r.id, r.bot]), others: Object.fromEntries(s.remoteIds().map((id) => [id, s.remote(id)])), views: g.others.size }; });
const [a, bb] = [await state(A), await state(B)];
const seenByB = bb.others[a.id], seenByA = a.others[bb.id];
const dist = (o, me) => (o ? Math.hypot(o.x - me.x, o.z - me.z) : Infinity);

// Scripted collision: B paddles at A until the server says they touched. Both tabs must get the same event.
await A.keyboard.up('KeyW');
await B.keyboard.down('KeyW');
let hitA = null, hitB = null;
for (let i = 0; i < 400 && !(hitA && hitB); i++) {
  const sb = await state(B), target = sb.others[a.id];
  if (target) {
    const want = Math.atan2(target.z - sb.z, target.x - sb.x), d = Math.atan2(Math.sin(want - sb.heading), Math.cos(want - sb.heading));
    await B.keyboard[d > 0.15 ? 'down' : 'up']('KeyD'); await B.keyboard[d < -0.15 ? 'down' : 'up']('KeyA');
  }
  const find = (p) => p.evaluate(([x, y]) => window.__ev.find((e) => e.kind === 6 && ((e.a === x && e.b === y) || (e.a === y && e.b === x))) ?? null, [a.id, bb.id]);
  hitA = await find(A); hitB = await find(B);
  await new Promise((r) => setTimeout(r, 100));
}
const result = {
  room, ids: [a.id, bb.id], humansInRoster: a.roster.filter((r) => !r[1]).length, bots: a.roster.filter((r) => r[1]).length,
  aSeesBWithin: +dist(seenByA, bb).toFixed(2), bSeesAWithin: +dist(seenByB, a).toFixed(2), aMoved: +(a.z - 16).toFixed(1), viewsA: a.views, viewsB: bb.views,
  collisionOnA: hitA, collisionOnB: hitB, errors,
};
console.log(JSON.stringify(result));
const same = hitA && hitB && hitA.id === hitB.id && hitA.a === hitB.a && hitA.b === hitB.b && hitA.value === hitB.value;
const ok = result.humansInRoster === 2 && result.bots >= 5 && result.aSeesBWithin < 1.5 && result.bSeesAWithin < 1.5 && result.aMoved > 5 && same && !errors.length;
await A.screenshot({ path: '.look/twotabs-a.png' });
await b.close();
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
