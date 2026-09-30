// ---------------------------------------------------------------------------
// END SCENE — the run is over: the Landlord is down. Shows what the run was (time, grabs, creatures) and
// how it compares with your records. There is no endless mode on purpose (docs/DESIGN.md): it ends, you
// take a bow, you start again if you want to.
// ---------------------------------------------------------------------------
Scenes.end = (() => {
  const S = {};
  const fx = new Particles();
  let t = 0, sel = 0, records = null, newBest = false, mins = 0;
  const FALL = ['p_skull', 'p_ribcage', 'p_bonearm', 'p_heart', 'p_boneleg', 'p_wolfskull', 'p_goldheart', 'p_crownskull', 'p_tentacle', 'p_wings', 'p_fleshArm', 'p_ogrearm'];
  S.pausable = false; // nothing to pause: the run is over
  S.tracksTime = false;

  S.enter = function () {
    t = 0; sel = 0; fx.list = [];
    mins = Math.max(1, Math.round(Game.playTime / 60));
    const r = Save.data && Save.data.records;
    newBest = !!(r && r.wins <= 1) || !!(r && r.bestWinMinutes && mins <= r.bestWinMinutes);
    records = r ? Object.assign({}, r) : null;
    Music.play('shop');
    Game.talk.say('That is the last of the rent. I may cry. Or rattle. Hard to tell.', 4);
    Telemetry.log('runWon', { minutes: mins });
    if (typeof Announce !== 'undefined') Announce.say(`The Landlord is down. You won in ${mins} minutes. ${Game.stats.grabs} grabs, ${Game.stats.creatures} creatures made.`);
  };
  S.exit = function () {};

  // NEW RUN starts at once; TITLE leaves no finished run behind and shows the title with START
  function again() { Game.newGame(); Save.data.records.runs++; Save.reset(); Engine.go('shop', {}); setTimeout(() => Game.talk.say('Again? The machine restocked itself. Funny, that.', 3), 400); }
  function toTitle() { Save.data.run = null; Save.runActive = false; Save.flush(); Game.newGame(); Engine.go('shop', { title: true }); Overlays.title(); }

  S.update = function (dt) {
    t += dt;
    fx.update(dt);
    Game.talk.update(dt);
    if (chanceTick(dt)) {
      const spr = vpick(FALL);
      if (SPR.has(spr)) fx.add({ kind: 'spr', spr, x: vrand(10, 470), y: -12, vx: vrand(-14, 14), vy: vrand(30, 60), ay: 10, vr: vrand(-2, 2), life: 6, fade: false, solid: undefined });
    }
    const items = [{ label: 'NEW RUN', act: again }, { label: 'TITLE', act: toTitle }];
    if (Input.hit('left') || Input.hit('up')) { sel = (sel + items.length - 1) % items.length; Sfx.play('ui_hover'); }
    if (Input.hit('right') || Input.hit('down')) { sel = (sel + 1) % items.length; Sfx.play('ui_hover'); }
    if (Input.hit('a') && t > 0.8) { Sfx.play('ui_click'); items[sel].act(); return; }
    UI.set(items.map((it, i) => ({ id: 'end' + i, x: 150 + i * 100, y: 238, w: 80, h: 18, label: it.label, style: i === 0 ? 'green' : 'dark', onClick: () => { sel = i; if (t > 0.8) it.act(); } })));
    S.items = items;
  };
  // parts fall at about 3 a second
  let acc = 0;
  function chanceTick(dt) { acc += dt * 3; if (acc >= 1) { acc -= 1; return true; } return false; }

  S.draw = function (ctx) {
    BG.graveyard(ctx, t);
    ctx.fillStyle = 'rgba(14,11,22,0.55)'; ctx.fillRect(0, 0, W, H);
    fx.draw(ctx);
    const k = clamp(t / 0.6, 0, 1);
    Font.draw(ctx, 'THE LANDLORD IS DOWN', 240, 22 - Math.round((1 - easeOutBack(k)) * 24), { scale: 3, color: '#f6c64b', outline: PAL.k, shadow: '#80501c', align: 'center', alpha: k });
    Font.draw(ctx, 'The graveyard is yours. The rent, at long last, is paid.', 240, 56, { color: '#ecdcbc', outline: PAL.k, align: 'center', alpha: k });
    // the run in numbers
    Draw.panel(ctx, 100, 74, 280, 128, 'slate');
    const st = Game.stats, tries = st.grabs || 1;
    const rows = [
      ['TIME', mins + ' min'],
      ['GRABS', st.grabs + '  (' + Math.round((100 * st.parts) / tries) + '% brought a part home)'],
      ['PARTS WON', String(st.parts)],
      ['CREATURES', st.creatures + '  (' + st.lost + ' fell apart)'],
      ['FIGHTS', st.fightsWon + ' won, ' + st.fightsLost + ' lost, ' + st.retreats + ' retreats'],
      ['ZAPS', String(st.zaps)],
    ];
    rows.forEach(([a, b], i) => { Font.draw(ctx, a, 116, 84 + i * 14, { font: 'small', color: '#a6aec2' }); Font.draw(ctx, b, 190, 83 + i * 14, { color: '#fff6e3', shadow: PAL.k }); });
    if (records) {
      Draw.rect(ctx, 112, 170, 256, 1, '#3b3654');
      Font.draw(ctx, `RUNS WON ${records.wins}    FASTEST ${records.bestWinMinutes || mins} MIN` + (newBest ? '    ★ NEW BEST' : ''), 240, 178, { font: 'small', color: newBest ? '#f6c64b' : '#7a6a9a', align: 'center' });
      Font.draw(ctx, 'Times are for you; there is no board. Nobody is watching. Well. The Reaper is.', 240, 190, { font: 'small', color: '#5b4a78', align: 'center' });
    }
    for (const b of UI.buttons) if (b.id && b.id.startsWith('end')) UI.drawButton(ctx, b);
    const b = UI.buttons.find((x) => x.id === 'end' + sel);
    if (b) Draw.frame(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 4, '#fff6e3');
    if (Game.talk.visible()) Game.talk.drawBubble(ctx, 90, 204, 300, null, null, {});
  };

  return S;
})();
