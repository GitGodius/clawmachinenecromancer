// Shared party builders and small stats helpers for the bots.
// Everything here works through the game's own code (randomPartType, Creature), never a copy of its rules.

// Slots a bot fills first when it only has n parts to spend on a creature.
const FILL_ORDER = ['torso', 'head', 'arm', 'leg', 'arm', 'leg', 'heart', 'back'];

export function randomCreature(game, nParts) {
  const slots = {};
  for (let i = 0; i < nParts; i++) {
    const slot = FILL_ORDER[i];
    const type = game.run(`randomPartType({ slot: ${JSON.stringify(slot)} })`);
    const key = slot === 'arm' ? (slots.armR ? 'armL' : 'armR') : slot === 'leg' ? (slots.legR ? 'legL' : 'legR') : slot;
    slots[key] = type;
  }
  return game.run(`new Creature(${JSON.stringify(slots)})`);
}

// Standard party shapes the balance tables are reported for.
export const SETUPS = [
  ['1 creature, 3 parts', [3]],
  ['1 creature, 5 parts', [5]],
  ['2 creatures, 4 parts', [4, 4]],
  ['3 creatures, 5 parts', [5, 5, 5]],
  ['3 creatures, 7 parts', [7, 7, 7]],
];

export { pct, mean, median, quantile } from './stats.mjs';
