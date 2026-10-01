// ---------------------------------------------------------------------------
// CLAW RIG — the physical half of the RNG manipulation layer (docs/RNG_LAYER.md).
// Mixed into ClawSim: quake, nudge, the chute lid, the drop lock, Iron Grip arming,
// the Lens (odds preview), and turn recording + rewind for REDO.
// No rendering and no DOM: tools/rig_check.mjs runs all of this headless.
// The rules (Luck, costs, TILT heat) live in 29_rig.js; this file only moves things.
// Every shake is a *velocity change*, not a force, so heavy and light parts are
// thrown about alike, the way a real quake treats a pile.
// ---------------------------------------------------------------------------
const RIGSIM = {
  histDt: 1 / 30, // recording resolution for REDO
  histMax: 1500, // frames kept (50 s of turn): longer turns can't be rewound
  lidH: MACHINE.lipY, // the chute lid runs from the top of the guard right up to the glass ceiling
  vmax: 170, // speed clamp for shaken parts, px/s
  // Quake shocks (px/s, rad/s). Each is a velocity change. Rumble kicks stay well under gravity
  // (36 px/s per pulse) so parts hop and land instead of floating; the vertical work is done by
  // the P-wave, the periodic bumps and the aftershock.
  pwave: { up: 110, side: 35, spin: 3 },
  rumble: { up: 22, side: 68, spin: 2.2, gap: [0.055, 0.095] },
  bump: { up: 85, side: 30, spin: 2.6, every: 0.42 },
  after: { up: 80, side: 40, spin: 2.6 },
  nudge: { side: 185, up: 100, spin: 4.4 }, // one bump, at full strength under the claw (see nudge())
  // The Lens shows chanceFor() x this, measured so the badge matches how often drops really come up holding
  // something (tools/rig_check.mjs "calibration"; uncalibrated green badges once held only 59% of the time and
  // felt rigged). Re-measure both if the grab changes (the prongs, the spread, ClawSim.scanCage, the soul hook).
  lensShift: 1, // the model is fitted to 400 plain drops: badge 40.8% on average, 41.0% held
  lensIron: 0.22, // Iron Grip leaves this share of a plain drop's chance to fail (400 armed drops: badge 87%, held 89%)
  steady: 0.55, // fraction of speed kept when the shaking stops (the machine "steadies")
  damp: 3, // linear damping on loose parts while shaking: reins in how high a shaken pile heaves
  dropRest: 14, // px/s: a quake unlocks the drop once every part is slower than this
  sealCap: 30, // s: the chute lid comes down by itself if nobody drops for this long
  settleCap: 2.4, // s: a quake never locks the drop for longer than this after the shaking stops
};

Object.assign(ClawSim.prototype, {
  // ------------------------------------------------------------ locks
  // Stops a new drop (and, for TILT, the carriage) for a while. A longer lock wins.
  lock(why, secs) {
    if (secs > this.lockT) { this.lockT = secs; this.lockWhy = why; }
  },
  canDrop() { return this.state === 'idle' && this.lockT <= 0; },

  armIron(on) {
    this.iron = !!on;
    this.emit('iron', { on: this.iron });
  },
  // Is an Iron Grip paid for and not used up? Armed, or riding on a drop still in flight (a save refunds that drop),
  // or coming back with a rewind. What a saved run must keep.
  ironPaid() {
    return !!(this.iron || (this.state === 'rewind' && this.rw && this.rw.H.iron) || (this.state !== 'idle' && this.turn && this.turn.iron));
  },

  // ------------------------------------------------------------ chute lid
  // The moment the machine is shaken, the guard grows an invisible wall up to the glass ceiling.
  // Only parts collide with it (the claw ignores it). It stays up through the whole drop, close and
  // lift, and comes down when the claw starts carrying (a held part then has to cross the guard).
  // So nothing the Rig does, now, a moment later when a shaken mound tips over, or while nudged
  // parts are still in flight as the claw drops, can put a free part in the chute.
  seal() {
    if (this.lid) { this.sealAge = 0; return; }
    const pl = planck, M = MACHINE;
    this.sealAge = 0;
    this.lid = this.ground.createFixture(
      pl.Box(M.guardW / 2 / PPM, RIGSIM.lidH / 2 / PPM, pl.Vec2((M.guardX + M.guardW / 2) / PPM, (M.lipY - RIGSIM.lidH / 2) / PPM), 0),
      { friction: 0.2, filterCategoryBits: CAT.WALL, filterMaskBits: CAT.PART });
    this.emit('seal', { on: true });
  },
  sealStep(h) {
    if (!this.lid) return;
    this.sealAge += h;
    if (this.sealAge > RIGSIM.sealCap) this.unseal(); // walked away from the machine: let it go
  },
  unseal() {
    if (!this.lid) return;
    this.ground.destroyFixture(this.lid); this.lid = null;
    this.emit('seal', { on: false });
  },
  // True when no loose part is moving faster than `speed` px/s. (A part that twitched a moment
  // ago is ignored: living parts jump about on their own and would keep the pile "moving".)
  pileStill(speed) {
    const lim = (speed / PPM) * (speed / PPM);
    for (const p of this.parts) {
      if (p.won || this.time - (p.twitchT || -9) < 0.6) continue;
      for (const b of p.bodies) { const v = b.getLinearVelocity(); if (v.x * v.x + v.y * v.y > lim) return false; }
    }
    return true;
  },

  // ------------------------------------------------------------ QUAKE
  // An earthquake: an opening P-wave (big upward jolt), a rumble of coherent side-to-side
  // slosh with per-part noise, and an aftershock. Ends by itself; drops stay locked until
  // the pile has settled.  opts: {time, power, settle, tilt}
  quake(opts = {}) {
    if (this.state !== 'idle' || this.quakeS) return false;
    this.settleS = null; // a new quake restarts the wait for the pile to settle
    const T = opts.time != null ? opts.time : CONFIG.quakeTime;
    const power = (opts.power != null ? opts.power : 1) * CONFIG.quakePower;
    this.quakeS = { t: 0, T, power, next: 0, bumpT: RIGSIM.bump.every, dir: RNG() < 0.5 ? -1 : 1, hit: false, after: false };
    if (opts.tilt) this.lock('tilt', T + (opts.settle != null ? opts.settle : 0));
    else this.lock('quake', 99); // ends when the shaking is over and the pile has settled (settleStep)
    this.seal();
    this.damp(RIGSIM.damp);
    this.redoHist = null; // the pile is about to change: a rewind would undo the wrong thing
    this.emit('quake', { phase: 'start', power, time: T, tilt: !!opts.tilt });
    return true;
  },
  quakeStep(h) {
    const q = this.quakeS, R = RIGSIM;
    q.t += h;
    // envelope: fast attack, long hold, release over the last third
    const tail = q.T * 0.66;
    const e = Math.min(1, q.t / 0.1) * (q.t > tail ? Math.max(0, 1 - (q.t - tail) / (q.T - tail)) : 1);
    if (!q.hit) {
      q.hit = true;
      this.shake(Object.assign({ mag: q.power }, R.pwave));
      this.emit('quakePulse', { e: 1, big: true });
    }
    q.next -= h;
    if (q.next <= 0 && q.t < q.T) {
      q.next = R.rumble.gap[0] + RNG() * (R.rumble.gap[1] - R.rumble.gap[0]);
      if (RNG() < 0.35) q.dir = -q.dir;
      this.shake(Object.assign({ mag: q.power * e, dir: q.dir }, R.rumble));
      this.emit('quakePulse', { e, big: false });
    }
    q.bumpT -= h;
    if (q.bumpT <= 0 && q.t < q.T * 0.75) {
      q.bumpT = R.bump.every * (0.8 + 0.4 * RNG());
      this.shake(Object.assign({ mag: q.power * e }, R.bump));
      this.emit('quakePulse', { e, big: true });
    }
    if (!q.after && q.t > q.T * 0.8) {
      q.after = true;
      this.shake(Object.assign({ mag: q.power * 0.8 }, R.after));
      this.emit('quakePulse', { e: 0.8, big: true });
    }
    if (q.t >= q.T) {
      this.quakeS = null; this.steady(R.steady); this.damp(0.05);
      if (this.lockWhy === 'quake') this.settleS = { t: 0, rest: 0 };
      this.emit('quake', { phase: 'end' });
    }
  },
  // Linear damping for every loose part (0.05 is the normal value; see spawnPart).
  damp(k) { for (const p of this.parts) for (const b of p.bodies) b.setLinearDamping(k); },
  // After a quake the drop stays locked until the pile is at rest (at least quakeSettle, at most settleCap).
  settleStep(h) {
    if (this.quakeS) return;
    const S = this.settleS;
    S.t += h;
    S.rest = this.pileStill(RIGSIM.dropRest) ? S.rest + h : 0;
    if ((S.t >= CONFIG.quakeSettle && S.rest >= 0.25) || S.t >= RIGSIM.settleCap) {
      this.settleS = null;
      if (this.lockWhy === 'quake') { this.lockT = 0; this.lockWhy = null; this.emit('unlock', { why: 'quake' }); }
    }
  },
  // Bleed speed off every loose part (the end of a quake, so the pile settles quickly).
  steady(k) {
    const V = planck.Vec2;
    for (const p of this.parts) {
      if (p.won) continue;
      for (const b of p.bodies) { const v = b.getLinearVelocity(); b.setLinearVelocity(V(v.x * k, v.y * k)); b.setAngularVelocity(b.getAngularVelocity() * k); }
    }
  },
  // One seismic shock for every loose part. o: {up, side (px/s), spin (rad/s), mag, dir}.
  // Like real ground motion it is coherent: one strength for the whole pile with only a little
  // per-part variation. (Independent strengths made stacked parts collide mid-air and sling
  // the top one far too high.)
  shake(o) {
    const V = planck.Vec2, vmax = RIGSIM.vmax / PPM, mag = o.mag, dir = o.dir || 0;
    const gUp = 0.35 + 0.65 * RNG(), gSide = dir ? 0.6 + 0.4 * RNG() : RNG() * 2 - 1;
    for (const p of this.parts) {
      if (p.won) continue;
      const up = gUp * (0.85 + 0.3 * RNG()) * o.up * mag;
      const side = (dir ? dir * gSide : gSide) * (0.8 + 0.4 * RNG()) * o.side * mag;
      const w = (RNG() * 2 - 1) * o.spin * mag;
      for (const b of p.bodies) { // one draw per part, so a bone tail moves as one piece
        const v = b.getLinearVelocity();
        let vx = v.x + side / PPM, vy = v.y - up / PPM;
        const s = Math.hypot(vx, vy);
        if (s > vmax) { vx *= vmax / s; vy *= vmax / s; }
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(w)) continue; // never hand planck a NaN
        b.setLinearVelocity(V(vx, vy));
        b.setAngularVelocity(clamp(b.getAngularVelocity() + w, -12, 12));
      }
    }
    const hv = this.hub.getLinearVelocity(); // the cabinet rattles the claw too
    this.hub.setLinearVelocity(V(hv.x + (RNG() * 2 - 1) * 10 * mag / PPM, hv.y));
  },

  // ------------------------------------------------------------ NUDGE
  // Bump the glass: a sideways kick with a little hop, strongest around the claw.
  nudge(dir) {
    if (this.state !== 'idle' || this.lockT > 0) return false;
    const V = planck.Vec2, vmax = RIGSIM.vmax / PPM, cx = this.carX, R = CONFIG.nudgeRadius, P = CONFIG.nudgePower;
    for (const p of this.parts) {
      if (p.won) continue;
      const k = 0.75 + 0.5 * RNG(), kup = 0.6 + 0.6 * RNG(), w = (RNG() * 2 - 1) * RIGSIM.nudge.spin * P;
      for (const b of p.bodies) {
        const dx = (b.getPosition().x * PPM - cx) / R;
        const f = 0.35 + 0.65 * Math.exp(-dx * dx); // full strength under the claw, a third at the far end
        const v = b.getLinearVelocity();
        let vx = v.x + (dir * RIGSIM.nudge.side * P * f * k) / PPM, vy = v.y - (RIGSIM.nudge.up * P * f * kup) / PPM;
        const s = Math.hypot(vx, vy);
        if (s > vmax) { vx *= vmax / s; vy *= vmax / s; }
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(w * f)) continue;
        b.setLinearVelocity(V(vx, vy));
        b.setAngularVelocity(clamp(b.getAngularVelocity() + w * f, -12, 12));
      }
    }
    const hv = this.hub.getLinearVelocity();
    this.hub.setLinearVelocity(V(hv.x + (dir * 14) / PPM, hv.y)); // the claw swings with the bump
    this.seal();
    this.redoHist = null;
    this.emit('nudge', { dir, x: cx });
    return true;
  },

  // ------------------------------------------------------------ LENS
  // The grab rolls nothing (what the prongs close around is what you get), so the Lens is a forecast of the
  // physics: how likely a drop right here comes up holding SOMETHING, for part p whose centre is lx px off the
  // claw's axis. Measured on the claw's own physics, what matters most is whether that part lies on top or down in a
  // pit between taller neighbours, where the prongs can't get under it (pit: px its top lies below the highest
  // surface 10-14 px to either side: on top 63% held, deep in a pit 21%). Then size (a big torso barely fits the
  // mouth), how far off-centre, and slime. Iron Grip's soul hook reaches into pits and its soul grip holds what it
  // catches: only lensIron of the plain failure chance is left. tools/rig_check.mjs ("calibration") checks the
  // badge against real drops, so a green badge means what it says.
  chanceFor(p, lx, iron = false, pit = 0) {
    const s = SPR.get(p.def.sprite);
    const dim = p.def.chain ? 16 : Math.max(s.w, s.h);
    const reach = clamp(0.5 - 0.0125 * pit, 0.2, 0.65);
    const size = dim <= 29 ? 1 : 0.75;
    const center = 1 - 0.3 * smoothstep(6, 12, Math.abs(lx));
    const wet = 0.55 + 0.45 * (p.def.grip || 1); // hearts and eyeballs are slippery
    const c = reach * size * center * wet;
    return iron ? 1 - (1 - c) * RIGSIM.lensIron : c; // predict() scales by lensShift, then caps at 98%
  },

  // What would a drop right here hold? Finds the first part under the claw's axis, how buried it is, and scores it
  // with chanceFor(). The chance is for holding SOMETHING: which part ends up in the claw depends on how the pile
  // shifts as it lands.
  predict() {
    if (this.state !== 'idle') return null;
    const pl = planck, V = pl.Vec2, M = MACHINE;
    const top = this.hub.getPosition().y * PPM + 30;
    const ray = (x) => { // the first surface below x: { y, part } (the claw itself doesn't count)
      let hit = null;
      this.world.rayCast(V(x / PPM, top / PPM), V(x / PPM, M.floor / PPM), (fix, point, normal, fr) => {
        const ud = fix.getBody().getUserData();
        if (ud === 'claw' || (ud && ud.won)) return -1;
        hit = { part: ud && ud.def ? ud : null, y: point.y * PPM };
        return fr;
      });
      return hit;
    };
    const best = ray(this.carX);
    if (!best) return null;
    const p = best.part;
    if (!p || p.won) return { part: null, y: best.y };
    let lx = Infinity; // the body nearest the claw's axis (a bone tail is six bodies), as the claw meets it
    for (const b of p.bodies) { const d = b.getPosition().x * PPM - this.carX; if (Math.abs(d) < Math.abs(lx)) lx = d; }
    const rim = Math.min(...[-14, -10, 10, 14].map((o) => { const h = ray(this.carX + o); return h ? h.y : M.floor; }));
    const pit = best.y - rim;
    return { part: p, y: best.y, lx, pit, chance: clamp(this.chanceFor(p, lx, this.iron, pit) * RIGSIM.lensShift, 0, 0.98) };
  },

  // ------------------------------------------------------------ recording (for REDO)
  // From the drop until the turn ends, every loose part and the claw are sampled ~30x a second.
  // A failed grab keeps its recording; REDO replays it backwards.
  beginRecord() {
    const bodies = [], parts = [];
    for (const p of this.parts) if (!p.won) { parts.push(p); for (const b of p.bodies) bodies.push(b); }
    const H = this.hist = { bodies, parts, frames: [], acc: 0, dur: 0, tainted: false, v0: null, iron: !!(this.turn && this.turn.iron) };
    this.redoHist = null;
    H.v0 = bodies.map((b) => { const v = b.getLinearVelocity(); return [v.x, v.y, b.getAngularVelocity()]; });
    H.frames.push(this.captureFrame(H));
  },
  captureFrame(H) {
    const nb = H.bodies.length, f = new Float64Array(nb * 3 + 10);
    for (let i = 0; i < nb; i++) { const b = H.bodies[i], q = b.getPosition(); f[i * 3] = q.x; f[i * 3 + 1] = q.y; f[i * 3 + 2] = b.getAngle(); }
    let o = nb * 3;
    f[o++] = this.carX;
    for (const b of [this.hub, this.prongL, this.prongR]) { const q = b.getPosition(); f[o++] = q.x; f[o++] = q.y; f[o++] = b.getAngle(); }
    return f;
  },
  recordStep(h) {
    const H = this.hist;
    H.acc += h; H.dur += h;
    if (H.acc < RIGSIM.histDt) return;
    H.acc -= RIGSIM.histDt;
    if (H.frames.length < RIGSIM.histMax) H.frames.push(this.captureFrame(H)); else H.tainted = true;
  },
  histValid(H) { return H.parts.every((p) => !p.removed && !p.won); },
  endRecord(result) {
    const H = this.hist;
    this.hist = null;
    this.redoHist = null;
    if (!H || H.tainted || result === 'win') return; // a win is nothing to undo
    H.frames.push(this.captureFrame(H)); // so the rewind starts exactly where the turn ended
    if (this.histValid(H)) this.redoHist = H;
  },

  // ------------------------------------------------------------ REDO
  canRedo() { return !!this.redoHist && this.state === 'idle' && this.histValid(this.redoHist); },
  rewind() {
    if (!this.canRedo()) return false;
    const H = this.redoHist;
    this.redoHist = null;
    const dur = clamp(H.dur / CONFIG.redoSpeed, 0.7, 1.6);
    this.rw = { H, n: H.frames.length, dur };
    this.setState('rewind');
    this.emit('rewind', { phase: 'start', dur, turnTime: H.dur });
    return true;
  },
  rewindStep() {
    const R = this.rw;
    const k = clamp(this.stateT / R.dur, 0, 1);
    this.applyFrame(R.H, R.H.frames[Math.round((1 - easeInOutQuad(k)) * (R.n - 1))]);
    if (k >= 1) this.finishRewind();
  },
  // Put every recorded body (and the claw) exactly where the frame says, at rest. The angle is restored RAW:
  // planck's setTransform() wraps a body's angle into (-PI, PI] on its own, but a revolute joint computes its
  // angle from the raw difference of its two bodies. A bone tail whose segments straddle PI would otherwise come
  // back with its joints off by 2*PI, and the limit solver would thrash it (found in review, reproduced).
  applyFrame(H, f) {
    const V = planck.Vec2, nb = H.bodies.length, zero = V(0, 0);
    const put = (b, x, y, a) => {
      b.setTransform(V(x, y), a);
      b.m_sweep.a = b.m_sweep.a0 = a;
      b.setLinearVelocity(zero); b.setAngularVelocity(0);
    };
    for (let i = 0; i < nb; i++) put(H.bodies[i], f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
    let o = nb * 3;
    this.carX = f[o++]; this.carV = 0;
    this.carriage.setTransform(V(this.carX / PPM, MACHINE.railY / PPM), 0);
    this.carriage.setLinearVelocity(zero);
    for (const b of [this.hub, this.prongL, this.prongR]) { put(b, f[o], f[o + 1], f[o + 2]); o += 3; }
  },
  finishRewind() {
    const V = planck.Vec2, H = this.rw.H;
    this.rw = null;
    this.applyFrame(H, H.frames[0]);
    H.bodies.forEach((b, i) => { const v = H.v0[i]; b.setLinearVelocity(V(v[0], v[1])); b.setAngularVelocity(v[2]); b.setAwake(true); });
    this.ropeLen = MACHINE.topLen;
    this.turn = null; this.grips = []; this.cage = []; this.held = new Set(); this.landed = false;
    this.iron = H.iron; // the world is as it was before the drop, Iron Grip included (it was already paid for)
    this.setState('idle');
    this.emit('rewind', { phase: 'end' });
  },
});
