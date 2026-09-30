// ---------------------------------------------------------------------------
// BATTLE SCENE — "Graveyard of Second Chances". Your creations auto-fight the
// shades; you get one lever (ZAP: heal + haste) and the choice to retreat.
// Winning pays tokens and restocks the machine; the dead go back in the pile.
//
// This file only shows the fight. The rules are in 13_battlesim.js (combat) and
// Game.applyBattle (what a result is worth); the scene turns their events into
// particles, sound, shake and words.
// ---------------------------------------------------------------------------
Scenes.battle = (() => {
  const S = {};
  const fx = new Particles();
  const debris = new Particles();
  let sim = null;
  let t = 0, phase = 'ready', result = null, menuSel = 0, logLines = [], resultT = 0;
  let coinsShown = 0, bolts = [], fightStage = 1;
  const say = (x, h) => Game.talk.say(x, h);
  const log = (s) => { logLines.push(s); if (logLines.length > 2) logLines.shift(); };
  const bodyH = (u) => (u.team === 'ally' ? -rigLayout(u.c.slots).top : { wisp: 26, shade: 32, wraith: 48 }[u.kind]);

  S.enter = function () {
    t = 0; phase = 'ready'; result = null; menuSel = 0; logLines = []; resultT = 0; bolts = []; fightStage = Game.stage;
    fx.list = []; debris.list = [];
    sim = new BattleSim({ party: Game.party, stage: Game.stage, onEvent: onSim });
    for (const u of sim.units) { u.bob = vrand(0, 6); u.flashT = 0; }
    Music.play('battle');
    const boss = sim.kinds.includes('wraith');
    say(Game.stage === 1 ? 'Your creations fight for you. Give them better parts.' :
      boss ? 'That\'s a Wraith. It owes me money. Bring friends. Three of them, ideally.' :
      vpick(['Stage ' + Game.stage + '. The shades are getting braver.', 'Back again? The graveyard remembers you.', 'Chin up, bones out.']), 3.8);
    Telemetry.c.battles++;
    Telemetry.log('battle', { stage: Game.stage, party: sim.units.filter((u) => u.team === 'ally').length, enemies: sim.kinds.join(',') });
  };
  S.exit = function () {};

  function start() {
    if (phase !== 'ready') return;
    phase = 'fight';
    sim.start();
    Sfx.play('swing');
    Engine.shake(2, 0.2);
    log('The shades drift closer...');
  }

  function zap() {
    if (phase !== 'fight' || !sim.zap()) return Sfx.play('ui_deny');
    Telemetry.c.zaps++;
    log('ZAP! Your creations surge with borrowed life.');
  }

  function retreat() {
    if (phase !== 'fight' && phase !== 'ready') return;
    Telemetry.c.retreats++;
    sim.stop();
    finish('retreat');
  }

  // ------------------------------------------------------- sim events -> juice
  function onSim(type, d) {
    switch (type) {
      case 'attackStart': if (d.u.team === 'enemy' || vchance(0.5)) Sfx.play('swing', { intensity: 0.4 }); break;
      case 'whiff': Sfx.play('swing'); break;
      case 'miss':
        fx.text(d.def.x, d.def.y - bodyH(d.def) - 6, 'MISS', '#a6aec2');
        Sfx.play('swing', { pitch: 1.3 });
        break;
      case 'hit': {
        const { att, def, dmg, crit } = d;
        def.flashT = 0.12;
        const col = crit ? PAL.L : att.team === 'ally' ? '#fff6e3' : PAL.r;
        fx.text(def.x + vrand(-4, 4), def.y - bodyH(def) - 4, crit ? dmg + '!' : String(dmg), col, { font: crit ? 'main' : 'small', scale: crit ? 2 : 1 });
        if (def.team === 'enemy') fx.burst(def.x, def.y - bodyH(def) / 2, crit ? 12 : 6, { speed: 60, ay: -20, drag: 2, life: 0.5, color: ['#1b1526', '#33274a', '#5b4a78'], sizes: [1, 2] });
        else fx.burst(def.x, def.y - bodyH(def) / 2, crit ? 10 : 5, { speed: 70, ay: 200, life: 0.5, color: ['#fff6e3', '#cdb892', '#e8405a'], floor: def.y });
        Sfx.play(def.team === 'enemy' ? 'enemy_hit' : 'hit', { crit, intensity: crit ? 1 : 0.7 });
        if (crit) { Engine.hitPause(0.05); Engine.shake(2.5, 0.15); if (vchance(0.5)) log(`${att.name} crits for ${dmg}!`); }
        break;
      }
      case 'heal': fx.text(d.u.x, d.u.y - bodyH(d.u) - 10, '+' + d.amount, '#9be38f'); break;
      case 'stun': fx.text(d.u.x, d.u.y - bodyH(d.u) - 16, 'STUN', PAL.L); Engine.shake(3, 0.2); break;
      case 'fireball':
        d.p.y = d.u.y - bodyH(d.u) + 8;
        Sfx.play('zap', { intensity: 0.5, pitch: 0.7 });
        break;
      case 'fireHit': fx.burst(d.p.x, d.p.y, 10, { speed: 50, life: 0.4, color: [PAL.A, PAL.L] }); break;
      case 'undying': {
        const u = d.u;
        fx.text(u.x, u.y - 70, 'UNDYING!', '#b56bd6', { font: 'main', life: 1.4 });
        fx.burst(u.x, u.y - 30, 24, { speed: 80, life: 0.8, color: ['#b56bd6', '#e7a6f0', '#0e0b16'] });
        Sfx.play('alive');
        log(`${u.name} refuses to stay dead.`);
        break;
      }
      case 'zap': {
        Sfx.play('thunder');
        Engine.flash('#c2f5ff', 0.2);
        Engine.shake(3, 0.3);
        bolts = d.healed.map(({ u }) => ({ x: u.x, y: u.y, t: 0, seed: vrandInt(1, 999) }));
        for (const { u, amount } of d.healed) {
          fx.text(u.x, u.y - 60, '+' + amount, '#9be38f', { font: 'main' });
          fx.burst(u.x, u.y - 30, 14, { speed: 60, life: 0.5, color: ['#c2f5ff', '#9be38f', '#fff'] });
        }
        break;
      }
      case 'kill': onKill(d.u, d.by); break;
    }
  }

  function onKill(u, by) {
    if (u.team === 'enemy') {
      Sfx.play('enemy_die');
      Engine.shake(u.K.boss ? 6 : 2, 0.3);
      if (u.K.boss) { Engine.hitPause(0.15); Engine.flash('#ff4040', 0.2); }
      for (let i = 0; i < 24 + (u.K.boss ? 40 : 0); i++) fx.add({ x: u.x + vrand(-10, 10), y: u.y - vrand(0, bodyH(u)), vx: vrand(-20, 20), vy: vrand(-50, -10), drag: 1.5, life: vrand(0.6, 1.3), color: vpick(['#0e0b16', '#1b1526', '#33274a', '#ff4040']), size: vpick([1, 2, 2, 3]) });
      if (by && by.traits.includes('golden')) fx.text(u.x, u.y - 30, '+1 TOKEN', PAL.L, { font: 'main' });
      if (by) log(`${by.name} dispatched a ${u.name}.`);
    } else {
      Sfx.play('creature_die');
      Engine.shake(4, 0.35);
      Engine.hitPause(0.1);
      // dismember: every part flies off with a bit of physics
      const L = rigLayout(u.c.slots);
      const at = { head: L.neck, torso: [0, L.ty], armL: L.shL, armR: L.shR, legL: L.hipL, legR: L.hipR, heart: L.heart, back: L.back };
      for (const [slot, type] of Object.entries(u.c.slots)) {
        if (!type) continue;
        const pd = PART_DEFS[type];
        const p = at[slot] || [0, -20];
        debris.add({ kind: 'spr', spr: pd.chain ? 'p_vert' : pd.sprite, x: u.x + p[0], y: u.y + p[1], vx: vrand(-90, 90), vy: vrand(-170, -80), ay: 520, vr: vrand(-10, 10), life: 3.2, floor: u.y + vrand(-2, 3), bounce: 0.4, fade: true });
      }
      fx.burst(u.x, u.y - 30, 16, { speed: 90, ay: 300, life: 0.8, color: ['#fff6e3', '#cdb892', '#e8405a'], floor: u.y });
      log(`${u.name} fell apart. Literally.`);
      say(vpick(['I\'ll put those back in the machine.', 'Back to the pile with you.', 'Nothing\'s wasted here.']), 2.2);
    }
  }

  function finish(kind) {
    if (result) return;
    phase = 'done';
    resultT = 0;
    result = Game.applyBattle(sim, kind);
    coinsShown = 0;
    if (kind === 'win') {
      Sfx.play('victory');
      Music.duck(0.8, 2.5);
      say(vpick(['The graveyard provides.', 'Look at them. My little war crimes.', 'Victory! Mostly intact, even.']), 3);
    } else if (kind === 'lose') {
      Sfx.play('defeat');
      say('Back to the pile they go. Nothing\'s wasted here. Give them better parts.', 4);
    } else say('Retreat! Live to rot another day.', 2.5);
    Telemetry.log('battleEnd', { kind, stage: Game.stage, reward: result.reward, lost: result.lost.length });
  }

  S.cheatWin = function () { sim && sim.killEnemies(); };

  S.update = function (dt, realDt) {
    t += dt;
    Game.talk.update(dt);
    fx.update(dt); debris.update(dt);
    for (const b of bolts) b.t += dt;
    bolts = bolts.filter((b) => b.t < 0.35);
    if (phase === 'fight') {
      sim.step(dt);
      const bdt = dt * CONFIG.battleSpeed;
      for (const u of sim.units) {
        if (u.dead) continue;
        u.flashT = Math.max(0, u.flashT - dt);
        if (u.bleedT > 0 && vchance(bdt * 4)) fx.add({ x: u.x + vrand(-4, 4), y: u.y - bodyH(u) / 2, vy: 30, ay: 100, life: 0.4, color: '#e8405a' });
        if (u.burnT > 0 && vchance(bdt * 10)) fx.add({ x: u.x + vrand(-6, 6), y: u.y - vrand(4, bodyH(u)), vy: -30, life: 0.4, color: vpick([PAL.A, PAL.L, PAL.R]) });
      }
      for (const p of sim.projectiles) if (!p.done && vchance(0.6)) fx.add({ x: p.x, y: p.y + vrand(-2, 2), vx: -p.vx * 0.05, vy: vrand(-10, 10), life: 0.25, color: vpick([PAL.A, PAL.L, PAL.R]) });
      if (sim.over && !result) finish(sim.won ? 'win' : 'lose');
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
    const cd = sim.zapCd;
    return [
      phase === 'ready' ? { label: 'FIGHT', act: start } : { label: cd > 0 ? `ZAP  ${Math.ceil(cd)}s` : 'ZAP', disabled: cd > 0, act: zap },
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
    for (const u of sim.units) {
      if (u.dead) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const w = u.team === 'ally' ? 16 : u.K.w * 0.7;
      ctx.fillRect(Math.round(u.x - w / 2), u.y, Math.round(w), 2);
    }
    debris.draw(ctx);
    const order = sim.units.filter((u) => !u.dead).sort((a, b) => a.y - b.y);
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
    for (const p of sim.projectiles) { Draw.glow(ctx, p.x, p.y, 10, '#ffb070', 0.5); Draw.rect(ctx, p.x - 2, p.y - 2, 4, 4, PAL.L); Draw.rect(ctx, p.x - 1, p.y - 1, 2, 2, '#fff'); }

    // HUD: stage title
    Font.draw(ctx, stageName(fightStage), 472, 7, { align: 'right', color: '#cdb892', shadow: PAL.k });
    Font.draw(ctx, 'Stage ' + fightStage + (fightStage % 5 === 0 ? '  ·  BOSS' : ''), 472, 18, { align: 'right', color: '#a6aec2', shadow: PAL.k });
    if (SPR.has('ico_token')) SPR.draw(ctx, 'ico_token', 12, 12);
    Font.draw(ctx, String(Game.tokens + (phase === 'fight' ? sim.goldKills : 0)), 20, 8, { color: PAL.L, shadow: PAL.k });

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
