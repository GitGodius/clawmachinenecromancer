// Does any single build win everywhere? Pits archetype creatures against each enemy type on its own.
//
//   node tools/matchups.mjs [runs=60] [stage=6]
//
// Pillar 4 ("build for the graveyard") says each enemy asks a different question of your parts. If one
// archetype tops every column, the pillar is decoration; this table is the evidence it is not.
// Parties are three copies of one archetype, so the numbers show the build, not the party size.
import { loadGame } from './lib/headless.mjs';
import { pct } from './lib/stats.mjs';

// Every build spends the same budget of rarity: one rare, two uncommons, everything else common. Without that
// the table only shows that better parts are better. Each is a full 8-slot creature, so the differences are
// about WHAT it is good at, not how much of it there is.
export const ARCHETYPES = {
  'tank':     { head: 'wolfskull', torso: 'ogregut', armL: 'fleshArm', armR: 'fleshArm', legL: 'pegleg', legR: 'pegleg', heart: 'heart', back: 'tail' },       // rare: ogre gut. Health pool.
  'plated':   { head: 'wolfskull', torso: 'armor', armL: 'fleshArm', armR: 'fleshArm', legL: 'pegleg', legR: 'fleshLeg', heart: 'blackheart', back: null },   // rare: black heart. Armour, and one revive.
  'bruiser':  { head: 'skull', torso: 'stitched', armL: 'ogrearm', armR: 'swordarm', legL: 'fleshLeg', legR: 'fleshLeg', heart: 'heart', back: 'tail' },       // rare: ogre arm. Big hits.
  'skirmish': { head: 'wolfskull', torso: 'ribcage', armL: 'bonearm', armR: 'bonearm', legL: 'goatleg', legR: 'boneleg', heart: 'heart', back: 'wings' },     // rare: wings. Quick, small hits, dodgy.
};

export const ENEMY_GROUPS = {
  'wisps  x4': ['wisp', 'wisp', 'wisp', 'wisp'],
  'shades x3': ['shade', 'shade', 'shade'],
  'wraith x1': ['wraith'],
};

export function matchupTable(game, { runs = 60, stage = 6, parties = 3 } = {}) {
  const G = game.get('Game'), CONFIG = game.get('CONFIG');
  const table = {};
  for (const [name, slots] of Object.entries(ARCHETYPES)) {
    table[name] = {};
    for (const [gname, kinds] of Object.entries(ENEMY_GROUPS)) {
      let wins = 0, hp = 0;
      for (let i = 0; i < runs; i++) {
        game.seedGameplay(4000 + i);
        G.stage = stage;
        G.party = Array.from({ length: parties }, () => game.run(`new Creature(${JSON.stringify(slots)})`));
        const sim = game.run(`new BattleSim({ party: Game.party, stage: ${stage}, enemies: ${JSON.stringify(kinds)} })`);
        sim.start();
        let t = 0, zapT = 0;
        while (t < 180 && !sim.over) {
          sim.step(1 / 30); t += 1 / 30; zapT += 1 / 30;
          if (!sim.over && zapT > CONFIG.zapCooldown + 0.1) { sim.zap(); zapT = 0; }
        }
        if (sim.over && sim.won) { wins++; hp += sim.allies().reduce((a, u) => a + Math.max(0, u.hp) / u.maxHp, 0) / parties; }
      }
      table[name][gname] = { win: pct(wins, runs), hpLeft: wins ? Math.round((100 * hp) / wins) : 0 };
    }
  }
  return table;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const runs = +(process.argv[2] || 60), stage = +(process.argv[3] || 6);
  const game = loadGame();
  game.run('Game.newGame()');
  const T = matchupTable(game, { runs, stage });
  const cols = Object.keys(ENEMY_GROUPS);
  console.log(`win % (and % HP left when winning), 3 copies of one build vs one enemy type, stage ${stage} scaling, ${runs} runs`);
  console.log('build'.padEnd(10) + cols.map((c) => c.padStart(16)).join(''));
  for (const [name, row] of Object.entries(T)) console.log(name.padEnd(10) + cols.map((c) => `${row[c].win}% (${row[c].hpLeft}%)`.padStart(16)).join(''));
  const best = cols.map((c) => Object.entries(T).sort((a, b) => b[1][c].win - a[1][c].win || b[1][c].hpLeft - a[1][c].hpLeft)[0][0]);
  console.log('\nbest vs each: ' + cols.map((c, i) => `${c.trim()} -> ${best[i]}`).join(',  '));
  console.log(new Set(best).size > 1 ? 'no single build tops every column' : 'WARNING: one build tops every column');
}
