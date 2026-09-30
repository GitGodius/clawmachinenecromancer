// Headless claw tuner: runs the real ClawSim in Node with a bot player and
// reports grab odds per part type. Use it to tune CONFIG before playtesting.
//   node tools/tune.mjs [trials=200] [overridesJSON] [sweep key=v1,v2,...]
//   e.g. node tools/tune.mjs 300 '{"gripAssist":0.2}' gripTorque=20,30,45
// env: AIM_NOISE=5 (px of aim error), STYLE=careful|hasty|reckless (how the bot
// carries; compare them to check that carrying well still pays), MODE=auto, VERBOSE=1
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const planck = require('planck');

const files = ['01_config.js', '02_util.js', '03_palette.js', '04_sprites_core.js', '05_sprites_parts.js', '10_parts.js', '11_clawsim.js'];
const src = files.map((f) => fs.readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8')).join('\n') +
  '\n;globalThis.__api = { CONFIG, CONFIG_DEFAULTS, ClawSim, MACHINE, PART_DEFS, setRNG: (r) => { RNG = r; }, mulberry32, clamp };';
const ctx = { planck, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { CONFIG, CONFIG_DEFAULTS, ClawSim, MACHINE, PART_DEFS, setRNG, mulberry32, clamp } = ctx.__api;

const trials = +(process.argv[2] || 200);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const sweepArg = process.argv[4];
const AIM_NOISE = +(process.env.AIM_NOISE || 2.5);
const MODE = process.env.MODE || 'manual'; // manual: bot steers to the chute
// how the bot carries: careful (settle, then ease over) | hasty (full speed at once) | reckless (reverses halfway, slams the end stop)
const STYLE = process.env.STYLE || (process.env.JERKY ? 'hasty' : 'careful');

function runTrial(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  setRNG(mulberry32(seed));
  let ended = null, slips = 0, grabs = 0, info = null, gripLost = 0, nGrips = 0, why = [], gripT = [], slipping = 0, saved = 0, ignored = false, outside = false;
  const sim = new ClawSim({ onEvent: (t, d) => {
    if (t === 'turnEnd') ended = d; if (t === 'slip') slips++; if (t === 'grab') grabs++;
    if (t === 'slipping') slipping++; if (t === 'reseat') saved++;
    if (t === 'lift') {
      info = sim.grabInfo; nGrips = d.grips.length; gripT = d.grips.map((p) => p.type);
      // regression guard for "it was right in the claw and nothing happened": the middle of a
      // part sits in the claw's cavity yet no such part got a grip; and the reverse, a grip on
      // a part that is visibly outside the prongs
      const m = sim.measureGrab(), gripped = new Set(sim.grips.map((g) => g.part));
      const inClaw = m.parts.filter((c) => c.centerIn);
      ignored = inClaw.length > 0 && !inClaw.some((c) => gripped.has(c.p));
      outside = sim.grips.some((g) => { const c = m.parts.find((x) => x.p === g.part); return !c || (!c.centerIn && c.frac < 0.2); });
    }
    if (t === 'gripLost') { gripLost++; why.push(d.why); }
  } });
  sim.fillPile(CONFIG.partCount);
  const cand = sim.parts.filter((p) => { const [x] = sim.partPos(p); return !p.won && x > 14 && x < 132; });
  const exposed = cand.filter((p) => {
    const [x, y] = sim.partPos(p);
    return !cand.some((q) => q !== p && Math.abs(sim.partPos(q)[0] - x) < 8 && sim.partPos(q)[1] < y - 4);
  });
  const pool = exposed.length ? exposed : cand;
  const target = pool[Math.floor(rng() * pool.length)];
  const [tx] = sim.partPos(target);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  sim.teleportClaw(clamp(tx + gauss() * AIM_NOISE, MACHINE.carMin, MACHINE.carMax));
  for (let i = 0; i < 30; i++) sim.step(1 / 60);
  sim.startDrop();
  let t = 0, phase = 0, settled = false, phase0x = null, revT = 0;
  while (!ended && t < 30) {
    if (sim.state === 'carry') {
      const d = MACHINE.home - sim.carX;
      if (STYLE === 'hasty') { // mashing the stick: full speed at once, release as soon as it's over the chute
        sim.input.move = Math.abs(d) < 4 ? 0 : Math.sign(d);
        if (Math.abs(d) < 8) sim.press();
      } else if (STYLE === 'reckless') { // full speed, a panicky reversal halfway, then slam into the end stop
        if (phase === 0) { sim.input.move = 1; phase0x ??= sim.carX; if (sim.carX > (phase0x + MACHINE.home) / 2) { phase = 1; revT = sim.time; } }
        else if (phase === 1) { sim.input.move = -1; if (sim.time - revT > 0.3) phase = 2; }
        else if (phase === 2) { sim.input.move = 1; if (sim.carX >= MACHINE.carMax - 0.5) phase = 3; }
        else { sim.input.move = 0; if (Math.abs(sim.carV) < 5) sim.press(); }
      } else { // careful: let the grip settle (the meter a player sees), then ease over and stop before releasing
        settled ||= sim.state === 'carry' && (sim.stateT > 2.5 || sim.grips.every((g) => g.load < 0.45 && !g.slipping));
        sim.input.move = !settled || Math.abs(d) < 1.5 ? 0 : Math.sign(d) * Math.min(1, Math.abs(d) / 12);
        if (settled && Math.abs(d) < 2 && Math.abs(sim.carV) < 5) sim.press();
      }
    }
    sim.step(1 / 60);
    t += 1 / 60;
  }
  const won = ended ? ended.won : [];
  return {
    type: target.type, rarity: PART_DEFS[target.type].rarity,
    result: ended ? ended.result : 'timeout',
    target: won.includes(target), any: won.length > 0, multi: won.length > 1,
    grabbed: ended ? ended.grabbed.length > 0 : false, slips, time: t,
    nCand: info ? info.inClaw : 0, open: info ? info.open : 1, hold: info && info.held[0] ? info.held[0].q : 0,
    gripped: nGrips > 0, gripLost, why, gripTarget: gripT.includes(target.type), slipping, saved, ignored, outside,
  };
}

function runSet(label, extra) {
  Object.assign(CONFIG, CONFIG_DEFAULTS, overrides, extra || {});
  if (MODE === 'auto') CONFIG.carryManual = 0;
  const t0 = Date.now();
  const rs = [];
  for (let i = 0; i < trials; i++) rs.push(runTrial(1000 + i));
  if (process.env.VERBOSE) rs.forEach((r, i) => console.log(i, r.type, r.result, 'in claw', r.nCand, 'open', r.open.toFixed(2), 'hold', r.hold.toFixed(2), 'gripped', r.gripped, 'lost', r.gripLost));
  const pct = (a) => ((100 * a) / Math.max(1, rs.length)).toFixed(0).padStart(3) + '%';
  const byType = {};
  for (const r of rs) (byType[r.type] ||= []).push(r);
  console.log(`\n== ${label}  (${trials} trials, ${((Date.now() - t0) / 1000).toFixed(1)}s, aim noise ${AIM_NOISE}px, ${MODE}, ${STYLE} carry)`);
  console.log(`  win(any) ${pct(rs.filter((r) => r.any).length)}  target ${pct(rs.filter((r) => r.target).length)}  lifted ${pct(rs.filter((r) => r.grabbed).length)}  slipped ${pct(rs.filter((r) => r.result === 'slip').length)}  miss ${pct(rs.filter((r) => r.result === 'miss').length)}  multi ${pct(rs.filter((r) => r.multi).length)}  timeouts ${rs.filter((r) => r.result === 'timeout').length}  avg ${(rs.reduce((a, r) => a + r.time, 0) / rs.length).toFixed(1)}s`);
  const avg = (f) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(2);
  const gr = rs.filter((r) => r.gripped);
  console.log(`  grab: nothing in claw ${pct(rs.filter((r) => !r.nCand).length)}  avg open ${avg((r) => r.open)}  avg hold ${(gr.reduce((a, r) => a + r.hold, 0) / Math.max(1, gr.length)).toFixed(2)}  gripped ${pct(gr.length)}  grip lost ${pct(rs.filter((r) => r.gripLost).length)}  in-claw-but-ignored ${pct(rs.filter((r) => r.ignored).length)}  gripped-outside-claw ${pct(rs.filter((r) => r.outside).length)}`);
  const whys = {}; rs.forEach((r) => r.why.forEach((w) => (whys[w] = (whys[w] || 0) + 1)));
  console.log(`  lost reasons ${JSON.stringify(whys)}  gripped-the-target ${pct(rs.filter((r) => r.gripTarget).length)}  started slipping ${pct(rs.filter((r) => r.slipping).length)}  saved (re-seated) ${pct(rs.filter((r) => r.saved).length)}`);
  const rows = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
  console.log('  ' + rows.map(([k, v]) => `${k}:${v.length}→${Math.round((100 * v.filter((r) => r.target).length) / v.length)}%`).join('  '));
  return rs;
}

if (sweepArg) {
  const [key, vals] = sweepArg.split('=');
  for (const v of vals.split(',')) runSet(`${key}=${v}`, { [key]: +v });
} else runSet('current config');
