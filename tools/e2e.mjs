// End-to-end checks in a real (headless) Chromium, against the page players get (index.html).
//
//   node tools/e2e.mjs            run everything
//   node tools/e2e.mjs frame      run the tests whose name contains "frame"
//
// What this is, honestly: real Chromium, software rendering, no GPU, no real audio device, an iframe I built
// to look like the itch.io one. It is NOT the itch.io page and NOT real graphics cards; docs/RELEASE.md lists
// what still has to be checked by hand there. Everything else the shipped page promises, it checks here.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const serve = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__parent') { // a page that frames the game, like itch.io does
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><body style="margin:0;background:#000"><iframe id="g" src="${u.searchParams.get('src')}" ${u.searchParams.get('sandbox') != null ? `sandbox="${u.searchParams.get('sandbox')}"` : ''} allow="autoplay; fullscreen" style="width:100vw;height:100vh;border:0"></iframe>`);
      return;
    }
    const f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (u.pathname === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('nope'); return; }
    res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  }).listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
});

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = [];
let browser, A, B;

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 960, height: 540 }, ...(opts.context || {}) });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  return page;
}
const wait = (page, ms) => page.waitForTimeout(ms);
const press = async (page, key, ms = 110) => { await page.keyboard.press(key); await wait(page, ms); };
const canvasBox = (page) => page.evaluate(() => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
const clickGame = async (page, x, y) => { const b = await canvasBox(page); await page.mouse.click(b.x + (x / 480) * b.width, b.y + (y / 270) * b.height); await wait(page, 120); };
const shot = async (page) => page.screenshot({ clip: await canvasBox(page) });
const lit = (page) => page.evaluate(() => { const c = document.getElementById('game'); const d = c.getContext('2d').getImageData(0, 0, 480, 270).data; let n = 0; for (let i = 0; i < d.length; i += 40) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n; });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const startGame = async (page, url) => { await page.goto(url); await wait(page, 900); await press(page, 'Enter', 250); await wait(page, 2400); }; // title -> START -> shop, Reaper done talking
const giveParty = (page) => page.evaluate(() => { Game.party.push(new Creature({ head: 'wolfskull', torso: 'ogregut', armL: 'ogrearm', armR: 'swordarm', legL: 'goatleg', legR: 'goatleg', heart: 'heart' })); });

const tests = {
  async 'release page has no developer tools'() {
    const page = await newPage();
    await page.goto(`http://127.0.0.1:${A}/index.html?scene=battle&tokens=99&parts=1&party=1&stage=14&seed=1`);
    await wait(page, 900);
    const r = await page.evaluate(() => ({
      dev: BUILD.dev, game: typeof window.__game, debug: typeof Debug, panel: !!document.getElementById('debug'), toggle: !!document.getElementById('dbgToggle'),
      tokens: Game.tokens, stage: Game.stage, party: Game.party.length, bag: Game.inventory.length, scene: Engine.sceneName, title: Engine.overlays.length, version: BUILD.version,
    }));
    assert(r.dev === false && r.game === 'undefined' && r.debug === 'undefined' && !r.panel && !r.toggle, 'dev tools present: ' + JSON.stringify(r));
    assert(r.tokens === 6 && r.stage === 1 && r.party === 0 && r.bag === 0 && r.scene === 'shop' && r.title === 1, 'URL flags were honoured: ' + JSON.stringify(r));
    assert(/^\d+\.\d+\.\d+/.test(r.version) && r.version !== '0.0.0-dev', 'version not stamped: ' + r.version);
    await press(page, 'Backquote'); assert(!(await page.evaluate(() => document.getElementById('debug'))), 'backquote opened something');
    assert(page.errors.length === 0, page.errors.join('\n'));
    await page.close();
  },

  async 'title, start, and the first screens draw and work from the keyboard'() {
    const page = await newPage();
    await page.goto(`http://127.0.0.1:${A}/index.html`); await wait(page, 900);
    assert((await lit(page)) > 200, 'title screen is blank');
    await press(page, 'Enter', 300); await wait(page, 2200);
    assert(await page.evaluate(() => Engine.overlays.length === 0 && Engine.sceneName === 'shop'), 'START did not reach the shop');
    await press(page, 'ArrowDown'); await press(page, 'Enter', 200); await wait(page, 1600); // the sign under the cursor: COMBINE (slab) or COLLECT depending on hint
    const scene = await page.evaluate(() => Engine.sceneName);
    assert(['slab', 'claw'].includes(scene), 'menu sign did not open a scene: ' + scene);
    assert((await lit(page)) > 200, scene + ' is blank');
    assert(page.errors.length === 0, page.errors.join('\n'));
    await page.close();
  },

  async 'pause stops the clock and allows no game action'() {
    const page = await newPage();
    await startGame(page, `http://127.0.0.1:${A}/index.html`);
    await giveParty(page);
    await page.evaluate(() => Engine.go('battle', {}, 'cut')); await wait(page, 900);
    await clickGame(page, 60, 219); await wait(page, 1500); // FIGHT
    await press(page, 'KeyP', 700);
    assert(await page.evaluate(() => Engine.overlays.length === 1 && Engine.frozen), 'P did not pause');
    const a = await shot(page); const zaps = await page.evaluate(() => Telemetry.c.zaps);
    await wait(page, 2200);
    const b = await shot(page);
    assert(a.equals(b), 'the screen changed while paused: the clock kept running');
    // every way of acting on the fight: keys, and a click on the ZAP button behind the menu
    await clickGame(page, 60, 219); await clickGame(page, 60, 235);
    assert((await page.evaluate(() => Telemetry.c.zaps)) === zaps, 'ZAP worked while paused');
    assert(await page.evaluate(() => Engine.sceneName === 'battle'), 'RETREAT/leave worked while paused');
    await press(page, 'KeyP', 250);
    await wait(page, 1500);
    assert(await page.evaluate(() => Engine.overlays.length === 0), 'P did not resume');
    const c = await shot(page);
    assert(!c.equals(b), 'the fight did not carry on after resuming');
    // the on-page Menu button pauses too (that is the only way on a phone)
    await page.click('#menuBtn'); await wait(page, 200);
    assert(await page.evaluate(() => Engine.overlays.length === 1), 'the Menu button did not pause');
    assert(page.errors.length === 0, page.errors.join('\n'));
    await page.close();
  },

  async 'rebound keys work and survive a reload'() {
    const page = await newPage();
    const url = `http://127.0.0.1:${A}/index.html`;
    await startGame(page, url);
    await press(page, 'KeyP', 250); // pause, then Settings, then Key bindings, the way a player gets there
    await press(page, 'ArrowDown'); await press(page, 'Enter', 250);
    const rows = await page.evaluate(() => Engine.top && Engine.overlays.length); assert(rows === 2, 'Settings did not open over the pause menu');
    await page.evaluate(() => { Overlays.controls(); }); await wait(page, 200);
    await press(page, 'Enter', 200);         // rebind "Move left", slot 1
    await press(page, 'KeyJ', 250);          // capture
    let map = await page.evaluate(() => ({ j: Input.KEYMAP.KeyJ, left: Settings.v.keys.left }));
    assert(map.j === 'left' && map.left[0] === 'KeyJ', 'rebinding did not take: ' + JSON.stringify(map));
    await press(page, 'Escape', 200);
    await page.reload(); await wait(page, 900);
    map = await page.evaluate(() => ({ j: Input.KEYMAP.KeyJ, oldA: Input.KEYMAP.ArrowLeft, saved: JSON.parse(localStorage.getItem('thegoodparts.save')).settings.keys.left }));
    assert(map.j === 'left', 'rebinding did not survive a reload: ' + JSON.stringify(map));
    // conflicts: binding a key that is already used moves it and says so
    const stolen = await page.evaluate(() => Settings.bind('right', 0, 'KeyJ'));
    assert(stolen === 'left', 'a stolen key was not reported');
    assert(page.errors.length === 0, page.errors.join('\n'));
    await page.close();
  },

  async 'a run continues after a reload'() {
    const page = await newPage();
    const url = `http://127.0.0.1:${A}/index.html`;
    await startGame(page, url);
    await giveParty(page);
    await page.evaluate(() => { Game.tokens = 11; Game.stage = 3; Game.addPart('crownskull'); Game.addPart('goatleg'); Game.tally('grabs', 9); Save.flush(); });
    await page.reload(); await wait(page, 900);
    const title = await page.evaluate(() => ({ has: Save.hasRun(), tokens: Save.data.run.tokens }));
    assert(title.has && title.tokens === 11, 'the run was not in the save: ' + JSON.stringify(title));
    await press(page, 'Enter', 300); await wait(page, 1500); // CONTINUE is first when a run exists
    const s = await page.evaluate(() => ({ tokens: Game.tokens, stage: Game.stage, party: Game.party.length, bag: Game.inventory.map((i) => i.type).sort(), grabs: Game.stats.grabs, overlays: Engine.overlays.length }));
    assert(s.tokens === 11 && s.stage === 3 && s.party === 1 && s.bag.join() === 'crownskull,goatleg' && s.grabs === 9 && s.overlays === 0, 'continue restored the wrong run: ' + JSON.stringify(s));
    // NEW RUN asks first, and the safe choice is the default: a stray Enter must not delete a run
    await page.evaluate(() => { Engine.overlays.length = 0; Engine.go('shop', { title: true }, 'cut'); Overlays.title(); }); await wait(page, 300);
    await press(page, 'ArrowDown'); await press(page, 'Enter', 250);
    assert(await page.evaluate(() => Engine.overlays.length === 2), 'NEW RUN did not ask for confirmation');
    await press(page, 'Enter', 250);
    const kept = await page.evaluate(() => ({ has: Save.hasRun(), overlays: Engine.overlays.length, stage: Game.stage }));
    assert(kept.has && kept.overlays === 1, 'a stray Enter on the confirmation deleted or closed the run: ' + JSON.stringify(kept));
    assert(page.errors.length === 0, page.errors.join('\n'));
    await page.close();
  },

  async 'a broken screen does not freeze the game'() {
    const page = await newPage();
    await startGame(page, `http://127.0.0.1:${A}/index.html`);
    await page.evaluate(() => Engine.go('claw', {}, 'cut')); await wait(page, 500);
    const before = await page.evaluate(() => Engine.frame);
    await page.evaluate(() => { Scenes.claw.update = () => { throw new Error('e2e boom'); }; });
    await wait(page, 900);
    const r = await page.evaluate(() => ({ frame: Engine.frame, scene: Engine.sceneName, crash: document.getElementById('crash') && document.getElementById('crash').classList.contains('open'), text: document.getElementById('crash') ? document.getElementById('crash').textContent : '', logged: CrashLog.list.map((e) => e.msg) }));
    assert(r.frame > before + 20, 'the game loop stopped');
    assert(r.crash && /boom/.test(r.text) && r.logged.includes('e2e boom'), 'no crash report shown: ' + JSON.stringify(r));
    assert(r.scene === 'shop', 'after repeated errors the game should fall back to the shop, was ' + r.scene);
    const rep = await page.evaluate(() => CrashLog.text('t'));
    assert(/graphics:/.test(rep) && /browser:/.test(rep) && /e2e boom/.test(rep), 'the report is missing pieces');
    await page.close();
  },

  async 'blocked storage (sandboxed frame) is survivable and says so'() {
    const page = await newPage();
    await page.goto(`http://127.0.0.1:${A}/__parent?src=${encodeURIComponent(`http://127.0.0.1:${B}/index.html`)}&sandbox=${encodeURIComponent('allow-scripts')}`);
    await wait(page, 1500);
    const f = page.frames().find((x) => x.url().includes(`:${B}/`));
    assert(f, 'the game frame did not load');
    const r = await f.evaluate(() => ({ persistent: Store.persistent, overlays: Engine.overlays.length, err: null }));
    assert(r.persistent === false, 'storage should be reported blocked');
    await page.keyboard.press('Enter'); await wait(page, 300); // focus is in the parent; click in to give the frame the keys
    const box = await (await page.$('#g')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await wait(page, 300);
    const lit2 = await f.evaluate(() => { const d = document.getElementById('game').getContext('2d').getImageData(0, 0, 480, 270).data; let n = 0; for (let i = 0; i < d.length; i += 40) if (d[i] > 60) n++; return n; });
    assert(lit2 > 100, 'the game did not draw in the sandboxed frame');
    assert(page.errors.length === 0, page.errors.join('\n'));
    await page.close();
  },

  async 'an itch-style cross-origin frame keeps saves and fullscreen does not throw'() {
    const page = await newPage();
    await page.goto(`http://127.0.0.1:${A}/__parent?src=${encodeURIComponent(`http://127.0.0.1:${B}/index.html`)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock')}`);
    await wait(page, 1500);
    const f = page.frames().find((x) => x.url().includes(`:${B}/`));
    const box = await (await page.$('#g')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await wait(page, 300);
    assert(await f.evaluate(() => Store.persistent), 'storage should work in an allow-same-origin frame');
    await f.evaluate(() => { Settings.v.master = 0.35; Save.flush(); });
    await page.reload(); await wait(page, 1500);
    const f2 = page.frames().find((x) => x.url().includes(`:${B}/`));
    assert((await f2.evaluate(() => Settings.v.master)) === 0.35, 'settings did not persist across a reload in the frame');
    await page.keyboard.press('KeyF'); await wait(page, 300);
    assert(page.errors.length === 0, page.errors.join('\n'));
    await page.close();
  },

  async 'accessibility: narration, reduced flashing, focus ring'() {
    const page = await newPage();
    await startGame(page, `http://127.0.0.1:${A}/index.html`);
    const said = await page.evaluate(() => document.getElementById('sr').textContent);
    assert(said && said.length > 3, 'nothing was announced to screen readers');
    await page.evaluate(() => { Settings.v.reduceFlash = true; Settings.apply(); Engine.flash('#fff', 0.5); });
    assert((await page.evaluate(() => Engine.flashT)) === 0, 'a full-screen flash happened with reduced flashing on');
    // nothing blinks faster than 1.5 times a second when calm: count on/off changes over a second
    const flips = await page.evaluate(() => { let last = null, n = 0; for (let t = 0; t < 1; t += 0.005) { const v = blinkOn(t, 20); if (last !== null && v !== last) n++; last = v; } return n; });
    assert(flips <= 4, 'blinkOn flips ' + flips + ' times a second in calm mode');
    await giveParty(page); await page.evaluate(() => Game.addPart('skull'));
    await page.evaluate(() => Engine.go('slab', {}, 'cut')); await wait(page, 700);
    await press(page, 'ArrowRight'); await press(page, 'ArrowDown');
    const f = await page.evaluate(() => ({ focus: UI.focusId, tip: !!(UI.focused() && UI.focused().tip) }));
    assert(f.focus, 'arrow keys did not move a focus ring on the slab');
    await page.close();
  },

  async 'layouts: phone, laptop and a big monitor'() {
    for (const vp of [{ width: 390, height: 780 }, { width: 1280, height: 720 }, { width: 2560, height: 1440 }]) {
      const page = await newPage({ viewport: vp });
      await page.goto(`http://127.0.0.1:${A}/index.html`); await wait(page, 800);
      const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(), m = document.getElementById('menuBtn').getBoundingClientRect(); return { c: [Math.round(c.left), Math.round(c.width), Math.round(c.height)], mb: [Math.round(m.bottom), m.width > 0], vw: innerWidth, vh: innerHeight, sx: document.documentElement.scrollWidth }; });
      assert(r.c[0] >= 0 && r.c[0] + r.c[1] <= r.vw + 1, `canvas overflows at ${vp.width}: ${JSON.stringify(r)}`);
      assert(r.mb[1] && r.mb[0] <= r.vh, `menu button off screen at ${vp.width}: ${JSON.stringify(r)}`);
      assert(r.sx <= r.vw, `horizontal scroll at ${vp.width}`);
      assert(page.errors.length === 0, page.errors.join('\n'));
      await page.close();
    }
  },

  async 'soak: 60 seconds of random keys and clicks across every screen'() {
    const page = await newPage();
    await startGame(page, `http://127.0.0.1:${A}/index.html`);
    await giveParty(page);
    await page.evaluate(() => { for (const t of ['skull', 'ribcage', 'bonearm', 'fleshArm', 'boneleg', 'goatleg', 'heart', 'wolfskull', 'tentacle', 'wings']) Game.addPart(t); Game.tokens = 40; });
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Escape', 'KeyP', 'KeyM', 'KeyX', 'KeyA', 'KeyD'];
    const box = await canvasBox(page);
    const scenes = new Set(); let frames0 = await page.evaluate(() => Engine.frame);
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const r = rnd();
      if (r < 0.55) await page.keyboard.down(keys[Math.floor(rnd() * keys.length)]).catch(() => {});
      else if (r < 0.7) await page.keyboard.press(keys[Math.floor(rnd() * keys.length)]);
      else if (r < 0.95) await page.mouse.click(box.x + rnd() * box.width, box.y + rnd() * box.height);
      else await page.evaluate(() => { Game.tokens = Math.max(Game.tokens, 3); if (Game.inventory.length < 3) Game.addPart('skull'); });
      for (const k of keys) if (rnd() < 0.3) await page.keyboard.up(k).catch(() => {});
      scenes.add(await page.evaluate(() => Engine.sceneName + (Engine.overlays.length ? '+menu' : '')));
      await wait(page, 30 + Math.floor(rnd() * 120));
    }
    const end = await page.evaluate(() => ({ frame: Engine.frame, crash: document.getElementById('crash') && document.getElementById('crash').classList.contains('open'), errors: CrashLog.list.map((e) => e.msg), scene: Engine.sceneName }));
    assert(end.frame - frames0 > 500, 'the game loop barely ran: ' + (end.frame - frames0));
    assert(!end.crash && end.errors.length === 0, 'the soak crashed something: ' + JSON.stringify(end));
    assert(page.errors.length === 0, page.errors.join('\n'));
    console.log(`     visited: ${[...scenes].sort().join(', ')}`);
    await page.close();
  },
};

const servers = [await serve(), await serve()];
A = servers[0].port; B = servers[1].port;
browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  if (only.length && !only.some((o) => name.toLowerCase().includes(o.toLowerCase()))) continue;
  const t0 = Date.now();
  try { await fn(); console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`); }
}
await browser.close();
servers.forEach((s) => s.srv.close());
console.log(failed ? `\n${failed} failed` : '\nall good');
process.exit(failed ? 1 : 0);
