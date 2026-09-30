// ---------------------------------------------------------------------------
// SHOP SCENE — title screen and hub. The cabinet's window shows the live pile.
// COLLECT (claw) · COMBINE (slab) · COMMAND (graveyard).
// ---------------------------------------------------------------------------
Scenes.shop = (() => {
  const S = {};
  const fx = new Particles();
  let t = 0, titleT = 0, opened = false, zoom = null, blinkT = 0, chatT = 8, catT = 0, catMood = 0, lean = 0, tokenPop = 0;
  const MX = 6, MY = 4, MW = 194; // cabinet
  const GLX = MX + 7, GLY = 52; // glass (180x122 mini world)
  const REAPER_X = 300, COUNTER_Y = 196;
  const say = (x, h, force = true) => Game.talk.say(x, h, force);
  const IDLE_LINES = [
    'Everything\'s used. Nothing\'s cheap. That\'s the deal.',
    'One token, one grab. Life is simple when you\'re dead.',
    'Bodies. Power. A brighter tomorrow. It\'s on the poster, so it\'s true.',
    'I\'m told the claw is rigged. I\'m told a lot of things.',
    'The cat is not for sale. I asked.',
    'Every part in there was someone\'s favourite part once.',
    'Give them better parts. They\'ll give you better days.',
    'There\'s a panel on the side of the machine. I didn\'t put it there. Flip the switches.',
    'Bad luck isn\'t wasted here. I bank it. Ask me how I know.',
  ];

  function hint() {
    if (Game.tokens > 0 && !Game.inventory.length && !Game.party.length) return 'collect';
    if (Game.inventory.length >= 3 && Game.party.length < 3 && (Game.tokens === 0 || Game.inventory.length >= 5)) return 'combine';
    if (Game.party.length && (Game.tokens === 0 || !Game.inventory.length)) return 'command';
    if (Game.tokens > 0) return 'collect';
    if (Game.inventory.length) return 'combine';
    return null;
  }

  S.enter = function (params) {
    Music.play('shop');
    zoom = null;
    if (opened) {
      if (Game.broke()) { Game.givePity(); say('Broke? Here. On the house. Death is patient.', 3.5); tokenPop = 1; }
      else if (Game.stage > 1 && !Game.seen['stage' + Game.stage]) { Game.seen['stage' + Game.stage] = 1; say(pick(['Welcome back, champion. The machine restocked itself. Funny, that.', 'Fresh parts in the machine. Some of them are your old friends.']), 3.5); }
      else if (chance(0.5)) say(pick(['Welcome back.', 'Good parts make great friends.', 'The machine missed you. It told me.']), 2.4);
    }
    if (params && params.skipIntro) open();
  };

  function open() {
    if (opened) return;
    opened = true;
    AudioSys.init();
    Sfx.play('coin');
    say('Good parts make great friends.', 2.4);
    Game.talk.say(`Here. ${Game.tokens} tokens. The first ones are always free.`, 3.2, false);
    tokenPop = 1;
    Telemetry.log('open');
  }

  function goClaw() {
    if (zoom) return;
    zoom = { t: 0 };
    Sfx.play('transition');
  }

  S.update = function (dt) {
    t += dt;
    Game.talk.update(dt);
    fx.update(dt);
    tokenPop = Math.max(0, tokenPop - dt * 2);
    blinkT -= dt;
    if (blinkT < -0.14) blinkT = rand(2, 5);
    catT += dt;
    catMood = Math.max(0, catMood - dt);
    lean = approach(lean, Game.talk.visible() ? 1 : 0, dt * 3);
    if (!opened) {
      titleT += dt;
      if (Input.anyPressed || Input.mouse.pressed) open();
      UI.set([]);
      return;
    }
    if (zoom) {
      zoom.t += dt;
      if (zoom.t > 0.5) { Engine.go('claw', {}, 'dither'); zoom = null; }
      UI.set([]);
      return;
    }
    chatT -= dt;
    if (chatT < 0 && !Game.talk.visible()) { chatT = rand(14, 22); say(pick(IDLE_LINES), 3.2); }
    const h = hint();
    const signs = [
      { id: 'collect', label: 'COLLECT', y: 205, onClick: goClaw, tip: [{ t: 'The claw machine', c: '#ff8ac6' }, { t: `1 token per grab · you have ${Game.tokens}`, c: '#ecdcbc' }] },
      { id: 'combine', label: 'COMBINE', y: 223, onClick: () => Engine.go('slab'), tip: [{ t: 'The slab', c: '#9be38f' }, { t: `stitch parts into creatures · ${Game.inventory.length} parts`, c: '#ecdcbc' }] },
      { id: 'command', label: 'COMMAND', y: 241, disabled: !Game.canFight(), onClick: () => Engine.go('battle'),
        onDeny: () => say('You\'ll need a friend first. The slab is right there.', 2.6),
        tip: Game.canFight() ? [{ t: 'The graveyard', c: '#e8405a' }, { t: `stage ${Game.stage} · party of ${Game.party.length}`, c: '#ecdcbc' }] : 'Stitch a creature first.' },
    ].map((b) => Object.assign({ x: 398, w: 76, h: 16, style: 'wood', kind: 'sign', pulse: h === b.id }, b));
    signs.push({ id: 'machine', x: MX, y: MY, w: MW, h: 214, label: '', kind: 'hot', silent: true, onClick: goClaw, tip: 'Play the claw machine' });
    signs.push({ id: 'cat', x: 424, y: 176, w: 24, h: 20, label: '', kind: 'hot', silent: true, onClick: () => { catMood = 1.5; Sfx.play('meow'); say(pick(['The cat is not for sale.', 'He bites. Affectionately.', 'That\'s Mr. Whiskers. He\'s been dead for years. Don\'t tell him.']), 2.4); } });
    signs.push({ id: 'reaper', x: REAPER_X - 22, y: 150, w: 44, h: 46, label: '', kind: 'hot', silent: true, onClick: () => { say(pick(IDLE_LINES), 3); chatT = 18; } });
    S.signs = signs;
    UI.set(signs);
    const sg = signs.filter((b) => b.kind === 'sign');
    if (Input.hit('up')) { S.sel = ((S.sel == null ? 0 : S.sel) + 2) % 3; Sfx.play('ui_hover'); }
    if (Input.hit('down')) { S.sel = ((S.sel == null ? -1 : S.sel) + 1) % 3; Sfx.play('ui_hover'); }
    if (Input.hit('a')) {
      const b = sg[S.sel == null ? 0 : S.sel];
      if (b.disabled) { Sfx.play('ui_deny'); b.onDeny && b.onDeny(); } else { Sfx.play('ui_click'); b.onClick(); }
    }
  };

  function drawCabinet(ctx) {
    // body
    const body = '#5a1834', hi = '#8a2a4e', lo = '#34101f', dark = '#220913';
    Draw.rect(ctx, MX, MY + 44, MW, 216, dark);
    Draw.rect(ctx, MX + 1, MY + 45, MW - 2, 214, body);
    Draw.rect(ctx, MX + 1, MY + 45, 2, 214, hi);
    Draw.rect(ctx, MX + MW - 3, MY + 45, 2, 214, lo);
    // marquee
    Draw.rect(ctx, MX - 2, MY, MW + 4, 44, dark);
    Draw.rect(ctx, MX, MY + 2, MW, 40, '#2b0a1a');
    Draw.rect(ctx, MX + 3, MY + 5, MW - 6, 34, '#6d1438');
    Draw.rect(ctx, MX + 3, MY + 5, MW - 6, 1, '#b0224a');
    Draw.glow(ctx, MX + MW / 2, MY + 20, 90, '#e8405a', 0.18);
    Font.draw(ctx, 'THE GOOD PARTS', MX + MW / 2 - 8, MY + 8, { scale: 2, color: '#fff1d6', outline: '#3a0c20', shadow: '#1b0610', align: 'center' });
    if (SPR.has('skull_small')) SPR.draw(ctx, 'skull_small', MX + MW - 18, MY + 16); else if (SPR.has('ico_skull')) SPR.draw(ctx, 'ico_skull', MX + MW - 18, MY + 16);
    Font.draw(ctx, 'COLLECT · REANIMATE · CONQUER', MX + MW / 2, MY + 29, { font: 'small', color: '#ffb8c8', align: 'center' });
    // marquee bulbs
    for (let i = 0; i < 22; i++) {
      const x = MX + 4 + i * 9;
      const on = (i + Math.floor(t * 5)) % 3 === 0 || !opened && Math.sin(t * 6 + i) > 0.3;
      Draw.rect(ctx, x, MY + 1, 2, 2, on ? PAL.l : '#6b3a1c');
      Draw.rect(ctx, x, MY + 41, 2, 2, !on ? PAL.l : '#6b3a1c');
    }
    // glass with the live pile
    Draw.rect(ctx, GLX - 3, GLY - 3, 186, 128, lo);
    Draw.rect(ctx, GLX - 2, GLY - 2, 184, 126, '#6b6f86');
    Scenes.claw.drawMini(ctx, GLX, GLY);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(GLX + 30, GLY); ctx.lineTo(GLX + 60, GLY); ctx.lineTo(GLX + 5, GLY + 122); ctx.lineTo(GLX - 25 > GLX ? GLX : GLX, GLY + 122); ctx.fill();
    Draw.glow(ctx, GLX + 90, GLY + 60, 110, '#b84a7c', 0.08);
    // control panel
    const py = GLY + 128;
    Draw.rect(ctx, MX + 4, py, MW - 8, 34, '#3a0f22');
    Draw.rect(ctx, MX + 4, py, MW - 8, 1, hi);
    // joystick
    Draw.rect(ctx, MX + 30, py + 18, 30, 10, '#1b0610');
    Draw.rect(ctx, MX + 44, py + 8, 2, 12, '#a6aec2');
    const jx = Input.held('left') ? -2 : Input.held('right') ? 2 : 0;
    Draw.rect(ctx, MX + 42 + jx, py + 5, 6, 6, '#e8405a');
    Draw.rect(ctx, MX + 43 + jx, py + 6, 2, 2, '#ff7d8a');
    Font.draw(ctx, '← →', MX + 45, py + 22, { font: 'small', color: '#ffb8c8', align: 'center' });
    // coin display
    Draw.panel(ctx, MX + 110, py + 6, 70, 22, 'dark');
    Font.draw(ctx, '1', MX + 118, py + 9, { scale: 2, color: '#ff8ac6' });
    Font.draw(ctx, 'TOKEN', MX + 132, py + 12, { color: '#ffb8c8' });
    // lower body: prize door
    const ly = py + 38;
    Draw.rect(ctx, MX + 20, ly + 6, 60, 30, '#220913');
    Draw.rect(ctx, MX + 22, ly + 8, 56, 26, '#2b0a1a');
    Font.draw(ctx, 'PRIZE', MX + 50, ly + 17, { font: 'small', color: '#8a2a4e', align: 'center' });
    Draw.rect(ctx, MX + 120, ly + 6, 50, 30, '#220913');
    for (let i = 0; i < 4; i++) Draw.rect(ctx, MX + 124, ly + 11 + i * 6, 42, 2, '#34101f');
  }

  S.draw = function (ctx) {
    ctx.save();
    if (zoom) {
      const k = easeInOutQuad(clamp(zoom.t / 0.5, 0, 1));
      const s = 1 + k * 1.6;
      const cx = GLX + 90, cy = GLY + 61;
      ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
    }
    BG.shop(ctx, t, { layer: 'back' });
    // the reaper behind the counter
    const talking = Game.talk.talking() && Math.sin(t * 24) > 0;
    let rs = 'reaper_idle';
    if (talking && SPR.has('reaper_talk')) rs = 'reaper_talk';
    else if (blinkT < 0 && SPR.has('reaper_blink')) rs = 'reaper_blink';
    if (lean > 0.5 && !talking && SPR.has('reaper_lean') && catMood <= 0) rs = 'reaper_lean';
    const breathe = Math.round(Math.sin(t * 1.6) * 1);
    if (SPR.has(rs)) SPR.draw(ctx, rs, REAPER_X, 202 + breathe);
    BG.shop(ctx, t, { layer: 'front' }); // counter in front of him
    drawCabinet(ctx);
    // cat with swishing tail
    if (SPR.has('cat_sit')) {
      const cx = 436, cy = COUNTER_Y + 1;
      const tail = 'cat_tail' + [0, 1, 2, 1][Math.floor(t * (catMood > 0 ? 8 : 2.5)) % 4];
      if (SPR.has(tail)) SPR.draw(ctx, tail, cx + 6, cy - 3);
      SPR.draw(ctx, Math.sin(t * 0.9) > 0.97 || catMood > 0 && Math.sin(t * 10) > 0 ? 'cat_blink' : 'cat_sit', cx, cy - (catMood > 1.2 ? 2 : 0));
    }
    // poster text
    const ink = '#4c2270';
    Font.draw(ctx, 'BODIES', 437, 54, { color: ink, align: 'center' });
    Font.draw(ctx, '> POWER', 437, 66, { font: 'small', color: ink, align: 'center' });
    Font.draw(ctx, '> A BRIGHTER', 437, 75, { font: 'small', color: ink, align: 'center' });
    Font.draw(ctx, 'TOMORROW', 437, 83, { font: 'small', color: ink, align: 'center' });
    if (SPR.has('ico_skull')) SPR.draw(ctx, 'ico_skull', 437, 101, { alpha: 0.7 });
    // signs
    for (const b of S.signs || []) {
      if (b.kind !== 'sign') continue;
      UI.drawButton(ctx, b);
      if (b.pulse && opened && Math.sin(t * 5) > 0) Draw.frame(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 4, '#ff8ac6');
      if (S.sel != null && (S.signs || []).filter((q) => q.kind === 'sign')[S.sel] === b) { Draw.frame(ctx, b.x - 1, b.y - 1, b.w + 2, b.h + 2, '#fff6e3'); Font.draw(ctx, '▶', b.x - 8, b.y + 4, { color: '#fff6e3' }); }
    }
    // HUD
    const hudLuck = Rig.on;
    Draw.panel(ctx, 206, 4, (hudLuck ? 104 : 70) + (Game.bestStage ? 38 : 0), 16, 'dark');
    if (SPR.has('ico_token')) SPR.draw(ctx, 'ico_token', 216, 12);
    Font.draw(ctx, String(Game.tokens), 224, 8 - Math.round(tokenPop * 3), { color: PAL.L });
    Font.draw(ctx, 'PARTY ' + Game.party.length, 270, 9, { font: 'small', color: '#a6aec2', align: 'right' });
    if (hudLuck) {
      SPR.has('ico_luck_s') && SPR.draw(ctx, 'ico_luck_s', 283, 12);
      Font.draw(ctx, String(Rig.luck), 290, 8, { color: '#f6c64b' });
    }
    if (Game.bestStage) Font.draw(ctx, 'BEST ' + Game.bestStage, hudLuck ? 346 : 308, 9, { font: 'small', color: '#9be38f', align: 'right' });
    // speech bubble
    if (Game.talk.visible()) Game.talk.drawBubble(ctx, REAPER_X - 70, 150, 170, REAPER_X - 8, 158, { anchorBottom: true });
    fx.draw(ctx);
    ctx.restore();
    // title overlay
    if (!opened) {
      ctx.fillStyle = 'rgba(14,11,22,0.45)'; ctx.fillRect(0, 0, W, H);
      const k = clamp(titleT / 0.8, 0, 1);
      Font.draw(ctx, 'THE GOOD PARTS', 240, 92 - Math.round((1 - easeOutBack(k)) * 30), { scale: 4, color: '#fff1d6', outline: '#3a0c20', shadow: '#b0224a', align: 'center', alpha: k });
      Font.draw(ctx, 'a claw machine necromancer prototype', 240, 132, { color: '#cdb892', align: 'center', alpha: k, outline: PAL.k });
      if (Math.sin(t * 4) > -0.2) Font.draw(ctx, Input.lastDevice === 'touch' ? 'TAP TO OPEN THE SHOP' : 'CLICK OR PRESS ANY KEY', 240, 176, { color: '#ff8ac6', align: 'center', outline: PAL.k });
      Font.draw(ctx, '← →  MOVE    SPACE  DROP    Q E  NUDGE    1-4  RIG    ESC  BACK    M  MUTE    F  FULLSCREEN', 240, 252, { font: 'small', color: '#7a6a9a', align: 'center' });
    }
  };

  return S;
})();
