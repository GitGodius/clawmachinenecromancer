// ---------------------------------------------------------------------------
// STAGES — who is waiting in the graveyard. Pure data plus a few pure functions, so the battle sim, the
// scene, the stage preview and the balance bots all read the same table.
//
// A run is FINAL_STAGE stages in three acts. The boss of the last one ends it. Every stage is written out
// (no dice), because the Reaper tells you what is coming and the claw only becomes a shopping trip if he
// is telling the truth.
//
// Each enemy asks a different question of your parts (pillar 4, see docs/DESIGN.md):
//   Wisp    swarms in. Many small hits, so armour and a big health pool answer it.
//   Shade   is armoured. Hits smaller than its armour barely count, so big single hits answer it.
//   Wraith  is a boss. Big, slow, a lot of health, so sustain and burst answer it.
// ---------------------------------------------------------------------------
const ENEMY_KINDS = {
  wisp:   { name: 'Wisp',   hp: 10, atk: 3, def: 0, atkTime: 0.8, speed: 34, range: 24, dodge: 0.1, spr: 'wisp', hover: 10, w: 14, tag: 'swarm',
            ask: 'Swarms in. Many small hits: armour and health answer it.' },
  shade:  { name: 'Shade',  hp: 24, atk: 4, def: 3, atkTime: 1.25, speed: 22, range: 28, dodge: 0.05, spr: 'shade', hover: 3, w: 22, tag: 'armoured',
            ask: 'Armoured. Small hits barely scratch it: big hits answer it.' },
  wraith: { name: 'Wraith', hp: 50, atk: 8, def: 3, atkTime: 1.6, speed: 15, range: 38, dodge: 0, spr: 'wraith', hover: 4, w: 36, boss: true, tag: 'boss',
            ask: 'A boss. Huge and slow: staying power and burst answer it.' },
};

const FINAL_STAGE = 15;

// stage -> enemies, left to right. `boss` stages are 5, 10 and 15.
const STAGES = {
  1:  ['wisp', 'wisp'],
  2:  ['wisp', 'shade'],
  3:  ['shade', 'shade'],
  4:  ['shade', 'wisp', 'shade'],
  5:  ['wraith'],
  6:  ['wisp', 'wisp', 'wisp', 'wisp'],
  7:  ['shade', 'wisp', 'shade', 'wisp'],
  8:  ['shade', 'shade', 'wisp', 'shade'],
  9:  ['wisp', 'wisp', 'wisp', 'wisp', 'wisp'],
  10: ['wisp', 'wraith', 'wisp'],
  11: ['shade', 'wisp', 'shade', 'wisp'],
  12: ['shade', 'shade', 'shade', 'shade'],
  13: ['wisp', 'wisp', 'shade', 'wisp', 'wisp'],
  14: ['shade', 'shade', 'wisp', 'shade', 'shade'],
  15: ['shade', 'wraith', 'shade'],
};

const stageEnemies = (n) => STAGES[Math.min(Math.max(1, n), FINAL_STAGE)];

// Enemy health and attack both grow by this factor per stage.
const enemyScale = (n) => 1 + CONFIG.enemyGrowth * (n - 1);
const isBossStage = (n) => n % 5 === 0;
const isFinalStage = (n) => n >= FINAL_STAGE;

const ACTS = [
  { name: 'Graveyard of Second Chances', from: 1 },
  { name: 'The Leaning Crypts', from: 6 },
  { name: 'The Landlord\'s Plot', from: 11 },
];
const actOf = (n) => (n >= 11 ? 2 : n >= 6 ? 1 : 0);
const stageName = (n) => ACTS[actOf(n)].name;
const stageTitle = (n) => 'Stage ' + n + (n >= FINAL_STAGE ? '  ·  THE LANDLORD' : isBossStage(n) ? '  ·  BOSS' : '');

// What the Reaper says about a stage before you go: counts by kind, and the question it asks.
function stagePreview(n) {
  const kinds = stageEnemies(n), count = {};
  for (const k of kinds) count[k] = (count[k] || 0) + 1;
  const lead = kinds.slice().sort((a, b) => ENEMY_KINDS[b].hp - ENEMY_KINDS[a].hp)[0];
  const parts = Object.entries(count).map(([k, c]) => c + ' ' + ENEMY_KINDS[k].name + (c > 1 ? 's' : ''));
  return { n, kinds, count, text: parts.join(', '), ask: ENEMY_KINDS[lead].ask, boss: isBossStage(n), final: isFinalStage(n) };
}

// Sanity checks for tools/test.mjs: returns a list of problems (empty = fine).
function checkStageTable() {
  const bad = [];
  for (const [k, e] of Object.entries(ENEMY_KINDS)) {
    if (!SPR.has(e.spr + '_0') && !SPR.has(e.spr)) bad.push(`enemy ${k}: sprite ${e.spr} is not defined`);
    for (const f of ['hp', 'atk', 'atkTime', 'speed', 'range']) if (!(e[f] > 0)) bad.push(`enemy ${k}: ${f} must be > 0`);
    if (!e.ask) bad.push(`enemy ${k}: needs an 'ask' line for the stage preview`);
  }
  for (let n = 1; n <= FINAL_STAGE; n++) {
    const kinds = STAGES[n];
    if (!kinds || !kinds.length) { bad.push(`stage ${n} has no enemies`); continue; }
    if (kinds.length > 5) bad.push(`stage ${n} has ${kinds.length} enemies; the arena fits 5`);
    for (const k of kinds) if (!ENEMY_KINDS[k]) bad.push(`stage ${n}: unknown enemy ${k}`);
    if (isBossStage(n) !== kinds.includes('wraith')) bad.push(`stage ${n}: boss stages (every 5th) are exactly the ones with a Wraith`);
  }
  if (Object.keys(STAGES).length !== FINAL_STAGE) bad.push('STAGES must have exactly FINAL_STAGE entries');
  return bad;
}
