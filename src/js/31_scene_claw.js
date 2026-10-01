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
  let t = 0, winFx = 0, bagBump = 0, tokenBump = 0, noTokenT = 0, idleT = 0, movedOnce = false, chuteWarnT = 0, missShown = false, swayLvl = 0, lastLoss = null;
  let flying = [];
  let slowmoDone = new Set();
  let lastBumpSfx = 0;
  let neonOff = 0;
  let turnWins = 0;
  let toggleDir = 0; // steering mode 'toggle': tap a direction to start, tap again to stop
  let toggleTarget = null; // ...and with a pointer: tap the glass and the claw goes there and stops
  const btn = {};
  const ACTION_LABEL = { close: 'GRABBING', lift: 'LIFTING', return: 'RETURNING', release: 'OPENING' };
  const toScreen = (x, y) => [(x + GX) * 2, (y + GY) * 2];
  const say = (text, hold) => Game.talk.say(text, hold);

  // --- The Rig (docs/RNG_LAYER.md). The right-hand column is 84 px wide and was already full, so
  // it is budgeted in screen px: [y, height] per panel. Panels are drawn chunky in the 2x buffer
  // (see drawSideArt) and their text and icons crisp at 1x (drawOverlay).
  const CX = 394, CW = 84;
  const LAY = { tokens: [6, 44], luck: [52, 26], talk: [80, 62], rig: [144, 70], ctrl: [216, 50] };
  const CELL = { w: 24, h: 26, x: [398, 424, 450], y: [157, 185] };
  const CELLS = [['nudgeL', 0, 0], ['quake', 1, 0], ['nudgeR', 2, 0], ['grip', 0, 1], ['order', 1, 1], ['redo', 2, 1]]; // id, column, row
  const CELL_ICON = { nudgeL: 'ico_nudgeL', nudgeR: 'ico_nudgeR', quake: 'ico_quake', grip: 'ico_grip', order: 'ico_order', redo: 'ico_redo' };
  const SLOT_ICON = { head: 'skull', torso: 'ribcage', arm: 'bonearm', leg: 'boneleg', heart: 'heart', back: 'tail' };
  const PK = { x: 84, y: 66, w: 220, h: 134 }; // the Order menu
  let picker = null; // Order menu: { sel } while open
  let lens = null; // what a drop right here would hold: { part, chance, y, lx }
  let noLuckT = 0, luckHint = 0, ironFlash = 0, leftAt = null;
  let pipPop = []; // per Luck pip: seconds left of its "just earned" pop
  const cellPulse = {}; // lever id -> seconds left of a pulsing hint frame (first-time nudges)
  let pickerBtns = [];

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
      toggleDir = 0; toggleTarget = null;
      if (!buf) { [buf, g] = mk(BW, BH); buildGlass(); buildFrame(); }
      Music.play('claw');
      idleT = 0;
      topUp();
      picker = null;
      if (leftAt != null) Rig.cool(Engine.realT - leftAt); // TILT heat keeps cooling while you are in the shop
      if (!Game.seen.claw) {
        Game.seen.claw = true;
        say('Pick a part. Any part. They are ALL good parts.', 3.2);
        if (Rig.on) { // the layer introduces itself
          Game.talk.say('Psst. Panel on the right. The machine is rigged. Rig it back.', 3.6, false);
          cellPulse.quake = 9;
        }
      } else if (Game.sim.pending.length) say('Fresh stock! Straight from the graveyard.', 2.4);
      buildButtons();
    },
    exit() { Sfx.motor(0, 0); Game.sim.input.move = 0; picker = null; leftAt = Engine.realT; },
    update(dt) {
      t += dt;
      const sim = Game.sim;
      let move = 0;
      const tog = Settings.v.steering === 'toggle';
      if (tog) {
        if (picker || (sim.state !== 'idle' && sim.state !== 'carry')) { toggleDir = 0; toggleTarget = null; }
        else {
          if (Input.hit('left')) toggleDir = toggleDir === -1 ? 0 : -1;
          if (Input.hit('right')) toggleDir = toggleDir === 1 ? 0 : 1;
          if (Input.hit('a')) toggleDir = 0; // dropping or releasing stops the carriage first
        }
        move = toggleDir;
      } else toggleDir = 0;
      if (!tog && (Input.held('left') || btn.left.held)) move -= 1;
      if (!tog && (Input.held('right') || btn.right.held)) move += 1;
      // hold the mouse / a finger on the glass to steer the claw toward the pointer
      const mp = Input.mouse;
      const onGlass = !picker && mp.x >= 14 && mp.x < 374 && mp.y >= 14 && mp.y < 258 && (sim.state === 'idle' || sim.state === 'carry');
      if (tog) {
        // tap-to-toggle with a pointer: tap the glass and the claw goes there and stops; tap the arrows to toggle
        if (mp.pressed && onGlass) toggleTarget = mp.x / 2 - GX;
        if (toggleTarget != null && !move) {
          const d = toggleTarget - sim.carX;
          if (Math.abs(d) < 2 || (sim.state !== 'idle' && sim.state !== 'carry')) toggleTarget = null; else move = clamp(d / 10, -1, 1);
        }
        if (toggleDir) toggleTarget = null;
      } else {
        toggleTarget = null;
        if (!move && mp.down && onGlass) {
          const d = mp.x / 2 - GX - sim.carX;
          if (Math.abs(d) > 2) move = clamp(d / 10, -1, 1);
        }
      }
      if (picker) move = 0; // arrows move the menu selection, not the claw
      if (move) { movedOnce = true; idleT = 0; } else if (sim.state === 'idle') idleT += dt;
      chuteWarnT = Math.max(0, chuteWarnT - dt);
      // how the carry is going, from the wobble meter: 0 steady, 1 swaying, 2 slipping. It tints the held part and
      // the claw creaks the moment it tips into SLIPPING
      const sw = sim.state === 'carry' || sim.state === 'return' ? sim.swayInfo() : null;
      const lvl = sw ? (sw.ratio <= 1 ? 0 : sw.ratio <= 1.5 ? 1 : 2) : 0;
      if (lvl === 2 && swayLvl < 2) Sfx.play('bump', { material: 'metal', intensity: 0.5 });
      swayLvl = lvl;
      sim.input.move = move;
      // The Rig: hotkeys (Q/E nudge, 1-4 levers; pad LB/RB, X, Y)
      Rig.update(dt);
      if (picker) updatePicker();
      else if (Rig.on) {
        if (Input.hit('nudgeL') || Input.hit('lb')) pull('nudgeL');
        if (Input.hit('nudgeR') || Input.hit('rb')) pull('nudgeR');
        if (Input.hit('quake') || Input.hit('x')) pull('quake');
        if (Input.hit('grip') || Input.hit('y')) pull('grip');
        if (Input.hit('order')) pull('order');
        if (Input.hit('redo')) pull('redo');
      }
      if (Input.hit('a')) S.pressA();
      if (Input.hit('b')) S.back();
      sim.step(dt);
      lens = Rig.on && CONFIG.lens && !picker && sim.lockT <= 0 ? sim.predict() : null; // (no badge while the pile is being shaken)
      if (lens && lens.part && !Game.seen.lensHint && Game.seen.claw && movedOnce) {
        Game.seen.lensHint = true;
        Game.talk.say('That badge is your odds of holding something. Aim for green.', 3.2, false);
      }
      noLuckT = Math.max(0, noLuckT - dt); luckHint = Math.max(0, luckHint - dt); ironFlash = Math.max(0, ironFlash - dt);
      for (let i = 0; i < pipPop.length; i++) pipPop[i] = Math.max(0, pipPop[i] - dt);
      for (const k in cellPulse) cellPulse[k] = Math.max(0, cellPulse[k] - dt);
      if ((sim.iron || (sim.turn && sim.turn.iron)) && vchance(dt * 9)) { // Iron Grip: gold sparks around the claw head
        fxW.add({ x: sim.hub.getPosition().x * PPM + vrand(-11, 11), y: sim.hub.getPosition().y * PPM + vrand(2, 28), vy: -14, life: 0.5, color: vpick(['#fff1a6', '#f6c64b', '#ffffff']) });
      }

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
        if (p.won || p.def.rarity !== 'legendary' || !vchance(dt * 3)) continue;
        const [x, y] = sim.partPos(p);
        fxW.add({ x: x + vrand(-8, 8), y: y + vrand(-8, 8), vy: -6, life: 0.6, color: vpick([PAL.l, PAL.L, PAL.j]) });
      }

      fxW.update(dt); fxS.update(dt);
      Game.talk.update(dt);
      winFx = Math.max(0, winFx - dt);
      bagBump = Math.max(0, bagBump - dt * 3);
      tokenBump = Math.max(0, tokenBump - dt * 3);
      noTokenT = Math.max(0, noTokenT - dt);
      neonOff = neonOff > 0 ? neonOff - dt : vchance(dt * 0.25) ? vrand(0.05, 0.25) : 0;
      for (const f of flying) f.t += dt;
      flying = flying.filter((f) => {
        if (f.t < f.dur) return true;
        bagBump = 1;
        fxS.text(452, 34, '+1', RARITY[PART_DEFS[f.type].rarity].color, { font: 'main' });
        return false;
      });
      btn.drop.label = sim.state === 'rewind' ? 'REWIND' : sim.lockT > 0 ? (sim.lockWhy === 'tilt' ? 'TILT!' : 'SHAKING') :
        sim.state === 'idle' ? (Game.tokens > 0 ? 'DROP' : 'NO TOKENS') : sim.state === 'carry' ? 'RELEASE' : sim.state === 'drop' ? 'STOP' : ACTION_LABEL[sim.state] || '...';
      for (const [id] of CELLS) btn['r_' + id].tip = Rig.on && Input.lastDevice !== 'touch' ? tipFor(id) : null; // a tap would leave the tooltip stuck on screen
      UI.set(picker ? pickerBtns : Object.values(btn));
      if (picker) for (const b of Object.values(btn)) b.hover = b.held = false;
    },

    pressA() {
      const sim = Game.sim;
      if (picker) { confirmPicker(); return; }
      if (sim.state === 'idle') {
        if (sim.lockT > 0) { // shaking or TILTed: no token is taken
          Sfx.play('ui_deny');
          say(sim.lockWhy === 'tilt' ? vpick(['TILT! Hands off the glass.', 'The machine is sulking. Give it a second.']) : 'Hold on. It\'s still shaking.', 1.8);
          return;
        }
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
          say(vpick(['Out of tokens. Go stitch something. Or someone.', 'No token, no grab. Your creations can earn you more.']), 3);
          return;
        }
        if (sim.carX > M.chuteX0 + 4) { // over the prize chute there is nothing to grab: don't burn a token on a sure miss
          Sfx.play('ui_deny');
          chuteWarnT = 1.6;
          say(vpick(['That\'s the chute. Over the pile, please.', 'Prizes go IN there. Steer left.', 'Nothing to grab in the chute. Go left.']), 2.4);
          return;
        }
        Game.tokens--;
        Game.tally('grabs');
        tokenBump = 1;
        turnWins = 0;
        slowmoDone = new Set();
        Sfx.play('coin');
        fxS.text(436, 30, '-1', PAL.L, { font: 'main' });
        Telemetry.grabStart(Rig.takeRigged(), sim.iron);
        sim.startDrop();
      } else if (sim.state === 'drop' || sim.state === 'carry') sim.press();
    },
    back() {
      const sim = Game.sim;
      if (picker) { picker = null; Sfx.play('ui_back'); return; }
      if (sim.state !== 'idle') { Sfx.play('ui_deny'); say('Finish your grab first.', 1.6); return; }
      if (sim.lockT > 0) { Sfx.play('ui_deny'); say('Wait for the shaking to stop.', 1.6); return; }
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
          if (d.iron) { ironFlash = 0.6; fxW.burst(hx, hy + 14, 10, { speed: 34, life: 0.5, color: ['#fff1a6', '#f6c64b'] }); Engine.flash('#f6c64b', 0.12); }
          if (vchance(0.35)) say(vpick(['Steady...', 'Ooh, bold.', 'Down she goes.', 'Mind the fingers.', 'Come to papa.']), 1.4);
          break;
        case 'land':
          Sfx.play('claw_land', { intensity: d.intensity });
          Engine.shake(1 + d.intensity * 2, 0.18);
          fxW.burst(d.x, d.y + 26, 10, { speed: 30, angle: -Math.PI / 2, spread: 1.3, ay: 80, life: 0.5, color: ['#6e5580', '#45365f', '#a08962'], size: 1 });
          break;
        case 'close': Sfx.play('claw_close'); break;
        case 'roll': showRoll(d); break;
        case 'iron': if (d.on) { Sfx.play('grip_arm'); ironFlash = 0.5; fxW.burst(hx, hy + 14, 12, { speed: 28, life: 0.6, color: ['#fff1a6', '#f6c64b', '#ffffff'] }); } else Sfx.play('ui_back'); break;
        case 'quake':
          if (d.phase === 'start') {
            Sfx.play(d.tilt ? 'tilt' : 'quake');
            Engine.hitPause(0.05);
            if (d.tilt) { Engine.flash('#e8405a', 0.3); Engine.shake(5, 0.3); }
            else fxS.text(194, 70, 'EARTHQUAKE!', '#ffb070', { font: 'main', scale: 3, life: 1.6, vy: -3, drag: 0.4, outline: PAL.k });
          }
          break;
        case 'quakePulse': {
          Engine.shake(d.big ? 4.5 : 2.6, 0.14);
          const n = d.big ? 7 : 3;
          for (let i = 0; i < n; i++) fxW.add({ x: vrand(4, 176), y: vrand(-2, 6), vx: vrand(-6, 6), vy: vrand(6, 24), ay: 55, life: vrand(0.5, 1.2), color: vpick(['#6e5580', '#45365f', '#a08962', '#c9b8e0']), size: vpick([1, 1, 2]) });
          if (d.big) fxW.burst(vrand(10, 130), M.floor - 6, 6, { speed: 26, angle: -Math.PI / 2, spread: 1.2, ay: 80, life: 0.5, color: ['#6e5580', '#45365f', '#a08962'] });
          break;
        }
        case 'unlock':
          if (d.why === 'quake') say(vpick(['New layout. Same pile. Funny how that works.', 'Look at that. A whole new set of possibilities.', 'Everything\'s in a different place. Isn\'t that nice?', 'Settled. Mostly. The bones are still talking.']), 2.6);
          break;
        case 'nudge': {
          Sfx.play('nudge', { pan: d.dir * 0.5 });
          Engine.shake(1.8, 0.12);
          const wx = d.dir > 0 ? M.chuteX0 - 6 : 6;
          fxW.burst(wx, M.floor - 10, 6, { speed: 24, angle: d.dir > 0 ? Math.PI : 0, spread: 0.7, ay: 60, life: 0.35, color: ['#6e5580', '#c9b8e0'] });
          break;
        }
        case 'rewind':
          if (d.phase === 'start') { Sfx.play('rewind'); Engine.flash('#6fd3ff', 0.15); }
          else { Engine.flash('#c2f5ff', 0.25); Engine.shake(1.2, 0.12); }
          break;
        case 'lift':
          if (d.grips.length) {
            const best = d.grips.slice().sort((a, b) => RARITY[b.def.rarity].order - RARITY[a.def.rarity].order)[0];
            Sfx.play('grab');
            const r = RARITY[best.def.rarity].order;
            if (r >= 2) say(vpick(['Oh, that\'s a good part.', 'Don\'t. Drop. It.', 'Careful. That one\'s precious.']), 2);
            else if (vchance(0.6)) say(vpick(['Got something!', 'Ooh.', 'Hold it... hold it...', 'Easy does it.']), 1.6);
          }
          break;
        case 'top': Sfx.play('claw_top'); Engine.shake(1, 0.1); Game.seen.carries = (Game.seen.carries || 0) + 1; break;
        case 'empty': // nothing in the claw: say so right away instead of after a pointless carry
          if (!sim.turn || !sim.turn.grabbed.size) {
            missShown = true;
            Sfx.play('miss');
            say(vpick(['Nothing. Very zen.', 'You grabbed air. Air is free, by the way.', 'The pile says no.', 'Aim for the middle of it.']), 2.2);
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
            say(vpick(['SO close. The chute was RIGHT there.', 'Inches. Literal inches.', 'The chute felt that.', 'Ohh. Ohh no. So close.']), 2.4);
            break;
          }
          const quips = {
            twitch: ['It squirmed out! They do that.', 'Wriggly one. Hold tighter next time.'],
            jolt: ['The top always gets them.', 'The jolt at the top. Every time.', 'So close to the top. Rude.'],
            swing: ['Swing it less. It gets dizzy.', 'You yanked it. Gently does it.', 'Too much stick, too fast. Watch the meter.', 'Gravity: undefeated.'],
            stuck: ['It was pinned under the others.', 'Wedged in. Try one off the top.'],
          };
          say(vpick(quips[lastLoss] || ['Almost. Almost is a whole genre here.', 'The claw is weak. Like the flesh.']), 2.4);
          break;
        }
        case 'release':
          Sfx.play('claw_open');
          if (d.timeout) { Sfx.play('ui_deny'); say(vpick(['Too slow! The claw has a schedule.', 'Time! It lets go on its own.']), 2.2); }
          break;
        case 'win': onWin(d); break;
        case 'turnEnd': {
          Telemetry.grabEnd(d.result, d.won);
          Save.soon();
          Rig.onTurnEnd(d); // bad luck fills the Luck meter
          if (Rig.on && d.result !== 'win') {
            if (!Game.seen.luckHint) { Game.seen.luckHint = true; luckHint = 5; setTimeout(() => { if (Engine.sceneName === 'claw') say('Bad luck is worth something here. Watch the LUCK meter.', 3.4); }, 250); }
            else if (d.redo && Rig.luck >= Rig.cost('redo') && !Game.seen.redoHint) { Game.seen.redoHint = true; cellPulse.redo = 7; setTimeout(() => { if (Engine.sceneName === 'claw') say('Want that one back? REDO turns back time. Press ' + Settings.hint('redo') + '.', 3.4); }, 250); }
          }
          if (d.result === 'miss' && !missShown) {
            Sfx.play('miss');
            if (!Game.talk.visible() || vchance(0.5)) say(vpick(['Nothing. Very zen.', 'You grabbed air. Air is free, by the way.', 'The pile says no.', 'Close. Ish.', 'Aim for the middle of it.']), 2.2);
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
          if (d.held || vchance(0.5)) Sfx.play('twitch', { intensity: d.held ? 0.9 : 0.4 });
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
    Game.tally('parts');
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
      for (let i = 0; i < 40; i++) fxW.add({ x: vrand(10, 170), y: vrand(-10, 20), vx: vrand(-20, 20), vy: vrand(10, 40), ay: 40, life: vrand(1.2, 2.2), color: vpick([PAL.l, PAL.L, PAL.W, PAL.R]), size: vpick([1, 2]) });
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
    say(p.from && order < 3 ? vpick([`${poss(p.from)} ${def.name}. Welcome home.`, `Oh. ${poss(p.from)} ${def.name}. Hello again.`, `${p.from} did say they'd be back.`]) : vpick(lines), 2.6);
    if (!d.inTurn) say('Free part! Don\'t tell the manager. I\'m the manager.', 2.6);
  }

  // the machine never runs dry (rule lives in Game.topUpMachine); the Reaper just announces it
  function topUp() {
    if (Game.topUpMachine()) setTimeout(() => say('Running low! Let me fetch more from the back room.', 3), 900);
  }

  // ---------------------------------------------------------------- the Rig
  // Every lever goes through Rig.use(); the scene only adds sound, light and words.
  function pull(id) {
    if (picker || !Rig.on) return;
    if (id === 'order') { // a menu first: which slot?
      const c = Rig.can('order');
      if (!c.ok) { Rig.emit('deny', { name: id, why: c.why, cost: c.cost }); return; }
      picker = { sel: Math.max(0, ORDER_SLOTS.indexOf(Rig.suggestSlot())), t0: Engine.realT };
      buildPickerButtons();
      Sfx.play('ui_click');
      return;
    }
    cellPulse[id] = 0;
    Rig.use(id);
  }

  function tipFor(id) {
    const T = RIG_TRICKS[id], c = Rig.can(id), cost = Rig.cost(id), armed = id === 'grip' && Game.sim.iron;
    const lines = [{ t: armed ? 'Iron Grip: ARMED' : T.name + (cost ? '   ' + cost + ' LUCK' : '   FREE'), c: T.color }];
    for (const l of T.tip) lines.push({ t: l, c: '#ecdcbc' });
    const why = { luck: 'Not enough Luck.', tilt: 'The machine is tilted.', busy: 'Not right now.', none: 'Only after a missed or slipped grab.' }[c.why];
    if (!c.ok && why) lines.push({ t: why, c: '#e8405a' });
    lines.push({ t: 'key ' + Settings.hint(id), c: '#7a6a9a' }); // whatever the player bound it to
    return lines;
  }

  // Luck, denials and the words that go with each lever.
  function onRig(type, d) {
    const inClaw = Engine.sceneName === 'claw';
    switch (type) {
      case 'luck':
        if (d.delta > 0) {
          Sfx.play('luck_gain', { pitch: 1 + 0.05 * d.delta });
          if (inClaw) {
            for (let i = Rig.luck - d.delta; i < Rig.luck; i++) pipPop[i] = 0.45;
            fxS.text(436, LAY.luck[0] + 6, '+' + d.delta + ' LUCK', '#f6c64b', { font: 'main', life: 1.1, vy: -16, drag: 1.5 });
            if (d.wasted > 0 && !Game.seen.luckFull) { Game.seen.luckFull = true; say('Your luck is overflowing. Use it or lose it.', 2.8); }
          }
        } else if (d.delta < 0 && inClaw && d.why !== 'tilt') fxS.text(436, LAY.luck[0] + 22, String(d.delta), '#e8405a', { font: 'main', life: 0.9, vy: -12, drag: 1.5 });
        break;
      case 'deny':
        if (!inClaw) break;
        Sfx.play('ui_deny');
        if (d.why === 'luck') { noLuckT = 1.2; say(vpick(['Not enough luck. Go fail a little more.', 'Luck is tight. Misfortune is a resource.', 'Short on luck. Try being unlucky.']), 2.2); }
        else if (d.why === 'tilt') say('TILT! Nothing works until it cools off.', 2);
        else if (d.why === 'none') say('Nothing to undo. Yet.', 1.6);
        break;
      case 'tilt':
        if (inClaw) say(vpick(['TILT! Hands off the glass!', 'Told you. Pinball rules.', 'The machine has feelings. Mostly anger.']), 2.6);
        break;
      case 'used':
        if (!inClaw) break;
        switch (d.name) {
          case 'quake': say(vpick(['Hold onto your bones!', 'Hope you like surprises.', 'The dead are restless today.', 'Shake it. Shake it ALL.']), 2.2); break;
          case 'nudgeL': case 'nudgeR':
            if (!d.tilt && vchance(0.35)) say(vpick(['Gentle...', 'Careful with the glass.', 'A little nudge never hurt. Much.']), 1.6);
            break;
          case 'grip':
            say(d.disarm ? 'Changed your mind? Luck refunded.' : vpick(['Iron grip. Try not to squeeze the life out of it.', 'A little necromancy on the prongs.', 'That claw is not letting go.']), 2.4);
            break;
          case 'order':
            Sfx.play('order');
            fxS.text(194, 70, 'SPECIAL ORDER', '#6fd3ff', { font: 'main', scale: 2, life: 1.4, vy: -6, drag: 0.6, outline: PAL.k });
            say(`One ${SLOT_NAMES[d.slot].toLowerCase()}, fresh from the back room.`, 2.6);
            break;
          case 'redo': say(vpick(['Rewinding. Don\'t ask how.', 'Never happened. Try again.', 'Time is cheap down here.']), 2.4); break;
        }
        break;
    }
  }
  Rig.onEvent = onRig;

  // The Lens, part two: the actual dice, shown when the claw closes.
  function showRoll(d) {
    if (!Rig.on || !CONFIG.lens) return;
    const hp = Game.sim.hub.getPosition();
    const [sx, sy] = toScreen(hp.x * PPM, hp.y * PPM + 12);
    const x = clamp(sx, 70, 320);
    if (!d.rolls.length) { fxS.text(x, sy, 'NOTHING IN THE CLAW', '#a6aec2', { life: 1.4, vy: -16, drag: 1.5 }); Sfx.play('roll_no'); return; }
    let any = false;
    d.rolls.forEach((r, i) => {
      any = any || r.hit;
      fxS.text(x, sy + i * 11, `${PART_DEFS[r.type].name.toUpperCase()} ${Math.round(r.chance * 100)}%  ${r.hit ? 'HELD!' : 'NO GRIP'}`, r.hit ? '#9be38f' : '#e8405a', { life: 1.8, vy: -14, drag: 1.5 });
    });
    Sfx.play(any ? 'roll_ok' : 'roll_no');
  }

  // ---- the Order menu (modal): pick a slot, the Reaper drops one in
  function pickerCells() {
    return ORDER_SLOTS.map((slot, i) => ({ slot, i, x: PK.x + 10 + (i % 3) * 68, y: PK.y + 28 + Math.floor(i / 3) * 44, w: 64, h: 40 }));
  }
  function buildPickerButtons() {
    pickerBtns = pickerCells().map((c) => ({ id: 'pk' + c.i, x: c.x, y: c.y, w: c.w, h: c.h, label: '', silent: true, cell: c, onClick: () => { picker.sel = c.i; confirmPicker(); } }));
  }
  function confirmPicker() {
    if (!picker) return;
    const slot = ORDER_SLOTS[picker.sel];
    picker = null;
    Input.mouse.down = false; // the button may still be held: don't let that steer the claw across the glass
    Rig.use('order', slot);
  }
  function updatePicker() {
    const sel = picker.sel, col = sel % 3, row = Math.floor(sel / 3);
    let n = sel;
    if (Input.hit('left')) n = row * 3 + (col + 2) % 3;
    if (Input.hit('right')) n = row * 3 + (col + 1) % 3;
    if (Input.hit('up') || Input.hit('down')) n = (1 - row) * 3 + col;
    if (Engine.realT - picker.t0 > 0.2) { // (a double-tap of 3 must not order slot 3, an Arm)
      for (let i = 0; i < 6; i++) if (Input.hit('Digit' + (i + 1)) || Input.hit('Numpad' + (i + 1))) { picker.sel = i; confirmPicker(); return; }
    }
    if (n !== sel) { picker.sel = n; Sfx.play('ui_hover'); }
    for (const b of pickerBtns) if (b.hover && Input.mouse.moved && picker.sel !== b.cell.i) { picker.sel = b.cell.i; Sfx.play('ui_hover'); }
    // a click outside the menu closes it. Consume the press: UI.update runs after this and would otherwise
    // hand the same click to whatever button is now under the pointer (QUAKE, DROP, BACK...)
    if (Input.mouse.pressed && !Input.over(PK.x, PK.y, PK.w, PK.h)) { picker = null; Input.mouse.pressed = false; Input.mouse.down = false; Sfx.play('ui_back'); }
  }

  function buildButtons() {
    const tap = (d) => () => { if (Settings.v.steering === 'toggle' && (Game.sim.state === 'idle' || Game.sim.state === 'carry')) { toggleDir = toggleDir === d ? 0 : d; toggleTarget = null; } };
    btn.left = { id: 'cl', x: 398, y: 219, w: 18, h: 16, label: '', hidden: false, silent: true, onClick: tap(-1) };
    btn.right = { id: 'cr', x: 418, y: 219, w: 18, h: 16, label: '', silent: true, onClick: tap(1) };
    btn.drop = { id: 'ca', x: 398, y: 236, w: 76, h: 14, label: 'DROP', silent: true, onClick: () => S.pressA() };
    btn.back = { id: 'cb', x: 398, y: 251, w: 76, h: 14, label: 'BACK', silent: true, onClick: () => S.back() };
    for (const [id, col, row] of CELLS) {
      btn['r_' + id] = { id: 'r_' + id, x: CELL.x[col], y: CELL.y[row], w: CELL.w, h: CELL.h, label: '', silent: true, onClick: () => pull(id) };
    }
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
    const chuteGlow = winFx > 0 ? (blinkOn(t, 5) ? 0.5 : 0.2) : 0.12 + 0.05 * Math.sin(t * 3);
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
    // Iron Grip: a gold halo on the claw head
    const iron = sim.iron || (sim.turn && sim.turn.iron);
    if (iron) Draw.glow(g, P.hubX, P.hubY + 12, 24 + ironFlash * 14, '#f6c64b', 0.3 + 0.1 * Math.sin(t * 6) + ironFlash * 0.3);
    // blinking status light on the claw head
    g.fillStyle = iron ? (blinkOn(t, 1.6) ? '#fff1a6' : '#f6c64b') : sim.state === 'idle' ? (Math.sin(t * 5) > 0 ? '#9be38f' : '#274536') : sim.grips.length ? '#f6c64b' : '#e8405a';
    const la = P.hubA;
    g.fillRect(Math.round(P.hubX + Math.cos(la) * 7 - Math.sin(la) * -1), Math.round(P.hubY + Math.sin(la) * 7 + Math.cos(la) * -1), 1, 1);

    // The Rig: while the machine is shaken (and until the next drop) the chute is sealed by a
    // wall of light that only parts collide with. Shaken parts can't spill out for free.
    if (sim.lid) {
      const a = 0.14 + 0.06 * Math.sin(t * 5);
      g.fillStyle = `rgba(111,211,255,${a})`; g.fillRect(M.guardX, 0, M.guardW, M.lipY);
      g.fillStyle = `rgba(194,245,255,${a + 0.22})`;
      for (let y = Math.floor(t * (Settings.v.reduceFlash ? 7 : 28)) % 7; y < M.lipY; y += 7) g.fillRect(M.guardX, y, M.guardW, 2);
    }
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
    const glow = rar.glow ? 0.55 + 0.45 * Math.sin(t * [0, 2, 4, 6][rar.order] + p.glowT) : 0; // a faster pulse means rarer, so the pile never relies on colour alone
    for (let i = 0; i < p.bodies.length; i++) {
      const b = p.bodies[i];
      const q = b.getPosition(), a = b.getAngle();
      const name = def.chain ? (i === p.bodies.length - 1 ? 'p_tailtip' : 'p_vert') : def.sprite;
      const s = SPR.get(name);
      g.save();
      g.translate(q.x * PPM, q.y * PPM);
      g.rotate(a);
      if (held && blinkOn(t, 2.5 + swayLvl)) { g.drawImage(SPR.outline(name, ['#fff6e3', '#f6c64b', '#e8405a'][swayLvl]), -s.w / 2 - 1, -s.h / 2 - 1); }
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
      const sim = Game.sim, calm = Settings.v.reduceFlash;
      if (sim.lockWhy === 'tilt' && sim.lockT > 0) { on = calm ? blinkOn(t, 1.2) : Math.sin(t * 9 + i * 0.4) > -0.2; col = '#ff5a5a'; }
      else if (sim.quakeS) { on = calm ? (i + Math.floor(t * 1.4)) % 2 === 0 : Math.sin(t * 41 + i * 12.9898) > 0.1; col = PAL.A; } // reduceFlash: a slow alternation
      if (winFx > 0) { on = Settings.v.reduceFlash ? (i + Math.floor(t * 1.5)) % 2 === 0 : Math.sin(t * 20 + i * 1.3) > 0; col = Settings.v.reduceFlash ? [PAL.l, PAL.r, PAL.C, PAL.p][i % 4] : vpick([PAL.l, PAL.r, PAL.C, PAL.p]); }
      else { const sp = Settings.v.reduceFlash ? 1.2 : 7; on = (i + Math.floor(t * sp)) % 4 === 0 || (i + Math.floor(t * sp)) % 4 === 1 && Game.sim.state !== 'idle'; col = PAL.l; }
      g.fillStyle = on ? col : '#6b3a1c';
      g.fillRect(x, y, 1, 1);
      if (on) { g.fillStyle = on ? 'rgba(255,241,166,0.35)' : ''; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); }
    }
  }

  function drawSideArt() {
    // Panels in buffer pixels (2x on screen): tokens + bag, Luck, the Reaper's box, THE RIG, controls.
    // Their text and icons are drawn crisp at 1x in drawOverlay.
    const sim = Game.sim, tilted = sim.lockWhy === 'tilt' && sim.lockT > 0;
    Draw.panel(g, 197, 3 - Math.round(tokenBump * 1), 42, 22, 'slate');
    Draw.panel(g, 197, LAY.luck[0] / 2, 42, LAY.luck[1] / 2, noLuckT > 0 && blinkOn(t, 3.8) ? 'red' : 'dark');
    Draw.panel(g, 197, LAY.talk[0] / 2, 42, LAY.talk[1] / 2, 'neon');
    if (!Game.talk.visible()) { // the neon sign, until the Reaper has something to say
      const dim = neonOff > 0;
      const col = dim ? '#5a2a48' : '#ff8ac6';
      if (!dim) Draw.glow(g, 218, 55, 26, '#b84a7c', 0.35);
      ['GRAB', 'SOME', 'FATE'].forEach((w, i) => {
        Font.draw(g, w, 218, 43 + i * 9, { color: col, align: 'center', shadow: dim ? null : '#6b1f48' });
      });
    }
    Draw.panel(g, 197, LAY.rig[0] / 2, 42, LAY.rig[1] / 2, tilted && Math.sin(t * 9) > -0.2 ? 'red' : 'dark');
    Draw.panel(g, 197, LAY.ctrl[0] / 2, 42, LAY.ctrl[1] / 2, 'dark');
  }

  // ---- Luck: eight horseshoes, filled by bad luck
  function drawLuckMeter(ctx) {
    const y = LAY.luck[0];
    if (!Rig.on) {
      Font.draw(ctx, 'LUCK', 402, y + 5, { font: 'small', color: '#5b4a78' });
      Font.draw(ctx, 'RIG OFF', 470, y + 5, { font: 'small', color: '#5b4a78', align: 'right' });
      return;
    }
    const low = noLuckT > 0 && blinkOn(t, 3.8);
    Font.draw(ctx, 'LUCK', 402, y + 5, { font: 'small', color: low ? '#e8405a' : '#f6c64b' });
    Font.draw(ctx, Rig.luck + '/' + CONFIG.luckMax, 470, y + 5, { font: 'small', color: '#ecdcbc', align: 'right' });
    const n = CONFIG.luckMax, step = Math.min(9, Math.floor(72 / n));
    for (let i = 0; i < n; i++) {
      const pop = pipPop[i] > 0, px = 406 + i * step;
      SPR.draw(ctx, i < Rig.luck ? 'ico_luck' : 'ico_luck_e', px, y + 18 - (pop ? 2 : 0));
      if (pop && blinkOn(t + i * 0.16, 6.4)) Draw.rect(ctx, px - 1, y + 13, 2, 2, '#fff6e3'); // glint on a fresh pip
    }
    if (luckHint > 0 && Math.sin(t * 6) > 0) Draw.frame(ctx, CX - 1, y - 1, CW + 2, LAY.luck[1] + 2, '#f6c64b');
  }

  // ---- the Reaper's speech: the bubble fills the whole box (his face moved out to make room for THE RIG)
  function drawSpeech(ctx) {
    const tk = Game.talk;
    if (!tk.visible()) return;
    const x = 398, y = LAY.talk[0] + 3, w = 76, maxH = LAY.talk[1] - 6;
    let font = 'main', lines = Font.wrap(tk.text, w - 12);
    if (lines.length * Font.lineHeight('main') + 6 > maxH) { font = 'small'; lines = Font.wrap(tk.text, w - 12, 'small'); } // a long line: smaller type
    const h = Math.min(maxH, lines.length * Font.lineHeight(font) + 8);
    Draw.panel(ctx, x, y, w, h, 'paper');
    Font.drawWrapped(ctx, tk.text, x + 6, y + 5, w - 12, { font, color: PAL.N, maxChars: Math.floor(tk.shown) });
  }

  // ---- THE RIG: six levers, the TILT gauge
  function drawRigPanel(ctx) {
    const sim = Game.sim, y0 = LAY.rig[0], tilted = sim.lockWhy === 'tilt' && sim.lockT > 0;
    Font.draw(ctx, 'THE RIG', 402, y0 + 5, { font: 'small', color: tilted ? '#ff8a8a' : '#ff8ac6' });
    if (!Rig.on) {
      Font.draw(ctx, 'OFFLINE', 436, y0 + 32, { font: 'small', color: '#5b4a78', align: 'center' });
      Font.draw(ctx, 'THE ORIGINAL CLAW', 436, y0 + 42, { font: 'small', color: '#3b3654', align: 'center' });
      return;
    }
    const hk = Rig.heat / CONFIG.tiltAt; // nudge heat: fill it and the next nudge TILTs the machine
    Font.draw(ctx, 'TILT', 436, y0 + 5, { font: 'small', color: hk > 0.66 || tilted ? '#e8405a' : '#7a6a9a' });
    const SEG = ['#9be38f', '#f6c64b', '#e8405a'];
    for (let i = 0; i < 3; i++) {
      const lit = tilted ? Math.sin(t * 9) > -0.2 : hk > i / 3 + 0.02;
      Draw.rect(ctx, 456 + i * 6, y0 + 4, 5, 5, lit ? SEG[i] : '#3b3654');
    }
    for (const [id] of CELLS) drawCell(ctx, btn['r_' + id], id);
  }

  function drawCell(ctx, b, id) {
    const T = RIG_TRICKS[id], c = Rig.can(id), sim = Game.sim;
    const cost = Rig.cost(id), armed = id === 'grip' && sim.iron, ok = c.ok || armed;
    const x = b.x, y = b.y + (b.held ? 1 : 0);
    Draw.panel(ctx, x, y, b.w, b.h, armed ? 'wood' : c.ok ? 'slate' : 'dark');
    if (b.hover) Draw.frame(ctx, x - 1, y - 1, b.w + 2, b.h + 2, ok ? '#fff6e3' : '#5b4a78');
    if (cellPulse[id] > 0 && Math.sin(t * 7) > 0) Draw.frame(ctx, x - 2, y - 2, b.w + 4, b.h + 4, '#ff8ac6'); // first-time hint
    if (armed && Math.sin(t * 8) > -0.3) Draw.frame(ctx, x - 1, y - 1, b.w + 2, b.h + 2, '#f6c64b');
    if (id === 'redo' && c.ok && Math.sin(t * 5) > 0) Draw.frame(ctx, x - 1, y - 1, b.w + 2, b.h + 2, '#e7a6f0'); // a redo is on offer
    const kn = Settings.hint(id); // the player's key (a long name like SPACE is cut to fit; the tooltip has it whole)
    Font.draw(ctx, kn.length > 3 ? kn.slice(0, 3) : kn, x + 3, y + 3, { font: 'small', color: ok ? '#8a7aa8' : '#4b4466' });
    if (cost > 0) {
      Font.draw(ctx, String(cost), x + b.w - 11, y + 3, { font: 'small', color: Rig.luck >= cost ? '#f6c64b' : '#e8405a' });
      SPR.draw(ctx, 'ico_luck_s', x + b.w - 5, y + 5);
    }
    SPR.draw(ctx, CELL_ICON[id], x + 12, y + 14, { alpha: ok ? 1 : 0.4 });
    Font.draw(ctx, armed ? 'ARMED' : T.label, x + 12, y + 20, { font: 'small', color: armed ? '#f6c64b' : ok ? '#ecdcbc' : '#5b4a78', align: 'center' });
  }

  // ---- the Lens: the odds of a drop right here, on the drop guide
  function drawLens(ctx) {
    if (!lens || !lens.part) return;
    // The number is the chance this drop holds SOMETHING (already calibrated by the sim); the name is
    // what sits under the claw. Green/yellow/red are cut on the calibrated number.
    const sim = Game.sim, P = sim.clawPose(), pct = Math.round(lens.chance * 100);
    const col = lens.chance >= 0.52 ? '#9be38f' : lens.chance >= 0.33 ? '#f6c64b' : '#e8405a';
    const a = 'HOLD ' + pct + '%', b = lens.part.def.name.toUpperCase(); // (the small font has no '~')
    const wa = Font.measure(a, 'small'), w = wa + Font.measure(b, 'small') + 14;
    const [sx, sy] = toScreen(P.carX, (P.hubY + 30 + lens.y) / 2);
    let x = Math.round(sx + 6);
    if (x + w > 372) x = Math.round(sx - 6 - w);
    const y = Math.round(sy) - 6;
    Draw.panel(ctx, x, y, w, 12, 'dark');
    Font.draw(ctx, a, x + 5, y + 3, { font: 'small', color: col });
    Font.draw(ctx, b, x + 9 + wa, y + 3, { font: 'small', color: '#a6aec2' });
    if (sim.iron) Font.draw(ctx, 'IRON GRIP', x + 5, y - 7, { font: 'small', color: '#f6c64b', outline: PAL.k });
  }

  // ---- rewinding: a tinted, scan-lined tape
  function drawRewind(ctx) {
    const sim = Game.sim;
    ctx.fillStyle = 'rgba(111,211,255,0.10)'; ctx.fillRect(14, 14, 360, 244);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let y = 14 + (Math.floor(t * (Settings.v.reduceFlash ? 6 : 50)) % 4); y < 258; y += 4) ctx.fillRect(14, y, 360, 1);
    ctx.fillStyle = 'rgba(194,245,255,0.12)'; ctx.fillRect(14, Math.round(14 + ((t * 160) % 238)), 360, 6); // a rolling glitch band
    if (Math.sin(t * 8) > -0.3) Font.draw(ctx, '◀◀ REWIND', 24, 22, { scale: 2, color: '#c2f5ff', outline: PAL.k });
    if (sim.rw) {
      const k = clamp(sim.stateT / sim.rw.dur, 0, 1);
      Draw.rect(ctx, 24, 44, 120, 3, PAL.k); Draw.rect(ctx, 25, 45, Math.round(118 * (1 - k)), 1, '#6fd3ff');
    }
  }

  // ---- the Order menu
  function drawPicker(ctx) {
    ctx.fillStyle = 'rgba(14,11,22,0.62)'; ctx.fillRect(14, 14, 360, 244);
    Draw.panel(ctx, PK.x, PK.y, PK.w, PK.h, 'dark');
    Font.draw(ctx, 'SPECIAL ORDER', PK.x + 10, PK.y + 9, { color: '#6fd3ff', shadow: PAL.k });
    const cost = Rig.cost('order');
    Font.draw(ctx, cost + ' LUCK', PK.x + PK.w - 10, PK.y + 9, { color: '#f6c64b', align: 'right', shadow: PAL.k });
    const counts = Rig.slotCounts(), need = Rig.suggestSlot();
    for (const b of pickerBtns) {
      const c = b.cell, sel = picker.sel === c.i;
      Draw.panel(ctx, c.x, c.y, c.w, c.h, sel ? 'wood' : 'slate');
      if (sel) Draw.frame(ctx, c.x - 1, c.y - 1, c.w + 2, c.h + 2, '#fff6e3');
      drawPartIcon(ctx, SLOT_ICON[c.slot], c.x + 19, c.y + 20, 26);
      Font.draw(ctx, String(c.i + 1), c.x + 4, c.y + 4, { font: 'small', color: '#8a7aa8' });
      Font.draw(ctx, SLOT_NAMES[c.slot].toUpperCase(), c.x + 36, c.y + 9, { font: 'small', color: '#ecdcbc' });
      Font.draw(ctx, 'OWN ' + counts[c.slot], c.x + 36, c.y + 18, { font: 'small', color: '#a6aec2' });
      if (need && c.slot === need) Font.draw(ctx, 'NEEDED', c.x + 36, c.y + 27, { font: 'small', color: '#9be38f' });
    }
    Font.draw(ctx, '1-6 OR CLICK TO ORDER  ·  ' + Settings.hint('b') + ' TO CANCEL', PK.x + PK.w / 2, PK.y + PK.h - 12, { font: 'small', color: '#7a6a9a', align: 'center' });
  }

  // The carry meter: how hard the load is swaying, so a slip is never a mystery. The word, the length of the
  // bar and its texture all say the same thing (steady / swaying / slipping), so colour is a bonus, not the message.
  function drawSway(ctx, cx, y) {
    const sw = Game.sim.swayInfo();
    if (!sw) return;
    const lvl = sw.ratio <= 1 ? 0 : sw.ratio <= 1.5 ? 1 : 2;
    const col = ['#9be38f', '#f6c64b', '#e8405a'][lvl];
    const x0 = cx - 21, w = 42, fill = Math.round(clamp(sw.ratio / 2, 0, 1) * (w - 2));
    Draw.rect(ctx, x0, y, w, 5, PAL.k);
    for (let i = 0; i < fill; i++) {
      if (lvl === 1 && i % 2) continue; // swaying: dotted
      if (lvl === 2 && i % 3 === 2) continue; // slipping: striped
      Draw.rect(ctx, x0 + 1 + i, y + 1, 1, 3, col);
    }
    Draw.rect(ctx, x0 + 1 + Math.round((w - 2) / 2), y - 1, 1, 7, '#fff6e3'); // the line between steady and swaying
    const word = ['STEADY', 'SWAYING', 'SLIPPING!'][lvl];
    if (lvl < 2 || blinkOn(t, 3)) Font.draw(ctx, word, cx, y + 7, { font: 'small', color: col, align: 'center', outline: PAL.k });
  }

  function drawOverlay(ctx) {
    const sim = Game.sim;
    // TOKENS, with the bag folded in underneath
    Font.draw(ctx, 'TOKENS', 436, 9 - Math.round(tokenBump * 2), { font: 'small', color: '#a6aec2', align: 'center' });
    const tk = String(Game.tokens);
    Font.draw(ctx, tk, 436, 15 - Math.round(tokenBump * 2), { scale: 3, color: Game.tokens > 0 ? '#fff6e3' : noTokenT > 0 && blinkOn(t, 2.5) ? '#e8405a' : '#7a6a9a', align: 'center', shadow: PAL.k });
    Draw.rect(ctx, 400, 40, 76, 1, '#3b3654');
    Font.draw(ctx, 'BAG', 402, 43 + Math.round(bagBump), { font: 'small', color: '#a6aec2' });
    Font.draw(ctx, String(Game.inventory.length), 470, 43 + Math.round(bagBump), { font: 'small', color: '#ecdcbc', align: 'right' });
    drawLuckMeter(ctx);
    drawSpeech(ctx);
    drawRigPanel(ctx);
    // flying prizes
    for (const f of flying) {
      if (f.t < 0) continue;
      const k = easeInOutQuad(clamp(f.t / f.dur, 0, 1));
      const x = lerp(f.x0, 452, k), y = lerp(f.y0, 44, k) - Math.sin(k * Math.PI) * 60;
      drawPartIcon(ctx, f.type, x, y, 22, { outline: RARITY[PART_DEFS[f.type].rarity].color });
    }
    // controls
    const ico = (name, x, y, fb) => (SPR.has(name) ? SPR.draw(ctx, name, x, y) : Font.draw(ctx, fb, x, y - 3, { align: 'center', color: '#ecdcbc' }));
    ico('key_left', 407, 227, '◀'); ico('key_right', 427, 227, '▶');
    Font.draw(ctx, 'MOVE', 442, 224, { color: '#ecdcbc' });
    for (const b of [btn.drop, btn.back]) {
      const hot = b.hover || b.held;
      const pulse = b === btn.back && noTokenT > 0 && blinkOn(t, 1.6);
      if (hot || pulse) Draw.rect(ctx, b.x, b.y, b.w, b.h, pulse ? '#5a1834' : '#2b2d3d');
      let lx = b.x + 20;
      if (Input.lastDevice === 'keys') { // keyboard players see their own keys, not gamepad glyphs
        const cap = Settings.hint(b === btn.drop ? 'a' : 'b'), cw = Font.measure(cap, 'small') + 5;
        Draw.rect(ctx, b.x + 1, b.y + 2, cw, 10, '#1b1526'); Draw.rect(ctx, b.x + 1, b.y + 2, cw, 9, '#3c4257'); Draw.rect(ctx, b.x + 1, b.y + 2, cw, 1, '#677089');
        Font.draw(ctx, cap, b.x + 3, b.y + 4, { font: 'small', color: '#ecdcbc' });
        lx = b.x + cw + 5;
      } else ico(b === btn.drop ? 'btn_a' : 'btn_b', b.x + 9, b.y + 7, b === btn.drop ? 'A' : 'B');
      const dead = b === btn.drop && ((Game.tokens <= 0 || sim.lockT > 0) && sim.state === 'idle' || !['idle', 'drop', 'carry'].includes(sim.state));
      Font.draw(ctx, b.label, lx, b.y + 4, { color: dead ? '#7a6a9a' : '#ecdcbc' });
    }
    if (chuteWarnT > 0 && blinkOn(t, 2.5)) Draw.frame(ctx, btn.left.x - 1, btn.left.y - 1, btn.left.w + 2, btn.left.h + 2, '#ff8ac6');
    if (btn.left.held || Input.held('left')) Draw.frame(ctx, btn.left.x, btn.left.y, btn.left.w, btn.left.h, '#fff6e3');
    if (btn.right.held || Input.held('right')) Draw.frame(ctx, btn.right.x, btn.right.y, btn.right.w, btn.right.h, '#fff6e3');

    // held part label + carry timer near the claw
    const gp = sim.grips[0] ? sim.grips[0].part : [...sim.held][0];
    if (gp && (sim.state === 'lift' || sim.state === 'carry' || sim.state === 'return')) {
      const [px, py] = sim.partPos(gp);
      const [sx, sy] = toScreen(px, py);
      const r = RARITY[gp.def.rarity];
      const txt = (gp.from ? poss(gp.from) + ' ' : '') + gp.def.name + (r.order ? ' · ' + r.name : '');
      const lx = clamp(sx, 90, 300);
      Font.draw(ctx, txt, lx, sy + 26, { color: r.color, align: 'center', outline: PAL.k });
      if (gp.def.set) Font.draw(ctx, PART_SETS[gp.def.set].name.toUpperCase() + ' SET', lx, sy + 37, { font: 'small', color: '#f6c64b', align: 'center', outline: PAL.k });
      drawSway(ctx, lx, sy + (gp.def.set ? 47 : 38));
    }
    if (sim.state === 'carry' && CONFIG.carryTime > 0) {
      const k = 1 - sim.stateT / CONFIG.carryTime;
      const [cx] = toScreen(sim.carX, 0);
      Draw.rect(ctx, cx - 16, 44, 32, 3, PAL.k);
      Draw.rect(ctx, cx - 15, 45, Math.max(0, 30 * k), 1, k < 0.3 && blinkOn(t, 3) ? PAL.R : PAL.d);
      const left = Math.max(0, Math.ceil(CONFIG.carryTime - sim.stateT));
      if (left <= 3) Font.draw(ctx, String(left), cx, 36, { font: 'small', color: '#fff6e3', align: 'center', outline: PAL.k }); // the number, not just the colour
    }
    // the first two carries: spell out steer -> chute -> release (nothing else teaches it).
    // The text sits on the side of the glass away from the claw so it never covers the held part.
    if (sim.state === 'carry' && (sim.grips.length || sim.held.size) && (Game.seen.carries || 0) <= 2) {
      const over = sim.carX > M.chuteX0 + 4, a = 0.75 + 0.2 * Math.sin(t * 6), cgx = (sim.carX + GX) * 2;
      const hx = cgx < 190 ? Math.min(cgx + 100, 296) : Math.max(cgx - 100, 100); // keep ~100 px clear of the claw
      const key = Input.lastDevice === 'keys' ? Settings.hint('a') : Input.lastDevice === 'pad' ? 'A' : 'THE RELEASE BUTTON';
      if (over) Font.draw(ctx, 'NOW RELEASE!  (' + key + ')', hx, 84, { font: 'small', color: '#9be38f', align: 'center', alpha: a, outline: PAL.k });
      else {
        Font.draw(ctx, 'STEER TO THE CHUTE  →', hx, 78, { font: 'small', color: '#e7d6ff', align: 'center', alpha: a, outline: PAL.k });
        Font.draw(ctx, 'THEN PRESS ' + key + ' TO RELEASE', hx, 89, { font: 'small', color: '#ff8ac6', align: 'center', alpha: a, outline: PAL.k });
        Font.draw(ctx, 'KEEP IT STEADY', hx, 100, { font: 'small', color: '#9be38f', align: 'center', alpha: a * 0.8, outline: PAL.k });
      }
    }
    // first-time controls hint, inside the glass, until the player does anything
    if (!movedOnce && sim.state === 'idle' && Game.tokens === CONFIG.startTokens) {
      const a = 0.55 + 0.25 * Math.sin(t * 3);
      Font.draw(ctx, Settings.v.steering === 'toggle' ? `${Settings.hint('left')} ${Settings.hint('right')} TO START AND STOP  or  TAP THE GLASS` : `${Settings.hint('left')} ${Settings.hint('right')}  or  HOLD MOUSE ON THE GLASS TO STEER`, 190, 96, { font: 'small', color: '#e7d6ff', align: 'center', alpha: a, outline: PAL.k });
      Font.draw(ctx, `THEN  DROP (${Settings.hint('a')})`, 190, 108, { font: 'small', color: '#ff8ac6', align: 'center', alpha: a, outline: PAL.k });
    }
    // first-time nudge: flash the controls if the player hasn't moved yet
    if (!movedOnce && idleT > 5 && blinkOn(t, 1)) Draw.frame(ctx, 396, 217, 80, 49, '#ff8ac6');

    drawLens(ctx);
    // TILT: the machine is sulking
    if (sim.lockWhy === 'tilt' && sim.lockT > 0) {
      if (Math.sin(t * 9) > -0.2) Font.draw(ctx, 'TILT', 194, 96, { scale: 6, color: '#e8405a', outline: PAL.k, align: 'center' });
      const k = clamp(sim.lockT / CONFIG.tiltLock, 0, 1);
      Draw.rect(ctx, 134, 146, 120, 4, PAL.k); Draw.rect(ctx, 135, 147, Math.round(118 * k), 2, '#e8405a');
    }
    if (sim.state === 'rewind') drawRewind(ctx);
    fxS.draw(ctx);
    if (picker) drawPicker(ctx);
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
