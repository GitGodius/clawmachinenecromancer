// Headless claw tuner: runs the real ClawSim in Node with a bot player and
// reports grab odds per part type. Use it to tune CONFIG before playtesting.
//   node tools/tune.mjs [trials=200] [overridesJSON] [sweep key=v1,v2,...]
//   e.g. node tools/tune.mjs 300 '{"gripAssist":0.2}' hookPull=1,2,3
// env: AIM_NOISE=4 (px, gaussian), JERKY=1 (mash the stick on the carry), MODE=auto (auto return),
//      VERBOSE=1 (one line per trial)
// The bot picks an exposed part, aims at it with human-like noise, drops, and carries to the chute.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const planck = require('planck');

const files = ['01_config.js', '02_util.js', '03_palette.js', '04_sprites_core.js', '05_sprites_parts.js', '10_parts.js', '11_clawsim.js'];
const src = files.map((f) => fs.readFileSync(new URL('../src/js/' + f, import.meta.url), 'utf8')).join('\n') +
  '\n;globalThis.__api = { CONFIG, CONFIG_DEFAULTS, ClawSim, MACHINE, PART_DEFS, PPM, cavityDepth, setRNG: (r) => { RNG = r; }, mulberry32, clamp };';
const ctx = { planck, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { CONFIG, CONFIG_DEFAULTS, ClawSim, MACHINE, PART_DEFS, PPM, cavityDepth, setRNG, mulberry32, clamp } = ctx.__api;

const trials = +(process.argv[2] || 200);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const sweepArg = process.argv[4];
const AIM_NOISE = +(process.env.AIM_NOISE || 4);
const MODE = process.env.MODE || 'manual'; // manual: bot steers to the chute

function runTrial(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  setRNG(mulberry32(seed));
  let ended = null, target = null, atLift = null, topHeld = [], tBound = false;
  const why = [];
  const sim = new ClawSim({ onEvent: (t, d) => {
    if (t === 'turnEnd') ended = d;
    if (t === 'top') topHeld = d.held || [];
    if (t === 'gripLost') why.push(d.why);
    if (t === 'bind' && d.part === target) tBound = true;
    if (t === 'lift') {
      // where everything sits when the claw has closed: inside its cavity or not
      const poly = sim.cavity();
      atLift = new Map();
      for (const p of sim.parts) {
        if (p.won) continue;
        const c = p.body.getWorldCenter(), [lx] = sim.toHub(c);
        atLift.set(p, { lx, depth: Math.max(...p.bodies.map((b) => { const q = b.getWorldCenter(); return cavityDepth(poly, q.x * PPM, q.y * PPM); })) });
      }
    }
  } });
  sim.fillPile(CONFIG.partCount);
  const cand = sim.parts.filter((p) => { const [x] = sim.partPos(p); return !p.won && x > 14 && x < 132; });
  const exposed = cand.filter((p) => {
    const [x, y] = sim.partPos(p);
    return !cand.some((q) => q !== p && Math.abs(sim.partPos(q)[0] - x) < 8 && sim.partPos(q)[1] < y - 4);
  });
  const pool = exposed.length ? exposed : cand;
  target = pool[Math.floor(rng() * pool.length)];
  const tx = target.body.getWorldCenter().x * PPM;
  const gauss = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const aim = clamp(tx + gauss() * AIM_NOISE, MACHINE.carMin, MACHINE.carMax);
  sim.teleportClaw(aim);
  for (let i = 0; i < 30; i++) sim.step(1 / 60);
  const aimErr = aim - target.body.getWorldCenter().x * PPM;
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
  const ti = atLift && atLift.get(target);
  const carried = new Set([...won, ...topHeld]);
  return {
    type: target.type, aimErr, result: ended ? ended.result : 'timeout', time: t, why,
    target: won.includes(target), any: won.length > 0, multi: won.length > 1,
    grabbed: ended ? ended.grabbed.length > 0 : false, tBound,
    tInside: !!ti && ti.depth > 0, tCentred: !!ti && ti.depth > 0 && Math.abs(ti.lx) < 5,
    // phantom: something carried or won that wasn't in the claw when it closed
    phantom: [...carried].some((p) => { const s = atLift && atLift.get(p); return s && s.depth < -CONFIG.gripSlack - 1; }),
  };
}

function runSet(label, extra) {
  Object.assign(CONFIG, CONFIG_DEFAULTS, overrides, extra || {});
  if (MODE === 'auto') CONFIG.carryManual = 0;
  const t0 = Date.now();
  const rs = [];
  for (let i = 0; i < trials; i++) rs.push(runTrial(1000 + i));
  if (process.env.VERBOSE) rs.forEach((r, i) => console.log(i, r.type.padEnd(10), r.result.padEnd(4), 'aim', r.aimErr.toFixed(1).padStart(5), 'inside', r.tInside ? 'Y' : '.', 'bound', r.tBound ? 'Y' : '.', r.target ? 'TARGET' : '', r.phantom ? 'PHANTOM' : '', r.why.join(',')));
  const pct = (a, n = rs.length) => ((100 * a) / Math.max(1, n)).toFixed(0).padStart(3) + '%';
  const n = (f, set = rs) => set.filter(f).length;
  console.log(`\n== ${label}  (${trials} trials, ${((Date.now() - t0) / 1000).toFixed(1)}s, aim noise ${AIM_NOISE}px, ${MODE}${process.env.JERKY ? ', jerky' : ''})`);
  console.log(`  win(any) ${pct(n((r) => r.any))}  target ${pct(n((r) => r.target))}  lifted ${pct(n((r) => r.grabbed))}  slipped ${pct(n((r) => r.result === 'slip'))}  miss ${pct(n((r) => r.result === 'miss'))}  multi ${pct(n((r) => r.multi))}  timeouts ${n((r) => r.result === 'timeout')}  avg ${(rs.reduce((a, r) => a + r.time, 0) / rs.length).toFixed(1)}s`);
  const inside = rs.filter((r) => r.tInside), centred = rs.filter((r) => r.tCentred);
  console.log(`  target in the claw when it closed ${pct(inside.length)} -> won ${pct(n((r) => r.target, inside), inside.length)}   centred in it ${centred.length} -> lost ${pct(n((r) => !r.target, centred), centred.length)}   phantom carries ${pct(n((r) => r.phantom))}`);
  const buckets = [[0, 2], [2, 4], [4, 7], [7, 11], [11, 99]];
  console.log('  target won by aim error: ' + buckets.map(([a, b]) => { const s = rs.filter((r) => Math.abs(r.aimErr) >= a && Math.abs(r.aimErr) < b); return `${a}-${b}px ${s.length ? pct(n((r) => r.target, s), s.length).trim() : '-'} (${s.length})`; }).join('  '));
  const whys = {}; rs.forEach((r) => r.why.forEach((w) => (whys[w] = (whys[w] || 0) + 1)));
  console.log(`  grips lost ${JSON.stringify(whys)}`);
  const byType = {};
  for (const r of rs) (byType[r.type] ||= []).push(r);
  const rows = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
  console.log('  ' + rows.map(([k, v]) => `${k}:${v.length}→${Math.round((100 * v.filter((r) => r.target).length) / v.length)}%`).join('  '));
  return rs;
}

if (sweepArg) {
  const [key, vals] = sweepArg.split('=');
  for (const v of vals.split(',')) runSet(`${key}=${v}`, { [key]: +v });
} else runSet('current config');
