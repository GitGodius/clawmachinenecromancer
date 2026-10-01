// ---------------------------------------------------------------------------
// CLAW SCENE — the core loop. The machine interior is rendered into a 240x135
// buffer (the physics world is 180x122 art px) and scaled 2x: a chunky close-up.
// UI text is drawn crisp at 1x on top.
// ---------------------------------------------------------------------------
Scenes.claw = (() => {
  const GX = 7, GY = 7, BW = 240, BH = 135;
  const M = MACHINE;
  let buf, g, glassBG, frameImg;
  const fxW = new Particles(); // world space (in the buffer, 2x on screen)
  const fxS = new Particles(); // screen space (1x)
  let t = 0, winFx = 0, bagBump = 0, tokenBump = 0, noTokenT = 0, idleT = 0, movedOnce = false, chuteWarnT = 0, missShown = false, riskV = 0, hot = false, lastLoss = null;
  let flying = [];
  let slowmoDone = new Set();
  let lastBumpSfx = 0;
  let neonOff = 0;
  let turnWins = 0;
  const btn = {};
  const ACTION_LABEL = { close: 'GRABBING', lift: 'LIFTING', return: 'RETURNING', release: 'OPENING' };
  const toScreen = (x, y) => [(x + GX) * 2, (y + GY) * 2];
  const say = (text, hold) => Game.talk.say(text, hold);

  function mk(w, h) { const c = SPR.makeCanvas(w, h); const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; }

  // ---------------------------------------------------------------- statics
  function buildGlass() {
    const [c, x] = mk(180, 122);
    // back panel: dithered purple gradient
    for (let y = 0; y < 122; y++) {
      const k = y / 121;
      for (let xx = 0; xx < 180; xx++) {
        const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]][y & 3][xx & 3] / 16;
        x.fillStyle = k * 1.6 % 1 > bayer ? (k < 0.62 ? '#2a1f3d' : '#1f1830') : (k < 0.62 ? '#241a35' : '#1a1428');
        if (k < 0.62 && k * 1.6 < 1) x.fillStyle = k * 1.6 > bayer ? '#2a1f3d' : '#221931';
        x.fillRect(xx, y, 1, 1);
      }
    }
    // wallpaper: faint skull emblems
    for (let yy = 12; yy < 100; yy += 22) {
      for (let xx = ((yy / 22) % 2) * 15 + 8; xx < 176; xx += 30) {
        x.fillStyle = '#31254a';
        x.fillRect(xx + 1, yy, 5, 1); x.fillRect(xx, yy + 1, 7, 3); x.fillRect(xx + 1, yy + 4, 5, 2);
        x.fillStyle = '#221931';
        x.fillRect(xx + 1, yy + 2, 2, 1); x.fillRect(xx + 4, yy + 2, 2, 1);
        x.fillRect(xx + 2, yy + 5, 1, 1); x.fillRect(xx + 4, yy + 5, 1, 1);
      }
    }
    // light tube at the ceiling + a rail shadow
    x.fillStyle = '#3b2e52'; x.fillRect(0, 0, 180, 3);
    x.fillStyle = '#e7d6ff'; x.fillRect(20, 0, 140, 1);
    x.fillStyle = '#7a6a9a'; x.fillRect(20, 1, 140, 1);
    // floor shadow
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 108, 180, 14);
    glassBG = c;
  }

  function buildFrame() {
    const [c, x] = mk(BW, BH);
    // side wall (right of the cabinet)
    x.fillStyle = '#150f20'; x.fillRect(193, 0, 47, BH);
    for (let i = 196; i < 240; i += 8) { x.fillStyle = '#1b1428'; x.fillRect(i, 0, 1, BH); }
    // cabinet body
    const body = '#5a1834', hi = '#8a2a4e', lo = '#34101f', dark = '#220913';
    x.fillStyle = dark; x.fillRect(0, 0, 194, BH);
    x.fillStyle = body; x.fillRect(1, 1, 192, BH - 2);
    x.fillStyle = hi; x.fillRect(1, 1, 192, 1); x.fillRect(1, 1, 1, BH - 2);
    x.fillStyle = lo; x.fillRect(1, BH - 2, 192, 1); x.fillRect(192, 1, 1, BH - 2);
    // inner bevel around the glass
    x.fillStyle = lo; x.fillRect(GX - 3, GY - 3, 186, 128);
    x.fillStyle = '#6b6f86'; x.fillRect(GX - 2, GY - 2, 184, 126);
    x.fillStyle = '#2b2d3d'; x.fillRect(GX - 1, GY - 1, 182, 124);
    x.clearRect(GX, GY, 180, 122);
    // bulb sockets
    x.fillStyle = dark;
    for (const [bx, by] of bulbSpots()) x.fillRect(bx - 1, by - 1, 3, 3);
    // prize sign under the chute
    x.fillStyle = dark; x.fillRect(GX + 144, GY + 123, 36, 4);
    frameImg = c;
  }

  let _bulbs = null;
  function bulbSpots() {
    if (_bulbs) return _bulbs;
    _bulbs = [];
    for (let bx = 10; bx <= 184; bx += 9) _bulbs.push([bx, 3]);
    for (let by = 13; by <= 124; by += 10) _bulbs.push([190, by]);
    for (let bx = 184; bx >= 10; bx -= 9) _bulbs.push([bx, 131]);
    for (let by = 124; by >= 13; by -= 10) _bulbs.push([3, by]);
    return _bulbs;
  }

  // ---------------------------------------------------------------- scene api
  const S = {
    enter() {
      if (!buf) { [buf, g] = mk(BW, BH); buildGlass(); buildFrame(); }
      Music.play('claw');
      idleT = 0;
      topUp();
      if (!Game.seen.claw) {
        Game.seen.claw = true;
        say('Pick a part. Any part. They are ALL good parts.', 3.2);
      } else if (Game.sim.pending.length) say('Fresh stock! Straight from the graveyard.', 2.4);
      buildButtons();
    },
    exit() { Sfx.motor(0, 0); Game.sim.input.move = 0; },
    update(dt) {
      t += dt;
      const sim = Game.sim;
      let move = 0;
      if (Input.held('left') || btn.left.held) move -= 1;
      if (Input.held('right') || btn.right.held) move += 1;
      // hold the mouse / a finger on the glass to steer the claw toward the pointer
      const mp = Input.mouse;
      if (!move && mp.down && mp.x >= 14 && mp.x < 374 && mp.y >= 14 && mp.y < 258 && (sim.state === 'idle' || sim.state === 'carry')) {
        const d = mp.x / 2 - GX - sim.carX;
        if (Math.abs(d) > 2) move = clamp(d / 10, -1, 1);
      }
      if (move) { movedOnce = true; idleT = 0; } else if (sim.state === 'idle') idleT += dt;
      chuteWarnT = Math.max(0, chuteWarnT - dt);
      const carrying = sim.state === 'carry' || sim.state === 'return';
      const risk = carrying ? sim.risk : 0;
      riskV += (risk - riskV) * Math.min(1, dt * (risk > riskV ? 14 : 3)); // jumps up fast, calms down slowly
      if (riskV > 0.6 && !hot) { hot = true; Sfx.play('bump', { material: 'metal', intensity: 0.5 }); } else if (riskV < 0.4) hot = false;
      sim.input.move = move;
      if (Input.hit('a')) S.pressA();
      if (Input.hit('b')) S.back();
      sim.step(dt);

      // motor voice
      const moving = Math.abs(sim.carV) / CONFIG.clawMoveSpeed;
      const reel = sim.state === 'drop' || (sim.state === 'lift' && sim.ropeLen > M.topLen + 0.5);
      const load = sim.grips.length ? 0.18 : 0;
      Sfx.motor(clamp(moving * 0.5 + (reel ? 0.55 : 0), 0, 0.9), reel ? (sim.state === 'drop' ? 0.62 : 0.38 - load) : 0.45 + moving * 0.25 - load);

      // slow-mo when something good is about to drop into the chute
      for (const p of sim.parts) {
        if (p.won || slowmoDone.has(p) || RARITY[p.def.rarity].order < 2) continue;
        const [x, y] = sim.partPos(p);
        const v = p.body.getLinearVelocity().y * PPM;
        if (x > M.chuteX0 - 2 && y > M.lipY - 26 && y < M.lipY + 2 && v > 25 && sim.state === 'release') {
          slowmoDone.add(p);
          Engine.slowmo(0.3, 0.45);
        }
      }
      // legendary sparkle
      for (const p of sim.parts) {
        if (p.won || p.def.rarity !== 'legendary' || !chance(dt * 3)) continue;
        const [x, y] = sim.partPos(p);
        fxW.add({ x: x + rand(-8, 8), y: y + rand(-8, 8), vy: -6, life: 0.6, color: pick([PAL.l, PAL.L, PAL.j]) });
      }

      fxW.update(dt); fxS.update(dt);
      Game.talk.update(dt);
      winFx = Math.max(0, winFx - dt);
      bagBump = Math.max(0, bagBump - dt * 3);
      tokenBump = Math.max(0, tokenBump - dt * 3);
      noTokenT = Math.max(0, noTokenT - dt);
      neonOff = neonOff > 0 ? neonOff - dt : chance(dt * 0.25) ? rand(0.05, 0.25) : 0;
      for (const f of flying) f.t += dt;
      flying = flying.filter((f) => {
        if (f.t < f.dur) return true;
        bagBump = 1;
        fxS.text(436, 150, '+1', RARITY[PART_DEFS[f.type].rarity].color, { font: 'main' });
        return false;
      });
      btn.drop.label = sim.state === 'idle' ? (Game.tokens > 0 ? 'DROP' : 'NO TOKENS') : sim.state === 'carry' ? 'RELEASE' : sim.state === 'drop' ? 'STOP' : ACTION_LABEL[sim.state] || '...';
      UI.set(Object.values(btn));
    },

    pressA() {
      const sim = Game.sim;
      if (sim.state === 'idle') {
        if (Game.tokens <= 0) {
          if (Game.broke()) {
            Game.givePity();
            say('Broke? On the house. Death is patient.', 3);
            Sfx.play('coin');
            tokenBump = 1;
            return;
          }
          Sfx.play('ui_deny');
          noTokenT = 2;
          say(pick(['Out of tokens. Go stitch something. Or someone.', 'No token, no grab. Your creations can earn you more.']), 3);
          return;
        }
        if (sim.carX > M.chuteX0 + 4) { // over the prize chute there is nothing to grab: don't burn a token on a sure miss
          Sfx.play('ui_deny');
          chuteWarnT = 1.6;
          say(pick(['That\'s the chute. Over the pile, please.', 'Prizes go IN there. Steer left.', 'Nothing to grab in the chute. Go left.']), 2.4);
          return;
        }
        Game.tokens--;
        tokenBump = 1;
        turnWins = 0;
        slowmoDone = new Set();
        Sfx.play('coin');
        fxS.text(436, 30, '-1', PAL.L, { font: 'main' });
        Telemetry.grabStart();
        sim.startDrop();
      } else if (sim.state === 'drop' || sim.state === 'carry') sim.press();
    },
    back() {
      const sim = Game.sim;
      if (sim.state !== 'idle') { Sfx.play('ui_deny'); say('Finish your grab first.', 1.6); return; }
      Engine.go('shop');
    },

    // ------------------------------------------------------------ sim events
    onSim(type, d) {
      const sim = Game.sim;
      const [hx, hy] = [sim.hub.getPosition().x * PPM, sim.hub.getPosition().y * PPM];
      switch (type) {
        case 'drop':
          missShown = false;
          Sfx.play('claw_drop');
          if (chance(0.35)) say(pick(['Steady...', 'Ooh, bold.', 'Down she goes.', 'Mind the fingers.', 'Come to papa.']), 1.4);
          break;
        case 'land':
          Sfx.play('claw_land', { intensity: d.intensity });
          Engine.shake(1 + d.intensity * 2, 0.18);
          fxW.burst(d.x, d.y + 26, 10, { speed: 30, angle: -Math.PI / 2, spread: 1.3, ay: 80, life: 0.5, color: ['#6e5580', '#45365f', '#a08962'], size: 1 });
          break;
        case 'close': Sfx.play('claw_close'); break;
        case 'lift':
          if (d.grips.length) {
            const best = d.grips.slice().sort((a, b) => RARITY[b.def.rarity].order - RARITY[a.def.rarity].order)[0];
            Sfx.play('grab');
            const r = RARITY[best.def.rarity].order;
            if (r >= 2) say(pick(['Oh, that\'s a good part.', 'Don\'t. Drop. It.', 'Careful. That one\'s precious.']), 2);
            else if (chance(0.6)) say(pick(['Got something!', 'Ooh.', 'Hold it... hold it...', 'Easy does it.']), 1.6);
          }
          break;
        case 'top': Sfx.play('claw_top'); Engine.shake(1, 0.1); Game.seen.carries = (Game.seen.carries || 0) + 1; break;
        case 'empty': // nothing in the claw: say so right away instead of after a pointless carry
          if (!sim.turn || !sim.turn.grabbed.size) {
            missShown = true;
            Sfx.play('miss');
            say(pick(['Nothing. Very zen.', 'You grabbed air. Air is free, by the way.', 'The pile says no.', 'Aim for the middle of it.']), 2.2);
          }
          break;
        case 'gripLost':
          lastLoss = d.why;
          Telemetry.c.bySlipWhy[d.why] = (Telemetry.c.bySlipWhy[d.why] || 0) + 1;
          break;
        case 'slip': {
          if (sim.carX >= M.chuteX0) break; // over the chute it falls in: the win beat takes over
          Sfx.play('slip');
          const [px, py] = sim.partPos(d.part);
          fxW.burst(px, py, 6, { speed: 25, ay: 60, life: 0.4, color: ['#fff6e3', '#cdb892'] });
          if (sim.carX > M.guardX - 32) { // dropped within a claw-length of the chute: the "one more try" moment
            Telemetry.c.nearMiss++;
            Engine.slowmo(0.35, 0.3);
            Engine.shake(2, 0.2);
            const [sx, sy] = toScreen(px, py);
            fxS.text(clamp(sx, 50, 330), sy - 10, 'SO CLOSE!', '#ff8ac6', { font: 'main', life: 1.3, vy: -16, outline: PAL.k });
            say(pick(['SO close. The chute was RIGHT there.', 'Inches. Literal inches.', 'The chute felt that.', 'Ohh. Ohh no. So close.']), 2.4);
            break;
          }
          const quips = {
            twitch: ['It squirmed out! They do that.', 'Wriggly one. Hold tighter next time.'],
            strain: ['You yanked it. Gently does it.', 'Too much stick, too fast. Watch the bar.', 'Easy on the controls. It bruises.'],
            jolt: ['The top always gets them.', 'The jolt at the top. Every time.', 'So close to the top. Rude.'],
            swing: ['Swing it less. It gets dizzy.', 'It wanted to stay. Respect that.', 'Gravity: undefeated.', 'Butterfingers. Literally.'],
          };
          say(pick(quips[lastLoss] || ['Almost. Almost is a whole genre here.', 'The claw is weak. Like the flesh.']), 2.4);
          break;
        }
        case 'release':
          Sfx.play('claw_open');
          if (d.timeout) { Sfx.play('ui_deny'); say(pick(['Too slow! The claw has a schedule.', 'Time! It lets go on its own.']), 2.2); }
          break;
        case 'win': onWin(d); break;
        case 'turnEnd': {
          Telemetry.grabEnd(d.result, d.won);
          if (d.result === 'miss' && !missShown) {
            Sfx.play('miss');
            if (!Game.talk.visible() || chance(0.5)) say(pick(['Nothing. Very zen.', 'You grabbed air. Air is free, by the way.', 'The pile says no.', 'Close. Ish.', 'Aim for the middle of it.']), 2.2);
          }
          if (d.won.length > 1) say('Two for one! The machine likes you.', 2.4);
          topUp();
          if (Game.tokens <= 0) setTimeout(() => { if (Engine.sceneName === 'claw') { noTokenT = 3; say(Game.inventory.length ? 'Out of tokens. Take your parts to the slab.' : 'Out of tokens. Your creations can earn more.', 3); } }, 1400);
          break;
        }
        case 'bump': {
          if (Engine.realT - lastBumpSfx < 0.035) break;
          lastBumpSfx = Engine.realT;
          Sfx.play('bump', { material: d.part.def.mat === 'wood' ? 'bone' : d.part.def.mat, intensity: d.intensity * 0.8, pan: (d.x - 90) / 90 });
          if (d.intensity > 0.6) fxW.burst(d.x, d.y, 3, { speed: 18, ay: 50, life: 0.3, color: ['#6e5580', '#45365f'] });
          break;
        }
        case 'clank': if (Engine.realT - lastBumpSfx > 0.05) { lastBumpSfx = Engine.realT; Sfx.play('bump', { material: 'metal', intensity: d.intensity * 0.6 }); } break;
        case 'twitch': {
          if (d.held || chance(0.5)) Sfx.play('twitch', { intensity: d.held ? 0.9 : 0.4 });
          const [px, py] = sim.partPos(d.part);
          if (d.held) { fxW.burst(px, py, 4, { speed: 20, life: 0.3, color: ['#e8405a', '#fff6e3'] }); if (!Game.talk.visible()) say('It\'s squirming!', 1.2); }
          break;
        }
        case 'spawn': {
          Sfx.play('restock');
          const [px, py] = sim.partPos(d.part);
          fxW.burst(px, py, 8, { speed: 20, life: 0.5, color: [RARITY[d.part.def.rarity].color, '#fff6e3'] });
          if (d.part.from) { const [sx, sy] = toScreen(px, py); fxS.text(sx, sy + 8, poss(d.part.from), '#a08962', { life: 1.4, vy: -10 }); }
          break;
        }
      }
    },
  };

  function onWin(d) {
    const p = d.part, def = p.def, r = RARITY[def.rarity];
    Game.addPart(p.type, p.from);
    turnWins++;
    if (p.from) Telemetry.c.homecomings++;
    Telemetry.c.wonRarity[def.rarity]++;
    if (!d.inTurn) Telemetry.c.freebies++;
    Telemetry.log('won', { part: p.type, rarity: def.rarity });
    const order = r.order;
    Engine.hitPause(0.06 + order * 0.03);
    Engine.shake(2 + order * 1.2, 0.3);
    winFx = 1.6 + order * 0.6;
    Sfx.play('chute');
    Sfx.play(['win_common', 'win_uncommon', 'win_rare', 'win_legendary'][order]);
    const cx = (M.chuteX0 + M.chuteX1) / 2;
    fxW.burst(cx, M.floor - 6, 16 + order * 10, { speed: 60 + order * 20, angle: -Math.PI / 2, spread: 0.9, ay: 90, life: 0.9, color: [r.color, '#fff6e3', r.color], sizes: [1, 1, 2] });
    fxW.add({ kind: 'ring', x: cx, y: M.floor - 8, r0: 2, r1: 26, life: 0.4, color: r.color });
    if (order >= 3) {
      Engine.flash('#f6c64b', 0.4);
      Music.duck(0.8, 2.5);
      for (let i = 0; i < 40; i++) fxW.add({ x: rand(10, 170), y: rand(-10, 20), vx: rand(-20, 20), vy: rand(10, 40), ay: 40, life: rand(1.2, 2.2), color: pick([PAL.l, PAL.L, PAL.W, PAL.R]), size: pick([1, 2]) });
    } else if (order >= 2) Engine.flash('#6fd3ff', 0.2);
    const [sx, sy] = toScreen(cx, M.floor - 20);
    fxS.text(sx, sy - 10, def.name.toUpperCase(), r.color, { font: 'main', life: 1.6, vy: -20, outline: PAL.k });
    if (order > 0) fxS.text(sx, sy + 2, r.name.toUpperCase() + '!', r.color, { life: 1.6, vy: -20 });
    flying.push({ type: p.type, t: -0.35, dur: 0.7, x0: sx, y0: toScreen(0, M.floor)[1] + 4 });
    const lines = [
      [`A ${def.name}. Still warm.`, `${def.name}! A classic.`, `A ${def.name}. That'll stitch nicely.`, 'Good part. Good part.'],
      [`Ooh, a ${def.name}!`, `${def.name}! Nice grab.`],
      [`A ${def.name}! Someone's getting spoiled.`, `${def.name}! Oh, that's a GOOD part.`],
      ['...I was saving that one.', `The ${def.name}. You absolute ghoul.`],
    ][order];
    say(p.from && order < 3 ? pick([`${poss(p.from)} ${def.name}. Welcome home.`, `Oh. ${poss(p.from)} ${def.name}. Hello again.`, `${p.from} did say they'd be back.`]) : pick(lines), 2.6);
    if (!d.inTurn) say('Free part! Don\'t tell the manager. I\'m the manager.', 2.6);
  }

  // the machine never runs dry: below 5 parts the Reaper fetches more from the back room
  function topUp() {
    const sim = Game.sim;
    const left = sim.parts.filter((p) => !p.won).length + sim.pending.length;
    if (left >= 5) return;
    for (let i = 0; i < 7; i++) sim.queueSpawn(randomPartType({ boost: 1 + Game.stage * 0.1 }), i * 0.25);
    Telemetry.log('topup', { left });
    setTimeout(() => say('Running low! Let me fetch more from the back room.', 3), 900);
  }

  function buildButtons() {
    btn.left = { id: 'cl', x: 398, y: 212, w: 18, h: 16, label: '', hidden: false, silent: true, onClick() {} };
    btn.right = { id: 'cr', x: 418, y: 212, w: 18, h: 16, label: '', silent: true, onClick() {} };
    btn.drop = { id: 'ca', x: 398, y: 230, w: 76, h: 14, label: 'DROP', silent: true, onClick: () => S.pressA() };
    btn.back = { id: 'cb', x: 398, y: 247, w: 76, h: 14, label: 'BACK', silent: true, onClick: () => S.back() };
  }

  // ---------------------------------------------------------------- drawing
  function drawWorld() {
    const sim = Game.sim;
    g.save();
    g.beginPath(); g.rect(GX, GY, 180, 122); g.clip();
    g.translate(GX, GY);
    g.drawImage(glassBG, 0, 0);
    const P = sim.clawPose();

    // spotlight cone under the claw
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    const grad = g.createLinearGradient(0, P.carY, 0, M.floor);
    grad.addColorStop(0, 'rgba(180,160,255,0.16)');
    grad.addColorStop(1, 'rgba(120,90,200,0.02)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(P.carX - 6, P.carY); g.lineTo(P.carX + 6, P.carY); g.lineTo(P.carX + 34, M.floor); g.lineTo(P.carX - 34, M.floor); g.fill();
    g.globalCompositeOperation = op;

    // chute interior
    g.fillStyle = 'rgba(111,211,255,0.07)'; g.fillRect(M.chuteX0, M.lipY, M.chuteX1 - M.chuteX0, 122 - M.lipY);
    g.fillStyle = '#0e0b16'; g.fillRect(M.chuteX0, 116, M.chuteX1 - M.chuteX0, 6);
    const chuteGlow = winFx > 0 ? (Math.sin(t * 30) > 0 ? 0.5 : 0.2) : 0.12 + 0.05 * Math.sin(t * 3);
    g.fillStyle = `rgba(111,211,255,${chuteGlow})`; g.fillRect(M.chuteX0 + 2, 114, M.chuteX1 - M.chuteX0 - 4, 2);
    // down-arrow painted on the chute's back wall
    g.fillStyle = sim.state === 'carry' && Math.sin(t * 8) > 0 ? '#6fd3ff' : '#2e4f78';
    const ax = (M.chuteX0 + M.chuteX1) / 2;
    for (let i = 0; i < 4; i++) g.fillRect(ax - 3 + i, 92 + i, 7 - i * 2, 1);
    g.fillRect(ax - 1, 86, 3, 6);

    // drop guide
    if (CONFIG.dropGuide && sim.state === 'idle') {
      const top = P.hubY + 30;
      let hitY = M.floor;
      const pl = planck;
      sim.world.rayCast(pl.Vec2(P.carX / PPM, top / PPM), pl.Vec2(P.carX / PPM, M.floor / PPM), (fix, point, normal, fr) => {
        if (fix.getBody().getUserData() === 'claw') return -1;
        hitY = point.y * PPM;
        return fr;
      });
      g.fillStyle = 'rgba(231,166,240,0.35)';
      for (let y = top; y < hitY - 2; y += 4) g.fillRect(Math.round(P.carX), Math.round(y), 1, 2);
      g.fillStyle = 'rgba(231,166,240,0.7)';
      g.fillRect(Math.round(P.carX) - 2, Math.round(hitY) - 1, 5, 1);
    }

    // parts
    const gripped = new Set(sim.grips.map((x) => x.part));
    for (const p of sim.parts) drawPart(p, gripped.has(p) || sim.held.has(p), P);

    // claw: rail, carriage, cable, head, prongs
    g.fillStyle = '#3c4257'; g.fillRect(2, P.carY - 3, 176, 2);
    g.fillStyle = '#a6aec2'; g.fillRect(2, P.carY - 3, 176, 1);
    SPR.draw(g, 'claw_carriage', P.carX, P.carY - 4);
    Draw.line(g, P.carX, P.carY + 5, P.ropeX, P.ropeY, '#a6aec2');
    Draw.line(g, P.carX + 1, P.carY + 5, P.ropeX + 1, P.ropeY, '#3c4257');
    SPR.draw(g, 'claw_hub', P.hubX, P.hubY, { rot: P.hubA || 0.0001 });
    SPR.draw(g, 'claw_prongL', P.lX, P.lY, { rot: P.lA || 0.0001 });
    SPR.draw(g, 'claw_prongR', P.rX, P.rY, { rot: P.rA || 0.0001 });
    // blinking status light on the claw head
    g.fillStyle = sim.state === 'idle' ? (Math.sin(t * 5) > 0 ? '#9be38f' : '#274536') : sim.grips.length ? '#f6c64b' : '#e8405a';
    const la = P.hubA;
    g.fillRect(Math.round(P.hubX + Math.cos(la) * 7 - Math.sin(la) * -1), Math.round(P.hubY + Math.sin(la) * 7 + Math.cos(la) * -1), 1, 1);

    // chute front: acrylic guard + prize plate
    g.fillStyle = 'rgba(194,245,255,0.18)'; g.fillRect(M.guardX, M.lipY, M.guardW, M.floor - M.lipY);
    g.fillStyle = '#c2f5ff'; g.fillRect(M.guardX, M.lipY, M.guardW, 1);
    g.fillStyle = 'rgba(194,245,255,0.55)'; g.fillRect(M.guardX, M.lipY + 1, 1, M.floor - M.lipY - 1);
    g.fillStyle = '#2b2d3d'; g.fillRect(M.chuteX0 - 3, 112, M.chuteX1 - M.chuteX0 + 3, 10);
    g.fillStyle = '#6b6f86'; g.fillRect(M.chuteX0 - 3, 112, M.chuteX1 - M.chuteX0 + 3, 1);
    fxW.draw(g);

    // glass reflections
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(255,255,255,0.045)';
    g.beginPath(); g.moveTo(20, 0); g.lineTo(46, 0); g.lineTo(-10, 122); g.lineTo(-36, 122); g.fill();
    g.beginPath(); g.moveTo(58, 0); g.lineTo(64, 0); g.lineTo(8, 122); g.lineTo(2, 122); g.fill();
    g.globalCompositeOperation = op;
    g.restore();
  }

  function drawPart(p, held, P) {
    const def = p.def;
    const rar = RARITY[def.rarity];
    const glow = rar.glow ? 0.55 + 0.45 * Math.sin(t * 4 + p.glowT) : 0;
    for (let i = 0; i < p.bodies.length; i++) {
      const b = p.bodies[i];
      const q = b.getPosition(), a = b.getAngle();
      const name = def.chain ? (i === p.bodies.length - 1 ? 'p_tailtip' : 'p_vert') : def.sprite;
      const s = SPR.get(name);
      g.save();
      g.translate(q.x * PPM, q.y * PPM);
      g.rotate(a);
      if (held && Math.sin(t * (16 + riskV * 10)) > 0) { g.drawImage(SPR.outline(name, riskV > 0.6 ? '#e8405a' : riskV > 0.25 ? '#f6c64b' : '#fff6e3'), -s.w / 2 - 1, -s.h / 2 - 1); }
      else if (glow > 0) { g.globalAlpha = glow; g.drawImage(SPR.outline(name, rar.glow), -s.w / 2 - 1, -s.h / 2 - 1); g.globalAlpha = 1; }
      g.drawImage(s.c, -s.w / 2, -s.h / 2);
      g.restore();
      if (def.sprite === 'p_eyeball') { // it watches the claw
        const cx = q.x * PPM, cy = q.y * PPM;
        drawIris(g, cx, cy, P.hubX - cx, P.hubY - cy);
      }
    }
    if (def.slot === 'heart' && Math.sin(t * 7 + p.glowT) > 0.7) Draw.glow(g, p.body.getPosition().x * PPM, p.body.getPosition().y * PPM, 9, def.rarity === 'legendary' ? '#f6c64b' : '#e8405a', 0.25);
  }

  function drawFrameLights() {
    const spots = bulbSpots();
    const n = spots.length;
    for (let i = 0; i < n; i++) {
      const [x, y] = spots[i];
      let on, col;
      if (winFx > 0) { on = Math.sin(t * 20 + i * 1.3) > 0; col = pick([PAL.l, PAL.r, PAL.C, PAL.p]); }
      else { on = (i + Math.floor(t * 7)) % 4 === 0 || (i + Math.floor(t * 7)) % 4 === 1 && Game.sim.state !== 'idle'; col = PAL.l; }
      g.fillStyle = on ? col : '#6b3a1c';
      g.fillRect(x, y, 1, 1);
      if (on) { g.fillStyle = on ? 'rgba(255,241,166,0.35)' : ''; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); }
    }
  }

  function drawSideArt() {
    // tokens box, neon/reaper box, bag box, controls box (panels in buffer pixels)
    Draw.panel(g, 197, 3 - Math.round(tokenBump * 1), 42, 22, 'slate');
    const talking = Game.talk.visible();
    Draw.panel(g, 197, 27, 42, 44, 'neon');
    if (!talking) {
      const dim = neonOff > 0;
      const col = dim ? '#5a2a48' : '#ff8ac6';
      if (!dim) Draw.glow(g, 218, 49, 26, '#b84a7c', 0.35);
      ['GRAB', 'SOME', 'FATE'].forEach((w, i) => {
        Font.draw(g, w, 218, 32 + i * 12, { color: col, align: 'center', shadow: dim ? null : '#6b1f48' });
      });
    } else {
      SPR.has('reaper_face') && SPR.draw(g, Game.talk.talking() && Math.sin(t * 22) > 0 ? (SPR.has('reaper_face_talk') ? 'reaper_face_talk' : 'reaper_face') : 'reaper_face', 205, 36);
    }
    Draw.panel(g, 197, 73 + Math.round(bagBump), 42, 27, 'dark');
    Draw.panel(g, 197, 102, 42, 31, 'dark');
  }

  function drawOverlay(ctx) {
    const sim = Game.sim;
    // TOKENS
    Font.draw(ctx, 'TOKENS', 436, 11 - Math.round(tokenBump * 2), { font: 'small', color: '#a6aec2', align: 'center' });
    const tk = String(Game.tokens);
    Font.draw(ctx, tk, 436, 21 - Math.round(tokenBump * 2), { scale: 3, color: Game.tokens > 0 ? '#fff6e3' : noTokenT > 0 && Math.sin(t * 16) > 0 ? '#e8405a' : '#7a6a9a', align: 'center', shadow: PAL.k });
    // reaper speech inside the neon box
    if (Game.talk.visible()) {
      Game.talk.drawBubble(ctx, 398, 90, 78, null, null, {});
    }
    // bag
    Font.draw(ctx, 'BAG', 402, 151 + Math.round(bagBump * 2), { font: 'small', color: '#a6aec2' });
    Font.draw(ctx, String(Game.inventory.length), 472, 151, { font: 'small', color: '#ecdcbc', align: 'right' });
    Game.recent.slice(0, 3).forEach((type, i) => {
      drawPartIcon(ctx, type, 413 + i * 24, 180 + Math.round(bagBump * 2), 17, { outline: RARITY[PART_DEFS[type].rarity].glow || undefined });
    });
    // flying prizes
    for (const f of flying) {
      if (f.t < 0) continue;
      const k = easeInOutQuad(clamp(f.t / f.dur, 0, 1));
      const x = lerp(f.x0, 413, k), y = lerp(f.y0, 180, k) - Math.sin(k * Math.PI) * 60;
      drawPartIcon(ctx, f.type, x, y, 22, { outline: RARITY[PART_DEFS[f.type].rarity].color });
    }
    // controls
    const ico = (name, x, y, fb) => (SPR.has(name) ? SPR.draw(ctx, name, x, y) : Font.draw(ctx, fb, x, y - 3, { align: 'center', color: '#ecdcbc' }));
    ico('key_left', 407, 220, '◀'); ico('key_right', 427, 220, '▶');
    Font.draw(ctx, 'MOVE', 442, 217, { color: '#ecdcbc' });
    for (const b of [btn.drop, btn.back]) {
      const hot = b.hover || b.held;
      const pulse = b === btn.back && noTokenT > 0 && Math.sin(t * 10) > 0;
      if (hot || pulse) Draw.rect(ctx, b.x, b.y, b.w, b.h, pulse ? '#5a1834' : '#2b2d3d');
      let lx = b.x + 20;
      if (Input.lastDevice === 'keys') { // keyboard players see the keys, not gamepad glyphs
        const cap = b === btn.drop ? 'SPACE' : 'ESC', cw = Font.measure(cap, 'small') + 5;
        Draw.rect(ctx, b.x + 1, b.y + 2, cw, 10, '#1b1526'); Draw.rect(ctx, b.x + 1, b.y + 2, cw, 9, '#3c4257'); Draw.rect(ctx, b.x + 1, b.y + 2, cw, 1, '#677089');
        Font.draw(ctx, cap, b.x + 3, b.y + 4, { font: 'small', color: '#ecdcbc' });
        lx = b.x + cw + 5;
      } else ico(b === btn.drop ? 'btn_a' : 'btn_b', b.x + 9, b.y + 7, b === btn.drop ? 'A' : 'B');
      const dead = b === btn.drop && (Game.tokens <= 0 && sim.state === 'idle' || !['idle', 'drop', 'carry'].includes(sim.state));
      Font.draw(ctx, b.label, lx, b.y + 4, { color: dead ? '#7a6a9a' : '#ecdcbc' });
    }
    if (chuteWarnT > 0 && Math.sin(t * 16) > 0) Draw.frame(ctx, btn.left.x - 1, btn.left.y - 1, btn.left.w + 2, btn.left.h + 2, '#ff8ac6');
    if (btn.left.held || Input.held('left')) Draw.frame(ctx, btn.left.x, btn.left.y, btn.left.w, btn.left.h, '#fff6e3');
    if (btn.right.held || Input.held('right')) Draw.frame(ctx, btn.right.x, btn.right.y, btn.right.w, btn.right.h, '#fff6e3');

    // held part label + carry timer near the claw
    const gp = sim.grips[0] ? sim.grips[0].part : [...sim.held][0];
    if (gp && (sim.state === 'lift' || sim.state === 'carry' || sim.state === 'return')) {
      const [px, py] = sim.partPos(gp);
      const [sx, sy] = toScreen(px, py);
      const r = RARITY[gp.def.rarity];
      const txt = (gp.from ? poss(gp.from) + ' ' : '') + gp.def.name + (r.order ? ' · ' + r.name : '');
      Font.draw(ctx, txt, clamp(sx, 90, 300), sy + 26, { color: r.color, align: 'center', outline: PAL.k });
      if (gp.def.set) Font.draw(ctx, PART_SETS[gp.def.set].name.toUpperCase() + ' SET', clamp(sx, 90, 300), sy + 37, { font: 'small', color: '#f6c64b', align: 'center', outline: PAL.k });
    }
    if (sim.state === 'carry' && CONFIG.carryTime > 0) {
      const k = 1 - sim.stateT / CONFIG.carryTime;
      const [cx] = toScreen(sim.carX, 0);
      Draw.rect(ctx, cx - 16, 44, 32, 3, PAL.k);
      Draw.rect(ctx, cx - 15, 45, Math.max(0, 30 * k), 1, k < 0.3 && Math.sin(t * 20) > 0 ? PAL.R : PAL.d);
    }
    if ((sim.state === 'carry' || sim.state === 'return') && sim.grips.length) { // how likely the part is to drop right now
      const [cx] = toScreen(sim.carX, 0), f = clamp(riskV / 1.2, 0, 1), shake = f > 0.7 ? Math.round(Math.sin(t * 50)) : 0;
      Draw.rect(ctx, cx - 16 + shake, 50, 32, 4, PAL.k);
      Draw.rect(ctx, cx - 15 + shake, 51, Math.max(1, Math.round(30 * f)), 2, f > 0.5 ? PAL.R : f > 0.2 ? PAL.L : PAL.d);
      Font.draw(ctx, 'STEADY', cx - 19 + shake, 49, { font: 'small', color: f > 0.5 ? '#e8405a' : '#7a6a9a', align: 'right', outline: PAL.k });
    }
    // the first two carries: spell out steer -> chute -> release (nothing else teaches it).
    // The text sits on the side of the glass away from the claw so it never covers the held part.
    if (sim.state === 'carry' && (sim.grips.length || sim.held.size) && (Game.seen.carries || 0) <= 2) {
      const over = sim.carX > M.chuteX0 + 4, a = 0.75 + 0.2 * Math.sin(t * 6), cgx = (sim.carX + GX) * 2;
      const hx = cgx < 190 ? Math.min(cgx + 100, 296) : Math.max(cgx - 100, 100); // keep ~100 px clear of the claw
      const key = Input.lastDevice === 'keys' ? 'SPACE' : Input.lastDevice === 'pad' ? 'A' : 'THE RELEASE BUTTON';
      if (over) Font.draw(ctx, 'NOW RELEASE!  (' + key + ')', hx, 84, { font: 'small', color: '#9be38f', align: 'center', alpha: a, outline: PAL.k });
      else {
        Font.draw(ctx, 'STEER TO THE CHUTE  →', hx, 78, { font: 'small', color: '#e7d6ff', align: 'center', alpha: a, outline: PAL.k });
        Font.draw(ctx, 'THEN PRESS ' + key + ' TO RELEASE', hx, 89, { font: 'small', color: '#ff8ac6', align: 'center', alpha: a, outline: PAL.k });
        Font.draw(ctx, 'KEEP THE BAR GREEN', hx, 100, { font: 'small', color: '#9be38f', align: 'center', alpha: a * 0.8, outline: PAL.k });
      }
    }
    // first-time controls hint, inside the glass, until the player does anything
    if (!movedOnce && sim.state === 'idle' && Game.tokens === CONFIG.startTokens) {
      const a = 0.55 + 0.25 * Math.sin(t * 3);
      Font.draw(ctx, '← →  or  HOLD MOUSE ON THE GLASS TO STEER', 190, 96, { font: 'small', color: '#e7d6ff', align: 'center', alpha: a, outline: PAL.k });
      Font.draw(ctx, 'THEN  DROP', 190, 108, { font: 'small', color: '#ff8ac6', align: 'center', alpha: a, outline: PAL.k });
    }
    // first-time nudge: flash the controls if the player hasn't moved yet
    if (!movedOnce && idleT > 5 && Math.sin(t * 6) > 0) Draw.frame(ctx, 396, 206, 80, 58, '#ff8ac6');
    fxS.draw(ctx);
  }

  S.draw = function (ctx) {
    g.clearRect(0, 0, BW, BH);
    drawWorld();
    g.drawImage(frameImg, 0, 0);
    drawFrameLights();
    drawSideArt();
    ctx.drawImage(buf, 0, 0, BW * 2, BH * 2);
    drawOverlay(ctx);
  };

  // tiny preview of the live pile for the shop's machine window (1x)
  S.drawMini = function (ctx, x, y) {
    if (!buf) { [buf, g] = mk(BW, BH); buildGlass(); buildFrame(); }
    const [c, cx] = S._mini || (S._mini = mk(180, 122));
    const keep = g;
    g = cx;
    g.clearRect(0, 0, 180, 122);
    g.save(); g.translate(-GX, -GY);
    drawWorld();
    g.restore();
    g = keep;
    ctx.drawImage(c, x, y);
  };

  return S;
})();
