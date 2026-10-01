// Headless verification of the Rig (the RNG manipulation layer, docs/RNG_LAYER.md).
// Runs the real sim and the real rules in Node: no browser, no human. Every check prints
// PASS or FAIL with its numbers; the exit code is 1 if anything failed.
//   node tools/rig_check.mjs [seeds=40]
//
// It checks, in order:
//   quake     shuffles the pile, loses nothing, never spills, settles, leaves the claw intact
//   seal      the chute lid stays up through a drop and comes down when the claw starts carrying;
//             a part thrown at the chute mid-drop cannot get in (and does get in without the lid)
//   nudge     pushes the right way, hardest under the claw, never spills
//   lens      the odds badge uses the exact function the dice use
//   iron      Iron Grip raises the win rate and cuts slips
//   redo      a rewind restores every part and the claw to the recorded pre-drop state: positions, RAW
//             angles and every revolute joint angle (a bone tail across the +-PI seam is forced, and the
//             same check is shown to fail with the old wrapped restore), and Iron Grip comes back
//   hooks     the recording hooks are invisible: same world with them stubbed out, seed for seed
//   rules     Luck gain/cap/spend/refund, costs, TILT, Order, A/B switch, free-lever cheat
//   fuzz      hundreds of random lever pulls keep every invariant
// See also: `VERBOSE=1 node tools/tune.mjs 80` before and after a change proves the unused
// claw's grab results are bit-identical.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { sourceFiles } from './lib/headless.mjs';
const require = createRequire(import.meta.url);
const planck = require('planck');

// ------------------------------------------------------------------ load the game (no DOM)
const dir = new URL('../src/js/', import.meta.url);
const files = sourceFiles(); // every file a headless run can load, in filename order (tools/lib/headless.mjs)
const src = files.map((f) => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n') +
  '\n;globalThis.__api = { CONFIG, CONFIG_DEFAULTS, Game, Rig, Telemetry, ClawSim, MACHINE, PART_DEFS, RIGSIM, ORDER_SLOTS, PPM, setRNG: (r) => { RNG = r; }, mulberry32, clamp };';
const ctx = { planck, console, performance, setTimeout, window: {}, navigator: {} };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext('Save.enabled = false', ctx); // a check never writes a save
const { CONFIG, CONFIG_DEFAULTS, Game, Rig, Telemetry, ClawSim, MACHINE, PART_DEFS, RIGSIM, ORDER_SLOTS, PPM, setRNG, mulberry32, clamp } = ctx.__api;

const SEEDS = +(process.argv[2] || 40);
let failed = 0;
const fresh = () => { Object.assign(CONFIG, CONFIG_DEFAULTS); };
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const max = (a) => Math.max(...a);
const section = (s) => console.log(`\n== ${s}`);

function newSim(seed) {
  fresh();
  setRNG(mulberry32(seed));
  const ev = [];
  const sim = new ClawSim({ onEvent: (t, d) => ev.push([t, d]) });
  sim.ev = ev;
  sim.fillPile(CONFIG.partCount);
  for (let i = 0; i < 60; i++) sim.step(1 / 60);
  return sim;
}
const snap = (sim) => new Map(sim.parts.filter((p) => !p.won).map((p) => [p.uid, sim.partPos(p)]));
// how many parts sit above each part (same column, at least 6 px higher): a cheap "stack order"
const depth = (pos) => { const m = new Map(); for (const [u, [x, y]] of pos) { let d = 0; for (const [u2, [x2, y2]] of pos) if (u2 !== u && Math.abs(x2 - x) < 12 && y2 < y - 6) d++; m.set(u, d); } return m; };
// A revolute joint reads the RAW angles of its two bodies, so angles and joint angles are compared strictly
// (no modulo 2*PI: comparing modulo hid a real bug where a rewind left a bone tail's joints off by 2*PI).
const jointAngles = (sim) => { const out = []; for (let j = sim.world.getJointList(); j; j = j.getNext()) out.push(j.getType() === 'revolute-joint' ? j.getJointAngle() : 0); return out; };
const jointCount = (sim) => { let n = 0; for (let j = sim.world.getJointList(); j; j = j.getNext()) n++; return n; };
const clawAngles = (sim) => [sim.hub, sim.prongL, sim.prongR].map((b) => b.getAngle());
const worstDiff = (a, b) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0);
const speedOf = (sim) => max(sim.parts.filter((p) => !p.won).map((p) => { const v = p.body.getLinearVelocity(); return Math.hypot(v.x, v.y) * PPM; }));
const finite = (sim) => sim.parts.every((p) => p.bodies.every((b) => { const q = b.getPosition(); return isFinite(q.x) && isFinite(q.y) && isFinite(b.getAngle()); }));
const stepFor = (sim, secs) => { for (let t = 0; t < secs; t += 1 / 60) sim.step(1 / 60); };

// ------------------------------------------------------------------ QUAKE
section(`quake (${SEEDS} seeded piles)`);
{
  const disp = [], changed = [], rise = [], hub = [], unlockAt = [];
  let lost = 0, won = 0, nan = 0, lidUpAtEnd = 0, lidUpAfterDrop = 0, tooLong = 0;
  for (let s = 0; s < SEEDS; s++) {
    const sim = newSim(1000 + s);
    const before = snap(sim), d0 = depth(before), hub0 = sim.hub.getPosition().clone();
    const minY0 = Math.min(...[...before.values()].map((v) => v[1]));
    const wonBefore = sim.parts.filter((p) => p.won).length;
    check_quake: {
      if (!sim.quake()) { failed++; console.log('FAIL  quake() refused on an idle machine'); break check_quake; }
      let minY = 1e9, t = 0, unlock = null;
      while (t < 7) {
        sim.step(1 / 60); t += 1 / 60;
        for (const p of sim.parts) if (!p.won) minY = Math.min(minY, sim.partPos(p)[1]);
        if (unlock == null && sim.lockT <= 0) unlock = t;
      }
      const after = snap(sim), d1 = depth(after);
      let dsum = 0, n = 0, ch = 0;
      for (const [u, [x, y]] of before) { const a = after.get(u); if (!a) continue; dsum += Math.hypot(a[0] - x, a[1] - y); n++; if (d0.get(u) !== d1.get(u)) ch++; }
      disp.push(dsum / n); changed.push(ch / n); rise.push(minY0 - minY);
      lost += [...before.keys()].filter((u) => !after.has(u)).length;
      won += sim.parts.filter((p) => p.won).length - wonBefore;
      if (!finite(sim)) nan++;
      const h1 = sim.hub.getPosition(); hub.push(Math.hypot(h1.x - hub0.x, h1.y - hub0.y) * PPM);
      unlockAt.push(unlock == null ? 99 : unlock);
      if (unlock == null || unlock > CONFIG.quakeTime + RIGSIM.settleCap + 0.2) tooLong++;
      if (sim.lid) lidUpAtEnd++; // the lid must still be up: nobody has dropped yet
      sim.startDrop();
      if (sim.lid) lidUpAfterDrop++; // ...and it stays up through the drop itself
    }
  }
  check('it shuffles: parts move', avg(disp) >= 12, `mean displacement ${avg(disp).toFixed(1)} px`);
  check('it shuffles: stack order changes', avg(changed) >= 0.45, `${(100 * avg(changed)).toFixed(0)}% of parts changed what is on top of them`);
  check('it stays in the glass: no part heaves too high', avg(rise) <= 35 && max(rise) <= 75, `rise above the pile: avg ${avg(rise).toFixed(1)}, worst ${max(rise).toFixed(1)} px`);
  check('nothing lost or spilled', lost === 0 && won === 0, `lost ${lost}, spilled ${won}`);
  check('no NaN ever reaches the world', nan === 0, `${nan} runs`);
  check('the claw is left where it was', max(hub) < 3, `hub drift worst ${max(hub).toFixed(2)} px`);
  check('the drop unlocks once the pile settles', tooLong === 0, `unlock avg ${avg(unlockAt).toFixed(2)} s, worst ${max(unlockAt).toFixed(2)} s`);
  check('the chute stays sealed until you drop', lidUpAtEnd === SEEDS, `${lidUpAtEnd}/${SEEDS}`);
  check('the lid stays up when a drop begins', lidUpAfterDrop === SEEDS, `${lidUpAfterDrop}/${SEEDS}`);
}
{ // the seal is doing real work: without it the same shakes occasionally spill parts
  const real = ClawSim.prototype.seal;
  let spillsWith = 0, spillsWithout = 0;
  const runs = Math.max(SEEDS, 40);
  for (const mode of ['with', 'without']) {
    ClawSim.prototype.seal = mode === 'with' ? real : function () {};
    for (let s = 0; s < runs; s++) {
      const sim = newSim(5000 + s);
      const before = snap(sim);
      sim.quake(); stepFor(sim, 6);
      const gone = [...before.keys()].filter((u) => !sim.parts.some((p) => p.uid === u && !p.won)).length;
      if (mode === 'with') spillsWith += gone; else spillsWithout += gone;
    }
  }
  ClawSim.prototype.seal = real;
  check('the chute seal: zero spills', spillsWith === 0, `with the seal ${spillsWith}; without it ${spillsWithout} (over ${runs} quakes)`);
}

// ------------------------------------------------------------------ NUDGE
section('nudge');
{
  const dx = { R: [], L: [] }, near = [], far = [];
  let bad = 0, nan = 0;
  for (let s = 0; s < SEEDS; s++) for (const dir of [1, -1]) {
    const sim = newSim(2000 + s);
    sim.teleportClaw(60);
    stepFor(sim, 0.5);
    const before = snap(sim);
    if (!sim.nudge(dir)) { bad++; continue; }
    stepFor(sim, 3);
    for (const [u, [x0]] of before) {
      const p = sim.parts.find((q) => q.uid === u && !q.won);
      if (!p) { bad++; continue; }
      const moved = sim.partPos(p)[0] - x0;
      (dir > 0 ? dx.R : dx.L).push(moved);
      (Math.abs(x0 - 60) < 30 ? near : far).push(Math.abs(moved));
    }
    if (!finite(sim)) nan++;
  }
  check('pushes the right way', avg(dx.R) > 0.5 && avg(dx.L) < -0.5, `mean shift right ${avg(dx.R).toFixed(1)} px, left ${avg(dx.L).toFixed(1)} px`);
  check('hardest under the claw', avg(near) > avg(far) * 1.15, `within 30 px ${avg(near).toFixed(1)} px, farther ${avg(far).toFixed(1)} px`);
  check('never loses or spills a part, never NaN', bad === 0 && nan === 0, `${bad} lost/refused, ${nan} NaN`);
  const sim = newSim(1); sim.startDrop();
  check('refuses mid-drop', sim.nudge(1) === false && sim.quake() === false);
}

// ------------------------------------------------------------------ bot for the claw (same idea as tools/tune.mjs)
function runTurn(sim, aimX, opts = {}) {
  if (!sim.ev) { // a sim made by Game.newGame(): collect its events too
    sim.ev = []; const old = sim.onEvent;
    sim.onEvent = (t, d) => { sim.ev.push([t, d]); old && old(t, d); };
  }
  sim.teleportClaw(clamp(aimX, MACHINE.carMin, MACHINE.carMax));
  stepFor(sim, 0.5);
  if (opts.iron) sim.armIron(true);
  if (opts.prep) opts.prep(sim); // a test may rearrange the world right before the drop
  const start = sim.ev.length;
  sim.pred = sim.predict(); // what the Lens says at the instant the drop starts
  sim.pre = { // the world at the instant the drop starts (raw angles: see jointAngles)
    pos: snap(sim), ang: new Map(sim.parts.map((p) => [p.uid, p.bodies.map((b) => b.getAngle())])), carX: sim.carX,
    joints: jointAngles(sim), nJoints: jointCount(sim), claw: clawAngles(sim), iron: sim.iron,
  };
  if (!sim.startDrop()) return null;
  let t = 0;
  while (sim.state !== 'idle' && t < 40) {
    if (opts.onStep) opts.onStep(sim);
    if (sim.state === 'carry') {
      const d = MACHINE.home - sim.carX;
      sim.input.move = Math.abs(d) < 1.5 ? 0 : Math.sign(d) * Math.min(1, Math.abs(d) / 12);
      if (Math.abs(d) < 2 && Math.abs(sim.carV) < 5) sim.press();
    }
    sim.step(1 / 60); t += 1 / 60;
  }
  sim.input.move = 0;
  const end = sim.ev.slice(start).find(([k]) => k === 'turnEnd');
  return end ? end[1] : null;
}
const aimAtRandomPart = (sim, rng) => {
  const c = sim.parts.filter((p) => !p.won && sim.partPos(p)[0] > 14 && sim.partPos(p)[0] < 132);
  return sim.partPos(c[Math.floor(rng() * c.length)])[0] + (rng() - 0.5) * 5;
};

// ------------------------------------------------------------------ CHUTE SEAL (lifetime and the drop itself)
section('chute seal');
{ // the lid stays up through the drop, close and lift, and comes down when the claw starts carrying
  const N = Math.max(SEEDS, 24);
  let wrongUp = 0, wrongDown = 0, lidAtEnd = 0, reached = 0, noLid = 0, turns = 0;
  for (let s = 0; s < N; s++) {
    const sim = newSim(12000 + s), rng = mulberry32(s + 9);
    sim.nudge(s % 2 ? 1 : -1); // a lever was pulled: the lid is up
    if (!sim.lid) { noLid++; continue; }
    const seen = {};
    const turn = runTurn(sim, aimAtRandomPart(sim, rng), { onStep: (q) => { (seen[q.state] = seen[q.state] || new Set()).add(!!q.lid); } });
    if (!turn) continue;
    turns++;
    for (const st of ['drop', 'close', 'lift']) if (seen[st] && seen[st].has(false)) wrongUp++;
    for (const st of ['carry', 'return', 'release']) if (seen[st] && seen[st].has(true)) wrongDown++;
    if (seen.carry || seen.return) reached++;
    if (sim.lid) lidAtEnd++;
  }
  check('a nudge puts the lid up', noLid === 0, `${noLid} without`);
  check('the lid stays up through the drop, the close and the lift', turns > 10 && wrongUp === 0, `${wrongUp} turns where it dropped early (${turns} turns)`);
  check('the lid is down while the claw carries, and when the turn is over', reached >= 3 && wrongDown === 0 && lidAtEnd === 0, `${reached} turns carried, ${wrongDown} with the lid still up, ${lidAtEnd} left up at the end`);
}
{ // a part thrown at the chute while the claw is going down must not get in (and does without the lid)
  const runs = Math.max(SEEDS, 30), real = ClawSim.prototype.seal;
  const tally = { with: 0, without: 0 };
  for (const mode of ['with', 'without']) {
    ClawSim.prototype.seal = mode === 'with' ? real : function () {};
    for (let s = 0; s < runs; s++) {
      const sim = newSim(14000 + s);
      sim.nudge(1); // seals the chute
      sim.teleportClaw(30);
      sim.startDrop();
      const p = sim.parts.filter((q) => !q.def.chain && !q.won).sort((a, b) => sim.partPos(a)[1] - sim.partPos(b)[1])[0];
      p.body.setTransform(planck.Vec2(124 / PPM, 40 / PPM), 0); // from above the pile, flat and fast, at the guard
      p.body.setLinearVelocity(planck.Vec2(340 / PPM, -40 / PPM));
      stepFor(sim, 4);
      if (sim.ev.some(([k]) => k === 'win')) tally[mode]++;
    }
  }
  ClawSim.prototype.seal = real;
  check('a part thrown at the chute mid-drop never gets in', tally.with === 0, `with the lid ${tally.with}/${runs}; without it ${tally.without}/${runs}`);
  check('(the throw is real: it gets in when there is no lid)', tally.without >= runs * 0.5, `${tally.without}/${runs}`);
}

// ------------------------------------------------------------------ LENS
section('lens (odds badge)');
{
  let n = 0, mismatch = 0, ironLess = 0, rollMismatch = 0, rolls = 0;
  for (let s = 0; s < Math.min(SEEDS, 25); s++) {
    const sim = newSim(3000 + s);
    const rng = mulberry32(s + 77);
    for (let k = 0; k < 8; k++) {
      sim.teleportClaw(14 + rng() * 120); stepFor(sim, 0.4);
      const a = sim.predict();
      if (!a || !a.part) continue;
      n++;
      if (Math.abs(a.chance - sim.chanceFor(a.part, a.lx, 1, false) * RIGSIM.lensShift) > 1e-12) mismatch++;
      sim.iron = true; const b = sim.predict(); sim.iron = false;
      if (!(b.chance >= a.chance - 1e-12) || (a.chance < 0.98 && b.chance <= a.chance)) ironLess++;
    }
    // the dice must roll with the chance the grab info reports
    const t = runTurn(sim, aimAtRandomPart(sim, rng));
    const roll = sim.ev.filter(([k]) => k === 'roll').pop();
    if (roll && roll[1].rolls.length && sim.grabInfo && sim.grabInfo.cand.length) {
      rolls++;
      if (Math.abs(roll[1].rolls[0].chance - sim.grabInfo.cand[0].chance) > 1e-12) rollMismatch++;
    }
  }
  check('badge chance = the sim\'s own chance function x the measured shift', n > 20 && mismatch === 0, `${n} predictions, ${mismatch} mismatches`);
  check('Iron Grip raises the predicted chance', ironLess === 0, `${ironLess} violations`);
  check('the revealed roll uses the same chance as the dice', rolls > 5 && rollMismatch === 0, `${rolls} rolls, ${rollMismatch} mismatches`);
}

{ // the badge must be honest on average: a failed "green" drop should not feel rigged
  const N = Math.max(SEEDS * 6, 240);
  const rows = [];
  for (let s = 0; s < N; s++) {
    const sim = newSim(20000 + s), rng = mulberry32(s * 3 + 1);
    runTurn(sim, aimAtRandomPart(sim, rng));
    const pr = sim.pred, roll = sim.ev.filter(([k]) => k === 'roll').pop();
    if (!pr || !pr.part || !roll) continue;
    rows.push({ pred: pr.chance, hit: roll[1].rolls.length > 0 && roll[1].rolls[0].hit });
  }
  const held = avg(rows.map((r) => +r.hit)), pred = avg(rows.map((r) => r.pred));
  const green = rows.filter((r) => r.pred >= 0.52), yellow = rows.filter((r) => r.pred >= 0.33 && r.pred < 0.52);
  check('calibration: the badge matches how often drops really hold', Math.abs(pred - held) <= 0.08, `badge ${(100 * pred).toFixed(0)}% vs held ${(100 * held).toFixed(0)}% over ${rows.length} drops`);
  check('calibration: green badges hold at least as often as yellow', avg(green.map((r) => +r.hit)) >= avg(yellow.map((r) => +r.hit)), `green ${(100 * avg(green.map((r) => +r.hit))).toFixed(0)}% (n=${green.length}), yellow ${(100 * avg(yellow.map((r) => +r.hit))).toFixed(0)}% (n=${yellow.length})`);
}

// ------------------------------------------------------------------ IRON GRIP
section('iron grip');
{
  const N = Math.max(SEEDS * 3, 100);
  const tally = { plain: { win: 0, lost: 0, n: 0 }, iron: { win: 0, lost: 0, n: 0 } };
  for (let s = 0; s < N; s++) {
    for (const mode of ['plain', 'iron']) {
      const sim = newSim(7000 + s);
      const rng = mulberry32(s * 31 + 5);
      let lostGrips = 0;
      sim.onEvent = (t, d) => { sim.ev.push([t, d]); if (t === 'gripLost') lostGrips++; };
      const x = aimAtRandomPart(sim, rng);
      const turn = runTurn(sim, x, { iron: mode === 'iron' });
      const T = tally[mode]; T.n++; if (turn && turn.won.length) T.win++; T.lost += lostGrips > 0 ? 1 : 0;
    }
  }
  const wp = tally.plain.win / N, wi = tally.iron.win / N, lp = tally.plain.lost / N, li = tally.iron.lost / N;
  check('wins more often', wi >= wp + 0.05, `win rate ${(100 * wp).toFixed(0)}% -> ${(100 * wi).toFixed(0)}%`);
  check('drops far less often', li <= lp * 0.6 + 0.01, `grabs that lost their grip ${(100 * lp).toFixed(0)}% -> ${(100 * li).toFixed(0)}%`);
  const sim = newSim(1); sim.armIron(true); sim.startDrop();
  check('lasts exactly one drop', sim.iron === false && sim.turn.iron === true);
}

// ------------------------------------------------------------------ REDO
section('redo (rewind)');
{
  let fails = 0, exact = 0, worst = 0, claw = 0, leftovers = 0, winNoRedo = 0, wins = 0, tried = 0;
  for (let s = 0; s < SEEDS * 4 && fails < Math.max(12, SEEDS / 2); s++) {
    const sim = newSim(9000 + s);
    const rng = mulberry32(s + 3);
    // aim half the turns at a part, half at the empty corner, so we collect both slips and misses
    const x = s % 2 ? aimAtRandomPart(sim, rng) : 18;
    const turn = runTurn(sim, x);
    const pre = sim.pre.pos, preAng = sim.pre.ang, preX = sim.pre.carX;
    tried++;
    if (!turn) continue;
    if (turn.result === 'win') { wins++; if (sim.canRedo()) winNoRedo++; continue; }
    fails++;
    if (!turn.redo || !sim.canRedo()) { leftovers++; continue; }
    if (!sim.rewind()) { leftovers++; continue; }
    let guard = 0;
    while (sim.state === 'rewind' && guard++ < 2000) sim.fixedStep(1 / 120); // stop exactly when the rewind lands
    let err = 0;
    for (const [u, [x0, y0]] of pre) {
      const p = sim.parts.find((q) => q.uid === u);
      if (!p) { err = 1e9; break; }
      const [x1, y1] = sim.partPos(p);
      err = Math.max(err, Math.hypot(x1 - x0, y1 - y0));
      p.bodies.forEach((b, i) => { err = Math.max(err, Math.abs(b.getAngle() - preAng.get(u)[i]) * 10); }); // RAW angle, no modulo
    }
    err = Math.max(err, worstDiff(jointAngles(sim), sim.pre.joints), worstDiff(clawAngles(sim), sim.pre.claw) * 10);
    if (jointCount(sim) !== sim.pre.nJoints) err = 1e9; // a rewind must not leak or lose a joint
    worst = Math.max(worst, err);
    if (err < 1e-6) exact++;
    if (Math.abs(sim.carX - preX) > 1e-6 || sim.state !== 'idle' || sim.turn || sim.redoHist) claw++;
    if (sim.canRedo()) leftovers++; // a rewind cannot be rewound twice
  }
  check('a failed grab can be rewound', fails >= 8 && leftovers === 0, `${fails} failed turns, ${leftovers} not rewindable`);
  check('every part, raw angle, joint angle and the claw restored exactly', fails > 0 && exact === fails - leftovers, `worst error ${worst.toExponential(2)}, ${exact} exact`);
  check('claw back at its start, state idle, one rewind only', claw === 0, `${claw} bad`);
  check('a win is never offered a redo', winNoRedo === 0, `${wins} wins seen`);
  const sim = newSim(4); const t = runTurn(sim, 18);
  sim.startDrop(); // anything that changes the world ends the offer
  check('a new drop cancels the offer', !sim.canRedo());
}
{ // a bone tail lying across the +-PI seam: the case that used to come back with its joints off by 2*PI
  const N = Math.max(8, Math.floor(SEEDS / 2));
  const oldApply = function (H, f) { // the previous restore: setTransform() wraps each angle into (-PI, PI]
    const V = planck.Vec2, nb = H.bodies.length, zero = V(0, 0);
    for (let i = 0; i < nb; i++) { const b = H.bodies[i]; b.setTransform(V(f[i * 3], f[i * 3 + 1]), f[i * 3 + 2]); b.setLinearVelocity(zero); b.setAngularVelocity(0); }
    let o = nb * 3;
    this.carX = f[o++]; this.carV = 0;
    this.carriage.setTransform(V(this.carX / PPM, MACHINE.railY / PPM), 0); this.carriage.setLinearVelocity(zero);
    for (const b of [this.hub, this.prongL, this.prongR]) { b.setTransform(V(f[o], f[o + 1]), f[o + 2]); o += 3; b.setLinearVelocity(zero); b.setAngularVelocity(0); }
  };
  const straddle = (tail) => (sim) => tail.bodies.forEach((b, i) => { // segments at PI-0.03 ... PI+0.03 (raw)
    const a = Math.PI + (i - (tail.bodies.length - 1) / 2) * 0.012;
    b.setTransform(b.getPosition(), a); b.m_sweep.a = b.m_sweep.a0 = a;
  });
  const real = ClawSim.prototype.applyFrame, res = {};
  for (const mode of ['fixed', 'old']) {
    ClawSim.prototype.applyFrame = mode === 'fixed' ? real : oldApply;
    const r = res[mode] = { n: 0, aerr: 0, jerr: 0, seam: 0 };
    for (let s = 0; s < N; s++) {
      const sim = newSim(15000 + s);
      const tail = sim.spawnPart('tail', 96 + (s % 5) * 6, 40, Math.PI);
      stepFor(sim, 3);
      const turn = runTurn(sim, 18, { prep: straddle(tail) });
      if (!turn || turn.result === 'win' || !sim.canRedo()) continue;
      const raw = sim.pre.ang.get(tail.uid);
      if (raw.some((a) => a > Math.PI) && raw.some((a) => a < Math.PI)) r.seam++; // really straddling at the drop
      sim.rewind();
      let guard = 0; while (sim.state === 'rewind' && guard++ < 2000) sim.fixedStep(1 / 120);
      r.n++;
      r.aerr = Math.max(r.aerr, worstDiff(tail.bodies.map((b) => b.getAngle()), raw));
      r.jerr = Math.max(r.jerr, worstDiff(jointAngles(sim), sim.pre.joints));
    }
  }
  ClawSim.prototype.applyFrame = real;
  check('bone tail on the seam: raw angles and joint angles restored exactly', res.fixed.n >= 5 && res.fixed.seam === res.fixed.n && res.fixed.aerr < 1e-9 && res.fixed.jerr < 1e-9,
    `${res.fixed.n} rewinds, tail straddled PI in ${res.fixed.seam}; worst angle error ${res.fixed.aerr.toExponential(1)}, joint ${res.fixed.jerr.toExponential(1)}`);
  check('(the check has teeth: the old wrapped restore fails it)', res.old.n >= 5 && res.old.jerr > 1, `old restore: joint error ${res.old.jerr.toFixed(2)} rad (2*PI = ${(2 * Math.PI).toFixed(2)})`);
}
{ // the world comes back as it was, Iron Grip included (it was already paid for)
  let n = 0, ironBack = 0, plainStaysPlain = 0, usable = 0, tried = 0;
  for (let s = 0; s < SEEDS * 3 && n < 8; s++) {
    for (const iron of [true, false]) {
      const sim = newSim(16000 + s), rng = mulberry32(s + 5);
      const turn = runTurn(sim, s % 2 ? aimAtRandomPart(sim, rng) : 18, { iron });
      tried++;
      if (!turn || turn.result === 'win' || !sim.canRedo()) continue;
      if (turn.iron !== iron || sim.iron) continue; // Iron is consumed by the drop
      sim.rewind(); let guard = 0; while (sim.state === 'rewind' && guard++ < 2000) sim.fixedStep(1 / 120);
      if (iron) { n++; if (sim.iron) ironBack++; if (sim.startDrop() && sim.turn.iron === true) usable++; }
      else if (!sim.iron) plainStaysPlain++;
    }
  }
  check('redo re-arms the Iron Grip that failed, and only that one', n >= 4 && ironBack === n && usable === n && plainStaysPlain > 0, `${ironBack}/${n} re-armed, ${usable}/${n} usable on the next drop, ${plainStaysPlain} plain turns stayed plain`);
}
{ // quakes / nudges / orders / restocks all cancel a pending redo
  const kinds = ['quake', 'nudge', 'spawn'];
  let bad = 0;
  for (const k of kinds) {
    const sim = newSim(11); runTurn(sim, 18);
    if (!sim.canRedo()) { bad++; continue; }
    if (k === 'quake') sim.quake(); else if (k === 'nudge') sim.nudge(1); else { sim.queueSpawn('skull', 0); stepFor(sim, 0.5); }
    if (sim.canRedo()) bad++;
  }
  check('quake, nudge and restock each cancel a pending redo', bad === 0, `${bad} did not`);
}

// ------------------------------------------------------------------ HOOKS are invisible
section('hooks do not disturb the original claw');
{
  const run = () => { const out = []; for (let s = 0; s < 25; s++) { const sim = newSim(6000 + s); const rng = mulberry32(s); const t = runTurn(sim, aimAtRandomPart(sim, rng)); out.push(t ? t.result + ':' + t.won.map((p) => p.type).join(',') + ':' + sim.grabInfo?.cand.map((c) => c.chance.toFixed(6)).join('/') : 'none'); } return out.join('|'); };
  const a = run();
  const keep = [ClawSim.prototype.beginRecord, ClawSim.prototype.recordStep, ClawSim.prototype.endRecord];
  ClawSim.prototype.beginRecord = function () {}; ClawSim.prototype.recordStep = function () {}; ClawSim.prototype.endRecord = function () {};
  const b = run();
  [ClawSim.prototype.beginRecord, ClawSim.prototype.recordStep, ClawSim.prototype.endRecord] = keep;
  check('identical results with the recorder stubbed out (25 seeds)', a === b);
}

// ------------------------------------------------------------------ RULES
section('rules (Luck, costs, TILT, Order)');
{
  const boot = (seed = 1) => { fresh(); setRNG(mulberry32(seed)); Game.newGame(); Game.tokens = 10; Telemetry.lastFailT = null; return Game.sim; };
  const evs = []; Rig.onEvent = (t, d) => evs.push([t, d]);
  let sim = boot();
  check('start Luck', Rig.luck === CONFIG.luckStart, `luck ${Rig.luck}`);
  Rig.luck = 6;
  Rig.gain(5, 'miss');
  check('Luck is capped and overflow is reported', Rig.luck === CONFIG.luckMax && evs.filter(([t]) => t === 'luck').pop()[1].wasted === 3, `luck ${Rig.luck}`);
  Rig.luck = 0;
  Rig.onTurnEnd({ result: 'miss' }); const afterMiss = Rig.luck;
  Rig.onTurnEnd({ result: 'slip' }); const afterSlip = Rig.luck;
  Rig.onTurnEnd({ result: 'win' });
  check('miss +1, slip +2, win +0', afterMiss === CONFIG.luckMiss && afterSlip === CONFIG.luckMiss + CONFIG.luckSlip && Rig.luck === afterSlip, `${afterMiss}, ${afterSlip}, ${Rig.luck}`);
  Rig.luck = 2;
  let r = Rig.use('quake');
  check('quake needs Luck and charges nothing when refused', !r.ok && r.why === 'luck' && Rig.luck === 2 && !sim.quakeS);
  Rig.luck = 8; r = Rig.use('quake');
  check('quake costs 3 and locks the drop', r.ok && Rig.luck === 8 - CONFIG.costQuake && sim.lockT > 0 && sim.lockWhy === 'quake');
  check('levers are busy while it shakes', Rig.can('quake').why === 'busy' && Rig.can('nudgeL').why === 'busy');
  stepFor(sim, 6);
  check('the lock ends by itself', sim.lockT === 0 && Rig.can('quake').ok === (Rig.luck >= CONFIG.costQuake));

  sim = boot(); Rig.luck = 8;
  const spent0 = Telemetry.c.luckSpent;
  r = Rig.use('grip'); const armed = sim.iron, afterArm = Rig.luck;
  r = Rig.use('grip');
  check('Iron Grip arms for 2 and disarming refunds it', armed && afterArm === 8 - CONFIG.costGrip && !sim.iron && Rig.luck === 8 && r.disarm);
  check('...and the stats agree: a taken-back grip is not counted as spent', Telemetry.c.luckSpent === spent0, `spent ${spent0} -> ${Telemetry.c.luckSpent}`);
  Rig.luck = 7; Rig.use('grip'); sim.armIron(false); Rig.refund(5, 'x');
  check('a refund never passes the cap', Rig.luck <= CONFIG.luckMax, `luck ${Rig.luck}`);

  sim = boot(); Rig.luck = 8;
  const n0 = sim.parts.length;
  r = Rig.use('order', 'torso'); stepFor(sim, 1.5);
  const added = sim.parts.filter((p) => p.bornT > sim.time - 3 && !p.won).slice(-1)[0];
  check('Order costs 4 and delivers a part of that slot', r.ok && Rig.luck === 8 - CONFIG.costOrder && sim.parts.length === n0 + 1 && added && PART_DEFS[added.type].slot === 'torso', `parts ${n0} -> ${sim.parts.length}`);
  Rig.luck = 8; const before = Rig.luck; r = Rig.use('order', 'wing');
  check('an unknown slot is refused without charge', !r.ok && Rig.luck === before);
  const slots = {}; for (let i = 0; i < 30; i++) { Rig.luck = 8; boot(i + 50); Rig.luck = 8; const x = Rig.use('order', ORDER_SLOTS[i % 6]); slots[PART_DEFS[x.type].slot] = 1; if (PART_DEFS[x.type].slot !== ORDER_SLOTS[i % 6]) slots.bad = 1; }
  check('every slot can be ordered', !slots.bad && Object.keys(slots).length === 6);

  sim = boot(); Rig.luck = 8;
  r = Rig.use('redo');
  check('redo with nothing to undo is refused', !r.ok && r.why === 'none' && Rig.luck === 8);
  for (const x of [18, 30, 52, 76, 100, 124]) { // find an aim that fails (a win has nothing to undo)
    boot(); sim = Game.sim; Rig.luck = 8; runTurn(sim, x);
    if (sim.canRedo()) break;
  }
  const tokens0 = Game.tokens, had = sim.canRedo();
  r = Rig.use('redo');
  check('redo costs 3, refunds the token and rewinds', had && r.ok && Rig.luck === 8 - CONFIG.costRedo && Game.tokens === tokens0 + 1 && sim.state === 'rewind', `tokens ${tokens0} -> ${Game.tokens}`);
  const again = Rig.use('redo');
  check('a second redo press mid-rewind is "busy", not "nothing to undo", and is free', !again.ok && again.why === 'busy' && Rig.luck === 8 - CONFIG.costRedo && Game.tokens === tokens0 + 1);

  // TILT
  sim = boot(); Rig.luck = 5; Rig.heat = 0;
  const tilts = [];
  for (let i = 0; i < 5; i++) { const res = Rig.use(i % 2 ? 'nudgeR' : 'nudgeL'); tilts.push(!!res.tilt); sim.step(0.05); }
  check('the fourth quick nudge TILTs', tilts.join() === 'false,false,false,true,false' || tilts.indexOf(true) === 3, tilts.join());
  check('TILT locks everything, costs 1 Luck and resets the heat', sim.lockWhy === 'tilt' && Rig.luck === 4 && Rig.heat === 0 && ['quake', 'grip', 'order', 'nudgeL'].every((n) => Rig.can(n).why === 'tilt'), `luck ${Rig.luck}, lock ${sim.lockWhy}`);
  stepFor(sim, CONFIG.tiltLock + 0.5);
  check('TILT ends', sim.lockT === 0 && Rig.can('nudgeL').ok);
  Rig.heat = 0; let slow = 0; for (let i = 0; i < 8; i++) { if (Rig.use('nudgeR').tilt) slow++; Rig.update(2.5); sim.step(1 / 60); stepFor(sim, 0.1); }
  check('slow nudging never TILTs', slow === 0);

  Rig.heat = 2; Rig.cool(2);
  check('TILT heat cools by elapsed time (used when you return from the shop)', Math.abs(Rig.heat - (2 - 2 * CONFIG.heatDecay)) < 1e-9 && (Rig.cool(99), Rig.heat === 0), `heat ${Rig.heat}`);
  sim = boot();
  const need0 = Rig.suggestSlot();
  for (const t of ['skull', 'ribcage', 'bonearm', 'bonearm', 'boneleg', 'boneleg', 'heart', 'wings']) Game.addPart(t);
  check('"needed" names a slot when you are short, and nothing when a full set is in the bag', ORDER_SLOTS.includes(need0) && Rig.suggestSlot() === null, `short: ${need0}, with a full set: ${Rig.suggestSlot()}`);

  // switches
  sim = boot(); Rig.luck = 8; CONFIG.rigOn = 0;
  check('Rig off: every lever refused, no Luck earned', Rig.can('quake').why === 'off' && Rig.gain(3, 'miss') === 0 && Rig.luck === 8);
  CONFIG.rigOn = 1; CONFIG.rigFree = 1; Rig.luck = 0;
  check('free-lever cheat', Rig.can('quake').ok && Rig.cost('order') === 0 && Rig.use('order', 'head').ok && Rig.luck === 0);
  fresh();
  Rig.onEvent = null;
}

// ------------------------------------------------------------------ FUZZ
section(`fuzz (${SEEDS * 10} random lever pulls)`);
{
  fresh(); setRNG(mulberry32(123)); Game.newGame(); const sim = Game.sim;
  const rng = mulberry32(99);
  const names = ['quake', 'nudgeL', 'nudgeR', 'grip', 'order', 'redo', 'drop', 'release', 'step', 'step', 'step', 'move'];
  let bad = '', steps = SEEDS * 10;
  Game.tokens = 500; Rig.luck = 8;
  try {
    for (let i = 0; i < steps && !bad; i++) {
      const n = names[Math.floor(rng() * names.length)];
      if (n === 'drop') { if (sim.canDrop() && Game.tokens > 0) { Game.tokens--; sim.startDrop(); } }
      else if (n === 'release') sim.press();
      else if (n === 'step') stepFor(sim, rng() * 1.5);
      else if (n === 'move') sim.input.move = Math.floor(rng() * 3) - 1;
      else Rig.use(n, ORDER_SLOTS[Math.floor(rng() * 6)]);
      if (Rig.luck < 0 || Rig.luck > CONFIG.luckMax) bad = `luck ${Rig.luck} after ${n}`;
      else if (!finite(sim)) bad = `non-finite body after ${n}`;
      else if (!['idle', 'drop', 'close', 'lift', 'carry', 'return', 'release', 'rewind'].includes(sim.state)) bad = `bad state ${sim.state}`;
      else if (sim.state === 'carry' && rng() < 0.3) sim.press();
      if (sim.parts.length > 90) bad = `parts ballooned to ${sim.parts.length}`;
    }
  } catch (e) { bad = 'exception: ' + e.stack.split('\n').slice(0, 3).join(' | '); }
  check('invariants hold: 0 <= Luck <= cap, finite physics, legal states', !bad, bad || `${steps} actions, ${sim.parts.length} parts, Luck ${Rig.luck}`);
}

console.log(`\n${failed ? failed + ' CHECK(S) FAILED' : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
