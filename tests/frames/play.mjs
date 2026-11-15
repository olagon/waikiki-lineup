// Scripted play session in a real GPU browser. Drives the keyboard, samples perf, saves a screenshot.
// usage: node tests/frames/play.mjs <out.png> [seconds] [query]
import { chromium } from 'playwright';
const [out = '.look/play.png', secs = '12', query = ''] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--hide-scrollbars'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let problems = 0;
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { problems++; console.log(`[${m.type()}] ${m.text().slice(0, 400)}`); } });
p.on('pageerror', (e) => { problems++; console.log('[pageerror]', e.message.slice(0, 400)); });
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?${query}`);
await p.waitForFunction('window.__perf && window.__perf().frames > 30', null, { timeout: 60000 });
await p.keyboard.down('KeyW');
await p.waitForTimeout(Number(secs) * 400);
await p.keyboard.down('KeyD'); await p.waitForTimeout(Number(secs) * 150); await p.keyboard.up('KeyD');
await p.waitForTimeout(Number(secs) * 450);
console.log(JSON.stringify(await p.evaluate('window.__perf()')));
await p.screenshot({ path: out });
await b.close();
console.log(problems ? `${problems} console problems` : 'console clean');
