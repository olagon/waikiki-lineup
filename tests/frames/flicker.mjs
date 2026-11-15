// Live-play flicker check: play for a while in a real GPU browser, grab frames, and measure how much of each
// is pure black or blown white. A healthy frame has almost none of either.
// usage: node tests/frames/flicker.mjs [frames=24] [query] [width height dpr]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const [n = '24', query = 'autoplay', w = '2000', h = '1158', dpr = '2'] = process.argv.slice(2);
mkdirSync('.look/flicker', { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--hide-scrollbars'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr })).newPage();
const problems = [];
p.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)); });
p.on('pageerror', (e) => problems.push(e.message.slice(0, 200)));
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?${query}`);
await p.waitForFunction('window.__game', null, { timeout: 60000 });
await p.keyboard.down('KeyW');
await p.waitForTimeout(4000);
const rows = [];
for (let i = 0; i < +n; i++) {
  const f = `.look/flicker/f${String(i).padStart(2, '0')}.png`;
  await p.screenshot({ path: f });
  const stat = (args) => Number(execFileSync('magick', [f, '-resize', '25%', '-colorspace', 'Gray', ...args, 'info:']).toString());
  rows.push({ i, black: +stat(['-threshold', '1.5%', '-format', '%[fx:1-mean]']).toFixed(3), white: +stat(['-threshold', '96%', '-format', '%[fx:mean]']).toFixed(3) });
  await p.waitForTimeout(350);
}
await b.close();
const bad = rows.filter((r) => r.black > 0.2 || r.white > 0.08);
console.log(JSON.stringify({ frames: rows.length, badFrames: bad.length, worstBlack: Math.max(...rows.map((r) => r.black)), worstWhite: Math.max(...rows.map((r) => r.white)), bad: bad.slice(0, 8), problems: problems.slice(0, 3) }));
process.exit(bad.length ? 1 : 0);
