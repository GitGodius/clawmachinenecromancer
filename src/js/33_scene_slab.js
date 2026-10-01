// ---------------------------------------------------------------------------
// SLAB SCENE — stitch parts into a creature, then BRING TO LIFE.
// Click a part in the inventory to stitch it on; click a slot to take it off.
// ---------------------------------------------------------------------------
Scenes.slab = (() => {
  const S = {};
  const fx = new Particles();
  let t = 0, page = 0, jolt = 0, selected = null, life = null, lastStitch = null;
  let build = null; // { head: item|null, ... }
  const CELL_W = 34, CELL_H = 30, COLS = 3, ROWS = 5, PER = COLS * ROWS;
  const FEET_X = 240, FEET_Y = 208;
  const say = (x, h) => Game.talk.say(x, h);
  const emptyBuild = () => ({ head: null, torso: null, armL: null, armR: null, legL: null, legR: null, heart: null, back: null });
  const types = () => { const o = {}; for (const k in build) o[k] = build[k] ? build[k].type : null; return o; };
  const count = () => Object.values(build).filter(Boolean).length;

  S.enter = function () {
    if (!build) build = emptyBuild();
    Music.play('slab');
    life = null;
    selected = null;
    if (!Game.seen.slab) {
      Game.seen.slab = true;
      say(Game.inventory.length ? 'The slab. Click a part to stitch it on. Any combination works. Some work better.' : 'Nothing to stitch. The machine is that way.', 4);
    } else if (!Game.inventory.length && !count()) say('Empty-handed? The claw awaits.', 2.5);
  };
  S.exit = function () {};

  function stitch(item) {
    const d = PART_DEFS[item.type];
    let slot = d.slot;
    if (slot === 'arm') slot = !build.armR ? 'armR' : !build.armL ? 'armL' : 'armR';
    if (slot === 'leg') slot = !build.legR ? 'legR' : !build.legL ? 'legL' : 'legR';
    const setsBefore = setsOf(types());
    Game.takeItem(item.uid);
    if (build[slot]) Game.inventory.push(build[slot]);
    build[slot] = item;
    lastStitch = { slot, t: 0 };
    jolt = 0.25;
    Sfx.play('stitch');
    const L = rigLayout(types());
    const pt = { head: L.neck, torso: [0, L.ty], armL: L.shL, armR: L.shR, legL: L.hipL, legR: L.hipR, heart: L.heart, back: L.back }[slot] || [0, -30];
    fx.burst(FEET_X + pt[0] * 2, FEET_Y + pt[1] * 2, 10, { speed: 50, life: 0.45, ay: 60, color: ['#9be38f', '#fff6e3', '#4fae6c'] });
    Telemetry.log('stitch', { part: item.type, slot });
    if (chance(0.3)) say(pick(['Snug.', 'It fits. Mostly.', 'Needle, thread, hope.', 'Ooh, that suits them.', 'Stitch, stitch, stitch.', 'Lovely. Horrible. Lovely.']), 1.6);
    if (item.type === 'pegleg' && chance(0.6)) say('A peg leg. Classic look. Terrible posture.', 2.2);
    for (const k of setsOf(types())) { // a set just came together: make a moment of it
      if (setsBefore.includes(k)) continue;
      const S = PART_SETS[k];
      Sfx.play('win_uncommon');
      fx.burst(FEET_X, FEET_Y - 60, 26, { speed: 100, life: 0.8, ay: 30, color: ['#f6c64b', '#fff1a6', '#fff6e3'] });
      fx.text(FEET_X, FEET_Y - 150, S.name.toUpperCase() + ' SET!', '#f6c64b', { font: 'main', life: 1.8, vy: -12 });
      fx.text(FEET_X, FEET_Y - 136, S.desc, '#fff1a6', { life: 1.8, vy: -12 });
      Telemetry.c.sets++;
      say(pick([`The ${S.name} set! ${S.desc}. Now we're getting somewhere.`, `${S.name} set complete. ${S.desc}. Lovely.`]), 3.2);
    }
  }
  function unstitchSlot(slot) {
    if (!build[slot]) return;
    Game.inventory.push(build[slot]);
    build[slot] = null;
    Sfx.play('unstitch');
    jolt = 0.15;
  }
  function canBring() { return count() > 0 && Game.party.length < 3 && !life; }

  function bringToLife() {
    if (!canBring()) return;
    const c = new Creature(types());
    life = { t: 0, c, bolts: [], stage: 0 };
    Music.duck(0.7, 3);
    Sfx.play('zap');
    Telemetry.c.creatures++;
    Telemetry.log('create', { name: c.name, parts: c.parts().join(',') });
  }

  function finishLife() {
    const c = life.c;
    c.born = Engine.t;
    Game.party.push(c);
    build = emptyBuild();
    life = null;
    say(pick(['Not pretty. But it\'ll fight.', 'Look at them go. Well. Look at them.', 'It\'s alive! Ish.', 'A face only a necromancer could love.']), 3);
    Game.talk.say(`Meet ${c.name}. Take them to the graveyard.`, 3.2, false);
  }

  function items() { return Game.inventory.slice().sort((a, b) => RARITY[PART_DEFS[b.type].rarity].order - RARITY[PART_DEFS[a.type].rarity].order || a.type.localeCompare(b.type)); }

  function partTip(type, extra, item) {
    const d = PART_DEFS[type], r = RARITY[d.rarity];
    const lines = [{ t: d.name, c: r.color }, { t: `${r.name} ${SLOT_NAMES[d.slot]}`, c: '#7a6a9a' }];
    if (item && item.from) lines.push({ t: `Once ${poss(item.from)}`, c: '#a08962' });
    if (d.set) {
      const S = PART_SETS[d.set], have = Object.values(types()).filter((x) => x && PART_DEFS[x].set === d.set).length;
      lines.push({ t: `${S.name} set ${Math.min(have, S.need)}/${S.need}: ${S.desc}`, c: have >= S.need ? '#f6c64b' : '#c9a24a' });
    }
    const st = [];
    if (d.hp) st.push('HP +' + d.hp);
    if (d.atk) st.push('ATK +' + d.atk);
    if (d.spd) st.push('SPD +' + d.spd);
    if (d.def) st.push('DEF +' + d.def);
    if (st.length) lines.push({ t: st.join('  '), c: '#ecdcbc' });
    if (d.trait) lines.push({ t: TRAITS[d.trait].name + ': ' + TRAITS[d.trait].desc, c: '#9be38f' });
    if (extra) lines.push({ t: extra, c: '#a08962' });
    return lines;
  }

  S.update = function (dt) {
    t += dt;
    jolt = Math.max(0, jolt - dt);
    fx.update(dt);
    Game.talk.update(dt);
    if (lastStitch) lastStitch.t += dt;
    if (life) {
      life.t += dt;
      const lt = life.t;
      if (life.stage === 0 && lt > 0.45) {
        life.stage = 1;
        Sfx.play('thunder');
        Engine.flash('#e7f7ff', 0.25);
        Engine.shake(5, 0.5);
        Engine.hitPause(0.08);
        for (let i = 0; i < 3; i++) life.bolts.push({ x0: FEET_X + rand(-60, 60), seed: randInt(1, 999), t: 0 });
      }
      if (life.stage >= 1 && lt < 1.3 && chance(dt * 30)) {
        fx.burst(FEET_X + rand(-30, 30), FEET_Y - rand(10, 120), 3, { speed: 70, life: 0.25, color: ['#c2f5ff', '#fff', '#9be38f'] });
        if (chance(dt * 8)) Sfx.play('zap', { intensity: 0.4 });
      }
      if (life.stage === 1 && lt > 1.35) { life.stage = 2; Sfx.play('alive'); fx.burst(FEET_X, FEET_Y - 60, 30, { speed: 90, life: 0.8, ay: 40, color: ['#9be38f', '#fff6e3', '#4fae6c'] }); }
      if (life.stage === 2 && lt > 3.2) finishLife();
    }
    if (Input.hit('b') && !life) Engine.go('shop');
    if (Input.hit('a') && !life && canBring()) bringToLife();
    buildButtons();
  };

  function buildButtons() {
    const bs = [];
    const list = items();
    const pages = Math.max(1, Math.ceil(list.length / PER));
    page = clamp(page, 0, pages - 1);
    list.slice(page * PER, page * PER + PER).forEach((it, i) => {
      const x = 9 + (i % COLS) * (CELL_W + 2), y = 21 + Math.floor(i / COLS) * (CELL_H + 2);
      bs.push({ id: 'inv' + it.uid, x, y, w: CELL_W, h: CELL_H, label: '', item: it, kind: 'cell', silent: true, disabled: !!life,
        tip: partTip(it.type, 'click to stitch on', it), onClick: () => stitch(it) });
    });
    if (pages > 1) {
      bs.push({ id: 'pgL', x: 9, y: 182, w: 18, h: 12, label: '◀', onClick: () => { page--; Sfx.play('page'); } });
      bs.push({ id: 'pgR', x: 97, y: 182, w: 18, h: 12, label: '▶', onClick: () => { page++; Sfx.play('page'); } });
    }
    RIG_SLOTS.forEach(([slot], i) => {
      const it = build[slot];
      bs.push({ id: 'slot' + slot, x: 366, y: 20 + i * 17, w: 106, h: 16, label: '', kind: 'slot', slot, silent: true, disabled: !it || !!life,
        tip: it ? partTip(it.type, 'click to unstitch', it) : null, onClick: () => unstitchSlot(slot) });
    });
    bs.push({ id: 'life', x: 364, y: 200, w: 110, h: 22, label: 'BRING TO LIFE', style: 'green', disabled: !canBring(), kind: 'big', sound: 'ui_click',
      tip: Game.party.length >= 3 ? 'Party is full (3). Unstitch someone first.' : count() ? null : 'Stitch at least one part on.', onClick: bringToLife });
    Game.party.forEach((c, i) => {
      bs.push({ id: 'pty' + c.id, x: 9 + i * 36, y: 214, w: 34, h: 40, label: '', kind: 'party', c, silent: true, disabled: !!life,
        tip: [{ t: c.name, c: '#9be38f' }, { t: `HP ${Math.ceil(c.hp)}/${c.maxHp}  ATK ${c.atk}  SPD ${c.spd}`, c: '#ecdcbc' }, ...(c.kills ? [{ t: `${c.kills} kill${c.kills > 1 ? 's' : ''} so far`, c: '#a08962' }] : []), ...c.traits.map((x) => ({ t: TRAITS[x].name, c: '#7a6a9a' })), { t: selected === c ? 'click again to UNSTITCH' : 'click to select', c: '#a08962' }],
        onClick: () => {
          if (selected === c) {
            Game.party = Game.party.filter((x) => x !== c);
            for (const tp of c.parts()) Game.inventory.push(makePartItem(tp));
            selected = null;
            Sfx.play('unstitch');
            Telemetry.c.unstitched++;
            say(pick([`${c.name.split(' ')[0]} is parts again. Circle of life.`, 'Back to bits. No hard feelings.']), 2.4);
          } else { selected = c; Sfx.play('ui_click'); }
        } });
    });
    bs.push({ id: 'back', x: 124, y: 4, w: 50, h: 14, label: '◀ SHOP', onClick: () => Engine.go('shop') });
    bs.push({ id: 'fight', x: 306, y: 4, w: 50, h: 14, label: 'FIGHT ▶', disabled: !Game.canFight() || !!life, style: 'red',
      tip: Game.canFight() ? null : 'Bring someone to life first.', onClick: () => Engine.go('battle') });
    S.buttons = bs;
    UI.set(bs);
  }

  S.draw = function (ctx) {
    BG.lab(ctx, t, { surge: life ? clamp(life.stage === 1 ? 1 - (life.t - 0.45) : life.stage === 2 ? 0.3 : life.t, 0, 1) : 0 });
    // creature on the slab
    const ty = types();
    const shakeX = life && life.stage === 1 ? rand(-2, 2) : jolt > 0 ? Math.round(Math.sin(jolt * 60) * 1) : 0;
    const shakeY = life && life.stage === 1 ? rand(-2, 2) : 0;
    if (life && life.stage >= 1 && life.t < 1.2) {
      ctx.fillStyle = 'rgba(14,11,22,0.55)'; ctx.fillRect(0, 0, W, H);
    }
    drawCreature(ctx, ty, FEET_X + shakeX, FEET_Y + shakeY, {
      scale: 2, t, anim: 'idle', ghost: life ? null : 'rgba(155,227,143,0.16)', noLump: !count(),
      eyes: life && life.stage >= 2 ? '#9be38f' : null,
      flash: life && life.stage === 1 && Math.sin(life.t * 50) > 0,
    });
    if (life && life.stage >= 1 && life.t < 1.3) {
      for (const b of life.bolts) {
        if (Math.sin(life.t * 40 + b.seed) > -0.3) {
          Draw.bolt(ctx, b.x0, 0, FEET_X + rand(-20, 20), FEET_Y - rand(40, 110), '#e7f7ff', 10, b.seed + Math.floor(life.t * 20));
          Draw.glow(ctx, FEET_X, FEET_Y - 70, 90, '#6fd3ff', 0.25);
        }
      }
    }
    fx.draw(ctx);
    if (life && life.stage >= 2) {
      const k = clamp((life.t - 1.35) / 0.3, 0, 1);
      const y = 40 - Math.round((1 - easeOutBack(k)) * 20);
      Font.draw(ctx, 'IT\'S ALIVE!', 240, y, { scale: 3, color: '#9be38f', outline: PAL.k, shadow: '#274536', align: 'center', alpha: k });
      Font.draw(ctx, life.c.name, 240, y + 28, { color: '#fff6e3', outline: PAL.k, align: 'center', alpha: k });
    }

    // inventory panel
    Draw.panel(ctx, 4, 4, 114, 196, 'slate');
    Font.draw(ctx, 'INVENTORY', 10, 9, { color: '#ecdcbc', shadow: PAL.k });
    Font.draw(ctx, String(Game.inventory.length), 112, 10, { font: 'small', color: '#7a6a9a', align: 'right' });
    const bs = S.buttons || [];
    const shownCells = bs.filter((b) => b.kind === 'cell').length;
    for (let i = 0; i < PER; i++) {
      const x = 9 + (i % COLS) * (CELL_W + 2), y = 21 + Math.floor(i / COLS) * (CELL_H + 2);
      if (i >= shownCells) { Draw.panel(ctx, x, y, CELL_W, CELL_H, 'dark'); }
    }
    for (const b of bs) {
      if (b.kind === 'cell') {
        const d = PART_DEFS[b.item.type], r = RARITY[d.rarity];
        Draw.panel(ctx, b.x, b.y, b.w, b.h, 'dark');
        if (r.glow) Draw.frame(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, r.glow);
        if (b.hover) Draw.frame(ctx, b.x - 1, b.y - 1, b.w + 2, b.h + 2, '#fff6e3');
        drawPartIcon(ctx, b.item.type, b.x + b.w / 2, b.y + b.h / 2 + (b.hover ? -1 : 0), 24);
      }
    }
    if (!Game.inventory.length) Font.drawWrapped(ctx, 'Empty. Win parts from the claw machine.', 12, 86, 100, { color: '#7a6a9a' });

    // parts list
    Draw.panel(ctx, 362, 4, 114, 192, 'slate');
    Font.draw(ctx, 'PARTS', 368, 9, { color: '#ecdcbc', shadow: PAL.k });
    for (const b of bs) {
      if (b.kind !== 'slot') continue;
      const it = build[b.slot];
      if (b.hover) Draw.rect(ctx, b.x, b.y, b.w, b.h, '#2d3344');
      Draw.frame(ctx, b.x + 1, b.y + 1, 14, 14, '#3b3654');
      if (it) {
        const d = PART_DEFS[it.type], r = RARITY[d.rarity];
        ctx.save(); ctx.beginPath(); ctx.rect(b.x + 2, b.y + 2, 12, 12); ctx.clip();
        drawPartIcon(ctx, it.type, b.x + 8, b.y + 8, 12);
        ctx.restore();
        Font.draw(ctx, d.name, b.x + 18, b.y + 1, { color: '#ecdcbc' });
        Font.draw(ctx, r.name, b.x + 18, b.y + 10, { font: 'small', color: r.color });
      } else {
        Font.draw(ctx, RIG_SLOT_LABEL[b.slot], b.x + 18, b.y + 4, { color: '#4b4466' });
      }
      if (lastStitch && lastStitch.slot === b.slot && lastStitch.t < 0.4) Draw.frame(ctx, b.x, b.y, b.w, b.h, '#9be38f');
    }
    // stats preview
    if (count()) {
      const c = new Creature(ty);
      const y0 = 158;
      const stat = (ico, label, v, x) => { if (SPR.has(ico)) SPR.draw(ctx, ico, x + 3, y0 + 4); Font.draw(ctx, label + ' ' + v, x + 9, y0, { color: '#ecdcbc' }); };
      stat('ico_heart', 'HP', c.maxHp, 366); stat('ico_sword', 'ATK', Math.round(c.atk), 404); stat('ico_boot', 'SPD', c.spd, 444);
      const tr = c.traits.length ? c.traits.map((x) => TRAITS[x].name).join(' · ') : 'no special traits';
      Font.drawWrapped(ctx, tr, 369, y0 + 12, 104, { font: 'small', color: c.traits.length ? '#9be38f' : '#4b4466' });
      const pw = clamp(c.power / 160, 0, 1);
      Draw.rect(ctx, 400, y0 + 27, 50, 4, PAL.k);
      Draw.rect(ctx, 401, y0 + 28, Math.round(48 * pw), 2, pw > 0.66 ? PAL.L : pw > 0.33 ? PAL.d : PAL.B);
      Font.draw(ctx, 'POWER', 368, y0 + 26, { font: 'small', color: '#7a6a9a' });
      Font.draw(ctx, String(c.power), 472, y0 + 26, { font: 'small', color: '#ecdcbc', align: 'right' });
    }

    // party roster
    Draw.panel(ctx, 4, 204, 114, 62, 'slate');
    Font.draw(ctx, 'PARTY ' + Game.party.length + '/3', 10, 207, { font: 'small', color: '#a6aec2' });
    for (let i = 0; i < 3; i++) {
      const x = 9 + i * 36, y = 214;
      const b = bs.find((q) => q.kind === 'party' && q.c === Game.party[i]);
      Draw.panel(ctx, x, y, 34, 40, b && (b.hover || selected === b.c) ? 'green' : 'dark');
      const c = Game.party[i];
      if (c) {
        ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, 32, 38); ctx.clip();
        const L = rigLayout(c.slots);
        drawCreature(ctx, c.slots, x + 17, y + 5 - L.top, { t: t + i, anim: 'idle', eyes: '#9be38f' });
        ctx.restore();
        const k = c.hp / c.maxHp;
        Draw.rect(ctx, x + 3, y + 35, 28, 3, PAL.k);
        Draw.rect(ctx, x + 4, y + 36, Math.round(26 * k), 1, k > 0.5 ? PAL.d : k > 0.25 ? PAL.L : PAL.R);
        if (selected === c) Font.draw(ctx, 'UNSTITCH?', x + 17, y + 42, { font: 'small', color: PAL.R, align: 'center' });
      }
    }

    // buttons (life, nav, paging)
    for (const b of bs) if (!b.kind || b.kind === 'big') UI.drawButton(ctx, b);

    // dialogue box
    if (Game.talk.visible()) {
      Draw.panel(ctx, 124, 236, 232, 30, 'dark');
      if (SPR.has('reaper_face')) SPR.draw(ctx, Game.talk.talking() && Math.sin(t * 22) > 0 && SPR.has('reaper_face_talk') ? 'reaper_face_talk' : 'reaper_face', 138, 251);
      Font.drawWrapped(ctx, Game.talk.text, 152, 241, 198, { color: '#ecdcbc', maxChars: Math.floor(Game.talk.shown) });
    }
  };

  return S;
})();
