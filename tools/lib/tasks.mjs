// The units of measurement behind docs/BALANCE.md. Each takes plain data and returns plain data, so a worker
// thread can run it and tools/balance.mjs can compare the result with the committed numbers.
import { loadGame } from './headless.mjs';
import { playRun, PROFILES, summarize as summarizeRuns } from './runbot.mjs';
import { playGrab, exposedParts } from './clawbot.mjs';
import { battleTable } from './tables.mjs';
import { SETUPS, randomCreature } from './scenarios.mjs';
import { pct, mean } from './stats.mjs';
import { matchupTable } from '../matchups.mjs';

// One game per worker, reused (loading and compiling the game is the slow part of a small task).
let cached = null;
const game = () => cached || (cached = loadGame());

// --- the claw: real physics, one bot profile, `trials` fresh piles
export function claw({ profile, trials }) {
  const g = game(), P = PROFILES[profile];
  const M = g.get('MACHINE'), CONFIG = g.get('CONFIG');
  g.resetConfig(P.carry === 'auto' ? { carryManual: 0 } : {});
  const rs = [];
  for (let i = 0; i < trials; i++) {
    g.seed(1000 + i);
    const sim = g.run('new ClawSim({})');
    sim.fillPile(CONFIG.partCount);
    let s = 7919 * (i + 1) + 13;
    const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 1) / 4294967297; };
    const pool = exposedParts(sim, M);
    const target = pool[Math.floor(u() * pool.length)];
    rs.push(playGrab(sim, M, { target, aimNoise: P.aimNoise, carry: P.carry === 'auto' ? 'gentle' : P.carry, u, cfg: CONFIG }));
  }
  g.resetConfig();
  const lifted = rs.filter((r) => r.lifted).length, won = rs.filter((r) => r.won.length).length;
  return { profile, trials, win: pct(won, trials), lifted: pct(lifted, trials), kept: pct(won, Math.max(1, lifted)), seconds: +mean(rs.map((r) => r.time)).toFixed(1) };
}

// --- fights: win % of party shapes by stage, parts dealt like the claw deals them
export function battles({ runs, stages }) {
  const g = game();
  g.run('Game.newGame()');
  g.resetConfig();
  return battleTable(g, { runs, stages });
}

// --- a party where every slot takes the best of `pick` random parts (a player choosing among what the claw gave)
export function battlesBestOf({ runs, stages, pick }) {
  const g = game();
  g.run('Game.newGame()');
  g.resetConfig();
  const G = g.get('Game'), CONFIG = g.get('CONFIG');
  const rows = {};
  for (const [name, shape] of [['3 creatures, 8 parts, best of ' + pick, [8, 8, 8]], ['2 creatures, 8 parts, best of ' + pick, [8, 8]]]) {
    rows[name] = {};
    for (const stage of stages) {
      let wins = 0;
      for (let i = 0; i < runs; i++) {
        g.seed(i * 31 + stage);
        const party = shape.map((n) => bestCreature(g, n, pick));
        G.stage = stage; G.party = party; G.sim.pending = [];
        g.seedGameplay(7000 + i);
        const sim = g.run(`new BattleSim({ party: Game.party, stage: ${stage} })`);
        sim.start();
        let t = 0, zapT = 0;
        while (t < 180 && !sim.over) { sim.step(1 / 30); t += 1 / 30; zapT += 1 / 30; if (!sim.over && zapT > CONFIG.zapCooldown + 0.1) { sim.zap(); zapT = 0; } }
        if (sim.over && sim.won) wins++;
      }
      rows[name][stage] = pct(wins, runs);
    }
  }
  return { stages, rows };
}
function bestCreature(g, n, pick) {
  const PART_DEFS = g.get('PART_DEFS');
  const order = ['torso', 'head', 'arm', 'leg', 'arm', 'leg', 'heart', 'back'];
  const score = (t) => { const d = PART_DEFS[t]; return (d.hp || 0) * 0.5 + (d.atk || 0) * 4 + (d.spd || 0) * 2 + (d.def || 0) * 6 + (d.trait ? 4 : 0); };
  const slots = {};
  for (let i = 0; i < n; i++) {
    const slot = order[i];
    let best = null;
    for (let k = 0; k < pick; k++) { const t = g.run(`randomPartType({ slot: ${JSON.stringify(slot)} })`); if (!best || score(t) > score(best)) best = t; }
    const key = slot === 'arm' ? (slots.armR ? 'armL' : 'armR') : slot === 'leg' ? (slots.legR ? 'legL' : 'legR') : slot;
    slots[key] = best;
  }
  return g.run(`new Creature(${JSON.stringify(slots)})`);
}

export function matchups({ runs, stage }) {
  const g = game();
  g.run('Game.newGame()');
  g.resetConfig();
  return matchupTable(g, { runs, stage });
}

// --- whole runs. fast = no physics (the economy model), otherwise the real claw.
export function runs({ profile, seeds, fast, config, patch }) {
  const out = [];
  for (const seed of seeds) out.push(playRun({ seed, profile, fast, config, patch }));
  return out;
}

// --- a hash of every number that decides balance, so a table can say which numbers it was measured with
export function fingerprint() {
  const g = game();
  const CONFIG = g.get('CONFIG'), META = g.get('CONFIG_META');
  const settingsBacked = new Set(['shake', 'hitPause', 'slowmo', 'dropGuide', 'physDebug', 'carryManual', 'carryTime']); // player settings, not balance
  const balance = {};
  for (const m of META) if (!settingsBacked.has(m[1])) balance[m[1]] = CONFIG[m[1]];
  const data = {
    config: balance,
    parts: JSON.parse(JSON.stringify(g.get('PART_DEFS'))),
    enemies: JSON.parse(JSON.stringify(g.get('ENEMY_KINDS'))),
    stages: JSON.parse(JSON.stringify(g.get('STAGES'))),
    rarity: JSON.parse(JSON.stringify(g.get('RARITY_WEIGHT'))),
    final: g.get('FINAL_STAGE'),
  };
  return { data };
}
export { summarizeRuns, SETUPS, randomCreature };
