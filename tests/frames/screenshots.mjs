// A clean screenshot set for a release. Needs the dev server (npm run dev) and a real GPU browser.
// usage: node tests/frames/screenshots.mjs <version>      writes screenshots/<version>/NN-name.jpg at 1440x900
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const version = process.argv[2] ?? 'dev', base = process.env.BASE ?? 'http://localhost:5173', dir = `screenshots/${version}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--hide-scrollbars'] });
const page = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // A returning player: no first-visit camera swoop and no tutorial prompts over the picture.
  await ctx.addInitScript(() => { localStorage.setItem('wl.swooped', '1'); localStorage.setItem('wl.pops', '3'); localStorage.setItem('wl.seen', JSON.stringify(['dive', 'diveX', 'go', 'pop', 'cut'])); });
  return ctx.newPage();
};
const save = async (p, name) => { await p.screenshot({ path: `${dir}/${name}.jpg`, type: 'jpeg', quality: 90 }); console.log(`${dir}/${name}.jpg`); await p.context().close(); };

// The opening screen, live.
let p = await page();
await p.goto(`${base}/`);
await p.getByText('Paddle out').waitFor({ timeout: 60000 });
await p.waitForFunction('window.__perf && window.__perf().frames > 240', null, { timeout: 60000 });
await save(p, '01-opening-screen');

// Paddling out, as played: late afternoon, a few seconds of strokes toward the lineup.
p = await page();
await p.goto(`${base}/?offline&hour=16.6`);
await p.waitForFunction('window.__perf && window.__perf().frames > 60', null, { timeout: 60000 });
await p.keyboard.down('KeyW');
await p.waitForTimeout(7000);
await save(p, '02-paddling-out');

// Staged moments (the same shots the art review uses).
const SHOTS = [['G4', '03-the-lineup'], ['G5', '04-takeoff'], ['G6', '05-surfing'], ['G7', '06-nose-ride'], ['G8', '07-wipeout'], ['G3', '08-duck-dive'],
  ['G12', '09-lifeguard-patch-up'], ['G9', '10-lesson-in-the-shallows'], ['G1', '11-the-bay-at-golden-hour'], ['G10', '12-dusk'], ['G11', '13-full-moon']];
for (const [id, name] of SHOTS) {
  p = await page();
  await p.goto(`${base}/?shot=${id}`);
  await p.waitForFunction('window.__shotReady === true', null, { timeout: 90000 });
  await save(p, name);
}
await browser.close();
