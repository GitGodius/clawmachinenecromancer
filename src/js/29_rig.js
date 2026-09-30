// ---------------------------------------------------------------------------
// THE RIG — the rules of the RNG manipulation layer (docs/RNG_LAYER.md).
// Luck (earned from bad luck, spent on levers), what each lever costs, TILT heat,
// and use(): the one door every lever goes through (buttons, hotkeys, tests).
// The physics lives in the sim (12_clawrig.js) and the presentation in the claw
// scene; this file only decides what is allowed and what it costs, so it can be
// checked with no screen at all (tools/rig_check.mjs).
//   Rig.use('quake')            Rig.use('order', 'torso')        Rig.can('redo')
//   Rig.onEvent = (type, data) => ...   'luck' 'deny' 'used' 'tilt'
// ---------------------------------------------------------------------------
const ORDER_SLOTS = ['head', 'torso', 'arm', 'leg', 'heart', 'back'];

// Presentation metadata for the UI. `cost` names the CONFIG key (null = free).
const RIG_TRICKS = {
  quake: { name: 'Earthquake', label: 'QUAKE', key: '1', cost: 'costQuake', color: '#ffb070',
    tip: ['Shake the whole machine.', 'The pile churns into a new layout.', 'Drops lock until it settles.'] },
  nudgeL: { name: 'Nudge left', label: 'NUDGE', key: 'Q', cost: null, color: '#ecdcbc',
    tip: ['Bump the glass to the left.', 'Loosens the pile around the claw.', 'Nudge too fast and it TILTs.'] },
  nudgeR: { name: 'Nudge right', label: 'NUDGE', key: 'E', cost: null, color: '#ecdcbc',
    tip: ['Bump the glass to the right.', 'Loosens the pile around the claw.', 'Nudge too fast and it TILTs.'] },
  grip: { name: 'Iron Grip', label: 'GRIP', key: '2', cost: 'costGrip', color: '#f6c64b',
    tip: ['Hex the claw for the next drop.', 'Stronger hold, far fewer slips.', 'Press again to take it back.'] },
  order: { name: 'Special Order', label: 'ORDER', key: '3', cost: 'costOrder', color: '#6fd3ff',
    tip: ['Pick a slot. The Reaper drops', 'one in from the back room.', 'Rarity is still the luck of the draw.'] },
  redo: { name: 'Redo', label: 'REDO', key: '4', cost: 'costRedo', color: '#e7a6f0',
    tip: ['Turn back time after a missed or', 'slipped grab: same pile, token back,', 'fresh dice.'] },
};

const Rig = {
  luck: 0,
  heat: 0, // nudge heat: past CONFIG.tiltAt the next nudge TILTs the machine
  riggedNext: false, // a lever was used since the last drop (telemetry: rigged vs plain grabs)
  onEvent: null, // (type, data) => void, set by the claw scene

  get on() { return CONFIG.rigOn > 0; },
  reset() {
    this.luck = Math.min(CONFIG.luckStart, CONFIG.luckMax);
    this.heat = 0;
    this.riggedNext = false;
  },
  emit(type, data) { if (this.onEvent) this.onEvent(type, data || {}); },

  cost(name) {
    const t = RIG_TRICKS[name];
    return !t || !t.cost || CONFIG.rigFree ? 0 : CONFIG[t.cost];
  },
  tilted() { const s = Game.sim; return !!s && s.lockWhy === 'tilt' && s.lockT > 0; },
  takeRigged() { const r = this.riggedNext; this.riggedNext = false; return r; },

  // ---------------------------------------------------------------- Luck
  gain(n, why) {
    if (!this.on || !(n > 0)) return 0;
    const got = Math.min(n, Math.max(0, CONFIG.luckMax - this.luck));
    this.luck += got;
    const c = Telemetry.c;
    c.luckEarned += got; c.luckWasted += n - got;
    c.luckBy[why] = (c.luckBy[why] || 0) + got;
    this.emit('luck', { delta: got, total: this.luck, why, wasted: n - got });
    return got;
  },
  refund(n, why) { // Luck handed back (disarming Iron Grip): not "earned", and never above the cap
    const got = Math.min(n, Math.max(0, CONFIG.luckMax - this.luck));
    this.luck += got;
    if (got) this.emit('luck', { delta: got, total: this.luck, why });
    return got;
  },
  lose(n, why) { // spend or penalty: never below zero
    n = Math.min(this.luck, n);
    if (n <= 0) return 0;
    this.luck -= n;
    Telemetry.c.luckSpent += n;
    this.emit('luck', { delta: -n, total: this.luck, why });
    return n;
  },

  // ---------------------------------------------------------------- rules
  // { ok, why, cost }. why: 'off' | 'state' | 'tilt' | 'busy' | 'none' | 'luck'
  can(name) {
    if (!this.on) return { ok: false, why: 'off' };
    const sim = Game.sim;
    if (!sim || !RIG_TRICKS[name]) return { ok: false, why: 'state' };
    if (this.tilted()) return { ok: false, why: 'tilt' };
    const cost = this.cost(name);
    switch (name) {
      case 'quake':
        if (sim.state !== 'idle' || sim.lockT > 0 || sim.quakeS) return { ok: false, why: 'busy', cost };
        break;
      case 'nudgeL': case 'nudgeR':
        if (sim.state !== 'idle' || sim.lockT > 0) return { ok: false, why: 'busy', cost: 0 };
        return { ok: true, cost: 0 };
      case 'grip':
        if (sim.state !== 'idle') return { ok: false, why: 'busy', cost };
        if (sim.iron) return { ok: true, cost: 0, disarm: true, refund: cost };
        break;
      case 'order':
        if (sim.state !== 'idle') return { ok: false, why: 'busy', cost };
        break;
      case 'redo':
        if (!sim.canRedo()) return { ok: false, why: 'none', cost };
        break;
    }
    return this.luck < cost ? { ok: false, why: 'luck', cost } : { ok: true, cost };
  },

  // Do it: check the rules, move the machine, charge the Luck. The sim acts first and the
  // Luck is only charged if it actually happened.
  use(name, arg) {
    const c = this.can(name);
    if (!c.ok) { this.emit('deny', { name, why: c.why, cost: c.cost }); return c; }
    const sim = Game.sim, T = Telemetry.c;
    const out = { ok: true, cost: c.cost, name };
    switch (name) {
      case 'quake':
        if (!sim.quake()) return { ok: false, why: 'busy' };
        this.lose(c.cost, name);
        T.quakes++;
        break;
      case 'nudgeL': case 'nudgeR': {
        this.heat += 1;
        if (this.heat > CONFIG.tiltAt) { this.tilt(); out.tilt = true; T.nudges++; break; }
        if (!sim.nudge(name === 'nudgeL' ? -1 : 1)) { this.heat -= 1; return { ok: false, why: 'busy' }; }
        T.nudges++;
        break;
      }
      case 'grip':
        if (c.disarm) { sim.armIron(false); this.refund(c.refund, 'refund'); out.disarm = true; T.ironDisarmed++; }
        else { sim.armIron(true); this.lose(c.cost, name); T.irons++; }
        break;
      case 'order': {
        if (!ORDER_SLOTS.includes(arg)) return { ok: false, why: 'arg' };
        out.type = randomPartType({ slot: arg, boost: 1 + Game.stage * 0.1 });
        out.slot = arg;
        sim.queueSpawn(out.type, 0);
        sim.redoHist = null;
        this.lose(c.cost, name);
        T.orders++;
        break;
      }
      case 'redo':
        if (!sim.rewind()) return { ok: false, why: 'none' };
        this.lose(c.cost, name);
        Game.tokens++; // the token never left your hand
        T.redos++;
        Telemetry.lastFailT = null; // the redo IS the retry; don't count the next drop as one too
        break;
    }
    if (name !== 'grip' || !c.disarm) this.riggedNext = true;
    Telemetry.log('rig', { lever: name, cost: out.cost, luck: this.luck });
    this.emit('used', out);
    return out;
  },

  // The fourth quick nudge: the machine jolts, locks for a few seconds, and you lose Luck.
  tilt() {
    const sim = Game.sim;
    this.heat = 0;
    sim.quake({ time: 0.9, power: 0.55, tilt: true });
    sim.lock('tilt', CONFIG.tiltLock);
    const lost = CONFIG.tiltPenalty > 0 ? this.lose(CONFIG.tiltPenalty, 'tilt') : 0;
    Telemetry.c.tilts++;
    this.emit('tilt', { lock: CONFIG.tiltLock, lost });
  },

  // Bad luck is the fuel: a miss or a slip earns Luck (soft pity). A win earns none.
  onTurnEnd(d) {
    if (!this.on) return;
    if (d.result === 'miss') this.gain(CONFIG.luckMiss, 'miss');
    else if (d.result === 'slip') this.gain(CONFIG.luckSlip, 'slip');
  },

  update(dt) { this.heat = Math.max(0, this.heat - CONFIG.heatDecay * dt); },

  // ---------------------------------------------------------------- Order helpers
  // How many of each slot you own (bag + everyone stitched up).
  slotCounts() {
    const n = {};
    for (const s of ORDER_SLOTS) n[s] = 0;
    for (const it of Game.inventory) n[PART_DEFS[it.type].slot]++;
    for (const c of Game.party) for (const t of c.parts()) n[PART_DEFS[t].slot]++;
    return n;
  },
  // The slot you are shortest of, for the creature count you have (1 head, 1 torso, 2 arms, 2 legs, 1 heart, 1 back each).
  suggestSlot() {
    const per = { head: 1, torso: 1, arm: 2, leg: 2, heart: 1, back: 1 };
    const crew = Math.max(1, Game.party.length), have = this.slotCounts();
    let best = 'torso', bestDef = -Infinity;
    for (const s of ['torso', 'head', 'leg', 'arm', 'heart', 'back']) { // ties go to the earlier slot
      const def = per[s] * crew - have[s];
      if (def > bestDef) { bestDef = def; best = s; }
    }
    return best;
  },
};
