// ---------------------------------------------------------------------------
// CLAW SIM — planck.js physics for the machine: walls, chute, pile, claw rig
// and the grab state machine. No rendering here; it emits events for juice.
// Headless-safe: tools/tune.mjs runs this in Node to measure grab odds.
// Coordinates are claw-scene pixels (y down); physics uses meters (PPM).
// ---------------------------------------------------------------------------
const PPM = 16;
const CAT = { WALL: 1, PART: 2, CLAW: 4 };
const MACHINE = {
  // world units are art pixels; the claw scene draws this world at 2x zoom
  left: 0, right: 180, top: 0, floor: 120, bottom: 132,
  guardX: 141, guardW: 3, lipY: 76, // acrylic guard in front of the chute
  chuteX0: 144, chuteX1: 180, // prize chute (open bottom)
  railY: 8, carMin: 14, carMax: 166, home: 162,
  topLen: 6, maxLen: 86,
  spawnX0: 8, spawnX1: 134,
};
const HULLS = {};
const getHull = (name) => HULLS[name] || (HULLS[name] = SPR.hull(name, 8, 0.45));

class ClawSim {
  constructor(opts = {}) {
    this.onEvent = opts.onEvent || (() => {});
    this.parts = [];
    this.pending = [];
    this.held = new Set();
    this.time = 0;
    this.acc = 0;
    this.pendingT = 0;
    this.input = { move: 0 };
    this.pressed = false;
    this.turn = null;
    this.turnCount = 0;
    this.grips = [];
    this.build();
  }

  emit(type, data) { this.onEvent(type, data || {}); }

  build() {
    const pl = planck, V = pl.Vec2, M = MACHINE;
    const w = (this.world = new pl.World({ gravity: V(0, CONFIG.gravity) }));
    this.ground = w.createBody();
    const box = (x0, y0, x1, y1, fr = 0.5) => {
      this.ground.createFixture(
        pl.Box((x1 - x0) / 2 / PPM, (y1 - y0) / 2 / PPM, V((x0 + x1) / 2 / PPM, (y0 + y1) / 2 / PPM), 0),
        { friction: fr, filterCategoryBits: CAT.WALL });
    };
    box(M.left - 30, -60, M.left, M.bottom + 60); // left wall
    box(M.right, -60, M.right + 30, M.bottom + 60); // right wall
    box(M.left, M.floor, M.guardX + M.guardW, M.floor + 30, 0.7); // pile floor (ends at the chute)
    box(M.guardX, M.lipY, M.guardX + M.guardW, M.floor, 0.3); // acrylic guard
    box(M.left - 30, -40, M.right + 30, M.top); // glass ceiling

    // collision sound bookkeeping
    this.impacts = new Map();
    w.on('post-solve', (contact, impulse) => {
      const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
      const ni = impulse.normalImpulses[0] || 0;
      if (ni < 0.25) return;
      for (const body of [a, b]) {
        const ud = body.getUserData();
        if (!ud) continue;
        const other = body === a ? b : a;
        const prev = this.impacts.get(ud);
        const claw = other.getUserData() === 'claw' || (ud === 'claw');
        if (!prev || prev.imp < ni) this.impacts.set(ud, { imp: ni, body, claw });
      }
    });

    this.buildClaw(M.home);
  }

  buildClaw(x) {
    const pl = planck, V = pl.Vec2, M = MACHINE, G = CLAW_GEO, w = this.world;
    this.carX = x; this.carV = 0;
    this.carriage = w.createBody({ type: 'kinematic', position: V(x / PPM, M.railY / PPM) });
    const hubY = M.railY + M.topLen + G.hubH / 2;
    this.hub = w.createBody({ type: 'dynamic', position: V(x / PPM, hubY / PPM), angularDamping: 5, linearDamping: CONFIG.swayDamping });
    const area = (G.hubW * G.hubH) / (PPM * PPM);
    const clawFix = (density, friction) => ({ density, friction, filterCategoryBits: CAT.CLAW, filterMaskBits: CAT.WALL | CAT.PART, filterGroupIndex: -1 });
    this.hub.createFixture(pl.Box(G.hubW / 2 / PPM, G.hubH / 2 / PPM), clawFix(CONFIG.hubMass / area, 0.4));
    this.hub.setUserData('claw');
    this.rope = w.createJoint(pl.RopeJoint({ maxLength: M.topLen / PPM, localAnchorA: V(0, 0), localAnchorB: V(0, -G.hubH / 2 / PPM) }, this.carriage, this.hub));
    this.ropeLen = M.topLen;
    const mk = (side) => {
      const piv = side < 0 ? G.pivotL : G.pivotR;
      const pos = V((x + piv[0]) / PPM, (hubY + piv[1]) / PPM);
      const b = w.createBody({ type: 'dynamic', position: pos, angularDamping: 2 });
      for (const poly of G.prong) {
        b.createFixture(pl.Polygon(poly.map(([px, py]) => V((side < 0 ? px : -px) / PPM, py / PPM))), clawFix(2, CONFIG.prongFriction));
      }
      b.setUserData('claw');
      const j = w.createJoint(pl.RevoluteJoint({
        enableLimit: true,
        lowerAngle: side < 0 ? -0.1 : -0.85,
        upperAngle: side < 0 ? 0.85 : 0.1,
        enableMotor: true, maxMotorTorque: 60, motorSpeed: 0,
      }, this.hub, b, pos));
      return [b, j];
    };
    [this.prongL, this.jL] = mk(-1);
    [this.prongR, this.jR] = mk(1);
    // motors and rope changes don't wake sleeping bodies, so the rig never sleeps
    for (const b of [this.carriage, this.hub, this.prongL, this.prongR]) b.setSleepingAllowed(false);
    this.state = 'idle';
    this.stateT = 0;
  }

  // Move the whole claw instantly (tuner / debug)
  teleportClaw(x) {
    const V = planck.Vec2, M = MACHINE, G = CLAW_GEO;
    const dx = (x - this.carX) / PPM;
    for (const b of [this.carriage, this.hub, this.prongL, this.prongR]) {
      const p = b.getPosition();
      b.setTransform(V(p.x + dx, p.y), b.getAngle());
      b.setLinearVelocity(V(0, 0));
      b.setAngularVelocity(0);
    }
    this.carX = x; this.carV = 0;
  }

  // ------------------------------------------------------------ parts
  spawnPart(type, x, y, angle = 0, vel) {
    const pl = planck, V = pl.Vec2, def = PART_DEFS[type];
    const part = { uid: _partUid++, type, def, bodies: [], won: false, removed: false, liftY0: 0, bornT: this.time, glowT: VRNG() * 10 };
    const fix = {
      density: (def.density || 1) * CONFIG.partDensity,
      friction: CONFIG.partFriction * (def.mat === 'squish' ? 0.55 : 1),
      restitution: def.restitution != null ? def.restitution : CONFIG.partRestitution,
      filterCategoryBits: CAT.PART, filterMaskBits: CAT.WALL | CAT.PART | CAT.CLAW,
    };
    if (def.chain) {
      const n = def.chain, seg = 4.6;
      let prev = null;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * seg;
        const bx = x + ca * off, by = y + sa * off;
        const b = this.world.createBody({ type: 'dynamic', position: V(bx / PPM, by / PPM), angle, angularDamping: 0.6, linearDamping: 0.05 });
        b.createFixture(pl.Circle((i === n - 1 ? 2.1 : 2.8) / PPM), fix);
        b.setUserData(part);
        if (prev) {
          this.world.createJoint(pl.RevoluteJoint({ enableLimit: true, lowerAngle: -0.75, upperAngle: 0.75 }, prev, b,
            V((bx - (ca * seg) / 2) / PPM, (by - (sa * seg) / 2) / PPM)));
        }
        part.bodies.push(b);
        prev = b;
      }
    } else {
      const b = this.world.createBody({ type: 'dynamic', position: V(x / PPM, y / PPM), angle, angularDamping: 0.4, linearDamping: 0.05 });
      if (def.shape === 'circle') {
        const s = SPR.get(def.sprite);
        b.createFixture(pl.Circle((Math.min(s.w, s.h) / 2 - 0.4) / PPM), fix);
      } else {
        b.createFixture(pl.Polygon(getHull(def.sprite).map(([hx, hy]) => V(hx / PPM, hy / PPM))), fix);
      }
      b.setUserData(part);
      part.bodies.push(b);
    }
    part.body = part.bodies[Math.floor(part.bodies.length / 2)];
    if (vel) for (const b of part.bodies) b.setLinearVelocity(V(vel[0] / PPM, vel[1] / PPM));
    this.parts.push(part);
    return part;
  }

  removePart(p) {
    if (p.removed) return;
    p.removed = true;
    this.grips = this.grips.filter((g) => { if (g.part === p) { this.world.destroyJoint(g.joint); return false; } return true; });
    for (const b of p.bodies) this.world.destroyBody(b);
    this.held.delete(p);
    this.parts = this.parts.filter((q) => q !== p);
  }

  clearParts() { for (const p of this.parts.slice()) this.removePart(p); }

  partPos(p) { const q = p.body.getPosition(); return [q.x * PPM, q.y * PPM]; }

  // Fresh pile: guarantees one legendary, a couple of rares and every slot represented.
  fillPile(n = CONFIG.partCount) {
    const M = MACHINE;
    const types = [randomPartType({ rarity: 'legendary' }), randomPartType({ rarity: 'rare' }), randomPartType({ rarity: 'rare' })];
    const need = { head: 3, torso: 3, arm: 4, leg: 4, heart: 1 };
    for (const slot in need) for (let i = 0; i < need[slot]; i++) types.push(randomPartType({ slot, rarity: i === 0 ? 'common' : undefined }));
    while (types.length < n) types.push(randomPartType());
    shuffle(types);
    const cols = 5, cw = (M.spawnX1 - M.spawnX0) / cols;
    types.slice(0, Math.max(n, 5)).forEach((t, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      this.spawnPart(t, M.spawnX0 + cw * (col + 0.5) + rand(-3, 3), M.floor - 14 - row * 23 + rand(-2, 2), rand(-Math.PI, Math.PI));
    });
    this.settle(4.5);
    // anything that bounced into the chute goes back on top of the pile
    for (const p of this.parts.slice()) {
      const [x] = this.partPos(p);
      if (x > M.guardX - 2 || p.won) {
        const t = p.type;
        this.removePart(p);
        this.spawnPart(t, rand(M.spawnX0, 100), 20, rand(-3, 3));
      }
    }
    this.settle(1.5);
    for (const p of this.parts) p.won = false;
  }

  settle(seconds) {
    const h = 1 / 60;
    this.settling = true;
    for (let t = 0; t < seconds; t += h) { this.world.step(h, 8, 4); }
    this.settling = false;
    this.impacts.clear();
    for (const p of this.parts) if (!p.won) { const [x, y] = this.partPos(p); if (x > MACHINE.chuteX0 && y > MACHINE.lipY) p.won = true; }
  }

  queueSpawn(type, delay = 0) { this.pending.push({ type, t: delay }); }

  // ------------------------------------------------------------ control
  press() { this.pressed = true; }

  startDrop() {
    if (this.state !== 'idle') return false;
    this.setState('drop');
    this.turn = { won: [], grabbed: new Set(), slips: 0, startT: this.time, n: ++this.turnCount };
    this.landed = false;
    this.slackT = 0;
    this.emit('drop');
    return true;
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    if (s === 'lift') for (const p of this.parts) p.liftY0 = p.body.getPosition().y * PPM;
  }

  ropeDist() {
    const a = this.carriage.getPosition();
    const b = this.hub.getWorldPoint(planck.Vec2(0, -CLAW_GEO.hubH / 2 / PPM));
    return Math.hypot(b.x - a.x, b.y - a.y) * PPM;
  }

  driveCarriage(target, h) {
    const M = MACHINE;
    this.carV = approach(this.carV, target, CONFIG.clawAccel * h);
    let nx = this.carX + this.carV * h;
    if (nx < M.carMin) { nx = M.carMin; this.carV = 0; }
    if (nx > M.carMax) { nx = M.carMax; this.carV = 0; }
    this.carriage.setLinearVelocity(planck.Vec2((nx - this.carX) / h / PPM, 0));
    this.carX = nx;
  }

  prongs(mode, fade = 0) {
    let torque, sL, sR;
    if (mode === 'open') { sL = 5; sR = -5; torque = 120; }
    else if (mode === 'close') {
      // full power while closing, then the machine "cuts the voltage" to the hold torque
      sL = -CONFIG.closeSpeed; sR = CONFIG.closeSpeed;
      torque = lerp(CONFIG.closeTorque, CONFIG.gripTorque, clamp(fade, 0, 1));
    }
    else { // relax: servo to half-open
      const k = 5;
      sL = clamp(k * (0.3 - this.jL.getJointAngle()), -3, 3);
      sR = clamp(k * (-0.3 - this.jR.getJointAngle()), -3, 3);
      torque = 40;
    }
    this.jL.setMotorSpeed(sL); this.jR.setMotorSpeed(sR);
    this.jL.setMaxMotorTorque(torque); this.jR.setMaxMotorTorque(torque);
  }

  step(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const h = 1 / 120;
    while (this.acc >= h) { this.fixedStep(h); this.acc -= h; }
  }

  fixedStep(h) {
    const M = MACHINE;
    this.time += h;
    this.stateT += h;
    this.world.setGravity(planck.Vec2(0, CONFIG.gravity));
    this.hub.setLinearDamping(CONFIG.swayDamping);
    const pressed = this.pressed;
    this.pressed = false;
    const move = clamp(this.input.move || 0, -1, 1);

    switch (this.state) {
      case 'idle':
        this.prongs('relax');
        this.driveCarriage(move * CONFIG.clawMoveSpeed, h);
        this.ropeLen = approach(this.ropeLen, M.topLen, CONFIG.liftSpeed * h);
        if (CONFIG.aimTime > 0 && this.aimActive && this.stateT > CONFIG.aimTime) this.emit('aimTimeout');
        break;
      case 'drop': {
        this.prongs('open');
        this.driveCarriage(0, h);
        const vy = this.hub.getLinearVelocity().y * PPM;
        const dist = this.ropeDist();
        // pay out cable, but never more than a few px of slack: the head falls at <= dropSpeed
        this.ropeLen = Math.min(M.maxLen, this.ropeLen + CONFIG.dropSpeed * h, dist + 4);
        this.dropVmax = Math.max(this.dropVmax || 0, vy);
        const slack = this.ropeLen - dist;
        this.slackT = this.stateT > 0.22 && slack > 2 && vy < 25 ? this.slackT + h : 0;
        if (this.slackT > 0.03 || this.ropeLen >= M.maxLen || (pressed && this.stateT > 0.1)) {
          this.landed = this.slackT > 0.03;
          if (this.landed) this.emit('land', { intensity: clamp(this.dropVmax / 140, 0.2, 1), x: this.hub.getPosition().x * PPM, y: this.hub.getPosition().y * PPM });
          this.dropVmax = 0;
          // slippery prongs while closing so they slide into the gaps of the pile
          this.setProngFriction(CONFIG.closeFriction);
          this.setState('close');
          this.emit('close');
        }
        break;
      }
      case 'close': {
        this.prongs('close');
        this.driveCarriage(0, h);
        // cable stays a little slack: the claw settles into the pile as it closes
        this.ropeLen = Math.min(M.maxLen, Math.max(this.ropeLen, this.ropeDist() + 2));
        if (this.stateT > CONFIG.closeTime) {
          this.setProngFriction(CONFIG.prongFriction);
          this.setState('lift');
          this.tryGrab();
          this.emit('lift', { grips: this.grips.map((g) => g.part) });
        }
        break;
      }
      case 'lift': {
        this.prongs('close', CONFIG.gripFade > 0 ? this.stateT / CONFIG.gripFade : 1);
        this.updateGrips(h);
        this.driveCarriage(0, h);
        const d = this.ropeDist();
        if (this.ropeLen > d + 1) this.ropeLen = d + 1;
        // winch spins up smoothly (an instant yank would rip parts out of the grip)
        const spin = easeInOutQuad(clamp(this.stateT / 0.45, 0, 1));
        this.ropeLen = Math.max(M.topLen, this.ropeLen - CONFIG.liftSpeed * spin * h);
        if (this.ropeLen <= M.topLen + 0.01 && this.stateT > 0.2) {
          for (const g of this.grips.slice()) this.rollSlip(g.part, CONFIG.topSlip, 'jolt');
          this.setState(CONFIG.carryManual ? 'carry' : 'return');
          this.emit('top', { held: [...this.held] });
        }
        break;
      }
      case 'carry':
        this.prongs('close', 1);
        this.updateGrips(h);
        this.driveCarriage(move * CONFIG.clawMoveSpeed, h);
        if (pressed || (CONFIG.carryTime > 0 && this.stateT > CONFIG.carryTime)) this.startRelease();
        break;
      case 'return': {
        this.prongs('close', 1);
        this.updateGrips(h);
        const d = M.home - this.carX;
        const vmax = Math.sqrt(2 * CONFIG.clawAccel * Math.abs(d));
        this.driveCarriage(Math.sign(d) * Math.min(CONFIG.clawMoveSpeed, vmax), h);
        if (Math.abs(d) < 0.6 && Math.abs(this.carV) < 6 && this.stateT > 0.3) this.startRelease();
        break;
      }
      case 'release':
        this.prongs('open');
        this.driveCarriage(0, h);
        if (this.stateT > 1.1) this.endTurn();
        break;
    }
    this.rope.setMaxLength(this.ropeLen / PPM);
    // keep the claw head roughly upright (real claws hang from a stiff cable mount)
    if (CONFIG.clawStiffness > 0) {
      const a = this.hub.getAngle(), w = this.hub.getAngularVelocity();
      this.hub.applyTorque(-CONFIG.clawStiffness * a - CONFIG.clawStiffness * 0.18 * w, true);
    }

    // living parts twitch
    if (!this.settling && CONFIG.twitchRate > 0 && RNG() < CONFIG.twitchRate * h) this.twitch();

    // restock queue
    if (this.pending.length) {
      this.pendingT -= h;
      if (this.pendingT <= 0) {
        const it = this.pending.shift();
        const p = this.spawnPart(it.type, rand(M.spawnX0 + 6, M.spawnX1 - 20), M.top + 12, rand(-3, 3), [rand(-10, 10), 20]);
        this.emit('spawn', { part: p });
        this.pendingT = 0.28;
      }
    }

    this.impacts.clear();
    this.world.step(h, 10, 6);
    this.afterStep();
  }

  setProngFriction(f) {
    for (const b of [this.prongL, this.prongR]) {
      for (let fx = b.getFixtureList(); fx; fx = fx.getNext()) fx.setFriction(f);
      for (let ce = b.getContactList(); ce; ce = ce.next) ce.contact.resetFriction();
    }
  }

  // hub-local coordinates (art px) of a world point given in meters
  toHub(q) {
    const hp = this.hub.getPosition(), a = this.hub.getAngle(), c = Math.cos(-a), s = Math.sin(-a);
    const dx = (q.x - hp.x) * PPM, dy = (q.y - hp.y) * PPM;
    return [dx * c - dy * s, dx * s + dy * c];
  }

  // After closing: whatever sits in the claw's cavity may get a springy grip.
  // Odds: centered + small + prongs actually closed = good. Physics does the rest.
  tryGrab() {
    this.grabInfo = null;
    const open = clamp((this.jL.getJointAngle() - this.jR.getJointAngle()) / 1.7, 0, 1);
    const closure = open < 0.6 ? 1 : lerp(1, 0.35, (open - 0.6) / 0.4);
    const cand = [];
    for (const p of this.parts) {
      if (p.won) continue;
      let best = null;
      for (const b of p.bodies) {
        const [lx, ly] = this.toHub(b.getPosition());
        if (Math.abs(lx) > 16 || ly < 3 || ly > 40) continue;
        const d = Math.hypot(lx, (ly - 20) * 0.6);
        if (!best || d < best.d) best = { b, lx, ly, d };
      }
      if (!best) continue;
      const s = SPR.get(p.def.sprite);
      const dim = p.def.chain ? 16 : Math.max(s.w, s.h);
      const size = dim <= 20 ? 1 : dim <= 26 ? 0.85 : 0.7;
      const center = 1 - 0.55 * Math.pow(Math.min(1, Math.abs(best.lx) / 16), 2);
      const chance = clamp(CONFIG.grabChance * size * center * closure * (p.def.grip || 1), 0, 0.98);
      cand.push({ p, ...best, chance });
    }
    cand.sort((a, b) => a.d - b.d);
    this.grabInfo = { open, closure, cand: cand.map((c) => ({ type: c.p.type, chance: c.chance })) };
    let first = true;
    for (const c of cand.slice(0, 2)) {
      const roll = first ? c.chance : c.chance * 0.3; // a second part is a lucky bonus
      if (RNG() < roll) this.attachGrip(c.p, c.b);
      first = false;
    }
  }

  attachGrip(p, body) {
    const pl = planck;
    const anchorA = this.hub.getWorldPoint(pl.Vec2(0, 16 / PPM));
    const anchorB = body.getWorldCenter();
    const len = Math.hypot(anchorA.x - anchorB.x, anchorA.y - anchorB.y);
    const joint = this.world.createJoint(pl.DistanceJoint({
      frequencyHz: CONFIG.gripSpring, dampingRatio: 1, length: clamp(len, 2 / PPM, 22 / PPM), collideConnected: true,
    }, this.hub, body, anchorA, anchorB));
    this.grips.push({ part: p, body, joint, strain: 0, t: 0 });
    for (const b of p.bodies) { b.setLinearDamping(1.6); b.setAngularDamping(2.5); } // clamped by the prongs
  }

  unclamp(p) { for (const b of p.bodies) { b.setLinearDamping(0.05); b.setAngularDamping(p.def.chain ? 0.6 : 0.4); } }

  // Slip model: explicit, tunable odds (physics supplies the swing you can see).
  updateGrips(h) {
    const hv = this.hub.getLinearVelocity();
    for (const g of this.grips.slice()) {
      g.t += h;
      const gp = g.part.def.grip || 1;
      const v = g.body.getLinearVelocity();
      const vrel = Math.hypot(v.x - hv.x, v.y - hv.y) * PPM; // how hard it's swinging, px/s
      const A = g.joint.getAnchorA(), B = g.joint.getAnchorB();
      const stretch = (Math.hypot(A.x - B.x, A.y - B.y) - g.joint.getLength()) * PPM;
      g.load = vrel;
      let lose = null;
      if (stretch > 9) lose = 'stuck'; // still wedged in the pile: it tears free of the claw
      else if (g.t > 0.4 && this.state !== 'lift') { // swinging only counts once the player is steering
        const hazard = CONFIG.slipBase / gp + CONFIG.swingSlip * Math.max(0, vrel - CONFIG.swingSafe) / 30;
        if (RNG() < hazard * h) lose = 'swing';
      }
      if (lose) this.loseGrip(g, lose);
    }
  }

  loseGrip(g, why) {
    if (!this.grips.includes(g)) return;
    this.world.destroyJoint(g.joint);
    this.unclamp(g.part);
    this.grips = this.grips.filter((x) => x !== g);
    this.emit('gripLost', { part: g.part, why });
  }

  // one-off slip rolls (the jolt at the top of the lift, a twitch in the claw)
  rollSlip(p, chance, why) {
    const g = this.grips.find((x) => x.part === p);
    if (g && RNG() < chance / (p.def.grip || 1)) this.loseGrip(g, why);
  }

  dropGrips() {
    for (const g of this.grips) { this.world.destroyJoint(g.joint); this.unclamp(g.part); }
    this.grips = [];
  }

  twitch() {
    const living = this.parts.filter((p) => p.def.alive && !p.won);
    if (!living.length) return;
    const p = pick(living);
    const held = this.held.has(p) || this.grips.some((g) => g.part === p);
    const f = CONFIG.twitchForce * (held ? 1.5 : 1);
    const b = held ? p.bodies[p.bodies.length - 1] : p.body;
    const m = b.getMass() * (p.bodies.length > 1 ? 2 : 1);
    b.applyLinearImpulse(planck.Vec2(rand(-1.4, 1.4) * f * m, -rand(2.2, 4) * f * m), b.getWorldCenter(), true);
    b.applyAngularImpulse(rand(-1, 1) * 0.35 * f * b.getInertia() * 10, true);
    p.twitchT = this.time;
    this.emit('twitch', { part: p, held });
    if (held) this.rollSlip(p, CONFIG.twitchSlip, 'twitch');
  }

  startRelease() {
    this.dropGrips();
    this.setState('release');
    this.emit('release', { held: [...this.held], overChute: this.carX > MACHINE.chuteX0 });
  }

  endTurn() {
    const t = this.turn;
    const result = t && t.won.length ? 'win' : t && t.grabbed.size ? 'slip' : 'miss';
    this.setState('idle');
    this.emit('turnEnd', { result, won: t ? t.won.slice() : [], grabbed: t ? [...t.grabbed] : [], turn: t });
    this.turn = null;
  }

  afterStep() {
    const M = MACHINE;
    // wins and strays
    for (const p of this.parts.slice()) {
      const [x, y] = this.partPos(p);
      if (!p.won && x > M.chuteX0 + 1 && y > M.lipY + 6) {
        p.won = true;
        p.wonT = this.time;
        this.held.delete(p);
        if (this.turn) this.turn.won.push(p);
        this.emit('win', { part: p, x, y, inTurn: !!this.turn });
      }
      if (y > M.bottom + 16 || x < M.left - 12 || x > M.right + 12 || y < -40) {
        if (!p.won) this.emit('lost', { part: p });
        this.removePart(p);
      }
    }
    // held / slipped
    const lifting = this.state === 'lift' || this.state === 'carry' || this.state === 'return';
    const now = new Set();
    if (lifting) {
      const hp = this.hub.getPosition(), a = this.hub.getAngle(), c = Math.cos(-a), s = Math.sin(-a);
      for (const p of this.parts) {
        if (p.won) continue;
        let inZone = false;
        for (const b of p.bodies) {
          const q = b.getPosition();
          const dx = (q.x - hp.x) * PPM, dy = (q.y - hp.y) * PPM;
          const lx = dx * c - dy * s, ly = dx * s + dy * c;
          if (lx > -24 && lx < 24 && ly > -4 && ly < 64) { inZone = true; break; }
        }
        if (!inZone) continue;
        if (this.held.has(p) || p.liftY0 - p.body.getPosition().y * PPM > 9) now.add(p);
      }
      for (const p of this.held) if (!now.has(p) && !p.won) { if (this.turn) this.turn.slips++; this.emit('slip', { part: p }); }
      for (const p of now) if (!this.held.has(p)) { if (this.turn) this.turn.grabbed.add(p); this.emit('grab', { part: p }); }
    }
    this.held = now;
    const gripped = new Set(this.grips.map((g) => g.part));
    for (const p of this.parts) {
      const gs = now.has(p) || gripped.has(p) ? 1 - CONFIG.gripAssist : 1;
      for (const b of p.bodies) if (b.getGravityScale() !== gs) b.setGravityScale(gs);
    }
    // impact sounds
    if (!this.settling) {
      for (const [ud, info] of this.impacts) {
        if (ud === 'claw') { if (info.imp > 1.2) this.emit('clank', { intensity: clamp(info.imp / 8, 0, 1) }); continue; }
        if (this.time - (ud.bumpT || -1) < 0.09) continue;
        const m = info.body.getMass();
        const inten = clamp(info.imp / (m * 3.5), 0, 1);
        if (inten < 0.12) continue;
        ud.bumpT = this.time;
        const q = info.body.getPosition();
        this.emit('bump', { part: ud, intensity: inten, claw: info.claw, x: q.x * PPM, y: q.y * PPM });
      }
    }
  }

  // ------------------------------------------------------------ render helpers
  clawPose() {
    const h = this.hub, pL = this.prongL, pR = this.prongR;
    const hp = h.getPosition(), lp = pL.getPosition(), rp = pR.getPosition();
    const top = h.getWorldPoint(planck.Vec2(0, -CLAW_GEO.hubH / 2 / PPM));
    return {
      carX: this.carX, carY: MACHINE.railY,
      hubX: hp.x * PPM, hubY: hp.y * PPM, hubA: h.getAngle(),
      ropeX: top.x * PPM, ropeY: top.y * PPM,
      lX: lp.x * PPM, lY: lp.y * PPM, lA: pL.getAngle(),
      rX: rp.x * PPM, rY: rp.y * PPM, rA: pR.getAngle(),
      open: clamp((this.jL.getJointAngle() - this.jR.getJointAngle()) / 1.7, 0, 1),
    };
  }

  debugShapes() {
    const out = [];
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const sh = f.getShape(), type = sh.getType();
        if (type === 'circle') {
          const c = b.getWorldPoint(sh.getCenter());
          out.push({ type, x: c.x * PPM, y: c.y * PPM, r: sh.getRadius() * PPM, stat: b.isStatic() });
        } else if (type === 'polygon') {
          out.push({ type, pts: sh.m_vertices.map((v) => { const p = b.getWorldPoint(v); return [p.x * PPM, p.y * PPM]; }), stat: b.isStatic() });
        }
      }
    }
    return out;
  }
}
