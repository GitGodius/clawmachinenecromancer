// Regenerates docs/screens.png (the README montage) from the current game: shop, claw, slab, graveyard.
//   node tools/screens.mjs
// Uses dev.html's jump-in flags with saving off, so it never touches a real save.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const shots = [];
const grab = async (query, prep, wait = 1200) => {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`file://${ROOT}/dev.html?${query}&nosave=1&seed=4`);
  await page.waitForTimeout(700);
  if (prep) await prep(page);
  await page.waitForTimeout(wait);
  const b = await page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  shots.push((await page.screenshot({ clip: b })).toString('base64'));
  await page.close();
};
await grab('scene=shop', async (p) => { await p.evaluate(() => { Scenes.shop.open(false); }); }, 2600);
await grab('scene=claw&tokens=9', async (p) => {
  for (let k = 0; k < 6; k++) {
    await p.evaluate((k) => { const sim = Game.sim; const ps = sim.parts.filter((q) => { const [x] = sim.partPos(q); return !q.won && x > 20 && x < 130; }); sim.teleportClaw(sim.partPos(ps[(k * 3) % ps.length])[0]); }, k);
    await p.waitForTimeout(300); await p.keyboard.press('Space');
    for (let i = 0; i < 300 && !['carry', 'idle'].includes(await p.evaluate(() => Game.sim.state)); i++) await p.waitForTimeout(100);
    if (await p.evaluate(() => Game.sim.grips.length)) break;
    for (let i = 0; i < 300 && (await p.evaluate(() => Game.sim.state)) !== 'idle'; i++) await p.waitForTimeout(100);
  }
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(900);
}, 300);
await grab('scene=slab&parts=1&stage=4', async (p) => { await p.evaluate(() => { for (const t of ['tentacle', 'ogrearm', 'crownskull']) Game.addPart(t); }); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown'); }, 900);
await grab('scene=battle&party=1&stage=6', async (p) => { await p.mouse.click(480 + 120, 438); await p.waitForTimeout(4500); }, 300);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:960px 960px">${shots.map((s) => `<img src="data:image/png;base64,${s}" width="960" height="540" style="display:block;image-rendering:pixelated">`).join('')}</body>`);
await page.waitForTimeout(300);
fs.writeFileSync(path.join(ROOT, 'docs/screens.png'), await page.screenshot());
await browser.close();
console.log('wrote docs/screens.png');
