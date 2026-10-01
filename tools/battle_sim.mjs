// Headless battle balance check: runs the real battle scene update loop in Node
// against random parties built from typical claw draws.
//   node tools/battle_sim.mjs [runs=60]
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let planck; try { planck = require('planck'); } catch (e) { planck = require('../vendor/planck.min.js'); } // npm copy, else the vendored one
const dir = new URL('../src/js/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !['99_main.js', '41_debug.js'].includes(f)).sort();
const src = files.map((f) => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n') +
  '\n;globalThis.__api = { CONFIG, Game, Scenes, Creature, randomPartType, PART_DEFS, setRNG: (r) => { RNG = r; }, mulberry32, Engine, UI, Input };';
const ctx = { planck, console, performance, setTimeout, window: {}, navigator: {} };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { CONFIG, Game, Scenes, Creature, randomPartType, PART_DEFS, setRNG, mulberry32 } = ctx.__api;

const runs = +(process.argv[2] || 60);
function randomCreature(nParts) {
  const slots = {};
  const want = ['torso', 'head', 'arm', 'leg', 'arm', 'leg', 'heart', 'back'];
  for (let i = 0; i < nParts; i++) {
    const slot = want[i];
    const type = randomPartType({ slot });
    const key = slot === 'arm' ? (slots.armR ? 'armL' : 'armR') : slot === 'leg' ? (slots.legR ? 'legL' : 'legR') : slot;
    slots[key] = type;
  }
  return new Creature(slots);
}
function fight(party, stage) {
  Game.newGame();
  Game.stage = stage;
  Game.party = party;
  const S = Scenes.battle;
  S.enter({});
  S.update(0.016, 0.016);
  // press FIGHT via the menu's first item
  const Q = ctx.__api.Input;
  Q.pressed.a = true; S.update(0.016, 0.016); Q.pressed = {};
  let t = 0, zapT = 0;
  const over = () => Game.stage !== stage || !Game.party.some((c) => c.hp > 0);
  while (t < 120) {
    S.update(1 / 30, 1 / 30);
    t += 1 / 30;
    zapT += 1 / 30;
    if (over()) break;
    if (zapT > CONFIG.zapCooldown + 0.1) { Q.pressed.a = true; S.update(0.001, 0.001); Q.pressed = {}; zapT = 0; } // uses ZAP whenever ready
    if (over()) break;
  }
  return Game.stage > stage;
}
const setups = [
  ['1 creature, 3 parts', () => [randomCreature(3)]],
  ['1 creature, 5 parts', () => [randomCreature(5)]],
  ['2 creatures, 4 parts', () => [randomCreature(4), randomCreature(4)]],
  ['3 creatures, 5 parts', () => [randomCreature(5), randomCreature(5), randomCreature(5)]],
  ['3 creatures, 7 parts', () => [randomCreature(7), randomCreature(7), randomCreature(7)]],
];
console.log('win rate by stage (ZAP used on cooldown)');
console.log('setup'.padEnd(24) + [1, 2, 3, 4, 5, 6, 8, 10].map((s) => ('S' + s).padStart(6)).join(''));
for (const [name, mk] of setups) {
  let row = name.padEnd(24);
  for (const stage of [1, 2, 3, 4, 5, 6, 8, 10]) {
    let wins = 0;
    for (let i = 0; i < runs; i++) { setRNG(mulberry32(i * 31 + stage)); if (fight(mk(), stage)) wins++; }
    row += (Math.round((100 * wins) / runs) + '%').padStart(6);
  }
  console.log(row);
}
