// Headless claw tuner: runs the real ClawSim in Node with a bot player and
// reports grab odds per part type. Use it to tune CONFIG before playtesting.
//   node tools/tune.mjs [trials=200] [overridesJSON] [sweep key=v1,v2,...]
//   e.g. node tools/tune.mjs 300 '{"gripAssist":0.2}' gripTorque=20,30,45
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const planck = require('planck');

const files = ['01_config.js', '02_util.js', '03_palette.js', '04_sprites_core.js', '05_sprites_parts.js', '10_parts.js', '11_clawsim.js', '12_clawrig.js'];
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

function runTrial(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  setRNG(mulberry32(seed));
  let ended = null, slips = 0, grabs = 0, info = null, gripLost = 0, nGrips = 0, why = [], gripT = [];
  const sim = new ClawSim({ onEvent: (t, d) => {
    if (t === 'turnEnd') ended = d; if (t === 'slip') slips++; if (t === 'grab') grabs++;
    if (t === 'lift') { info = sim.grabInfo; nGrips = d.grips.length; gripT = d.grips.map((p) => p.type); } if (t === 'gripLost') { gripLost++; why.push(d.why); }
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
  let t = 0;
  while (!ended && t < 30) {
    if (sim.state === 'carry') {
      const d = MACHINE.home - sim.carX;
      if (process.env.JERKY) { // a human mashing the stick: full speed, release as soon as it's over the chute
        sim.input.move = Math.abs(d) < 4 ? 0 : Math.sign(d);
        if (Math.abs(d) < 8) sim.press();
      } else {
        sim.input.move = Math.abs(d) < 1.5 ? 0 : Math.sign(d) * Math.min(1, Math.abs(d) / 12);
        if (Math.abs(d) < 2 && Math.abs(sim.carV) < 5) sim.press();
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
    nCand: info ? info.cand.length : 0, open: info ? info.open : 1, chance: info && info.cand[0] ? info.cand[0].chance : 0,
    gripped: nGrips > 0, gripLost, why, gripTarget: gripT.includes(target.type),
  };
}

function runSet(label, extra) {
  Object.assign(CONFIG, CONFIG_DEFAULTS, overrides, extra || {});
  if (MODE === 'auto') CONFIG.carryManual = 0;
  const t0 = Date.now();
  const rs = [];
  for (let i = 0; i < trials; i++) rs.push(runTrial(1000 + i));
  if (process.env.VERBOSE) rs.forEach((r, i) => console.log(i, r.type, r.result, 'cand', r.nCand, 'open', r.open.toFixed(2), 'chance', r.chance.toFixed(2), 'gripped', r.gripped, 'lost', r.gripLost));
  const pct = (a) => ((100 * a) / Math.max(1, rs.length)).toFixed(0).padStart(3) + '%';
  const byType = {};
  for (const r of rs) (byType[r.type] ||= []).push(r);
  console.log(`\n== ${label}  (${trials} trials, ${((Date.now() - t0) / 1000).toFixed(1)}s, aim noise ${AIM_NOISE}px, ${MODE})`);
  console.log(`  win(any) ${pct(rs.filter((r) => r.any).length)}  target ${pct(rs.filter((r) => r.target).length)}  lifted ${pct(rs.filter((r) => r.grabbed).length)}  slipped ${pct(rs.filter((r) => r.result === 'slip').length)}  miss ${pct(rs.filter((r) => r.result === 'miss').length)}  multi ${pct(rs.filter((r) => r.multi).length)}  timeouts ${rs.filter((r) => r.result === 'timeout').length}  avg ${(rs.reduce((a, r) => a + r.time, 0) / rs.length).toFixed(1)}s`);
  const avg = (f) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(2);
  console.log(`  grab: no-candidate ${pct(rs.filter((r) => !r.nCand).length)}  avg open ${avg((r) => r.open)}  avg chance ${avg((r) => r.chance)}  gripped ${pct(rs.filter((r) => r.gripped).length)}  grip lost ${pct(rs.filter((r) => r.gripLost).length)}`);
  const whys = {}; rs.forEach((r) => r.why.forEach((w) => (whys[w] = (whys[w] || 0) + 1)));
  console.log(`  lost reasons ${JSON.stringify(whys)}  gripped-the-target ${pct(rs.filter((r) => r.gripTarget).length)}`);
  const rows = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
  console.log('  ' + rows.map(([k, v]) => `${k}:${v.length}→${Math.round((100 * v.filter((r) => r.target).length) / v.length)}%`).join('  '));
  return rs;
}

if (sweepArg) {
  const [key, vals] = sweepArg.split('=');
  for (const v of vals.split(',')) runSet(`${key}=${v}`, { [key]: +v });
} else runSet('current config');
