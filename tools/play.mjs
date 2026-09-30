// Scripted play-through in headless Chromium, with screenshots.
//   node tools/play.mjs <url> <outDir> '<json steps>'
// steps: {"hold":"ArrowLeft","ms":600} {"press":"Space"} {"wait":1200} {"shot":"name"}  {"move":[x,y]} {"mdown":1} {"mup":1}
//        {"click":[x,y]} (game pixels)  {"eval":"js"}  {"size":[960,540]}
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const [url, outDir, stepsJson] = process.argv.slice(2);
const steps = JSON.parse(stepsJson || '[]');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const u = url.startsWith('http') ? url : 'file://' + path.resolve(url.split('?')[0]) + (url.includes('?') ? '?' + url.split('?')[1] : '');
await page.goto(u);
await page.waitForTimeout(600);
const toPage = async ([x, y]) => {
  const r = await page.evaluate(() => { const b = document.getElementById('game').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
  return [r[0] + (x / 480) * r[2], r[1] + (y / 270) * r[3]];
};
for (const s of steps) {
  if (s.size) await page.setViewportSize({ width: s.size[0], height: s.size[1] });
  if (s.hold) { await page.keyboard.down(s.hold); await page.waitForTimeout(s.ms || 300); await page.keyboard.up(s.hold); }
  if (s.press) await page.keyboard.press(s.press);
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.click) { const [x, y] = await toPage(s.click); await page.mouse.click(x, y); }
  if (s.move) { const [x, y] = await toPage(s.move); await page.mouse.move(x, y); }
  if (s.mdown) await page.mouse.down();
  if (s.mup) await page.mouse.up();
  if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
  if (s.shot) await page.screenshot({ path: path.join(outDir, s.shot + '.png') });
}
if (errors.length) console.log(errors.join('\n'));
else console.log('no errors');
await browser.close();
