// Adapters that run one fight to the end with the same bot policy: press FIGHT, ZAP whenever it is ready.
// `fightScene` drives Scenes.battle (the code path the browser takes). `fightSim` drives BattleSim directly.
// tools/test.mjs requires both to give identical numbers, which is what proves the sim/scene split changed nothing.

const DT = 1 / 30;

export function fightScene(game, party, stage, seed) {
  const G = game.get('Game'), S = game.get('Scenes').battle, CONFIG = game.get('CONFIG'), Input = game.get('Input');
  G.stage = stage;
  G.party = party;
  G.tokens = 0;
  G.sim.pending = [];
  game.seedGameplay(seed);
  S.enter({});
  S.update(0.016, 0.016);
  Input.pressed.a = true; S.update(0.016, 0.016); Input.pressed = {}; // FIGHT is the first menu item
  let t = 0, zapT = 0;
  const over = () => G.stage !== stage || !G.party.some((c) => c.hp > 0);
  while (t < 120) {
    S.update(DT, DT);
    t += DT; zapT += DT;
    if (over()) break;
    if (zapT > CONFIG.zapCooldown + 0.1) { Input.pressed.a = true; S.update(0.001, 0.001); Input.pressed = {}; zapT = 0; }
    if (over()) break;
  }
  return {
    won: G.stage > stage,
    frames: Math.round(t / DT),
    reward: G.tokens,
    alive: G.party.filter((c) => c.hp > 0).length,
    hp: Math.round(G.party.reduce((a, c) => a + Math.max(0, c.hp), 0)),
  };
}

export function fightSim(game, party, stage, seed) {
  const G = game.get('Game'), CONFIG = game.get('CONFIG');
  G.stage = stage;
  G.party = party;
  G.tokens = 0;
  G.sim.pending = [];
  game.seedGameplay(seed);
  const sim = game.run(`new BattleSim({ party: Game.party, stage: ${stage} })`);
  sim.start();
  let t = 0, zapT = 0;
  while (t < 120 && !sim.over) {
    sim.step(DT);
    t += DT; zapT += DT;
    if (sim.over) break;
    if (zapT > CONFIG.zapCooldown + 0.1) { sim.step(0.001); sim.zap(); zapT = 0; }
  }
  if (sim.over) G.applyBattle(sim, sim.won ? 'win' : 'lose');
  return {
    won: G.stage > stage,
    frames: Math.round(t / DT),
    reward: G.tokens,
    alive: G.party.filter((c) => c.hp > 0).length,
    hp: Math.round(G.party.reduce((a, c) => a + Math.max(0, c.hp), 0)),
  };
}
