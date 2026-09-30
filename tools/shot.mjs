// Screenshot a local HTML file with headless Chromium.
// usage: node tools/shot.mjs <file.html> <out.png> [width=960] [height=540] [waitMs=500] [jsToEval]
import { chromium } from 'playwright-core';
import path from 'node:path';
const [file, out, w = 960, h = 540, wait = 500, js] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto('file://' + path.resolve(file));
await page.waitForTimeout(+wait);
if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await page.waitForTimeout(300); }
await page.screenshot({ path: out, fullPage: true });
if (errors.length) console.log(errors.join('\n'));
await browser.close();
