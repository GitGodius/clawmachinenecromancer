// Regression tests for the game rules, run against the real code in Node (no browser).
//
//   node tools/test.mjs             run everything
//   node tools/test.mjs battles     run one section
//   node tools/test.mjs --update    rewrite tools/golden.json from the current code
//
// Two kinds of check:
//   invariants  rules that must always hold (every part has a sprite, every trait is defined, ...)
//   golden      fixed-seed outputs stored in tools/golden.json. A refactor must leave them byte-identical; a
//               deliberate rebalance re-runs with --update and the diff in git IS the record of what moved.
// Seeds make both randomness streams reproducible (see 02_util.js), so "identical" is a meaningful bar.
import fs from 'node:fs';
import { loadGame } from './lib/headless.mjs';
import { randomCreature, SETUPS } from './lib/scenarios.mjs';
import { fightScene, fightSim } from './lib/battle.mjs';
import { playGrab, exposedParts } from './lib/clawbot.mjs';

const GOLDEN_URL = new URL('./golden.json', import.meta.url);
const args = process.argv.slice(2);
const update = args.includes('--update');
const wanted = args.filter((a) => !a.startsWith('--'));
const golden = fs.existsSync(GOLDEN_URL) ? JSON.parse(fs.readFileSync(GOLDEN_URL, 'utf8')) : {};
const produced = {};
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

const game = loadGame();
const CONFIG = game.get('CONFIG'), PART_DEFS = game.get('PART_DEFS'), TRAITS = game.get('TRAITS'), RARITY = game.get('RARITY'), SPR = game.get('SPR');
game.run('Game.newGame()');

// ------------------------------------------------------------------ invariants
function invariants() {
  const slots = new Set(['head', 'torso', 'arm', 'leg', 'heart', 'back']);
  for (const [k, d] of Object.entries(PART_DEFS)) {
    if (!SPR.has(d.sprite)) fail(`part ${k}: sprite ${d.sprite} is not defined`);
    if (!slots.has(d.slot)) fail(`part ${k}: unknown slot ${d.slot}`);
    if (!RARITY[d.rarity]) fail(`part ${k}: unknown rarity ${d.rarity}`);
    if (d.trait && !TRAITS[d.trait]) fail(`part ${k}: trait ${d.trait} has no entry in TRAITS`);
  }
  for (const [k, t] of Object.entries(TRAITS)) {
    if (!t.name || !t.desc) fail(`trait ${k}: missing name/desc`);
    if (!Object.values(PART_DEFS).some((d) => d.trait === k)) fail(`trait ${k}: no part carries it`);
  }
  for (const slot of slots) if (!Object.values(PART_DEFS).some((d) => d.slot === slot)) fail(`slot ${slot} has no parts`);
  for (const [k, v] of Object.entries(CONFIG)) if (!Number.isFinite(v)) fail(`CONFIG.${k} is not a finite number`);
  if (game.has('checkStageTable')) for (const msg of game.run('checkStageTable()')) fail(msg);
}

// ---------------------------------------------------------------------- golden
const COMBOS = {
  empty: {},
  skullOnly: { head: 'skull' },
  starter: { head: 'skull', torso: 'ribcage', armL: 'swordarm', armR: 'bonearm', legL: 'boneleg', legR: 'boneleg', heart: 'heart' },
  brute: { head: 'wolfskull', torso: 'ogregut', armL: 'ogrearm', armR: 'clawarm', legL: 'goatleg', legR: 'pegleg' },
  royal: { head: 'crownskull', torso: 'armor', armL: 'swordarm', armR: 'swordarm', legL: 'goatleg', legR: 'goatleg', heart: 'goldheart', back: 'wings' },
  flapper: { head: 'eyeball', torso: 'stitched', armL: 'tentacle', armR: 'tentacle', legL: 'fleshLeg', legR: 'fleshLeg', heart: 'blackheart', back: 'tail' },
  noLegs: { head: 'demonskull', torso: 'ribcage', armL: 'fleshArm', armR: 'fleshArm' },
  noArms: { head: 'wolfskull', torso: 'stitched', legL: 'boneleg', legR: 'boneleg' },
};
function creatures() {
  const out = {};
  for (const [name, slots] of Object.entries(COMBOS)) {
    const c = game.run(`new Creature(${JSON.stringify(slots)})`);
    out[name] = { maxHp: c.maxHp, atk: c.atk, def: c.def, spd: c.spd, moveSpeed: c.moveSpeed, atkTime: +c.atkTime.toFixed(3), range: c.range, dodge: c.dodge, crit: c.crit, power: c.power, traits: c.traits };
  }
  return out;
}

function rolls() {
  game.seed(11);
  const byRarity = { common: 0, uncommon: 0, rare: 0, legendary: 0 }, byPart = {};
  for (let i = 0; i < 3000; i++) {
    const t = game.run('randomPartType()');
    byRarity[PART_DEFS[t].rarity]++;
    byPart[t] = (byPart[t] || 0) + 1;
  }
  return { byRarity, byPart };
}

const STAGES = [1, 4, 5, 8, 12], SEEDS = 16;
function battles(fight) {
  const out = {};
  for (const [name, parts] of SETUPS) {
    const row = {};
    for (const stage of STAGES) {
      const rs = [];
      for (let i = 0; i < SEEDS; i++) {
        game.seed(i * 31 + stage);
        const party = parts.map((n) => randomCreature(game, n));
        rs.push(fight(game, party, stage, 9000 + i * 17 + stage));
      }
      row['S' + stage] = rs.map((r) => `${r.won ? 'W' : 'L'}${r.frames}/${r.reward}/${r.alive}/${r.hp}`).join(' ');
    }
    out[name] = row;
  }
  return out;
}

function claw() {
  const M = game.get('MACHINE'), out = [];
  for (const carry of ['gentle', 'jerky']) {
    for (let i = 0; i < 12; i++) {
      game.seed(500 + i);
      const sim = game.run('new ClawSim({})');
      sim.fillPile(CONFIG.partCount);
      let s = 7 * (i + 1);
      const u = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const pool = exposedParts(sim, M);
      const target = pool[Math.floor(u() * pool.length)];
      const r = playGrab(sim, M, { target, aimNoise: 2.5, carry, u });
      out.push(`${carry[0]}${i}:${r.result}:${r.won.join('+') || '-'}:${r.slips}:${r.time.toFixed(2)}`);
    }
  }
  return out;
}

// --------------------------------------------------------------------- runner
const sections = [
  ['invariants', invariants, false],
  ['creatures', creatures, true],
  ['rolls', rolls, true],
  ['battles', () => battles(fightScene), true],
  ['claw', claw, true],
];
if (game.has('BattleSim')) sections.push(['battles(sim)', () => battles(fightSim), 'battles']);

for (const [name, fn, isGolden] of sections) {
  if (wanted.length && !wanted.some((w) => name.startsWith(w))) continue;
  const t0 = Date.now(), before = failures;
  const got = fn();
  if (isGolden) {
    const key = typeof isGolden === 'string' ? isGolden : name;
    if (typeof isGolden !== 'string') produced[key] = got;
    const want = golden[key];
    if (update && typeof isGolden !== 'string') { /* written below */ }
    else if (want === undefined) fail(`${name}: no golden data yet (run with --update)`);
    else {
      const a = JSON.stringify(got), b = JSON.stringify(want);
      if (a !== b) {
        fail(`${name}: output differs from tools/golden.json`);
        const flat = (o, p = '') => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, p + '/' + k)) : [[p, o]]);
        const fg = new Map(flat(got)), fw = new Map(flat(want));
        let shown = 0;
        for (const [k, v] of fg) if (fw.get(k) !== v && shown++ < 4) console.log(`    ${k}\n      got  ${String(v).slice(0, 160)}\n      want ${String(fw.get(k)).slice(0, 160)}`);
      }
    }
  }
  console.log(`${failures === before ? 'ok  ' : 'FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

if (update) {
  const next = Object.assign({}, golden, produced);
  fs.writeFileSync(GOLDEN_URL, JSON.stringify(next, null, 1) + '\n');
  console.log('wrote tools/golden.json');
}
if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall good');
