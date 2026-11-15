// Golden-frame capture. Needs the dev server running (npm run dev) and a real GPU browser.
// usage: node tests/frames/capture.mjs <milestone> [ids...]     e.g. node tests/frames/capture.mjs M1 G1 G9
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [milestone = 'dev', ...ids] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:5173';
const ALL = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'duckdive', 'takeoff', 'carve', 'wipeout'];
const MOBILE = new Set(['G2', 'G4', 'G6', 'G11']);
const SHEETS = { duckdive: 12, takeoff: 12, carve: 12, wipeout: 12 }; // motion sheets: frames at 100 ms

const dir = `docs/frames/${milestone}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !!process.env.HEADLESS, args: ['--enable-unsafe-webgpu', '--hide-scrollbars'] });
let problems = 0;

async function open(w, h, dpr, query) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { problems++; console.log(`  [${m.type()}] ${m.text()}`); } });
  page.on('pageerror', (e) => { problems++; console.log(`  [pageerror] ${e.message}`); });
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction('window.__shotReady === true', null, { timeout: 90000 }).catch(() => { problems++; console.log(`  [timeout] ${query}`); });
  return { ctx, page };
}

for (const id of ids.length ? ids : ALL) {
  if (id in SHEETS) {
    const shots = [];
    for (let f = 0; f < SHEETS[id]; f++) {
      const { ctx, page } = await open(480, 300, 1, `shot=${id}&frame=${f}`);
      shots.push((await page.screenshot()).toString('base64'));
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(4,480px);">${shots.map((s) => `<img src="data:image/png;base64,${s}">`).join('')}</body>`);
    await page.screenshot({ path: `${dir}/sheet-${id}.png` });
    await ctx.close();
    console.log(`sheet-${id}`);
    continue;
  }
  for (const [w, h, dpr] of [[1440, 900, 1], ...(MOBILE.has(id) ? [[390, 844, 2]] : [])]) {
    const { ctx, page } = await open(w, h, dpr, `shot=${id}`);
    await page.screenshot({ path: `${dir}/${id}-${w}x${h}.png` });
    console.log(`${id}-${w}x${h}`, JSON.stringify(await page.evaluate('window.__shotInfo')));
    await ctx.close();
  }
}
await browser.close();
console.log(problems ? `${problems} console problems` : 'console clean');
