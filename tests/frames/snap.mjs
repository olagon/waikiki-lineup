// one-off screenshot of an arbitrary dev URL query. usage: node snap.mjs "<query>" out.png [w h]
import { chromium } from 'playwright';
const [q, out, w = 800, h = 500] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--hide-scrollbars'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text().slice(0, 600)}`); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 600)));
await p.goto(`http://localhost:5173/?${q}`);
await p.waitForFunction('window.__shotReady === true', null, { timeout: 60000 }).catch((e) => console.log('timeout'));
await p.screenshot({ path: out });
await b.close();
