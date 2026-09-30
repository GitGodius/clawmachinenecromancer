// A bot that plays a whole run: grab -> stitch -> fight -> restock -> repeat, on the real game state.
//
// It goes through the same code the browser uses: Scenes.claw.pressA() starts a drop and the scene's own
// event handler awards parts and tops the machine up; fights run BattleSim and Game.applyBattle turns them
// into tokens, restocks and stage progress. The bot only makes the choices a player makes: where to aim,
// how to carry, how to stitch, when to fight.
//
// Skill profiles are the point of the exercise: the late game has to work for the careful player AND
// for the masher, so tools/run_sim.mjs plays all of them.
import { loadGame } from './headless.mjs';
import { playGrab, exposedParts } from './clawbot.mjs';
import { median } from './stats.mjs';

// carry: gentle | jerky | auto (the assist). p is the grab win chance the no-physics model uses for this
// profile; tools/balance.mjs measures the real value with tools/tune.mjs and keeps p honest.
export const PROFILES = {
  careful: { aimNoise: 1.5, carry: 'gentle', smartTarget: true, p: 0.44 },
  average: { aimNoise: 3, carry: 'okay', smartTarget: true, p: 0.4 },
  masher: { aimNoise: 5, carry: 'jerky', smartTarget: false, p: 0.33 },
  assisted: { aimNoise: 5, carry: 'auto', smartTarget: false, p: 0.45 },
};

const SLOT_KEYS = { head: ['head'], torso: ['torso'], arm: ['armR', 'armL'], leg: ['legR', 'legL'], heart: ['heart'], back: ['back'] };
const SLOT_NEED = { head: 3, torso: 3, arm: 6, leg: 6, heart: 3, back: 3 }; // what three full creatures need
const ORDER = ['torso', 'head', 'arm', 'leg', 'arm', 'leg', 'heart', 'back']; // what to fill first

export function playRun(opts = {}) {
  const { seed = 1, profile = 'average', maxStage = 15, maxGrabs = 900, maxRounds = 400, maxMinutes = 120, stallRounds = 60, zap = true, fast = false, patch = [] } = opts;
  const P = Object.assign({}, typeof profile === 'string' ? PROFILES[profile] : profile, opts.p != null ? { p: opts.p } : {});
  const game = opts.game || loadGame();
  game.resetConfig(opts.config);
  for (const code of patch) game.run(code); // e.g. 'ENEMY_KINDS.shade.def = 2' to try a change without editing source
  if (P.carry === 'auto') game.run('CONFIG.carryManual = 0');
  game.seed(seed);
  game.run('Game.newGame()');
  const G = game.get('Game'), M = game.get('MACHINE'), CONFIG = game.get('CONFIG'), PART_DEFS = game.get('PART_DEFS');
  const claw = game.get('Scenes').claw;
  const CreatureCtor = game.get('Creature');
  const makePartItem = game.get('makePartItem');

  // aim noise and target choice come from a private stream so the bot never disturbs the game's dice
  let s = (seed * 2654435761) >>> 0;
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 1) / 4294967297; };

  const run = { seed, profile: typeof profile === 'string' ? profile : 'custom', grabs: 0, wins: 0, slips: 0, misses: 0, fightsWon: 0, fightsLost: 0, retreats: 0, creaturesMade: 0,
    creaturesLost: 0, pity: 0, restockedParts: 0, lostParts: 0, tokensEarned: 0, playSeconds: 0, stageAtGrab: {}, stageAtSecond: {}, timeline: [] };
  const startParts = () => G.sim.parts.filter((p) => !p.won).length;
  let worldStart = startParts();
  const prevHandler = G.sim.onEvent;
  G.sim.onEvent = (t, d) => { if (t === 'lost') run.lostParts++; prevHandler(t, d); };
  run.fast = !!fast;

  const value = (type) => { const d = PART_DEFS[type]; return (d.hp || 0) * 0.5 + (d.atk || 0) * 4 + (d.spd || 0) * 2 + (d.def || 0) * 6 + (d.trait ? 4 : 0) + { common: 0, uncommon: 1, rare: 3, legendary: 6 }[d.rarity]; };
  const partsHeld = () => G.inventory.length + G.party.reduce((a, c) => a + c.parts().length, 0);
  const have = () => { const c = {}; for (const it of G.inventory) c[PART_DEFS[it.type].slot] = (c[PART_DEFS[it.type].slot] || 0) + 1; for (const cr of G.party) for (const t of cr.parts()) c[PART_DEFS[t].slot] = (c[PART_DEFS[t].slot] || 0) + 1; return c; };

  function chooseTarget() {
    const pool = exposedParts(G.sim, M);
    if (!pool.length) return null;
    if (!P.smartTarget) return pool[Math.floor(u() * pool.length)];
    const owned = have();
    let best = null, bs = -1e9;
    for (const p of pool) {
      const slot = p.def.slot;
      const need = (SLOT_NEED[slot] - (owned[slot] || 0)) > 0 ? 1 : 0.25;
      const sc = value(p.type) * need + u() * 2;
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }

  function settle(seconds) { if (fast) return; for (let i = 0; i < seconds * 60; i++) G.sim.step(1 / 60); }

  // The no-physics model: the machine is a list of part types; a grab looks at the few parts within reach,
  // aims at the best (or any, for a masher) and lands it with probability p. It keeps what matters for the
  // economy (recycling, depletion, top-ups) and drops what costs 100 ms a grab. Confirm with physics runs.
  const fastPile = fast ? G.sim.parts.filter((p) => !p.won).map((p) => p.type) : null;
  function grabFast() {
    if (G.tokens <= 0) return false;
    while (G.sim.pending.length) fastPile.push(G.sim.pending.shift().type);
    G.tokens--; run.grabs++; run.playSeconds += 11;
    const owned = have();
    const k = Math.min(4, fastPile.length);
    let best = -1, bs = -1e9;
    for (let i = 0; i < k; i++) {
      const j = Math.floor(u() * fastPile.length);
      const type = fastPile[j], slot = PART_DEFS[type].slot;
      const sc = P.smartTarget ? value(type) * ((SLOT_NEED[slot] - (owned[slot] || 0)) > 0 ? 1 : 0.25) + u() * 2 : u();
      if (sc > bs) { bs = sc; best = j; }
    }
    if (best >= 0 && u() < P.p * (PART_DEFS[fastPile[best]].grip || 1)) {
      const type = fastPile.splice(best, 1)[0];
      G.addPart(type); run.wins++;
    } else run.misses++;
    if (fastPile.length + G.sim.pending.length < 5) for (let i = 0; i < 7; i++) fastPile.push(game.run(`randomPartType({ boost: ${1 + G.stage * 0.1} })`));
    return true;
  }

  function grab() {
    if (fast) return grabFast();
    const target = chooseTarget();
    if (!target) { settle(3); return false; }
    const tokensBefore = G.tokens;
    const r = playGrab(G.sim, M, { target, aimNoise: P.aimNoise, carry: P.carry, u, start: () => claw.pressA(), cfg: CONFIG });
    if (r.result === 'refused') return false;
    run.grabs++; run.playSeconds += r.time + 4;
    if (r.result === 'win') run.wins++; else if (r.result === 'slip') run.slips++; else run.misses++;
    settle(G.sim.pending.length ? 2.5 : 0.5);
    return tokensBefore !== G.tokens;
  }

  // -------- stitching: pool every part I own and deal them out to up to three creatures
  function restitch() {
    const pool = [...G.inventory.map((i) => i.type), ...G.party.flatMap((c) => c.parts())];
    if (!pool.length) return;
    const n = pool.length <= 4 ? 1 : pool.length <= 9 ? 2 : 3;
    const list = Array.from({ length: n }, () => ({}));
    const left = pool.slice();
    for (const pos of ORDER) {
      const cands = left.filter((t) => PART_DEFS[t].slot === pos).sort((a, b) => value(b) - value(a));
      let ci = 0;
      for (const t of cands) {
        if (ci >= n) break;
        const keys = SLOT_KEYS[pos];
        const key = keys.find((k) => !list[ci][k]);
        if (!key) { ci++; continue; }
        list[ci][key] = t;
        left.splice(left.indexOf(t), 1);
        ci++;
      }
    }
    const sig = (arr) => arr.map((c) => JSON.stringify(Object.entries(c.slots || c).sort())).sort().join('|');
    const next = list.filter((c) => Object.keys(c).length);
    if (sig(next) === sig(G.party)) { G.inventory = left.map(makePartItem); return; } // nothing changed: keep them (and their kills)
    G.party = next.map((slots) => new CreatureCtor(slots));
    G.inventory = left.map(makePartItem);
    run.creaturesMade += G.party.length;
    run.playSeconds += 20;
  }

  // -------- one fight, straight through the sim
  function fight() {
    const stage = G.stage;
    const before = G.party.length;
    const sim = game.run('new BattleSim({ party: Game.party, stage: Game.stage })');
    sim.start();
    let t = 0, zapT = 0;
    const DT = 1 / 30;
    let look = 0, retreated = false;
    while (t < 180 && !sim.over) {
      sim.step(DT); t += DT; zapT += DT; look += DT;
      if (sim.over) break;
      if (zap && zapT > CONFIG.zapCooldown + 0.1) { sim.zap(); zapT = 0; }
      // a player pulls the plug when it is going badly: little of us left, lots of them left
      if (P.farm != null && sim.progress() >= P.farm) { retreated = true; break; } // the adversary: pull out at the first scratch
      if (P.retreat !== false && look >= 1) { look = 0; if (sim.standing() < 0.3 && 1 - sim.progress() > 0.3) { retreated = true; break; } }
    }
    const kind = sim.over ? (sim.won ? 'win' : 'lose') : 'retreat';
    if (!sim.over) sim.stop();
    if (retreated) run.retreats++;
    const res = G.applyBattle(sim, kind);
    run.playSeconds += t + 12;
    run.tokensEarned += res.reward + res.gold;
    if (kind === 'retreat') run.retreatPay = (run.retreatPay || 0) + res.reward;
    run.restockedParts += res.restocked.length + res.deadParts.length;
    run.creaturesLost += res.lost.length;
    if (kind === 'win') { run.fightsWon++; if (!(stage in run.stageAtGrab)) { run.stageAtGrab[stage] = run.grabs; run.stageAtSecond[stage] = Math.round(run.playSeconds); } } else run.fightsLost++;
    settle(5);
    return { kind, stage, seconds: t, before };
  }

  let stall = 0, lastStage = G.stage;
  for (let round = 0; round < maxRounds && !G.won && G.stage <= maxStage && run.grabs < maxGrabs && run.playSeconds < maxMinutes * 60; round++) {
    if (G.broke()) { G.givePity(); run.pity++; run.tokensEarned += CONFIG.pityTokens; }
    // spend tokens while there are still slots worth filling
    let guard = 0;
    while (G.tokens > 0 && run.grabs < maxGrabs && guard++ < 200) {
      if (partsHeld() >= 24 + 4) break; // three full creatures already; more parts only pad the bag
      if (!grab() && G.tokens > 0 && guard > 6) break;
    }
    restitch();
    if (!G.canFight()) { run.timeline.push({ round, stage: G.stage, note: 'no creature' }); continue; }
    const f = fight();
    run.timeline.push({ round, stage: f.stage, kind: f.kind, grabs: run.grabs, tokens: G.tokens, parts: partsHeld(), party: G.party.length });
    if (G.stage === lastStage) stall++; else { stall = 0; lastStage = G.stage; }
    if (stall >= stallRounds) { run.wall = G.stage; break; }
  }
  run.stage = G.stage; // the stage the run ended ON (highest cleared = stage - 1)
  run.cleared = G.won ? G.stage : G.stage - 1;
  run.won = G.won;
  run.endedBy = G.won ? 'won' : run.wall ? 'wall' : run.playSeconds >= maxMinutes * 60 ? 'time' : G.stage > maxStage ? 'cap' : run.grabs >= maxGrabs ? 'grabs' : 'rounds';
  run.partsInWorld = (fast ? fastPile.length : G.sim.parts.filter((p) => !p.won).length) + G.sim.pending.length + G.inventory.length + G.party.reduce((a, c) => a + c.parts().length, 0);
  run.partsAtStart = worldStart;
  run.winRate = run.grabs ? Math.round((100 * run.wins) / run.grabs) : 0;
  return run;
}

export function summarize(runs) {
  const cleared = runs.map((r) => r.cleared);
  const reach = (n) => Math.round((100 * runs.filter((r) => r.cleared >= n).length) / runs.length);
  const finished = runs.filter((r) => r.won);
  const finishedIn = (min) => Math.round((100 * finished.filter((r) => r.playSeconds <= min * 60).length) / runs.length);
  const at = (n) => median(runs.filter((r) => n in r.stageAtGrab).map((r) => r.stageAtGrab[n]));
  const atMin = (n) => Math.round(median(runs.filter((r) => n in r.stageAtSecond).map((r) => r.stageAtSecond[n])) / 60);
  return { runs: runs.length, medianCleared: median(cleared), reach, at, atMin, finished: Math.round((100 * finished.length) / runs.length), finishedIn, finishMin: Math.round(median(finished.map((r) => r.playSeconds)) / 60), ended: runs.reduce((a, r) => (a[r.endedBy] = (a[r.endedBy] || 0) + 1, a), {}) };
}
