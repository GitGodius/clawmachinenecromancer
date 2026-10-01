// Headless battle balance check: win rate of typical parties at each stage, using the real BattleSim.
//   node tools/battle_sim.mjs [runs=60]
// (ZAP is used the moment it is ready; nobody retreats. Parts are drawn like the claw would deal them.)
import { loadGame } from './lib/headless.mjs';
import { battleTable, printBattleTable } from './lib/tables.mjs';

const runs = +(process.argv[2] || 60);
const game = loadGame();
game.run('Game.newGame()');
console.log(`win rate by stage, ${runs} runs each`);
printBattleTable(battleTable(game, { runs }));
