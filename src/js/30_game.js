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
    Rig.reset();
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

  canFight() { return this.party.some((c) => c.hp > 0); },
  broke() { return this.tokens <= 0 && !this.inventory.length && !this.party.length; },
  givePity() {
    this.tokens += CONFIG.pityTokens;
    Telemetry.c.pity++;
    Telemetry.log('pity');
  },
};
