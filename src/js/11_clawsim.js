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
const GRIP_REF_MASS = 0.4; // a skull: CONFIG.gripStrength is measured in skull-weights

// Signed distance (px) from a point to the claw cavity polygon (ClawSim.cavity): > 0 inside.
// The closing edge (the underside of the claw head) is a wall, not a way out, so it doesn't count.
function cavityDepth(poly, x, y) {
  let inside = false, d2 = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    if (i === 0) continue;
    const ex = xi - xj, ey = yi - yj, t = clamp(((x - xj) * ex + (y - yj) * ey) / (ex * ex + ey * ey || 1), 0, 1);
    const dx = x - xj - t * ex, dy = y - yj - t * ey;
    d2 = Math.min(d2, dx * dx + dy * dy);
  }
  return (inside ? 1 : -1) * Math.sqrt(d2);
}

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
    // The Rig (12_clawrig.js): drop lock, chute lid, active quake, armed Iron Grip, turn recording for REDO
    this.lockT = 0; this.lockWhy = null;
    this.sealAge = 0; this.lid = null;
    this.quakeS = null; this.settleS = null;
    this.iron = false;
    this.hist = null; this.redoHist = null; this.rw = null;
    this.cav = null; // the claw's cavity polygon, refreshed while it grips
    this.joltT = -9;
    this.strain = 0; // how roughly the load is being carried: it frays the soul grip (carryStrain)
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
      // Each prong segment [innerA, outerA, outerB, innerB] is split lengthwise into a grippy inner
      // pad and a smooth outer shell (same shape and mass): parts caught inside get purchase, while
      // parts resting on the outside slide off instead of riding along on a prong.
      const pt = ([px, py]) => V((side < 0 ? px : -px) / PPM, py / PPM), mid = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      for (const [iA, oA, oB, iB] of G.prong) {
        const m0 = mid(iA, oA), m1 = mid(oB, iB);
        b.createFixture(pl.Polygon([iA, m0, m1, iB].map(pt)), clawFix(2, CONFIG.prongFriction)).setUserData('pad');
        b.createFixture(pl.Polygon([m0, oA, oB, m1].map(pt)), clawFix(2, CONFIG.shellFriction));
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

  clearParts() { for (const p of this.parts.slice()) this.removePart(p); this.hist = null; this.redoHist = null; }

  partPos(p) { const q = p.body.getPosition(); return [q.x * PPM, q.y * PPM]; }

  // Fresh pile: guarantees one legendary, a couple of rares and every slot represented.
  fillPile(n = CONFIG.partCount) {
    const M = MACHINE;
    const types = [randomPartType({ rarity: 'legendary' }), randomPartType({ rarity: 'rare' }), randomPartType({ rarity: 'rare' })];
    const need = { head: 3, torso: 3, arm: 4, leg: 4, heart: 1 };
    for (const slot in need) for (let i = 0; i < need[slot]; i++) types.push(randomPartType({ slot, rarity: i === 0 ? 'common' : undefined }));
    while (types.length < n) types.push(randomPartType());
    shuffle(types);
    this.layoutPile(types.slice(0, Math.max(n, 5)));
  }

  // Drop these parts into the machine in a loose grid, then let them settle into a pile. Each is a part type,
  // or { type, from } for a dead creature's remains (they keep its name). Also how a saved run rebuilds the
  // machine: the parts are kept, the exact pile is not.
  layoutPile(types) {
    const M = MACHINE;
    const cols = 5, cw = (M.spawnX1 - M.spawnX0) / cols;
    types.forEach((t, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const p = this.spawnPart(t.type || t, M.spawnX0 + cw * (col + 0.5) + rand(-3, 3), M.floor - 14 - row * 23 + rand(-2, 2), rand(-Math.PI, Math.PI));
      if (t.from) p.from = t.from;
    });
    this.settle(4.5);
    // anything that bounced into the chute goes back on top of the pile
    for (const p of this.parts.slice()) {
      const [x] = this.partPos(p);
      if (x > M.guardX - 2 || p.won) {
        const t = p.type, from = p.from;
        this.removePart(p);
        const q = this.spawnPart(t, rand(M.spawnX0, 100), 20, rand(-3, 3));
        if (from) q.from = from;
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

  queueSpawn(type, delay = 0, from) { this.pending.push({ type, t: delay, from }); }

  // ------------------------------------------------------------ control
  press() { this.pressed = true; }

  startDrop() {
    if (this.state !== 'idle' || this.lockT > 0) return false;
    this.setState('drop');
    this.turn = { won: [], grabbed: new Set(), slips: 0, startT: this.time, n: ++this.turnCount, iron: this.iron };
    this.iron = false; // Iron Grip lasts for exactly one drop
    this.landed = false;
    this.slackT = 0;
    // slippery prongs on the way down and while closing, so they slide off parts into the gaps
    this.setProngFriction(CONFIG.closeFriction);
    this.strain = 0;
    this.braked = false;
    this.beginRecord();
    this.emit('drop', { iron: this.turn.iron });
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

  // Reel the cable in at `speed` px/s. Shortening the rope joint alone drags the head up by
  // position correction, which never shows up as velocity: nothing the claw carries (the grip, a
  // part resting on the hooks) would feel the lift, and it would stay behind. So the head and its
  // prongs are given the cable's real speed, and the solver passes it on to whatever they hold.
  reel(speed) {
    const V = planck.Vec2, a = this.carriage.getPosition(), b = this.hub.getWorldPoint(V(0, -CLAW_GEO.hubH / 2 / PPM));
    const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
    if (d * PPM < this.ropeLen - 0.5 || d < 1e-6) return; // slack cable pulls nothing
    const ux = dx / d, uy = dy / d, s = speed / PPM;
    for (const body of [this.hub, this.prongL, this.prongR]) {
      const v = body.getLinearVelocity(), along = v.x * ux + v.y * uy;
      if (along < s) body.setLinearVelocity(V(v.x + (s - along) * ux, v.y + (s - along) * uy));
    }
  }

  // accel: how hard the carriage may change speed this tick. Aiming (idle) is snappy; carrying has momentum
  // (pillar 3: how you steer with something in the claw decides whether you keep it).
  driveCarriage(target, h, accel = CONFIG.clawAccel) {
    const M = MACHINE, v0 = this.carV;
    this.carV = approach(this.carV, target, accel * h);
    let nx = this.carX + this.carV * h;
    if (nx < M.carMin) { nx = M.carMin; this.carV = 0; } // the end stop: a loaded carriage that hits it at speed is jarred
    if (nx > M.carMax) { nx = M.carMax; this.carV = 0; }
    if (this.grips.length && (this.state === 'carry' || this.state === 'return')) this.addStrain(this.carV - v0, h);
    this.carriage.setLinearVelocity(planck.Vec2((nx - this.carX) / h / PPM, 0));
    this.carX = nx;
  }

  prongs(mode) {
    let torque, sL, sR;
    if (mode === 'open') {
      sL = clamp(12 * (CONFIG.clawOpen - this.jL.getJointAngle()), -5, 5);
      sR = clamp(12 * (-CONFIG.clawOpen - this.jR.getJointAngle()), -5, 5);
      torque = 120;
    }
    else if (mode === 'close') { sL = -CONFIG.closeSpeed; sR = CONFIG.closeSpeed; torque = CONFIG.closeTorque; }
    else if (mode === 'hold') {
      // Locked where they closed, like a worm-gear claw: a cage around the catch. Still squeezing,
      // the sloped shoulders would pop a rigid part out through the mouth like a watermelon seed.
      // Pushed open, they creep back; they never squeeze tighter.
      const aL = this.jL.getJointAngle(), aR = this.jR.getJointAngle();
      this.holdL = Math.min(this.holdL, aL); this.holdR = Math.max(this.holdR, aR);
      sL = Math.min(0, 6 * (this.holdL - aL)); sR = Math.max(0, 6 * (this.holdR - aR));
      torque = CONFIG.gripTorque;
    }
    else { // relax: servo to a half-open pose (or to the drop pose while it falls)
      const k = 5, a = mode === 'drop' ? CONFIG.dropOpen : 0.3;
      sL = clamp(k * (a - this.jL.getJointAngle()), -3, 3);
      sR = clamp(k * (-a - this.jR.getJointAngle()), -3, 3);
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
    if (this.state === 'rewind') { this.pressed = false; this.rewindStep(h); return; } // time runs backwards: no physics
    this.slipOpenT = Math.max(0, (this.slipOpenT || 0) - h);
    this.strain *= Math.exp(-h / Math.max(0.05, CONFIG.strainDecay)); // a rough moment passes
    this.world.setGravity(planck.Vec2(0, CONFIG.gravity));
    this.hub.setLinearDamping(CONFIG.swayDamping);
    const pressed = this.pressed;
    this.pressed = false;
    if (this.lockT > 0) {
      this.lockT -= h;
      if (this.lockT <= 0) { const why = this.lockWhy; this.lockT = 0; this.lockWhy = null; this.emit('unlock', { why }); }
    }
    const move = this.lockWhy === 'tilt' ? 0 : clamp(this.input.move || 0, -1, 1); // TILT freezes the carriage
    let guide = 0, stiff = 1; // cable guide (Hz) and upright stiffness: firm while the claw works the pile

    switch (this.state) {
      case 'idle':
        this.prongs('relax');
        this.driveCarriage(move * CONFIG.clawMoveSpeed, h);
        this.ropeLen = approach(this.ropeLen, M.topLen, CONFIG.liftSpeed * h);
        if (this.ropeLen > M.topLen) this.reel(CONFIG.liftSpeed);
        break;
      case 'drop': {
        // Down it goes in the narrow half-open pose, so the prong tips come down on whatever is under
        // the drop guide. Wide open, they'd land on its neighbours and the claw would close above it.
        guide = CONFIG.clawGuide; stiff = 3;
        this.prongs('drop');
        // The gantry stops and the claw settles before the cable pays out (0.7 s at most), so you drop where the guide
        // was: a drop on the move used to land ~16 px past the target, now ~5. It latches: once the cable is paying
        // out, a swing on the way down no longer pauses it.
        this.driveCarriage(0, h, CONFIG.clawAccel * 3); // brake hard
        if (!this.braked) {
          const hv = this.hub.getLinearVelocity(), sway = this.hub.getPosition().x * PPM - this.carX;
          if (this.stateT < 0.7 && (Math.abs(this.carV) > 6 || Math.abs(hv.x * PPM) > 10 || Math.abs(sway) > 3)) { this.hub.setLinearDamping(10); break; }
          this.braked = true;
        }
        const vy = this.hub.getLinearVelocity().y * PPM;
        const dist = this.ropeDist();
        // pay out cable, but never more than a few px of slack: the head falls at <= dropSpeed
        this.ropeLen = Math.min(M.maxLen, this.ropeLen + CONFIG.dropSpeed * h, dist + 4);
        this.dropVmax = Math.max(this.dropVmax || 0, vy);
        const slack = this.ropeLen - dist;
        // landed = the cable has stayed slack a moment (a prong just glancing off a part doesn't count)
        this.slackT = this.stateT > 0.22 && slack > 2 && vy < 25 ? this.slackT + h : 0;
        if (this.slackT > 0.05 || this.ropeLen >= M.maxLen || (pressed && this.stateT > 0.1)) {
          this.landed = this.slackT > 0.05;
          this.sink = this.landed; // stopped early by the player: spread and close right there
          if (this.landed) this.emit('land', { intensity: clamp(this.dropVmax / 140, 0.2, 1), x: this.hub.getPosition().x * PPM, y: this.hub.getPosition().y * PPM });
          this.dropVmax = 0;
          this.settleT = 0;
          this.setState('spread');
          this.emit('spread');
        }
        break;
      }
      case 'spread': {
        // Touched down: the prongs spread around what the tips landed on while the head settles in
        // between them on a slack cable, then the claw clamps shut.
        guide = CONFIG.clawGuide; stiff = 3;
        this.prongs('open');
        this.driveCarriage(0, h);
        if (this.sink) this.ropeLen = Math.min(M.maxLen, Math.max(this.ropeLen, this.ropeDist() + 3));
        this.soulHook();
        const open = (this.jL.getJointAngle() - this.jR.getJointAngle()) / 2;
        this.settleT = Math.abs(this.hub.getLinearVelocity().y * PPM) < 6 ? this.settleT + h : 0;
        if ((this.stateT > 0.2 && (open > CONFIG.clawOpen - 0.08 || this.stateT > 0.45) && this.settleT > 0.06) || this.stateT > 0.8) {
          this.setState('close');
          this.emit('close');
        }
        break;
      }
      case 'close': {
        guide = CONFIG.clawGuide; stiff = 3;
        this.prongs('close');
        this.driveCarriage(0, h);
        // cable stays a little slack: the claw settles into the pile as it closes...
        this.ropeLen = Math.min(M.maxLen, Math.max(this.ropeLen, this.ropeDist() + 2));
        // ...but it carries most of the head's weight, or the prong tips would be pinned to the pile
        // under 5 kg of claw and never sweep in
        const m = this.hub.getMass() + this.prongL.getMass() + this.prongR.getMass();
        this.hub.applyForceToCenter(planck.Vec2(0, -CONFIG.closeCarry * m * CONFIG.gravity), true);
        this.soulHook();
        if (this.stateT > CONFIG.closeTime) {
          this.hook = null;
          this.setProngFriction(CONFIG.prongFriction, CONFIG.shellFriction);
          this.holdL = this.jL.getJointAngle(); this.holdR = this.jR.getJointAngle();
          this.setState('lift');
          this.scanGrips();
          this.emit('lift', { grips: this.grips.map((g) => g.part) });
        }
        break;
      }
      case 'lift': {
        guide = CONFIG.clawGuide; stiff = 2;
        this.prongs(this.slipOpenT > 0 ? 'open' : 'hold');
        this.scanGrips(h);
        this.driveCarriage(0, h);
        const d = this.ropeDist();
        if (this.ropeLen > d + 1) this.ropeLen = d + 1;
        // winch spins up smoothly (an instant yank would rip parts out of the grip)
        const spin = easeInOutQuad(clamp(this.stateT / 0.45, 0, 1));
        // closed on air (nothing bound, nothing touching the claw): a quick, honest ride up instead of a slow empty one
        const emptyHanded = !this.grips.length && !this.held.size && !this.parts.some((p) => !p.won && this.touching(p, 0.3));
        const lift = CONFIG.liftSpeed * (emptyHanded ? 2.2 : 1) * spin;
        this.ropeLen = Math.max(M.topLen, this.ropeLen - lift * h);
        if (this.ropeLen > M.topLen) this.reel(lift);
        if (this.ropeLen <= M.topLen + 0.01 && this.stateT > 0.2) {
          const empty = !this.grips.length && !this.held.size; // nothing in the claw: no point steering it anywhere
          this.jolt();
          this.unseal(); // the top of the lift: the chute lid comes down (a held part now has to cross the guard)
          if (empty) { this.emit('empty'); this.startRelease(); } else {
            this.setState(CONFIG.carryManual ? 'carry' : 'return');
            this.emit('top', { held: [...this.held] });
          }
        }
        break;
      }
      case 'carry':
        this.prongs(this.slipOpenT > 0 ? 'open' : 'hold');
        this.driveCarriage(move * CONFIG.clawMoveSpeed, h, move ? CONFIG.carryAccel : CONFIG.carryBrake);
        this.scanGrips(h);
        if (pressed) this.startRelease();
        else if (CONFIG.carryTime > 0 && this.stateT > CONFIG.carryTime) this.startRelease(true);
        break;
      case 'return': {
        this.prongs(this.slipOpenT > 0 ? 'open' : 'hold');
        this.scanGrips(h);
        // the auto-carry assist: a steady, safe, deliberately unhurried speed with a smooth stop. It takes the
        // carry off your hands, and a careful human who takes the quick steady line still does slightly better.
        const d = M.home - this.carX;
        const vmax = Math.sqrt(2 * CONFIG.carryBrake * Math.abs(d));
        this.driveCarriage(Math.sign(d) * Math.min(CONFIG.swingSafe * CONFIG.assistSpeed, CONFIG.clawMoveSpeed, vmax), h, CONFIG.carryAccel);
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
    this.guideClaw(guide);
    // keep the claw head roughly upright (real claws hang from a stiff cable mount)
    if (CONFIG.clawStiffness > 0) {
      const k = CONFIG.clawStiffness * stiff, a = this.hub.getAngle(), w = this.hub.getAngularVelocity();
      this.hub.applyTorque(-k * a - k * 0.18 * w, true);
    }

    // living parts twitch
    if (!this.settling && CONFIG.twitchRate > 0 && RNG() < CONFIG.twitchRate * h) this.twitch();

    // restock queue
    if (this.pending.length) {
      this.pendingT -= h;
      if (this.pendingT <= 0) {
        const it = this.pending.shift();
        const p = this.spawnPart(it.type, rand(M.spawnX0 + 6, M.spawnX1 - 20), M.top + 12, rand(-3, 3), [rand(-10, 10), 20]);
        if (it.from) p.from = it.from;
        this.emit('spawn', { part: p });
        this.pendingT = 0.28;
        this.redoHist = null; // the world gained a part: a rewind would put it somewhere wrong
        if (this.hist) this.hist.tainted = true;
      }
    }

    if (this.quakeS) this.quakeStep(h);
    if (this.settleS) this.settleStep(h);
    this.sealStep(h);
    this.impacts.clear();
    this.world.step(h, 10, 6);
    this.afterStep();
    if (this.hist) this.recordStep(h);
  }

  setProngFriction(pad, shell = pad) {
    for (const b of [this.prongL, this.prongR]) {
      for (let fx = b.getFixtureList(); fx; fx = fx.getNext()) fx.setFriction(fx.getUserData() === 'pad' ? pad : shell);
      for (let ce = b.getContactList(); ce; ce = ce.next) ce.contact.resetFriction();
    }
  }

  // hub-local coordinates (art px) of a world point given in meters
  toHub(q) {
    const hp = this.hub.getPosition(), a = this.hub.getAngle(), c = Math.cos(-a), s = Math.sin(-a);
    const dx = (q.x - hp.x) * PPM, dy = (q.y - hp.y) * PPM;
    return [dx * c - dy * s, dx * s + dy * c];
  }

  // ------------------------------------------------------------ the soul grip
  // What the prongs close around is what you get. A part whose centre of mass ends up inside the
  // claw's cavity (outlined live by the prongs' inner faces, so a prong jammed open makes a leaky
  // claw) and that the claw is touching gets bound to the head by a friction joint: the Reaper's
  // soul grip. How strong depends on how it was caught: how deep inside, pinched by both prongs or
  // resting on one, slimy or dry, light or heavy. Nothing is rolled. A part slips only when the
  // physics pushes it out of the cavity (wedged in the pile, a hard swing, a twitch, the bounce at
  // the top), and a grip that nothing touches fades until the part settles back onto the prongs.

  // The cavity in world px: down the left prong's inner face to its hook, across the mouth, back up
  // the right prong. The closing edge is the underside of the head.
  cavity() {
    const V = planck.Vec2, I = CLAW_GEO.inner, out = [];
    for (const [x, y] of I) { const q = this.prongL.getWorldPoint(V(x / PPM, y / PPM)); out.push([q.x * PPM, q.y * PPM]); }
    for (let i = I.length - 1; i >= 0; i--) { const q = this.prongR.getWorldPoint(V(-I[i][0] / PPM, I[i][1] / PPM)); out.push([q.x * PPM, q.y * PPM]); }
    return out;
  }

  // remember when each part last touched the left prong, the right prong and the head
  noteTouches() {
    const scan = (body, k) => {
      for (let ce = body.getContactList(); ce; ce = ce.next) {
        const p = ce.other.getUserData();
        if (!p || p === 'claw' || !ce.contact.isTouching()) continue;
        (p.touchT || (p.touchT = [-9, -9, -9]))[k] = this.time;
      }
    };
    scan(this.prongL, 0); scan(this.prongR, 1); scan(this.hub, 2);
  }

  touching(p, within = 0.2) { return !!p.touchT && this.time - Math.max(p.touchT[0], p.touchT[1], p.touchT[2]) < within; }

  // 0..1: how well the claw holds part p, whose gripped body sits `depth` px inside the cavity
  gripQuality(p, depth) {
    const T = p.touchT, now = this.time;
    if (!T) return 0;
    const L = now - T[0] < 0.2, R = now - T[1] < 0.2, head = now - T[2] < 0.2;
    const pinch = L && R ? 1 : L || R ? 0.65 : head ? 0.45 : 0;
    return smoothstep(0, CONFIG.gripDepth, depth) * pinch * (p.def.grip || 1);
  }

  scanGrips(h = 1 / 120) {
    const poly = (this.cav = this.cavity());
    this.noteTouches();
    for (const g of this.grips.slice()) {
      g.t += h;
      const c = g.body.getWorldCenter();
      g.depth = cavityDepth(poly, c.x * PPM, c.y * PPM);
      if (g.depth < -CONFIG.gripSlack) { this.loseGrip(g, this.slipWhy(g)); continue; }
      // slide: how fast it's slipping through the claw (px/s). 0 = held fast.
      const v = g.body.getLinearVelocity(), hv = this.hub.getLinearVelocityFromWorldPoint(c);
      const slide = Math.hypot(v.x - hv.x, v.y - hv.y) * PPM;
      g.slide = Math.max(slide, (g.slide || 0) - h * 40);
      if (slide > 8 && g.t > 0.15) g.strainT = this.time;
      g.q = this.gripQuality(g.part, g.depth);
      if (this.fray(g, h)) continue; // frayed through: it let go
      this.setGripStrength(g);
    }
    for (const p of this.parts) {
      if (p.won || !this.touching(p) || this.time - (p.unbindT || -9) < 0.4 || this.grips.some((g) => g.part === p)) continue;
      let best = null;
      for (const b of p.bodies) {
        const c = b.getWorldCenter(), d = cavityDepth(poly, c.x * PPM, c.y * PPM);
        if (d > 0 && (!best || d > best.d)) best = { b, d };
      }
      if (!best) continue;
      const q = this.gripQuality(p, best.d);
      if (q >= CONFIG.gripMin * (this.ironOn() ? CONFIG.ironCatch : 1)) this.bind(p, best.b, q); // Iron Grip binds weaker catches too
    }
  }

  bind(p, body, q) {
    const c = body.getWorldCenter(), s = SPR.get(p.def.sprite);
    const joint = this.world.createJoint(planck.FrictionJoint({ collideConnected: true }, this.hub, body, c));
    const g = {
      part: p, body, joint, q, qBest: q, hold: q, t: 0, slide: 0, strainT: -9, depth: 0, fray: 0, load: 0, slipping: false,
      mass: p.bodies.reduce((a, b) => a + b.getMass(), 0),
      lever: (p.def.chain ? 8 : Math.max(s.w, s.h) / 2) / PPM,
    };
    this.grips.push(g);
    this.setGripStrength(g);
    for (const b of p.bodies) { b.setLinearDamping(0.8); b.setAngularDamping(2.5); } // clamped by the prongs
    this.emit('bind', { part: p, q, x: c.x * PPM, y: c.y * PPM });
  }

  // measured in skull-weights, so a heavy part needs a better catch than a light one. Iron Grip holds harder;
  // a fraying grip loosens, so an overstrained part visibly slides before it goes.
  setGripStrength(g) {
    const k = (this.ironOn() ? CONFIG.ironBoost : 1) * (1 - 0.75 * clamp(g.fray, 0, 1));
    const f = CONFIG.gripStrength * g.q * k * Math.sqrt(g.mass * GRIP_REF_MASS) * CONFIG.gravity;
    g.strength = f / (g.mass * CONFIG.gravity); // in the part's own weights
    g.joint.setMaxForce(f);
    g.joint.setMaxTorque(f * g.lever);
  }

  unclamp(p) { for (const b of p.bodies) { b.setLinearDamping(0.05); b.setAngularDamping(p.def.chain ? 0.6 : 0.4); } }

  // why a part left the claw (playtest report, the Reaper's lines)
  slipWhy(g) {
    const p = g.part;
    if (p.twitchT && this.time - p.twitchT < 0.6) return 'twitch';
    if (this.time - this.joltT < 0.5) return 'jolt';
    if (this.state === 'lift' && this.stateT < 0.7) return 'wedged'; // the pile held on to it
    if (this.time - g.strainT < 0.5 && this.state !== 'lift') return 'swing';
    return 'slid';
  }

  // ------------------------------------------------------------ the carry: strain against the catch
  // How roughly the load is being carried (dimensionless; a full-speed start or stop is about 1). Every change of
  // carriage speed adds to it, a reversal twice, slamming into the end stop all at once, and carrying faster than
  // the steady speed keeps adding; it calms down over strainDecay. Nothing is rolled: a steady hand carries anything
  // the claw caught well, a rough one frays the grip (see fray). Called from driveCarriage while something is held.
  addStrain(dv, h) {
    const over = Math.max(0, Math.abs(this.carV) - CONFIG.swingSafe) / Math.max(1, CONFIG.swingSafe);
    this.strain += (Math.abs(dv) / CONFIG.clawMoveSpeed) * CONFIG.strainLurch + over * CONFIG.strainSpeed * h;
  }

  // The strain one grip feels: heavier parts pull harder, Iron Grip shrugs most of it off.
  loadOn(g) { return this.strain * (0.6 + 0.4 * Math.sqrt(g.mass / GRIP_REF_MASS)) * (this.ironOn() ? CONFIG.ironSlip : 1); }

  // While a grip feels more strain than its catch can take, it frays: it loosens and the part starts to slide
  // ('slipping', which the scene telegraphs). Ease off and it re-seats ('reseat'). Fray all the way and it snaps,
  // and the jaws sag open for a moment so the part really drops instead of riding along in a closed claw.
  // Returns true if the grip let go.
  fray(g, h) {
    const carrying = this.state === 'carry' || this.state === 'return';
    // What the catch can take: the best grip this catch has had (what the reveal showed when the claw closed, or
    // better if the prongs closed in on the way up), as far as the part is still inside the claw. A part resting
    // deep in the cage holds even when no prong happens to touch it this instant; one sliding toward the mouth
    // loses it. It rises at once and falls over a moment (what the meter shows).
    g.qBest = Math.max(g.qBest, g.q);
    const hold = g.qBest * smoothstep(-CONFIG.gripSlack, CONFIG.gripDepth, g.depth);
    g.hold = approach(g.hold, hold, (hold > g.hold ? 4 : 0.8) * h);
    g.load = carrying ? this.loadOn(g) : 0;
    const over = g.load - g.hold;
    if (over > 0) g.fray += over * CONFIG.frayRate * h;
    else g.fray = Math.max(0, g.fray - CONFIG.frayHeal * h);
    if (!g.slipping && g.fray > 0.08) { g.slipping = true; this.emit('slipping', { part: g.part }); }
    else if (g.slipping && g.fray <= 0) { g.slipping = false; this.emit('reseat', { part: g.part }); }
    if (g.fray < 1) return false;
    this.loseGrip(g, 'strain'); // yanked loose: the carry was rougher than the catch
    if (!this.grips.length && CONFIG.slipOpen > 0) this.slipOpenT = CONFIG.slipOpen;
    return true;
  }

  // For the carry meter: the grip that is closest to letting go. hold = what its catch can take (0..1, Iron Grip
  // counted in), load = the strain it feels right now, fray = how far it has slid (0..1, at 1 it goes).
  carryInfo() {
    if (!this.grips.length || (this.state !== 'carry' && this.state !== 'return' && this.state !== 'lift')) return null;
    let worst = null;
    for (const g of this.grips) {
      const k = this.ironOn() ? CONFIG.ironSlip : 1, hold = g.hold / k, load = g.load / k; // in the units the player sees
      const r = { part: g.part, hold: clamp(hold, 0, 1.5), load, fray: clamp(g.fray, 0, 1), slipping: g.slipping, iron: this.ironOn() };
      if (!worst || r.fray > worst.fray || (r.fray === worst.fray && load - hold > worst.load - worst.hold)) worst = r;
    }
    return worst;
  }

  ironOn() { return !!(this.turn && this.turn.iron); } // this drop has Iron Grip (the Rig)

  loseGrip(g, why) {
    if (!this.grips.includes(g)) return;
    this.world.destroyJoint(g.joint);
    this.unclamp(g.part);
    this.grips = this.grips.filter((x) => x !== g);
    g.part.unbindT = this.time;
    this.emit('gripLost', { part: g.part, why });
  }

  dropGrips() {
    for (const g of this.grips) { this.world.destroyJoint(g.joint); this.unclamp(g.part); }
    this.grips = [];
  }

  // The extra magic. A real claw standing on its prong tips closes above whatever lies between them.
  // This one reaches: while the prongs spread and clamp, the SOUL HOOK drags the part straight below
  // the claw's centre line (the part the drop guide points at) up toward its heart. It's a real
  // force, so the pile pushes back, a buried part stays buried and nothing passes through a prong:
  // the prongs still have to close around whatever comes up.
  hookTarget(reach = CONFIG.hookReach) {
    const V = planck.Vec2, a = this.hub.getWorldPoint(V(0, CLAW_GEO.hubH / 2 / PPM)), b = this.hub.getWorldPoint(V(0, (34 + reach) / PPM));
    let hit = null;
    this.world.rayCast(a, b, (fix, point, normal, frac) => {
      const p = fix.getBody().getUserData();
      if (!p || p === 'claw' || p.won) return -1;
      hit = { part: p, body: fix.getBody(), x: point.x * PPM, y: point.y * PPM };
      return frac;
    });
    return hit;
  }

  soulHook() {
    const hook = (this.hook = CONFIG.hookPull > 0 ? this.hookTarget(CONFIG.hookReach * (this.ironOn() ? 1.3 : 1)) : null);
    if (!hook) return;
    const V = planck.Vec2, heart = this.hub.getWorldPoint(V(0, 17 / PPM));
    for (const b of hook.part.bodies) {
      const c = b.getWorldCenter(), dx = heart.x - c.x, dy = heart.y - c.y, L = Math.hypot(dx, dy) || 1;
      const f = b.getMass() * CONFIG.gravity * CONFIG.hookPull * (this.ironOn() ? CONFIG.ironBoost : 1) * Math.min(1, (L * PPM) / 6); // Iron Grip reaches harder too
      b.applyForce(V((dx / L) * f, (dy / L) * f), c, true);
    }
    hook.part.pullT = this.time;
  }

  // Hanging from a slack cable, the head used to skate down the slope of the pile while its prongs
  // closed (17 px on average, most of the width of its mouth), so grabs landed beside what you
  // aimed at. A real machine's heavy cable mount keeps the head under the carriage; this
  // spring-damper does the same while the claw works the pile. It swings freely again at the top.
  guideClaw(hz) {
    if (!(hz > 0)) return;
    const w = 2 * Math.PI * hz, m = this.hub.getMass() + this.prongL.getMass() + this.prongR.getMass();
    const p = this.hub.getPosition(), v = this.hub.getLinearVelocity();
    this.hub.applyForceToCenter(planck.Vec2(-m * (w * w * (p.x - this.carX / PPM) + 1.6 * w * (v.x - this.carV / PPM)), 0), true);
  }

  // The winch hits its stop: the cable snaps taut and everything on it bounces. A part held deep
  // in the claw rides it out; one hanging off a hook tip may not.
  jolt() {
    if (!(CONFIG.topJolt > 0)) return;
    const dv = CONFIG.topJolt / PPM;
    for (const b of [this.hub, this.prongL, this.prongR, ...this.grips.flatMap((g) => g.part.bodies)]) {
      const v = b.getLinearVelocity();
      b.setLinearVelocity(planck.Vec2(v.x, v.y + dv));
    }
    this.joltT = this.time;
  }

  twitch() {
    const living = this.parts.filter((p) => p.def.alive && !p.won);
    if (!living.length) return;
    const p = pick(living);
    const held = this.held.has(p) || this.grips.some((g) => g.part === p);
    const f = CONFIG.twitchForce * (held ? CONFIG.twitchHeld : 1); // a held part fights the grip; physics decides
    const b = held ? p.bodies[p.bodies.length - 1] : p.body;
    const m = b.getMass() * (p.bodies.length > 1 ? 2 : 1);
    b.applyLinearImpulse(planck.Vec2(rand(-1.4, 1.4) * f * m, -rand(2.2, 4) * f * m), b.getWorldCenter(), true);
    b.applyAngularImpulse(rand(-1, 1) * 0.35 * f * b.getInertia() * 10, true);
    p.twitchT = this.time;
    this.emit('twitch', { part: p, held });
  }

  startRelease(timeout = false) {
    this.dropGrips();
    this.setState('release');
    this.emit('release', { held: [...this.held], overChute: this.carX > MACHINE.chuteX0, timeout });
  }

  endTurn() {
    const t = this.turn;
    const result = t && t.won.length ? 'win' : t && t.grabbed.size ? 'slip' : 'miss';
    this.setState('idle');
    this.unseal(); // (already down since the lift; belt and braces)
    this.endRecord(result); // a failed grab keeps its recording so REDO can rewind it
    this.emit('turnEnd', { result, won: t ? t.won.slice() : [], grabbed: t ? [...t.grabbed] : [], turn: t, iron: !!(t && t.iron), redo: this.canRedo() });
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
    // held: parts the claw has actually lifted since the lift began, either soul-bound or riding in
    // its mouth while touching it. Nothing else counts, however close it is.
    const lifting = this.state === 'lift' || this.state === 'carry' || this.state === 'return';
    const bound = new Set(this.grips.map((g) => g.part));
    const now = new Set();
    if (lifting) {
      const poly = this.cav || this.cavity();
      for (const p of this.parts) {
        if (p.won || p.liftY0 - p.body.getPosition().y * PPM <= 9) continue;
        const c = p.body.getWorldCenter();
        if (bound.has(p) || (this.touching(p, 0.25) && cavityDepth(poly, c.x * PPM, c.y * PPM) > -6)) now.add(p);
      }
      for (const p of this.held) if (!now.has(p) && !p.won) { if (this.turn) this.turn.slips++; this.emit('slip', { part: p }); }
      for (const p of now) if (!this.held.has(p)) { if (this.turn) this.turn.grabbed.add(p); this.emit('grab', { part: p }); }
    }
    this.held = now;
    for (const p of this.parts) {
      const gs = bound.has(p) ? 1 - CONFIG.gripAssist : 1;
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
