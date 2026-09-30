// ---------------------------------------------------------------------------
// STAGES — who is waiting in the graveyard. Pure data plus a few pure functions, so the battle sim, the
// scene, the shop's stage preview and the balance bots all read the same table.
// ---------------------------------------------------------------------------
const ENEMY_KINDS = {
  wisp:   { name: 'Wisp',   hp: 10, atk: 2, atkTime: 1.1, speed: 34, range: 24, dodge: 0.1, spr: 'wisp', hover: 10, w: 14 },
  shade:  { name: 'Shade',  hp: 24, atk: 4, atkTime: 1.25, speed: 22, range: 28, dodge: 0.05, spr: 'shade', hover: 3, w: 22 },
  wraith: { name: 'Wraith', hp: 90, atk: 8, atkTime: 1.6, speed: 15, range: 38, dodge: 0, spr: 'wraith', hover: 4, w: 36, boss: true },
};

function stageEnemies(n) {
  const fixed = { 1: ['wisp', 'wisp'], 2: ['wisp', 'shade'], 3: ['shade', 'shade'], 4: ['shade', 'wisp', 'shade'], 5: ['wraith'] };
  if (fixed[n]) return fixed[n];
  if (n % 5 === 0) return ['wisp', 'wraith', 'wisp'];
  const list = [];
  let budget = 2 + n * 1.1;
  while (budget > 0.9 && list.length < 5) {
    const k = budget >= 2.2 && chance(0.6) ? 'shade' : 'wisp';
    list.push(k);
    budget -= k === 'shade' ? 2.2 : 1;
  }
  return list;
}

// Enemy health and attack both grow by this factor per stage.
const enemyScale = (n) => 1 + 0.2 * (n - 1);
const isBossStage = (n) => n % 5 === 0;

const STAGE_NAMES = ['Graveyard of Second Chances', 'The Leaning Crypts', 'Moonlit Ossuary', 'Hollow Hill', 'The Landlord\'s Plot'];
const stageName = (n) => STAGE_NAMES[Math.floor((n - 1) / 5) % STAGE_NAMES.length];

// Sanity checks for tools/test.mjs: returns a list of problems (empty = fine).
function checkStageTable() {
  const bad = [];
  for (const [k, e] of Object.entries(ENEMY_KINDS)) {
    if (!SPR.has(e.spr + '_0') && !SPR.has(e.spr)) bad.push(`enemy ${k}: sprite ${e.spr} is not defined`);
    for (const f of ['hp', 'atk', 'atkTime', 'speed', 'range']) if (!(e[f] > 0)) bad.push(`enemy ${k}: ${f} must be > 0`);
  }
  for (let n = 1; n <= 40; n++) {
    const kinds = stageEnemies(n);
    if (!kinds.length) bad.push(`stage ${n} has no enemies`);
    for (const k of kinds) if (!ENEMY_KINDS[k]) bad.push(`stage ${n}: unknown enemy ${k}`);
  }
  return bad;
}
