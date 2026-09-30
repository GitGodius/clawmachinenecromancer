// ---------------------------------------------------------------------------
// BATTLE SCENE — "Graveyard of Second Chances". Your creations auto-fight the
// shades; you get one lever (ZAP: heal + haste) and the choice to retreat.
// Winning pays tokens and restocks the machine; the dead go back in the pile.
// ---------------------------------------------------------------------------
const ENEMY_KINDS = {
  wisp:   { name: 'Wisp',   hp: 10, atk: 2, atkTime: 1.1, speed: 34, range: 24, dodge: 0.1, spr: 'wisp', hover: 10, w: 14 },
  shade:  { name: 'Shade',  hp: 24, atk: 4, atkTime: 1.25, speed: 22, range: 28, dodge: 0.05, spr: 'shade', hover: 3, w: 22 },
  wraith: { name: 'Wraith', hp: 90, atk: 8, atkTime: 1.6, speed: 15, range: 38, dodge: 0, spr: 'wraith', hover: 4, w: 36, boss: true },
};
function stageEnemies(n) {
  const fixed = { 1: ['wisp', 'wisp'], 2: ['wisp', 'shade'], 3: ['shade', 'shade'], 4: ['shade', 'wisp', 'shade'], 5: ['wraith'] };
  if (fixed[n]) return fixed[n];
  if (n % 5 === 0) return ['wisp', 'wraith', 'wisp'];
  const list = [];
  let budget = 2 + n * 1.1;
  while (budget > 0.9 && list.length < 5) {
    const k = budget >= 2.2 && chance(0.6) ? 'shade' : 'wisp';
    list.push(k);
    budget -= k === 'shade' ? 2.2 : 1;
  }
  return list;
}
const STAGE_NAMES = ['Graveyard of Second Chances', 'The Leaning Crypts', 'Moonlit Ossuary', 'Hollow Hill', 'The Landlord\'s Plot'];

Scenes.battle = (() => {
  const S = {};
  const GROUND = 214;
  const fx = new Particles();
  const debris = new Particles();
  let t = 0, units = [], phase = 'ready', result = null, zapCd = 0, menuSel = 0, logLines = [], resultT = 0;
  let coinsShown = 0, reward = 0, restocked = [], bolts = [], fightStage = 1;
  let later = []; // delayed combat actions (the tail's second strike), on battle time so they work headless too
  const say = (x, h) => Game.talk.say(x, h);
  const allies = () => units.filter((u) => u.team === 'ally');
  const enemies = () => units.filter((u) => u.team === 'enemy');
  const alive = (arr) => arr.filter((u) => !u.dead);
  const log = (s) => { logLines.push(s); if (logLines.length > 2) logLines.shift(); };

  function makeAlly(c, i) {
    return {
      team: 'ally', c, name: c.name.split(' ')[0], x: 120 - i * 38, y: GROUND + [0, 11, -11][i],
      hp: c.hp, maxHp: c.maxHp, atk: c.atk, def: c.def, atkTime: c.atkTime, speed: c.moveSpeed, range: c.range,
      dodge: c.dodge, crit: c.crit, traits: c.traits, cd: rand(0.1, 0.5), state: 'idle', animT: 0, flashT: 0, kx: 0,
      stunT: 0, bleedT: 0, burnT: 0, hasteT: 0, hits: 0, revived: false, dead: false, bob: vrand(0, 6),
    };
  }
  function makeEnemy(kind, i, n) {
    const K = ENEMY_KINDS[kind];
    const m = 1 + 0.2 * (Game.stage - 1);
    const hp = Math.round(K.hp * m * CONFIG.enemyHp);
    return {
      team: 'enemy', kind, K, name: K.name, x: 350 + i * 36 + (K.boss ? 20 : 0), y: GROUND + [0, 11, -11, 5, -5][i % 5],
      hp, maxHp: hp, atk: K.atk * m * CONFIG.enemyAtk, def: 0, atkTime: K.atkTime, speed: K.speed, range: K.range,
      dodge: K.dodge, crit: 0.05, traits: [], cd: rand(0.3, 0.9), state: 'idle', animT: 0, flashT: 0, kx: 0,
      stunT: 0, bleedT: 0, burnT: 0, hasteT: 0, hits: 0, dead: false, bob: vrand(0, 6),
    };
  }

  S.enter = function () {
    t = 0; phase = 'ready'; result = null; zapCd = 0; menuSel = 0; logLines = []; resultT = 0; bolts = []; fightStage = Game.stage; later = [];
    fx.list = []; debris.list = [];
    units = [];
    Game.party.filter((c) => c.hp > 0).slice(0, 3).forEach((c, i) => units.push(makeAlly(c, i)));
    const kinds = stageEnemies(Game.stage);
    kinds.forEach((k, i) => units.push(makeEnemy(k, i, kinds.length)));
    Music.play('battle');
    const boss = kinds.includes('wraith');
    say(Game.stage === 1 ? 'Your creations fight for you. Give them better parts.' :
      boss ? 'That\'s a Wraith. It owes me money. Bring friends. Three of them, ideally.' :
      vpick(['Stage ' + Game.stage + '. The shades are getting braver.', 'Back again? The graveyard remembers you.', 'Chin up, bones out.']), 3.8);
    Telemetry.c.battles++;
    Telemetry.log('battle', { stage: Game.stage, party: units.filter((u) => u.team === 'ally').length, enemies: kinds.join(',') });
  };
  S.exit = function () {};

  function start() {
    if (phase !== 'ready') return;
    phase = 'fight';
    Sfx.play('swing');
    Engine.shake(2, 0.2);
    log('The shades drift closer...');
  }

  function zap() {
    if (phase !== 'fight' || zapCd > 0) return Sfx.play('ui_deny');
    zapCd = CONFIG.zapCooldown;
    Telemetry.c.zaps++;
    Sfx.play('thunder');
    Engine.flash('#c2f5ff', 0.2);
    Engine.shake(3, 0.3);
    bolts = alive(allies()).map((u) => ({ x: u.x, y: u.y, t: 0, seed: vrandInt(1, 999) }));
    for (const u of alive(allies())) {
      const heal = Math.round(u.maxHp * 0.3);
      u.hp = Math.min(u.maxHp, u.hp + heal);
      u.hasteT = 4;
      fx.text(u.x, u.y - 60, '+' + heal, '#9be38f', { font: 'main' });
      fx.burst(u.x, u.y - 30, 14, { speed: 60, life: 0.5, color: ['#c2f5ff', '#9be38f', '#fff'] });
    }
    log('ZAP! Your creations surge with borrowed life.');
  }

  function retreat() {
    if (phase !== 'fight' && phase !== 'ready') return;
    Telemetry.c.retreats++;
    finish('retreat');
  }

  function nearestFoe(u) {
    let best = null, bd = 1e9;
    for (const o of units) {
      if (o.dead || o.team === u.team) continue;
      const d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y) * 1.2; // prefer the foe in your own lane
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function royalBonus() { return alive(allies()).some((u) => u.traits.includes('royal')) ? 1.25 : 1; }

  function dealHit(att, def, opts = {}) {
    if (def.dead) return;
    const isAlly = att.team === 'ally';
    if (chance(def.dodge)) {
      fx.text(def.x, def.y - bodyH(def) - 6, 'MISS', '#a6aec2');
      Sfx.play('swing', { pitch: 1.3 });
      return;
    }
    let dmg = att.atk * rand(0.85, 1.15) * (opts.mult || 1);
    if (isAlly) dmg *= CONFIG.allyAtk * royalBonus();
    const crit = chance(att.crit);
    if (crit) dmg *= 2;
    dmg = Math.max(1, dmg - (def.def || 0));
    if (def.traits && def.traits.includes('hefty')) dmg *= 0.8;
    dmg = Math.round(dmg);
    def.hp -= dmg;
    def.flashT = 0.12;
    def.kx = (def.x > att.x ? 1 : -1) * (crit ? 120 : 60);
    const col = crit ? PAL.L : isAlly ? '#fff6e3' : PAL.r;
    fx.text(def.x + vrand(-4, 4), def.y - bodyH(def) - 4, crit ? dmg + '!' : String(dmg), col, { font: crit ? 'main' : 'small', scale: crit ? 2 : 1 });
    if (def.team === 'enemy') fx.burst(def.x, def.y - bodyH(def) / 2, crit ? 12 : 6, { speed: 60, ay: -20, drag: 2, life: 0.5, color: ['#1b1526', '#33274a', '#5b4a78'], sizes: [1, 2] });
    else fx.burst(def.x, def.y - bodyH(def) / 2, crit ? 10 : 5, { speed: 70, ay: 200, life: 0.5, color: ['#fff6e3', '#cdb892', '#e8405a'], floor: def.y });
    Sfx.play(def.team === 'enemy' ? 'enemy_hit' : 'hit', { crit, intensity: crit ? 1 : 0.7 });
    if (crit) { Engine.hitPause(0.05); Engine.shake(2.5, 0.15); if (vchance(0.5)) log(`${att.name} crits for ${dmg}!`); }
    // traits
    if (isAlly) {
      if (att.traits.includes('bite')) { const h = Math.round(dmg * 0.3); att.hp = Math.min(att.maxHp, att.hp + h); if (h) fx.text(att.x, att.y - bodyH(att) - 10, '+' + h, '#9be38f'); }
      if (att.traits.includes('rend')) def.bleedT = 3;
      if (att.traits.includes('smash') && chance(0.3)) { def.stunT = 1; fx.text(def.x, def.y - bodyH(def) - 16, 'STUN', PAL.L); Engine.shake(3, 0.2); }
      if (opts.fire) def.burnT = 3;
    }
    if (def.hp <= 0) kill(def, att);
  }

  function kill(u, by) {
    if (u.team === 'ally' && u.traits.includes('undying') && !u.revived) {
      u.revived = true;
      u.hp = Math.round(u.maxHp * 0.4);
      fx.text(u.x, u.y - 70, 'UNDYING!', '#b56bd6', { font: 'main', life: 1.4 });
      fx.burst(u.x, u.y - 30, 24, { speed: 80, life: 0.8, color: ['#b56bd6', '#e7a6f0', '#0e0b16'] });
      Sfx.play('alive');
      log(`${u.name} refuses to stay dead.`);
      return;
    }
    u.dead = true;
    u.hp = 0;
    if (u.team === 'enemy') {
      Sfx.play('enemy_die');
      Engine.shake(u.K.boss ? 6 : 2, 0.3);
      if (u.K.boss) { Engine.hitPause(0.15); Engine.flash('#ff4040', 0.2); }
      for (let i = 0; i < 24 + (u.K.boss ? 40 : 0); i++) fx.add({ x: u.x + vrand(-10, 10), y: u.y - vrand(0, bodyH(u)), vx: vrand(-20, 20), vy: vrand(-50, -10), drag: 1.5, life: vrand(0.6, 1.3), color: vpick(['#0e0b16', '#1b1526', '#33274a', '#ff4040']), size: vpick([1, 2, 2, 3]) });
      if (by && by.traits.includes('golden')) { Game.tokens++; fx.text(u.x, u.y - 30, '+1 TOKEN', PAL.L, { font: 'main' }); }
      if (by) log(`${by.name} dispatched a ${u.name}.`);
      if (by && by.c) by.c.kills++;
    } else {
      Sfx.play('creature_die');
      Engine.shake(4, 0.35);
      Engine.hitPause(0.1);
      // dismember: every part flies off with a bit of physics
      const L = rigLayout(u.c.slots);
      const at = { head: L.neck, torso: [0, L.ty], armL: L.shL, armR: L.shR, legL: L.hipL, legR: L.hipR, heart: L.heart, back: L.back };
      for (const [slot, type] of Object.entries(u.c.slots)) {
        if (!type) continue;
        const d = PART_DEFS[type];
        const p = at[slot] || [0, -20];
        debris.add({ kind: 'spr', spr: d.chain ? 'p_vert' : d.sprite, x: u.x + p[0], y: u.y + p[1], vx: vrand(-90, 90), vy: vrand(-170, -80), ay: 520, vr: vrand(-10, 10), life: 3.2, floor: u.y + vrand(-2, 3), bounce: 0.4, fade: true });
      }
      fx.burst(u.x, u.y - 30, 16, { speed: 90, ay: 300, life: 0.8, color: ['#fff6e3', '#cdb892', '#e8405a'], floor: u.y });
      log(`${u.name} fell apart. Literally.`);
      say(vpick(['I\'ll put those back in the machine.', 'Back to the pile with you.', 'Nothing\'s wasted here.']), 2.2);
    }
  }

  function bodyH(u) {
    if (u.team === 'ally') return -rigLayout(u.c.slots).top;
    return { wisp: 26, shade: 32, wraith: 48 }[u.kind];
  }

  function finish(kind) {
    if (result) return;
    phase = 'done';
    resultT = 0;
    const deadAllies = allies().filter((u) => u.dead);
    const survivors = allies().filter((u) => !u.dead);
    // write back to the party
    for (const u of allies()) u.c.hp = u.dead ? 0 : Math.max(1, Math.ceil(u.hp));
    const deadParts = deadAllies.flatMap((u) => u.c.parts());
    Game.party = Game.party.filter((c) => c.hp > 0);
    reward = 0;
    restocked = [];
    if (kind === 'win') {
      reward = CONFIG.winTokens + Game.stage;
      if (survivors.some((u) => u.traits.includes('golden'))) reward += 1;
      const boost = 1 + Game.stage * 0.2;
      for (let i = 0; i < CONFIG.restockParts; i++) restocked.push(randomPartType({ boost }));
      for (const c of Game.party) c.hp = c.maxHp; // the Reaper patches them up
      Telemetry.c.victories++;
      Telemetry.c.bestStage = Math.max(Telemetry.c.bestStage, Game.stage);
      Game.bestStage = Math.max(Game.bestStage, Game.stage);
      Game.stage++;
      Sfx.play('victory');
      Music.duck(0.8, 2.5);
      say(vpick(['The graveyard provides.', 'Look at them. My little war crimes.', 'Victory! Mostly intact, even.']), 3);
    } else if (kind === 'lose') {
      reward = 1;
      Telemetry.c.defeats++;
      Sfx.play('defeat');
      say('Back to the pile they go. Nothing\'s wasted here. Give them better parts.', 4);
    } else {
      for (const c of Game.party) c.hp = Math.max(1, c.hp);
      say('Retreat! Live to rot another day.', 2.5);
    }
    Game.tokens += reward;
    coinsShown = 0;
    Game.restock([...restocked, ...deadParts]);
    result = { kind, reward, restocked, deadParts, lost: deadAllies.map((u) => u.name) };
    Telemetry.log('battleEnd', { kind, stage: Game.stage, reward, lost: deadAllies.length });
  }

  S.cheatWin = function () { for (const e of alive(enemies())) kill(e, null); };

  S.update = function (dt, realDt) {
    t += dt;
    Game.talk.update(dt);
    fx.update(dt); debris.update(dt);
    for (const b of bolts) b.t += dt;
    bolts = bolts.filter((b) => b.t < 0.35);
    const bdt = dt * CONFIG.battleSpeed;
    if (phase === 'fight') {
      zapCd = Math.max(0, zapCd - bdt);
      for (const a of later) a.t -= bdt;
      later = later.filter((a) => { if (a.t > 0) return true; a.fn(); return false; });
      for (const u of units) {
        if (u.dead) continue;
        u.flashT = Math.max(0, u.flashT - dt);
        u.x += u.kx * bdt; u.kx *= Math.exp(-10 * bdt);
        u.x = clamp(u.x, 20, 460);
        // status effects
        if (u.bleedT > 0) { u.bleedT -= bdt; u.hp -= 2 * bdt; if (vchance(bdt * 4)) fx.add({ x: u.x + vrand(-4, 4), y: u.y - bodyH(u) / 2, vy: 30, ay: 100, life: 0.4, color: '#e8405a' }); }
        if (u.burnT > 0) { u.burnT -= bdt; u.hp -= 3 * bdt; if (vchance(bdt * 10)) fx.add({ x: u.x + vrand(-6, 6), y: u.y - vrand(4, bodyH(u)), vy: -30, life: 0.4, color: vpick([PAL.A, PAL.L, PAL.R]) }); }
        if (u.team === 'ally' && (u.traits.includes('regen') || u.traits.includes('golden'))) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * (u.traits.includes('golden') ? 0.03 : 0.02) * bdt);
        if (u.hp <= 0) { kill(u, null); continue; }
        if (u.stunT > 0) { u.stunT -= bdt; u.state = 'idle'; continue; }
        u.hasteT = Math.max(0, u.hasteT - bdt);
        const haste = u.hasteT > 0 ? 1.5 : 1;
        u.cd -= bdt * haste;
        const f = nearestFoe(u);
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
              fx.add({ kind: 'proj', x: u.x + dir * 10, y: u.y - bodyH(u) + 8, vx: dir * 160, life: 1.2, color: PAL.A, target: f, from: u });
              Sfx.play('zap', { intensity: 0.5, pitch: 0.7 });
            } else if (dist <= u.range + 8) {
              dealHit(u, f);
              if (u.traits.includes('whip') && chance(0.25)) later.push({ t: 0.18, fn: () => { if (!f.dead && !u.dead) dealHit(u, f, { mult: 0.6 }); } });
            } else Sfx.play('swing');
          }
          if (u.animT >= 1) { u.state = 'idle'; u.animT = 0; }
        } else if (dist > u.range) {
          u.state = 'walk';
          u.x += dir * u.speed * bdt * haste;
        } else {
          u.state = 'idle';
          if (u.cd <= 0) { u.state = 'attack'; u.animT = 0; u.cd = u.atkTime; if (u.team === 'enemy' || vchance(0.5)) Sfx.play('swing', { intensity: 0.4 }); }
        }
      }
      // keep teammates from stacking
      for (const team of ['ally', 'enemy']) {
        const list = alive(units.filter((u) => u.team === team)).sort((a, b) => a.x - b.x);
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1], b = list[i];
          const gap = Math.abs(a.y - b.y) < 6 ? 26 : 12; // same lane: don't overlap; different lanes: depth is enough
          if (b.x - a.x < gap) { const push = (gap - (b.x - a.x)) / 2; a.x -= push * 0.6; b.x += push * 0.6; }
        }
      }
      // projectiles (hellfire)
      for (const p of fx.list) {
        if (p.kind !== 'proj' || p.done) continue;
        if (vchance(0.6)) fx.add({ x: p.x, y: p.y + vrand(-2, 2), vx: -p.vx * 0.05, vy: vrand(-10, 10), life: 0.25, color: vpick([PAL.A, PAL.L, PAL.R]) });
        if (p.target.dead) { p.life = 0; continue; }
        if (Math.abs(p.x - p.target.x) < 8) { p.done = true; p.life = 0; dealHit(p.from, p.target, { mult: 1.6, fire: true }); fx.burst(p.x, p.y, 10, { speed: 50, life: 0.4, color: [PAL.A, PAL.L] }); }
      }
      if (!alive(enemies()).length) finish('win');
      else if (!alive(allies()).length) finish('lose');
    }
    if (phase === 'done') {
      resultT += realDt;
      if (coinsShown < result.reward && resultT > 0.8 + coinsShown * 0.18) { coinsShown++; Sfx.play('coins_count'); }
    }
    // input
    const items = menuItems();
    if (Input.hit('up')) { menuSel = (menuSel + items.length - 1) % items.length; Sfx.play('ui_hover'); }
    if (Input.hit('down')) { menuSel = (menuSel + 1) % items.length; Sfx.play('ui_hover'); }
    menuSel = clamp(menuSel, 0, items.length - 1);
    if (Input.hit('a')) { const it = items[menuSel]; if (it && !it.disabled) it.act(); else Sfx.play('ui_deny'); }
    if (Input.hit('b') && phase === 'done') Engine.go('shop');
    UI.set(items.map((it, i) => ({ id: 'bm' + i, x: 12, y: 212 + i * 16, w: 94, h: 15, label: it.label, disabled: it.disabled, kind: 'menu', idx: i, silent: false,
      onClick: () => { menuSel = i; it.act(); } })));
  };

  function menuItems() {
    if (phase === 'done') {
      const canGo = Game.canFight() && result.kind === 'win';
      return [
        { label: 'BACK TO SHOP', act: () => Engine.go('shop') },
        { label: 'FIGHT ON', disabled: !canGo, act: () => Engine.go('battle') },
      ];
    }
    return [
      phase === 'ready' ? { label: 'FIGHT', act: start } : { label: zapCd > 0 ? `ZAP  ${Math.ceil(zapCd)}s` : 'ZAP', disabled: zapCd > 0, act: zap },
      { label: 'ABILITIES', disabled: true, act: () => { say('Abilities come from parts. Try a Demon Skull. Or a Black Heart.', 3); } },
      { label: 'RETREAT', act: retreat },
    ];
  }

  // ------------------------------------------------------------------ draw
  function drawEnemy(ctx, u) {
    const hover = Math.sin(t * 3 + u.bob) * 2 - u.K.hover;
    const atk = u.state === 'attack' && u.animT > 0.25 && u.animT < 0.75;
    const base = u.K.spr;
    const name = atk && SPR.has(base + '_atk') ? base + '_atk' : base + '_' + (Math.floor(t * 4 + u.bob) % 2);
    const lunge = u.state === 'attack' ? Math.sin(u.animT * Math.PI) * -6 : 0;
    if (SPR.has(name)) SPR.draw(ctx, name, u.x + lunge, u.y + hover, { solid: u.flashT > 0 ? '#fff6e3' : undefined });
    else { ctx.fillStyle = u.flashT > 0 ? '#fff' : '#1b1526'; ctx.fillRect(u.x - 8, u.y + hover - bodyH(u), 16, bodyH(u)); ctx.fillStyle = '#ff4040'; ctx.fillRect(u.x - 4, u.y + hover - bodyH(u) + 6, 2, 2); }
    if (u.stunT > 0) for (let i = 0; i < 3; i++) { const a = t * 6 + i * 2.1; ctx.fillStyle = PAL.L; ctx.fillRect(Math.round(u.x + Math.cos(a) * 8), Math.round(u.y - bodyH(u) - 4 + Math.sin(a) * 2), 1, 1); }
  }

  function drawBar(ctx, u) {
    const w = u.K && u.K.boss ? 40 : 24;
    const x = Math.round(u.x - w / 2), y = Math.round(u.y - bodyH(u) - 10);
    const k = clamp(u.hp / u.maxHp, 0, 1);
    Draw.rect(ctx, x - 1, y - 1, w + 2, 4, PAL.k);
    Draw.rect(ctx, x, y, w, 2, '#33274a');
    Draw.rect(ctx, x, y, Math.round(w * k), 2, u.team === 'ally' ? (k > 0.35 ? '#5fd3a0' : PAL.L) : '#e8405a');
    Draw.rect(ctx, x, y, Math.round(w * k), 1, u.team === 'ally' ? '#9bf5c8' : '#ff7d8a');
  }

  S.draw = function (ctx) {
    BG.graveyard(ctx, t);
    // shadows
    for (const u of units) {
      if (u.dead) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const w = u.team === 'ally' ? 16 : u.K.w * 0.7;
      ctx.fillRect(Math.round(u.x - w / 2), u.y, Math.round(w), 2);
    }
    debris.draw(ctx);
    const order = units.filter((u) => !u.dead).sort((a, b) => a.y - b.y);
    for (const u of order) {
      if (u.team === 'ally') {
        drawCreature(ctx, u.c.slots, u.x, u.y, { t: t + u.bob, anim: phase === 'fight' ? u.state : 'idle', animT: u.animT, flash: u.flashT > 0, eyes: u.hasteT > 0 ? '#c2f5ff' : '#9be38f', lookX: 1 });
        if (u.hasteT > 0 && vchance(0.3)) fx.add({ x: u.x - 10, y: u.y - vrand(5, 40), vx: -60, life: 0.2, color: '#c2f5ff' });
      } else drawEnemy(ctx, u);
    }
    for (const u of order) if (phase !== 'done' || u.team === 'ally') drawBar(ctx, u);
    for (const b of bolts) Draw.bolt(ctx, b.x + vrand(-20, 20), 0, b.x, b.y - 30, '#e7f7ff', 9, b.seed + Math.floor(b.t * 30));
    fx.draw(ctx);
    // projectiles
    for (const p of fx.list) if (p.kind === 'proj') { Draw.glow(ctx, p.x, p.y, 10, '#ffb070', 0.5); Draw.rect(ctx, p.x - 2, p.y - 2, 4, 4, PAL.L); Draw.rect(ctx, p.x - 1, p.y - 1, 2, 2, '#fff'); }

    // HUD: stage title
    Font.draw(ctx, STAGE_NAMES[Math.floor((fightStage - 1) / 5) % STAGE_NAMES.length], 472, 7, { align: 'right', color: '#cdb892', shadow: PAL.k });
    Font.draw(ctx, 'Stage ' + fightStage + (fightStage % 5 === 0 ? '  ·  BOSS' : ''), 472, 18, { align: 'right', color: '#a6aec2', shadow: PAL.k });
    if (SPR.has('ico_token')) SPR.draw(ctx, 'ico_token', 12, 12);
    Font.draw(ctx, String(Game.tokens), 20, 8, { color: PAL.L, shadow: PAL.k });

    // menu
    Draw.panel(ctx, 8, 206, 102, 58, 'slate');
    menuItems().forEach((it, i) => {
      const y = 212 + i * 16;
      const hot = UI.buttons[i] && UI.buttons[i].hover;
      if (hot || i === menuSel) { if (i === menuSel) Font.draw(ctx, '▶', 15, y + 3, { color: '#fff6e3' }); }
      Font.draw(ctx, it.label, 25, y + 3, { color: it.disabled ? '#4b4466' : hot || i === menuSel ? '#fff6e3' : '#cdb892' });
    });
    // narration box
    Draw.panel(ctx, 116, 222, 356, 42, 'slate');
    if (phase === 'done') drawResult(ctx);
    else if (Game.talk.visible()) Font.drawWrapped(ctx, Game.talk.text, 126, 229, 336, { color: '#ecdcbc', maxChars: Math.floor(Game.talk.shown) });
    else logLines.forEach((l, i) => Font.draw(ctx, l, 126, 229 + i * 12, { color: i === logLines.length - 1 ? '#ecdcbc' : '#7a6a9a' }));
    if (phase === 'ready' && Math.sin(t * 5) > 0) Draw.frame(ctx, 10, 210, 98, 17, '#ff8ac6');
  };

  function drawResult(ctx) {
    const r = result;
    const title = r.kind === 'win' ? 'STAGE CLEARED!' : r.kind === 'lose' ? 'DEFEATED' : 'RETREATED';
    const col = r.kind === 'win' ? '#9be38f' : r.kind === 'lose' ? '#e8405a' : '#cdb892';
    const k = clamp(resultT / 0.3, 0, 1);
    Font.draw(ctx, title, 240, 70 - Math.round((1 - easeOutBack(k)) * 20), { scale: 3, color: col, outline: PAL.k, shadow: '#0e0b16', align: 'center', alpha: k });
    if (r.lost.length) Font.draw(ctx, 'Lost: ' + r.lost.join(', '), 240, 100, { align: 'center', color: '#a6aec2', outline: PAL.k });
    // narration: rewards
    let x = 126;
    if (r.reward) {
      if (SPR.has('ico_token')) for (let i = 0; i < coinsShown; i++) SPR.draw(ctx, 'ico_token', x + 4 + i * 10, 234);
      Font.draw(ctx, `+${coinsShown} tokens`, x + 8 + r.reward * 10, 230, { color: PAL.L });
    }
    const back = r.restocked.length + r.deadParts.length;
    if (back) Font.draw(ctx, `${back} part${back > 1 ? 's' : ''} dropped into the claw machine`, 126, 247, { color: '#7a6a9a' });
    if (!r.reward && !back) Font.draw(ctx, 'No reward. No shame. Well, some shame.', 126, 234, { color: '#7a6a9a' });
  }

  return S;
})();
