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

// even-odd point-in-polygon test, poly = [[x, y], ...]
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// thinnest width of a fixture in px: what would have to fit through the claw's mouth
function shapeThickness(f) {
  const sh = f.getShape();
  if (sh.getType() === 'circle') return sh.getRadius() * 2 * PPM;
  const vs = sh.m_vertices;
  let best = Infinity;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length], ex = b.x - a.x, ey = b.y - a.y, L = Math.hypot(ex, ey) || 1;
    let far = 0;
    for (const v of vs) far = Math.max(far, Math.abs((v.x - a.x) * ey - (v.y - a.y) * ex) / L);
    best = Math.min(best, far);
  }
  return best * PPM;
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
    this.carX = x; this.carV = 0; this.carA = 0; this.giveT = 0;
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
    this.carX = x; this.carV = 0; this.carA = 0;
  }

  // ------------------------------------------------------------ parts
  spawnPart(type, x, y, angle = 0, vel) {
    const pl = planck, V = pl.Vec2, def = PART_DEFS[type];
    const part = { uid: _partUid++, type, def, bodies: [], won: false, removed: false, liftY0: 0, bornT: this.time, glowT: RNG() * 10 };
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

  // loaded: carrying a part, the carriage has momentum. It speeds up and coasts to a stop
  // gently, and brakes hard only when pushed against its motion (that lurch shakes parts loose).
  driveCarriage(target, h, loaded) {
    const M = MACHINE, v0 = this.carV;
    const accel = loaded && target * v0 >= 0 ? CONFIG.carryAccel : CONFIG.clawAccel;
    this.carV = approach(this.carV, target, accel * h);
    let nx = this.carX + this.carV * h;
    if (nx < M.carMin) { nx = M.carMin; this.carV = 0; }
    if (nx > M.carMax) { nx = M.carMax; this.carV = 0; }
    this.carA = (this.carV - v0) / h; // lurch: hitting the end stop at speed is the worst of all
    this.carriage.setLinearVelocity(planck.Vec2((nx - this.carX) / h / PPM, 0));
    this.carX = nx;
  }

  prongs(mode, fade = 0) {
    let torque, sL, sR;
    if (mode === 'open') { sL = 5; sR = -5; torque = 120; }
    else if (mode === 'close' && this.giveT > 0) { sL = 1.5; sR = -1.5; torque = 30; } // losing its grip: prongs sag open
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
    this.giveT = Math.max(0, (this.giveT || 0) - h);

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
        // the claw's weight drives the closing prongs into the pile instead of letting them lever it up
        if (CONFIG.closeDig > 0) this.hub.applyForceToCenter(planck.Vec2(0, CONFIG.closeDig * this.hub.getMass() * CONFIG.gravity), true);
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
          for (const g of this.grips.slice()) this.kickGrip(g.part, CONFIG.strainJolt, 'jolt');
          this.setState(CONFIG.carryManual ? 'carry' : 'return');
          this.emit('top', { held: [...this.held] });
        }
        break;
      }
      case 'carry':
        this.prongs('close', 1);
        this.updateGrips(h);
        this.driveCarriage(move * CONFIG.clawMoveSpeed, h, true);
        if (pressed || (CONFIG.carryTime > 0 && this.stateT > CONFIG.carryTime)) this.startRelease();
        break;
      case 'return': {
        this.prongs('close', 1);
        this.updateGrips(h);
        const d = M.home - this.carX;
        const vmax = Math.sqrt(2 * CONFIG.carryAccel * Math.abs(d));
        this.driveCarriage(Math.sign(d) * Math.min(CONFIG.clawMoveSpeed, vmax), h, true);
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

  // The claw's cavity as it is right now, traced along the inner edges of both prongs
  // (world px). Whatever lies inside this outline is what the player sees in the claw.
  cavity() {
    const V = planck.Vec2, I = CLAW_GEO.inner;
    const L = I.map(([x, y]) => this.prongL.getWorldPoint(V(x / PPM, y / PPM)));
    const R = I.map(([x, y]) => this.prongR.getWorldPoint(V(-x / PPM, y / PPM)));
    return [L[0], L[1], L[2], R[2], R[1], R[0]].map((q) => [q.x * PPM, q.y * PPM]);
  }

  // The claw as it is right now: its cavity (and bounds), which parts each prong touches,
  // and the mouth, i.e. the gap between the prong tips (0 once they cross) that a part
  // would have to fit through to fall out.
  clawFrame() {
    const V = planck.Vec2, I = CLAW_GEO.inner, cav = this.cavity();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of cav) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const touching = (prong) => {
      const s = new Set();
      for (let ce = prong.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) s.add(ce.other.getUserData());
      return s;
    };
    const [lx, ly] = this.toHub(this.prongL.getWorldPoint(V(I[2][0] / PPM, I[2][1] / PPM)));
    const [rx, ry] = this.toHub(this.prongR.getWorldPoint(V(-I[2][0] / PPM, I[2][1] / PPM)));
    return {
      cav, x0, y0, x1, y1, tL: touching(this.prongL), tR: touching(this.prongR),
      mouth: rx > lx ? Math.hypot(rx - lx, ry - ly) : 0,
      open: clamp((this.jL.getJointAngle() - this.jR.getJointAngle()) / 1.7, 0, 1),
    };
  }

  // How much of a part is in the claw: the share of its area inside the cavity (sampled
  // on a 1px grid), the centroid of that share (the spot the claw really holds), whether
  // its center of mass is inside, and which prongs touch it. Null if it's nowhere near.
  measurePart(p, F) {
    const V = planck.Vec2;
    const near = p.bodies.some((b) => {
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const bb = f.getAABB(0);
        if (bb.upperBound.x * PPM > F.x0 && bb.lowerBound.x * PPM < F.x1 && bb.upperBound.y * PPM > F.y0 && bb.lowerBound.y * PPM < F.y1) return true;
      }
      return false;
    });
    if (!near) return null;
    let area = 0, inside = 0, best = null;
    for (const b of p.bodies) {
      let k = 0, sx = 0, sy = 0;
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const bb = f.getAABB(0);
        for (let x = Math.floor(bb.lowerBound.x * PPM) + 0.5; x < bb.upperBound.x * PPM; x++) {
          for (let y = Math.floor(bb.lowerBound.y * PPM) + 0.5; y < bb.upperBound.y * PPM; y++) {
            if (!f.testPoint(V(x / PPM, y / PPM))) continue;
            area++;
            if (inPoly(x, y, F.cav)) { k++; sx += x; sy += y; }
          }
        }
      }
      inside += k;
      if (k && (!best || k > best.k)) best = { b, k, at: [sx / k, sy / k] };
    }
    if (!best) return null;
    const c = best.b.getWorldCenter();
    return {
      p, body: best.b, at: best.at, frac: inside / Math.max(1, area),
      centerIn: inPoly(c.x * PPM, c.y * PPM, F.cav), touchL: F.tL.has(p), touchR: F.tR.has(p),
      thick: shapeThickness(best.b.getFixtureList()),
    };
  }

  // How well the claw holds a measured part (0..1), from what the player can see: how much
  // of it is inside, whether the prongs closed under it (caged: it can't fall through the
  // mouth) or squeeze it from both sides (pinched), and how slippery it is.
  holdOf(c, F, g) {
    c.pinched = c.touchL && c.touchR;
    // once caged it stays caged until the mouth clearly opens (the prongs flex as it swings)
    c.caged = c.centerIn && F.mouth < c.thick * (g && g.caged ? 1.15 : 0.9);
    if (g) g.caged = c.caged;
    c.geo = 0;
    if (!c.centerIn && c.frac < 0.15) return 0; // it has slid out of the claw
    const fit = lerp(CONFIG.holdLoose, CONFIG.holdFull, smoothstep(0.3, 0.9, c.frac));
    c.geo = fit + (c.caged ? CONFIG.holdCaged : c.pinched ? CONFIG.holdPinch : 0); // the visible part of the hold
    return clamp(c.geo * (c.p.def.grip || 1), 0.05, 1);
  }

  measureGrab() {
    const F = this.clawFrame(), parts = [];
    for (const p of this.parts) {
      if (p.won) continue;
      const c = this.measurePart(p, F);
      if (c) { c.q = this.holdOf(c, F); parts.push(c); }
    }
    return { parts, mouth: F.mouth, open: F.open };
  }

  // After closing, whatever is in the claw gets a springy grip. No hidden dice roll: the
  // outcome follows what the player can see (see holdOf). The lift and the carry do the rest.
  tryGrab() {
    const m = this.measureGrab();
    // in the claw: its middle is inside, or most of it is, or both prongs squeeze a good chunk of it
    const held = m.parts.filter((c) => c.centerIn || c.frac >= CONFIG.grabInside || (c.pinched && c.frac >= CONFIG.grabInside / 2));
    // the claw takes what it visibly holds best; among equals, the one in the middle of it
    // (never an invisible stat like slipperiness)
    const rank = (c) => c.geo - 0.01 * Math.abs(this.toHub(planck.Vec2(c.at[0] / PPM, c.at[1] / PPM))[0]);
    held.sort((a, b) => rank(b) - rank(a));
    // a second part only when it's properly held too, and squeezed in beside the first
    // (weaker hold): a lucky double, not the norm. A third part is left to physics.
    const grips = held.slice(0, 1);
    if (held[1] && (held[1].caged || held[1].pinched)) grips.push(held[1]);
    grips.forEach((c, i) => this.attachGrip(c.p, c.body, c.at, c.q, i ? 0.75 : 1));
    // the closest call among the rest, so the scene can say what went wrong
    const near = m.parts.filter((c) => !grips.includes(c)).sort((a, b) => b.frac - a.frac)[0];
    this.grabInfo = {
      open: m.open, mouth: m.mouth,
      held: grips.map((c, i) => ({ type: c.p.type, q: c.q * (i ? 0.75 : 1), frac: c.frac, caged: c.caged, pinched: c.pinched })),
      near: near ? { part: near.p, frac: near.frac, touched: near.touchL || near.touchR } : null,
      inClaw: held.length,
    };
  }

  // A springy link from the middle of the claw to the spot the claw actually holds. A
  // part held by its end therefore dangles and swings, one held in the middle sits still.
  attachGrip(p, body, at, q = 1, share = 1) {
    const pl = planck;
    const anchorA = this.hub.getWorldPoint(pl.Vec2(0, 16 / PPM));
    const anchorB = at ? pl.Vec2(at[0] / PPM, at[1] / PPM) : body.getWorldCenter();
    const len = Math.hypot(anchorA.x - anchorB.x, anchorA.y - anchorB.y);
    const joint = this.world.createJoint(pl.DistanceJoint({
      frequencyHz: CONFIG.gripSpring, dampingRatio: 1, length: clamp(len, 2 / PPM, 22 / PPM), collideConnected: true,
    }, this.hub, body, anchorA, anchorB));
    const mass = p.bodies.reduce((a, b) => a + b.getMass(), 0);
    const weight = CONFIG.strainWeight * Math.sqrt(mass / 0.4); // heavier parts pull harder on the grip
    this.grips.push({
      part: p, body, joint, share, hold: q * share, weight, strain: weight, kick: 0, slide: 0, load: 0,
      len0: joint.getLength(), cause: 'swing', slipping: false, t: 0, measureT: 0,
    });
    for (const b of p.bodies) { b.setLinearDamping(1.6); b.setAngularDamping(2.5); } // clamped by the prongs
  }

  unclamp(p) { for (const b of p.bodies) { b.setLinearDamping(0.05); b.setAngularDamping(p.def.chain ? 0.6 : 0.4); } }

  // Slip model. Each grip has a hold (how well it's gripped: re-measured as the prongs
  // close around the part on the way up) and a strain (how hard the part is being yanked
  // right now): its weight, the carriage lurching, the claw swinging, plus spikes from the
  // jolt at the top and squirming. While strain beats hold the part visibly slides down in
  // the claw. Ease off and the claw re-seats it; keep yanking and it drops. Every slip is
  // telegraphed and the player can do something about it: no hidden dice.
  updateGrips(h) {
    const hv = this.hub.getLinearVelocity();
    const steering = this.state === 'carry' || this.state === 'return';
    const swing = Math.abs(hv.x * PPM - this.carV); // claw head swinging relative to the carriage, px/s
    let F = null;
    for (const g of this.grips.slice()) {
      g.t += h;
      if ((g.measureT -= h) <= 0) {
        g.measureT = 0.1;
        F = F || this.clawFrame();
        const c = this.measurePart(g.part, F);
        // peak of the last 0.3s: a part rattling in the claw shouldn't flicker its hold
        g.recent = [...(g.recent || []).slice(-2), c ? this.holdOf(c, F, g) * g.share : 0];
        g.target = Math.max(...g.recent);
        // it has worked its way out of the claw: nothing left to hold it by
        if (g.target === 0) { this.loseGrip(g, 'loose'); continue; }
      }
      if (g.target != null) g.hold = approach(g.hold, g.target, (g.target > g.hold ? 3 : 1.2) * h);
      const A = g.joint.getAnchorA(), B = g.joint.getAnchorB();
      const stretch = (Math.hypot(A.x - B.x, A.y - B.y) - g.joint.getLength()) * PPM;
      if (stretch > 9) { this.loseGrip(g, 'stuck'); continue; } // still wedged in the pile: it tears free
      const lurch = steering ? CONFIG.strainLurch * Math.min(3, Math.abs(this.carA) / 200) : 0;
      const sway = steering ? CONFIG.strainSwing * Math.max(0, swing - CONFIG.swingSafe) / 20 : 0;
      const target = g.weight + lurch + sway;
      // strain rises fast and settles slowly; spikes (jolt, twitch) fade on their own
      g.strain += (target - g.strain) * (1 - Math.exp(-h / (target > g.strain ? 0.05 : 0.3)));
      g.kick *= Math.exp(-h / 0.35);
      if (lurch + sway > g.kick) g.cause = 'swing';
      // a part that has slid down is held by less of the claw: slipping feeds on itself,
      // so a small slip recovers but yanking the claw while it slides tips it over
      const hold = g.hold * (1 - 0.6 * g.slide / CONFIG.slideMax);
      g.load = (g.strain + g.kick) / hold; // > 1: slipping
      const over = g.strain + g.kick - hold;
      if (over > 0) {
        g.slide += over * CONFIG.slideRate * h;
        if (!g.slipping && g.slide > 0.4) { g.slipping = true; this.emit('slipping', { part: g.part, why: g.cause }); }
      } else {
        g.slide = Math.max(0, g.slide - 4 * h); // the claw re-seats it
        if (g.slipping && g.slide < 0.2) { g.slipping = false; this.emit('reseat', { part: g.part }); }
      }
      g.joint.setLength(g.len0 + g.slide / PPM); // the part sinks in the claw as it slides
      if (g.slide > CONFIG.slideMax) this.loseGrip(g, g.cause);
    }
  }

  // a sudden spike of strain on a held part (the jolt at the top, a twitch in the claw)
  kickGrip(p, amount, why) {
    const g = this.grips.find((x) => x.part === p);
    if (!g || amount <= 0) return;
    g.kick += amount * rand(0.6, 1.4);
    if (g.kick > g.strain) g.cause = why;
    g.load = (g.strain + g.kick) / Math.max(0.01, g.hold * (1 - 0.6 * g.slide / CONFIG.slideMax));
  }

  loseGrip(g, why) {
    if (!this.grips.includes(g)) return;
    this.world.destroyJoint(g.joint);
    this.unclamp(g.part);
    this.grips = this.grips.filter((x) => x !== g);
    // the prongs sag open for a moment (the classic weak arcade claw), so a part caged
    // by the closed prongs really drops instead of riding along without a grip
    if (why !== 'stuck' && why !== 'loose') this.giveT = 0.45;
    this.emit('gripLost', { part: g.part, why });
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
    if (held) this.kickGrip(p, CONFIG.strainTwitch, 'twitch');
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
