// The measurements behind docs/BALANCE.md, as functions, so tools/battle_sim.mjs (print them) and
// tools/balance.mjs (write and check them) cannot disagree.
import { randomCreature, SETUPS } from './scenarios.mjs';
import { pct } from './stats.mjs';

// Win rate of a party shape at a stage, with the bot policy "ZAP on cooldown, never retreat".
export function fightOnce(game, party, stage, seed) {
  const G = game.get('Game'), CONFIG = game.get('CONFIG');
  G.stage = stage; G.party = party; G.tokens = 0; G.won = false; G.sim.pending = [];
  game.seedGameplay(seed);
  const sim = game.run(`new BattleSim({ party: Game.party, stage: ${stage} })`);
  sim.start();
  let t = 0, zapT = 0;
  while (t < 180 && !sim.over) {
    sim.step(1 / 30); t += 1 / 30; zapT += 1 / 30;
    if (!sim.over && zapT > CONFIG.zapCooldown + 0.1) { sim.zap(); zapT = 0; }
  }
  return { won: sim.over && sim.won, seconds: t, standing: sim.standing() };
}

export function battleTable(game, { runs = 60, stages = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15], setups = SETUPS } = {}) {
  const rows = {};
  for (const [name, shape] of setups) {
    rows[name] = {};
    for (const stage of stages) {
      let wins = 0;
      for (let i = 0; i < runs; i++) {
        game.seed(i * 31 + stage);
        const party = shape.map((n) => randomCreature(game, n));
        if (fightOnce(game, party, stage, 7000 + i).won) wins++;
      }
      rows[name][stage] = pct(wins, runs);
    }
  }
  return { stages, rows };
}

export function printBattleTable(t) {
  console.log('setup'.padEnd(24) + t.stages.map((s) => ('S' + s).padStart(6)).join(''));
  for (const [name, row] of Object.entries(t.rows)) console.log(name.padEnd(24) + t.stages.map((s) => (row[s] + '%').padStart(6)).join(''));
}
