// ---------------------------------------------------------------------------
// BATTLE SIM — the fight in the graveyard, with no drawing, sound or camera. It moves units, rolls hits,
// applies traits and reports what happened through onEvent; the scene turns events into juice, the bots
// (tools/) just read the outcome. Everything that changes a result goes through RNG (gameplay stream).
//
//   const sim = new BattleSim({ party, stage, onEvent });
//   sim.start(); sim.step(dt); sim.zap(); sim.retreat(); sim.over / sim.won
//   Game.applyBattle(sim, kind) then turns the outcome into tokens, restocks and stage progress.
//
// Events: start, attackStart {u}, whiff {u}, miss {att,def}, hit {att,def,dmg,crit,fire}, heal {u,amount},
//         stun {u}, bleed {u}, burn {u}, whip {u}, fireball {u,p}, fireHit {p}, undying {u}, kill {u,by},
//         zap {healed:[{u,amount}]}, over {won}
// ---------------------------------------------------------------------------
const ARENA = { ground: 214, minX: 20, maxX: 460, allyLanes: [0, 11, -11], enemyLanes: [0, 11, -11, 5, -5], allyStartX: 120, allyGap: 38, enemyStartX: 350, enemyGap: 36 };

class BattleSim {
  constructor({ party, stage, onEvent, enemies }) {
    this.onEvent = onEvent || (() => {});
    this.stage = stage;
    this.state = 'ready'; // ready -> fight -> over
    this.units = [];
    this.projectiles = []; // hellfire bolts in flight
    this.later = []; // delayed actions on battle time (the tail's second strike)
    this.zapCd = 0;
    this.elapsed = 0;
    this.goldKills = 0; // enemies dropped by Heart of Gold carriers: +1 token each, paid out by Game.applyBattle
    this.over = false;
    this.won = false;
    (party || []).filter((c) => c.hp > 0).slice(0, 3).forEach((c, i) => this.units.push(this.makeAlly(c, i)));
    this.kinds = enemies || stageEnemies(stage); // `enemies` overrides the stage table (matchup tests)
    this.kinds.forEach((k, i) => this.units.push(this.makeEnemy(k, i)));
    // what a win drops into the machine, rolled up front so the scene can show what you are fighting for
    this.prize = Array.from({ length: CONFIG.restockParts }, () => randomPartType({ boost: 1 + stage * 0.2 }));
  }

  emit(type, data) { this.onEvent(type, data || {}); }
  allies() { return this.units.filter((u) => u.team === 'ally'); }
  enemies() { return this.units.filter((u) => u.team === 'enemy'); }
  static alive(arr) { return arr.filter((u) => !u.dead); }

  // How much of the enemy's health has been chewed through, 0..1. Even a lost fight pays for this.
  progress() {
    const es = this.enemies();
    const max = es.reduce((a, u) => a + u.maxHp, 0);
    return max ? clamp(1 - es.reduce((a, u) => a + Math.max(0, u.hp), 0) / max, 0, 1) : 0;
  }
  // Fraction of your creatures' total health still standing (the dead count as zero).
  standing() {
    const as = this.allies();
    const max = as.reduce((a, u) => a + u.maxHp, 0);
    return max ? as.reduce((a, u) => a + Math.max(0, u.hp), 0) / max : 0;
  }

  makeAlly(c, i) {
    return {
      team: 'ally', c, name: c.name.split(' ')[0], x: ARENA.allyStartX - i * ARENA.allyGap, y: ARENA.ground + ARENA.allyLanes[i],
      hp: c.hp, maxHp: c.maxHp, atk: c.atk, hitList: c.hits.slice(), def: c.def, atkTime: c.atkTime, speed: c.moveSpeed, range: c.range,
      dodge: c.dodge, crit: c.crit, traits: c.traits, cd: rand(0.1, 0.5), state: 'idle', animT: 0, kx: 0,
      stunT: 0, bleedT: 0, burnT: 0, hasteT: 0, hits: 0, revived: false, dead: false,
    };
  }

  makeEnemy(kind, i) {
    const K = ENEMY_KINDS[kind];
    const m = enemyScale(this.stage);
    const hp = Math.round(K.hp * m * CONFIG.enemyHp);
    return {
      team: 'enemy', kind, K, name: K.name, x: ARENA.enemyStartX + i * ARENA.enemyGap + (K.boss ? 20 : 0), y: ARENA.ground + ARENA.enemyLanes[i % 5],
      hp, maxHp: hp, atk: K.atk * m * CONFIG.enemyAtk, hitList: null, def: K.def || 0, atkTime: K.atkTime, speed: K.speed, range: K.range,
      dodge: K.dodge, crit: 0.05, traits: [], cd: rand(0.3, 0.9), state: 'idle', animT: 0, kx: 0,
      stunT: 0, bleedT: 0, burnT: 0, hasteT: 0, hits: 0, dead: false,
    };
  }

  start() {
    if (this.state !== 'ready') return false;
    this.state = 'fight';
    this.emit('start');
    return true;
  }

  // The player's one lever: heal 30% and haste everyone, on a cooldown. Returns false if it isn't available.
  zap() {
    if (this.state !== 'fight' || this.zapCd > 0) return false;
    this.zapCd = CONFIG.zapCooldown;
    const healed = [];
    for (const u of BattleSim.alive(this.allies())) {
      const amount = Math.round(u.maxHp * 0.3);
      u.hp = Math.min(u.maxHp, u.hp + amount);
      u.hasteT = 4;
      healed.push({ u, amount });
    }
    this.emit('zap', { healed });
    return true;
  }

  // ends the fight without a winner (retreat); the caller decides what that costs
  stop() { this.state = 'over'; this.over = true; this.projectiles = []; }

  nearestFoe(u) {
    let best = null, bd = 1e9;
    for (const o of this.units) {
      if (o.dead || o.team === u.team) continue;
      const d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y) * 1.2; // prefer the foe in your own lane
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  royalBonus() { return BattleSim.alive(this.allies()).some((u) => u.traits.includes('royal')) ? 1.25 : 1; }

  dealHit(att, def, opts = {}) {
    if (def.dead) return;
    const isAlly = att.team === 'ally';
    if (chance(def.dodge)) { this.emit('miss', { att, def }); return; }
    let dmg = (opts.base != null ? opts.base : att.atk) * rand(0.85, 1.15) * (opts.mult || 1);
    if (isAlly) dmg *= CONFIG.allyAtk * this.royalBonus();
    const crit = chance(att.crit);
    if (crit) dmg *= 2;
    dmg = Math.max(1, dmg - (def.def || 0));
    if (def.traits && def.traits.includes('hefty')) dmg *= 0.8;
    dmg = Math.round(dmg);
    def.hp -= dmg;
    def.kx = (def.x > att.x ? 1 : -1) * (crit ? 120 : 60);
    this.emit('hit', { att, def, dmg, crit, fire: !!opts.fire });
    if (isAlly) {
      if (att.traits.includes('bite')) { const h = Math.round(dmg * 0.3); att.hp = Math.min(att.maxHp, att.hp + h); if (h) this.emit('heal', { u: att, amount: h }); }
      if (att.traits.includes('rend')) { if (!(def.bleedT > 0)) this.emit('bleed', { u: def }); def.bleedT = 3; }
      if (att.traits.includes('smash') && chance(0.3)) { def.stunT = 1; this.emit('stun', { u: def }); }
      if (opts.fire) def.burnT = 3;
      if (att.traits.includes('set_abyssal')) { if (!(def.burnT > 0)) this.emit('burn', { u: def }); def.burnT = 3; } // the Abyssal set: every hit burns
    }
    if (def.hp <= 0) this.kill(def, att);
  }

  kill(u, by) {
    if (u.team === 'ally' && u.traits.includes('undying') && !u.revived) {
      u.revived = true;
      u.hp = Math.round(u.maxHp * 0.4);
      this.emit('undying', { u });
      return;
    }
    u.dead = true;
    u.hp = 0;
    if (u.team === 'enemy') {
      if (by && by.traits.includes('golden')) this.goldKills++;
      if (by && by.c) by.c.kills++;
    }
    this.emit('kill', { u, by });
  }

  killEnemies() { for (const e of BattleSim.alive(this.enemies())) this.kill(e, null); } // dev tool and tests

  step(dt) {
    if (this.state !== 'fight') return;
    const bdt = dt * CONFIG.battleSpeed;
    this.elapsed += bdt;
    // hellfire bolts fly on wall-clock dt, like the particles they used to be
    for (const p of this.projectiles) { p.t += dt; p.life -= dt; p.x += p.vx * dt; }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
    this.zapCd = Math.max(0, this.zapCd - bdt);
    for (const a of this.later) a.t -= bdt;
    this.later = this.later.filter((a) => { if (a.t > 0) return true; a.fn(); return false; });
    for (const u of this.units) {
      if (u.dead) continue;
      u.x += u.kx * bdt; u.kx *= Math.exp(-10 * bdt);
      u.x = clamp(u.x, ARENA.minX, ARENA.maxX);
      // status effects
      if (u.bleedT > 0) { u.bleedT -= bdt; u.hp -= 2 * bdt; }
      if (u.burnT > 0) { u.burnT -= bdt; u.hp -= 3 * bdt; }
      if (u.team === 'ally' && (u.traits.includes('regen') || u.traits.includes('golden'))) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * (u.traits.includes('golden') ? 0.03 : 0.02) * bdt);
      if (u.hp <= 0) { this.kill(u, null); continue; }
      if (u.stunT > 0) { u.stunT -= bdt; u.state = 'idle'; continue; }
      u.hasteT = Math.max(0, u.hasteT - bdt);
      const haste = u.hasteT > 0 ? 1.5 : 1;
      u.cd -= bdt * haste;
      const f = this.nearestFoe(u);
      if (!f) { u.state = 'idle'; continue; }
      const dir = f.x > u.x ? 1 : -1;
      u.facing = dir;
      const dist = Math.abs(f.x - u.x);
      if (u.state === 'attack') {
        const before = u.animT;
        u.animT += (bdt * haste) / 0.55;
        if (before < 0.5 && u.animT >= 0.5) {
          u.hits++;
          const fire = u.traits.includes('hellfire') && u.hits % 3 === 0;
          if (fire) {
            const p = { x: u.x + dir * 10, y: 0, vx: dir * 160, t: 0, life: 1.2, target: f, from: u, done: false };
            this.projectiles.push(p);
            this.emit('fireball', { u, p });
          } else if (dist <= u.range + 8) {
            // one strike per arm, a beat apart; armour bites each one separately
            const list = u.hitList && u.hitList.length ? u.hitList : [u.atk];
            list.forEach((h, k) => {
              if (k === 0) this.dealHit(u, f, { base: h });
              else this.later.push({ t: 0.12 * k, fn: () => { const foe = f.dead ? this.nearestFoe(u) : f; if (foe && !u.dead) this.dealHit(u, foe, { base: h }); } });
            });
            if (u.traits.includes('whip') && chance(0.25)) { this.emit('whip', { u }); this.later.push({ t: 0.18, fn: () => { if (!f.dead && !u.dead) this.dealHit(u, f, { mult: 0.6 }); } }); }
          } else this.emit('whiff', { u });
        }
        if (u.animT >= 1) { u.state = 'idle'; u.animT = 0; }
      } else if (dist > u.range) {
        u.state = 'walk';
        u.x += dir * u.speed * bdt * haste;
      } else {
        u.state = 'idle';
        if (u.cd <= 0) { u.state = 'attack'; u.animT = 0; u.cd = u.atkTime; this.emit('attackStart', { u }); }
      }
    }
    // keep teammates from stacking
    for (const team of ['ally', 'enemy']) {
      const list = BattleSim.alive(this.units.filter((u) => u.team === team)).sort((a, b) => a.x - b.x);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const gap = Math.abs(a.y - b.y) < 6 ? 26 : 12; // same lane: don't overlap; different lanes: depth is enough
        if (b.x - a.x < gap) { const push = (gap - (b.x - a.x)) / 2; a.x -= push * 0.6; b.x += push * 0.6; }
      }
    }
    // projectiles land
    for (const p of this.projectiles) {
      if (p.done) continue;
      if (p.target.dead) { p.life = 0; continue; }
      if (Math.abs(p.x - p.target.x) < 8) { p.done = true; p.life = 0; this.emit('fireHit', { p }); this.dealHit(p.from, p.target, { mult: 1.6, fire: true }); }
    }
    if (!BattleSim.alive(this.enemies()).length) this.conclude(true);
    else if (!BattleSim.alive(this.allies()).length) this.conclude(false);
  }

  conclude(won) {
    if (this.over) return;
    this.over = true;
    this.won = won;
    this.state = 'over';
    this.emit('over', { won });
  }
}
