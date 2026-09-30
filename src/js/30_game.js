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
  won: false, // the final boss is down: the run is over
  playTime: 0, // seconds of play in this run (menus and pauses don't count)
  failStreak: 0, // failed fights in a row; the Reaper adds a token per failure (up to ladderMax) so bad luck cannot become a dead end

  newGame(opts = {}) {
    this.tokens = CONFIG.startTokens;
    this.inventory = [];
    this.party = [];
    this.stage = 1;
    this.won = false;
    this.failStreak = 0;
    this.recent = [];
    this.seen = {};
    this.talk = new Talker({ voice: 0.62, cps: 40 });
    this.playTime = 0;
    if (typeof Scenes !== 'undefined' && Scenes.slab && Scenes.slab.reset) Scenes.slab.reset();
    this.sim = new ClawSim({ onEvent: (t, d) => Scenes.claw && Scenes.claw.onSim(t, d) });
    if (opts.pile !== false) this.sim.fillPile(CONFIG.partCount);
  },

  // ---- saving: the run as plain data. Positions are not kept; the pile is rebuilt from part types.
  toSave() {
    const sim = this.sim;
    const machine = sim ? [...sim.parts.filter((p) => !p.won).map((p) => p.type), ...sim.pending.map((p) => p.type)] : [];
    const inGrab = !!sim && sim.state !== 'idle'; // a drop in flight: the token comes back, the part it carries is in the pile
    return {
      tokens: this.tokens + (inGrab ? 1 : 0), stage: this.stage, bestStage: this.bestStage, won: this.won, failStreak: this.failStreak,
      playTime: Math.round(this.playTime || 0), seen: this.seen,
      inventory: [...this.inventory.map((i) => i.type), ...(typeof Scenes !== 'undefined' && Scenes.slab && Scenes.slab.buildTypes ? Scenes.slab.buildTypes() : [])],
      party: this.party.map((c) => ({ slots: c.slots, hp: c.hp, name: c.name, kills: c.kills })),
      machine,
    };
  },

  // Rebuild a run from saved data. Part ids that no longer exist are mapped through PART_ALIASES; anything
  // still unknown becomes nothing and is reported through Save.notes (never a crash).
  fromSave(run) {
    this.newGame({ pile: false });
    let retired = 0;
    const fix = (t) => {
      if (PART_DEFS[t]) return t;
      if (PART_ALIASES[t] && PART_DEFS[PART_ALIASES[t]]) return PART_ALIASES[t];
      retired++;
      return null;
    };
    const num = (v, d, lo, hi) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : d);
    this.tokens = num(run.tokens, CONFIG.startTokens, 0, 9999);
    this.stage = Math.round(num(run.stage, 1, 1, FINAL_STAGE));
    this.bestStage = Math.round(num(run.bestStage, 0, 0, FINAL_STAGE));
    this.won = !!run.won;
    this.failStreak = Math.round(num(run.failStreak, 0, 0, 99));
    this.playTime = num(run.playTime, 0, 0, 1e7);
    this.seen = run.seen && typeof run.seen === 'object' ? run.seen : {};
    for (const t of run.inventory || []) { const f = fix(t); if (f) this.inventory.push(makePartItem(f)); }
    for (const c of (run.party || []).slice(0, 3)) {
      const slots = {};
      for (const [slot, t] of Object.entries(c.slots || {})) { const f = t ? fix(t) : null; if (f && RIG_SLOTS.some(([k]) => k === slot)) slots[slot] = f; }
      if (!Object.keys(slots).length) continue;
      const cr = new Creature(slots);
      cr.hp = num(c.hp, cr.maxHp, 1, cr.maxHp);
      if (typeof c.name === 'string' && c.name.length < 60) cr.name = c.name;
      cr.kills = Math.round(num(c.kills, 0, 0, 9999));
      this.party.push(cr);
    }
    const machine = (run.machine || []).map(fix).filter(Boolean);
    const first = machine.slice(0, 22);
    this.sim.layoutPile(first.length >= 5 ? first : [...first, ...Array.from({ length: 5 - first.length }, () => randomPartType())]);
    machine.slice(22).forEach((t, i) => this.sim.queueSpawn(t, i * 0.25));
    if (retired) Save.notes.push(retired + (retired > 1 ? ' parts' : ' part') + ' from an older version ' + (retired > 1 ? 'were' : 'was') + ' retired.');
    return this;
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

  // What a fight pays. A win pays winTokens + stage. Anything else pays a share of that for the damage you
  // did (CONFIG.partialPay of it, scaled by how much of the enemy you got through), so a lost fight is a
  // bad day and not a dead end: the early game had a poverty trap where a defeat paid 1 token and the parts
  // it scattered cost ~30 to win back (see docs/BALANCE.md, "Failing forward").
  battlePay(stage, kind, progress, goldSurvivor) {
    const full = CONFIG.winTokens + stage + (goldSurvivor ? 1 : 0);
    if (kind === 'win') return full;
    const share = Math.round(CONFIG.partialPay * (CONFIG.winTokens + stage) * progress);
    // the ladder scales with the damage you did, so pressing FIGHT and then RETREAT earns nothing, and a scratch earns a scratch
    const ladder = Math.round(Math.min(CONFIG.ladderMax, this.failStreak + 1) * progress);
    return (kind === 'lose' ? Math.max(1, share) : share) + ladder;
  },

  // Turn a finished fight into consequences: creature health, dead creatures, tokens, restocks, stage.
  // kind: 'win' | 'lose' | 'retreat'. This is the whole economy of a battle, in one place.
  //   win      full pay, 3 parts drop into the machine, the run advances (the last boss ends it)
  //   lose     partial pay; creatures that died fall apart into the machine
  //   retreat  partial pay; nobody dies and the Reaper patches everyone up
  // Dead creatures' parts ALWAYS go back into the machine, never the bag (pillar: the claw is the only door).
  applyBattle(sim, kind) {
    const allies = sim.units.filter((u) => u.team === 'ally');
    const deadAllies = allies.filter((u) => u.dead);
    const survivors = allies.filter((u) => !u.dead);
    for (const u of allies) u.c.hp = u.dead ? 0 : Math.max(1, Math.ceil(u.hp));
    const deadParts = deadAllies.flatMap((u) => u.c.parts());
    this.party = this.party.filter((c) => c.hp > 0);
    const restocked = [];
    const reward = this.battlePay(this.stage, kind, kind === 'win' ? 1 : sim.progress(), survivors.some((u) => u.traits.includes('golden')));
    if (kind === 'win') {
      const boost = 1 + this.stage * 0.2;
      for (let i = 0; i < CONFIG.restockParts; i++) restocked.push(randomPartType({ boost }));
      Telemetry.c.victories++;
      Telemetry.c.bestStage = Math.max(Telemetry.c.bestStage, this.stage);
      this.bestStage = Math.max(this.bestStage, this.stage);
      if (isFinalStage(this.stage)) this.won = true; else this.stage++;
      this.failStreak = 0;
    } else {
      if (kind === 'lose') Telemetry.c.defeats++;
      this.failStreak++;
    }
    for (const c of this.party) c.hp = c.maxHp; // the Reaper patches up everyone who is still standing
    this.tokens += reward + sim.goldKills;
    this.restock([...restocked, ...deadParts]);
    this.recordProgress();
    Save.soon();
    return { kind, reward, gold: sim.goldKills, restocked, deadParts, lost: deadAllies.map((u) => u.name), won: this.won, progress: sim.progress() };
  },

  // lifetime records live in the save file, next to the run
  recordProgress() {
    const r = Save.data && Save.data.records;
    if (!r) return;
    r.bestStage = Math.max(r.bestStage, this.bestStage);
    if (this.won) { r.wins++; const m = Math.round(this.playTime / 60); if (!r.bestWinMinutes || m < r.bestWinMinutes) r.bestWinMinutes = m; }
  },

  canFight() { return this.party.some((c) => c.hp > 0); },
  broke() { return this.tokens <= 0 && !this.inventory.length && !this.party.length; },
  givePity() {
    this.tokens += CONFIG.pityTokens;
    Telemetry.c.pity++;
    Telemetry.log('pity');
  },
};
