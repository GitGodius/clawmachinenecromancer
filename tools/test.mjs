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
    if (t.set) { if (!game.get('PART_SETS')[k.slice(4)]) fail(`trait ${k}: no set of that name`); continue; } // set bonuses come from PART_SETS, not from a part
    if (!Object.values(PART_DEFS).some((d) => d.trait === k)) fail(`trait ${k}: no part carries it`);
  }
  for (const slot of slots) if (!Object.values(PART_DEFS).some((d) => d.slot === slot)) fail(`slot ${slot} has no parts`);
  for (const [k, S] of Object.entries(game.get('PART_SETS'))) { // every set can be completed on one creature
    for (const t of S.parts) if (!PART_DEFS[t] || PART_DEFS[t].set !== k) fail(`set ${k}: part ${t} is missing or claimed by another set`);
    if (S.parts.length < S.need) fail(`set ${k}: needs ${S.need} parts but lists ${S.parts.length}`);
  }
  for (const [k, v] of Object.entries(CONFIG)) if (!Number.isFinite(v)) fail(`CONFIG.${k} is not a finite number`);
  if (game.has('checkStageTable')) for (const msg of game.run('checkStageTable()')) fail(msg);
}

// ------------------------------------------------------------- accessibility lint
// "Reduce flashing" promises nothing blinks faster than 1.5 times a second. This scans the source for on/off
// blinkers (Math.sin(t * N) compared with a number) that run faster than that and are not routed through
// blinkOn() or guarded by reduceFlash. New code that strobes fails here instead of in a player's eyes.
function flashLint() {
  const dir = new URL('../src/js/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    fs.readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((line, i) => {
      if (/blinkOn|reduceFlash|calm-ok/.test(line)) return;
      for (const m of line.matchAll(/Math\.sin\(\s*[\w.]+\s*\*\s*(\d+(?:\.\d+)?)[^)]*\)\s*(?:>|<)/g)) {
        const hz = +m[1] / (2 * Math.PI);
        if (hz > 1.5) fail(`${f}:${i + 1} blinks at ${hz.toFixed(1)} Hz without blinkOn()/reduceFlash: ${line.trim().slice(0, 90)}`);
      }
      // things that blink or strobe without a sine: the white hit-flash, and bolts that re-seed or jitter every frame
      if (/\.flashT\s*=\s*0\.\d/.test(line)) fail(`${f}:${i + 1} sets a hit-flash without a reduceFlash guard: ${line.trim().slice(0, 90)}`);
      if (/Draw\.bolt\(/.test(line) && !/function bolt|const bolt|bolt\(ctx, x0/.test(line)) fail(`${f}:${i + 1} draws a bolt without a reduceFlash guard: ${line.trim().slice(0, 90)}`);
      if (/col = vpick\(/.test(line) && /on\s*=/.test(line)) fail(`${f}:${i + 1} re-rolls a light's colour every frame without a reduceFlash guard: ${line.trim().slice(0, 90)}`);
      for (const m of line.matchAll(/Math\.floor\(\s*[\w.]+\s*\*\s*(\d+(?:\.\d+)?)\s*\)\s*%\s*(\d+)/g)) {
        const hz = +m[1] / +m[2];
        if (+m[1] > 1.5 && hz > 1.5) fail(`${f}:${i + 1} chases at ${hz.toFixed(1)} Hz without reduceFlash: ${line.trim().slice(0, 90)}`);
      }
    });
  }
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
      const r = playGrab(sim, M, { target, aimNoise: 2.5, carry, u, cfg: CONFIG });
      out.push(`${carry[0]}${i}:${r.result}:${r.won.join('+') || '-'}:${r.slips}:${r.time.toFixed(2)}`);
    }
  }
  return out;
}


// ------------------------------------------------------------------ the rules
// Things docs/DESIGN.md promises, checked against the real code.
const partsInWorld = () => game.run(`(() => { const G = Game; return G.sim.parts.filter((p) => !p.won).length + G.sim.pending.length + G.inventory.length + G.party.reduce((a, c) => a + c.parts().length, 0); })()`);

function rules() {
  const G = game.get('Game');
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
  const fresh = () => { game.seed(3); game.run('Game.newGame()'); G.sim.pending = []; };
  const fight = (party, stage, seed, opts = {}) => {
    G.stage = stage; G.party = party; G.won = false; G.failStreak = opts.streak || 0;
    game.seedGameplay(seed);
    const sim = game.run(`new BattleSim({ party: Game.party, stage: ${stage} })`);
    sim.start();
    let t = 0;
    while (!sim.over && t < 180) { sim.step(1 / 30); t += 1 / 30; if (opts.stopAt != null && sim.progress() >= opts.stopAt) break; }
    return sim;
  };
  const strong = () => [0, 1, 2].map(() => game.run('new Creature({ head: "wolfskull", torso: "ogregut", armL: "ogrearm", armR: "swordarm", legL: "goatleg", legR: "goatleg", heart: "heart" })'));
  const weak = () => [game.run('new Creature({ head: "skull" })')];

  // pillar 2: nothing is wasted. Across a fight the parts in the world only go up by what the battle restocked.
  fresh();
  let party = weak(); G.party = party;
  let before = partsInWorld();
  let sim = fight(party, 5, 1);
  eq(sim.over && !sim.won, true, 'a lone skull loses to the stage 5 boss');
  let r = G.applyBattle(sim, 'lose');
  eq(partsInWorld() - before, r.restocked.length, 'defeat: parts in the world change only by the restock');
  eq(r.deadParts.length, 1, 'the dead skull returns to the machine');
  eq(G.sim.pending.length, r.deadParts.length + r.restocked.length, 'dead creatures and restocks go to the MACHINE (pending), not the bag');
  eq(G.inventory.length, 0, 'pillar 1: a battle never puts a part in the bag');

  // a win pays full, restocks 3 into the machine, advances the stage, heals
  fresh(); party = strong(); G.party = party; before = partsInWorld();
  sim = fight(party, 1, 2);
  eq(sim.won, true, 'a strong party wins stage 1');
  const tok = G.tokens; const st = G.stage;
  r = G.applyBattle(sim, 'win');
  eq(r.reward, CONFIG.winTokens + 1, 'win pays winTokens + stage');
  eq(G.tokens - tok, r.reward + r.gold, 'tokens go up by the reward');
  eq(G.stage, st + 1, 'a win advances the stage');
  eq(r.restocked.length, CONFIG.restockParts, 'a win restocks the machine');
  eq(G.inventory.length, 0, 'pillar 1: a win puts nothing in the bag');
  eq(G.party.every((c) => c.hp === c.maxHp), true, 'the party is healed after a win');

  // retreat: nobody dies because of it, everyone standing is healed, pay is for damage only
  fresh(); party = strong();
  sim = fight(party, 6, 4, { stopAt: 0.4 });
  const prog = sim.progress();
  if (!(prog > 0.3 && !sim.over)) fail(`retreat setup: wanted an unfinished fight past 30%, got ${prog}, over ${sim.over}`);
  sim.stop();
  const t0 = G.tokens; r = G.applyBattle(sim, 'retreat');
  eq(r.reward, Math.round(CONFIG.partialPay * (CONFIG.winTokens + 6) * prog) + Math.round(Math.min(CONFIG.ladderMax, 1) * prog), 'retreat pays a share for the damage done, plus the ladder scaled the same way');
  eq(G.party.every((c) => c.hp === c.maxHp), true, 'retreat heals everyone still standing');
  eq(G.stage, 6, 'retreat does not advance the stage');
  eq(G.tokens - t0, r.reward + r.gold, 'retreat pays tokens');

  // the ladder cannot be farmed: FIGHT then RETREAT (no damage) pays nothing, at any streak
  fresh(); party = strong();
  for (const streak of [0, 3, 9]) {
    G.failStreak = streak; G.stage = 6;
    eq(G.battlePay(6, 'retreat', 0, false), 0, `retreat with no damage pays nothing (streak ${streak})`);
    eq(G.battlePay(6, 'lose', 0, false), 1, `a defeat with no damage pays the 1 token floor (streak ${streak})`);
  }
  // ...and it is bounded: more failures never pay more than the cap on top of the share
  G.failStreak = 99; const capped = G.battlePay(6, 'retreat', 1, false);
  eq(capped <= Math.round(CONFIG.partialPay * (CONFIG.winTokens + 6)) + CONFIG.ladderMax, true, 'the ladder is capped');

  // the run ends at the final boss
  fresh(); party = strong();
  sim = fight(party, FINAL, 5);
  if (sim.won) { G.applyBattle(sim, 'win'); eq(G.won, true, 'clearing the final stage ends the run'); eq(G.stage, FINAL, 'the stage does not run past the end'); }
  else { // the party we built can lose the last stage; force the rule instead
    G.stage = FINAL; const s2 = game.run('new BattleSim({ party: Game.party, stage: FINAL_STAGE })'); s2.killEnemies(); s2.step(0.1);
    G.applyBattle(s2, 'win'); eq(G.won, true, 'clearing the final stage ends the run');
  }

  // top-up: the machine never runs dry
  fresh(); G.sim.clearParts(); G.sim.pending = [];
  eq(G.topUpMachine(), 7, 'an empty machine is topped up'); eq(G.topUpMachine(), 0, '...once');
}
const FINAL = game.get('FINAL_STAGE');

// -------------------------------------------------------- settings, keys, saves
function saves() {
  const Settings = game.get('Settings'), Save = game.get('Save'), Store = game.get('Store'), G = game.get('Game');
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
  Save.enabled = false;
  game.storage.clear();

  // defaults and bad data
  Settings.load({ master: 5, shake: 0.7, carryTime: 99, steering: 'sideways', keys: { left: ['KeyQ', 'KeyQ'], right: [] } });
  eq(Settings.v.master, 1, 'volume is clamped'); eq(Settings.v.shake, 1, 'an unknown shake level falls back'); eq(Settings.v.carryTime, 8, 'an unknown carry time falls back'); eq(Settings.v.steering, 'hold', 'an unknown steering mode falls back');
  eq(Settings.v.keys.left, ['KeyQ', null], 'a key cannot sit on an action twice');
  eq(Settings.v.keys.right.some(Boolean), true, 'an action left with no key gets a default back');
  Settings.load(null);

  // rebinding: a key belongs to one action; movement can never be left with no key
  const stolen = Settings.bind('pause', 0, 'KeyA');
  eq(stolen, 'left', 'binding a taken key reports who lost it'); eq(Settings.v.keys.left, [ 'ArrowLeft', null ], 'the loser keeps its other key');
  eq(Settings.v.keys.pause[0], 'KeyA', 'the new binding took');
  eq(Settings.unbind('left', 0), false, 'the last key for a movement action cannot be cleared');
  eq(Settings.unbind('mute', 0), true, 'an optional action can be cleared');
  const seen = new Set(); let dup = false;
  for (const a of game.get('KEY_ACTIONS')) for (const c of Settings.v.keys[a.id]) if (c) { if (seen.has(c)) dup = true; seen.add(c); }
  eq(dup, false, 'no key code is bound to two actions');
  Settings.resetKeys(); eq(Settings.v.keys.pause, ['KeyP', null], 'reset restores the defaults');
  // a bind that would strand a movement/confirm action is refused, never silently undone
  eq(Settings.wouldStrand('pause', 'Space'), null, 'Space is safe to move: Drop has Enter too');
  Settings.bind('pause', 0, 'Space'); Settings.bind('mute', 0, 'Enter');
  eq(Settings.v.keys.a.some(Boolean), true, 'Drop/confirm still has a key after taking both of its defaults');
  eq(Settings.v.keys.pause[0], 'Space', 'the earlier binding was not silently undone');
  eq(Settings.wouldStrand('mute', 'Space'), null, 'pause is optional: taking its key is fine');
  Settings.resetKeys();

  // settings reach the game
  Settings.v.autoCarry = true; Settings.v.shake = 0.5; Settings.v.carryTime = 16; Settings.apply();
  eq([CONFIG.carryManual, CONFIG.shake, CONFIG.carryTime], [0, 0.5, 16], 'settings are applied to CONFIG');
  Settings.load(null); Settings.apply();

  // a foreign or hand-edited save must not throw
  for (const bad of ['{ inventory: {} }', '{ party: [null, 3, "x"] }', '{ machine: "abc" }', '{ party: [{ slots: 5 }] }', '{ stats: 7, seen: "no" }']) {
    let threw = null; try { game.run(`Game.fromSave(${bad})`); } catch (e) { threw = e.message; }
    eq(threw, null, `fromSave(${bad}) does not throw`);
  }
  game.run('Game.newGame()');

  // a run round-trips: build one with the bot, save it, load it, compare
  game.seed(9); game.run('Game.newGame()');
  G.tokens = 7; G.stage = 4; G.bestStage = 3; G.failStreak = 2; G.playTime = 321; G.tally('grabs', 12); G.tally('parts', 6);
  G.inventory.push(...['skull', 'goatleg', 'crownskull'].map((t) => game.run(`makePartItem(${JSON.stringify(t)})`)));
  const c = game.run('new Creature({ head: "wolfskull", torso: "armor", armL: "swordarm", legL: "goatleg" })'); c.hp = 5; c.kills = 3; G.party.push(c);
  const saved = JSON.parse(JSON.stringify(G.toSave()));
  const machineTypes = saved.machine.slice().sort();
  game.seed(10); G.fromSave(saved);
  const again = JSON.parse(JSON.stringify(G.toSave()));
  eq(again.machine.slice().sort(), machineTypes, 'the machine holds the same parts after a reload');
  eq({ ...again, machine: 0 }, { ...saved, machine: 0 }, 'a saved run loads back identical (the pile is rebuilt, its parts are the same)');
  eq(G.party[0].hp, 5, 'creature health survives'); eq(G.party[0].kills, 3, 'creature kills survive');

  // stitched-but-not-yet-alive parts are not lost by a save
  const slab = game.get('Scenes').slab;
  slab.reset();
  eq(slab.buildTypes(), [], 'reset clears the slab');

  // the file: versions, corruption, newer builds, retired parts
  Save.enabled = true;
  Save.load(); Settings.v.master = 0.3; Save.flush();
  Save.load(); eq(Settings.v.master, 0.3, 'settings persist through a save file');
  Store.set('thegoodparts.save', '{not json'); Save.load();
  eq(Save.problem, 'corrupt', 'a broken file is noticed'); eq(Store.get('thegoodparts.save.corrupt'), '{not json', 'and kept, not destroyed'); eq(Save.data.run, null, 'and it starts fresh');
  Store.set('thegoodparts.save', JSON.stringify({ v: 99, settings: { master: 0.1 }, run: { tokens: 5 } })); Save.load();
  eq(Save.problem, 'newer', 'a save from a newer build is recognised'); eq(Save.readOnly, true, 'and never overwritten');
  const before = Store.get('thegoodparts.save'); Save.flush(); eq(Store.get('thegoodparts.save'), before, 'flush leaves a newer save untouched');
  Store.set('thegoodparts.save', JSON.stringify({ v: 0, run: { tokens: 3, stage: 2, inventory: ['skull', 'retiredPart', 'goatleg'], party: [{ slots: { head: 'nope', torso: 'ribcage' } }], machine: ['skull', 'ribcage', 'heart', 'bonearm', 'boneleg', 'skull'] } }));
  Save.load(); eq(Save.data.v, game.get('SAVE_VERSION'), 'an old save is migrated to the current version');
  G.fromSave(Save.data.run);
  eq(G.inventory.map((i) => i.type), ['skull', 'goatleg'], 'a part that no longer exists is dropped, the rest survive');
  eq(/^2 parts from an older version were retired\.$/.test(Save.notes[0] || ''), true, 'and the player is told once how many (one in the bag, one on a creature)'); eq(G.party.length, 1, 'a creature with one retired part keeps the rest');
  // the boot-time blank game must not overwrite a waiting run (this once wiped every save on page load)
  Store.set('thegoodparts.save', JSON.stringify({ v: 1, run: { tokens: 11, stage: 3 } })); Save.load(); Save.runActive = false;
  G.newGame(); Save.flush();
  eq(JSON.parse(Store.get('thegoodparts.save')).run.tokens, 11, 'a flush before the player picks CONTINUE leaves the saved run alone');
  Save.runActive = true; G.newGame(); Save.flush();
  eq(JSON.parse(Store.get('thegoodparts.save')).run.tokens, G.tokens, 'once a run is active it is saved');
  Save.runActive = false;
  // a finished run is not saved as something to continue
  G.won = true; Save.runActive = true; Save.flush(); Save.load(); eq(Save.data.run, null, 'a won run is not continued'); G.won = false; Save.runActive = false;
  Save.enabled = false; game.storage.clear(); Save.wipe();

  // storage that throws (sandboxed frame, blocked site data) must not take the game down
  const blocked = loadGame({ storage: false });
  eq(blocked.run('Store.persistent'), false, 'no storage: Store says so');
  blocked.run('Store.set("k", "v")'); eq(blocked.run('Store.get("k")'), 'v', 'no storage: it still remembers for this page load');
  const throwing = loadGame({ globals: { localStorage: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } } } });
  eq(throwing.run('Store.persistent'), false, 'a localStorage that throws: Store falls back to memory');
  throwing.run('Store.set("k", "v")'); eq(throwing.run('Store.get("k")'), 'v', 'and keeps working');
  throwing.run('Save.load(); Save.enabled = true; Save.flush()'); eq(throwing.run('Save.data.v'), game.get('SAVE_VERSION'), 'the save layer survives blocked storage');
}

// --------------------------------------------------------------------- runner
const sections = [
  ['invariants', invariants, false],
  ['flashing', flashLint, false],
  ['rules', rules, false],
  ['saves', saves, false],
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
