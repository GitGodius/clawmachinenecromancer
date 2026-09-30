// ---------------------------------------------------------------------------
// GAME STATE — tokens, the bag of parts, your party, the persistent machine.
// No save system on purpose (it's a prototype): refresh = new run.
// ---------------------------------------------------------------------------
const Scenes = {};
const Game = {
  tokens: 0,
  inventory: [], // [{uid, type}]
  party: [], // [Creature]
  stage: 1,
  bestStage: 0,
  sim: null,
  talk: null,
  recent: [], // last won part types (for the bag display)
  seen: {},
  started: false,

  newGame() {
    this.tokens = CONFIG.startTokens;
    this.inventory = [];
    this.party = [];
    this.stage = 1;
    this.recent = [];
    this.seen = {};
    this.talk = new Talker({ voice: 0.62, cps: 40 });
    this.sim = new ClawSim({ onEvent: (t, d) => Scenes.claw && Scenes.claw.onSim(t, d) });
    this.sim.fillPile(CONFIG.partCount);
  },

  addPart(type) {
    const it = makePartItem(type);
    this.inventory.push(it);
    this.recent.unshift(type);
    if (this.recent.length > 8) this.recent.pop();
    return it;
  },
  takeItem(uid) {
    const i = this.inventory.findIndex((x) => x.uid === uid);
    return i >= 0 ? this.inventory.splice(i, 1)[0] : null;
  },
  // dead creatures and battle loot go back into the machine
  restock(types) { types.forEach((t, i) => this.sim.queueSpawn(t, i * 0.2)); },

  // The machine never runs dry: below 5 parts the Reaper fetches 7 more from the back room.
  // Returns how many were queued (0 = the pile was fine).
  topUpMachine() {
    const sim = this.sim;
    const left = sim.parts.filter((p) => !p.won).length + sim.pending.length;
    if (left >= 5) return 0;
    for (let i = 0; i < 7; i++) sim.queueSpawn(randomPartType({ boost: 1 + this.stage * 0.1 }), i * 0.25);
    Telemetry.log('topup', { left });
    return 7;
  },

  // Turn a finished fight into consequences: creature health, dead creatures, tokens, restocks, stage.
  // kind: 'win' | 'lose' | 'retreat'. This is the whole economy of a battle, in one place.
  //   win      tokens = winTokens + stage (+1 with a Heart of Gold), 3 parts drop into the machine, party is healed
  //   lose     1 token; creatures that died fall apart into the machine
  //   retreat  no reward; survivors keep at least 1 HP
  // Dead creatures' parts ALWAYS go back into the machine, never the bag (pillar: the claw is the only door).
  applyBattle(sim, kind) {
    const allies = sim.units.filter((u) => u.team === 'ally');
    const deadAllies = allies.filter((u) => u.dead);
    const survivors = allies.filter((u) => !u.dead);
    for (const u of allies) u.c.hp = u.dead ? 0 : Math.max(1, Math.ceil(u.hp));
    const deadParts = deadAllies.flatMap((u) => u.c.parts());
    this.party = this.party.filter((c) => c.hp > 0);
    let reward = 0;
    const restocked = [];
    if (kind === 'win') {
      reward = CONFIG.winTokens + this.stage;
      if (survivors.some((u) => u.traits.includes('golden'))) reward += 1;
      const boost = 1 + this.stage * 0.2;
      for (let i = 0; i < CONFIG.restockParts; i++) restocked.push(randomPartType({ boost }));
      for (const c of this.party) c.hp = c.maxHp; // the Reaper patches them up
      Telemetry.c.victories++;
      Telemetry.c.bestStage = Math.max(Telemetry.c.bestStage, this.stage);
      this.bestStage = Math.max(this.bestStage, this.stage);
      this.stage++;
    } else if (kind === 'lose') {
      reward = 1;
      Telemetry.c.defeats++;
    } else {
      for (const c of this.party) c.hp = Math.max(1, c.hp);
    }
    this.tokens += reward + sim.goldKills;
    this.restock([...restocked, ...deadParts]);
    return { kind, reward, gold: sim.goldKills, restocked, deadParts, lost: deadAllies.map((u) => u.name) };
  },

  canFight() { return this.party.some((c) => c.hp > 0); },
  broke() { return this.tokens <= 0 && !this.inventory.length && !this.party.length; },
  givePity() {
    this.tokens += CONFIG.pityTokens;
    Telemetry.c.pity++;
    Telemetry.log('pity');
  },
};
