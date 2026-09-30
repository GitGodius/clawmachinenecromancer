// ---------------------------------------------------------------------------
// MENUS — title, pause, settings, controls and how-to-play, drawn on the canvas like the rest of the game.
//
// ListMenu is one widget (rows you can move through, flip, slide and press) with three ways in that all do
// the same things: keys (whatever the player bound), mouse, touch. Overlays are what Engine.open() stacks on
// top of the game; a non-live overlay freezes the scene under it, and while it is up no game action works.
// That is the pause rule in docs/DESIGN.md: you cannot ZAP, retreat, stitch or steer the claw while paused.
// ---------------------------------------------------------------------------
class ListMenu {
  // items: { label, kind: 'button'|'toggle'|'slider'|'choice'|'header'|'info', get(), set(v), choices:[[value,text]], onClick(), disabled(), hint }
  constructor({ title, items, x = 130, y = 40, w = 220, rows = 11, onBack, footer }) {
    Object.assign(this, { title, items, x, y, w, rows, onBack, footer });
    this.sel = this.items.findIndex((i) => this.pickable(i));
    this.top = 0;
    this.drag = null;
  }
  pickable(i) { return i.kind !== 'header' && i.kind !== 'info' && !(i.hidden && i.hidden()); }
  visible() { return this.items.filter((i) => !(i.hidden && i.hidden())); }
  rowY(idx) { return this.y + 16 + (idx - this.top) * 13; }
  sound(n, o) { if (typeof Sfx !== 'undefined') Sfx.play(n, o); }

  move(d) {
    const v = this.visible();
    let i = v.indexOf(this.items[this.sel]);
    for (let n = 0; n < v.length; n++) { i = (i + d + v.length) % v.length; if (this.pickable(v[i])) break; }
    this.select(this.items.indexOf(v[i]));
    this.sound('ui_hover');
  }
  select(idx) {
    this.sel = idx;
    const v = this.visible(), vi = v.indexOf(this.items[idx]);
    if (vi < this.top) this.top = vi;
    if (vi >= this.top + this.rows) this.top = vi - this.rows + 1;
    if (typeof Announce !== 'undefined') { const it = this.items[idx]; Announce.say(it.label + (it.get ? ', ' + this.valueText(it) : '') + (it.hint ? '. ' + it.hint : '')); }
  }
  valueText(it) {
    if (it.kind === 'toggle') return it.get() ? 'ON' : 'OFF';
    if (it.kind === 'slider') return Math.round(it.get() * 100) + '%';
    if (it.kind === 'choice') { const c = it.choices.find(([v]) => v === it.get()); return c ? c[1] : ''; }
    return it.text ? it.text() : '';
  }
  adjust(it, d) {
    if (!it || it.disabled && it.disabled()) return;
    if (it.kind === 'slider') { it.set(clamp(Math.round((it.get() + d * 0.1) * 10) / 10, 0, 1)); this.sound('ui_click'); }
    else if (it.kind === 'toggle') { it.set(!it.get()); this.sound('ui_click'); }
    else if (it.kind === 'choice') {
      const i = it.choices.findIndex(([v]) => v === it.get());
      it.set(it.choices[(i + d + it.choices.length) % it.choices.length][0]); this.sound('ui_click');
    }
    if (typeof Announce !== 'undefined') Announce.say(it.label + ', ' + this.valueText(it));
  }
  activate(it) {
    if (!it) return;
    if (it.disabled && it.disabled()) { this.sound('ui_deny'); return; }
    if (it.kind === 'button') { this.sound(it.sound || 'ui_click'); it.onClick(); }
    else if (it.kind !== 'slider') this.adjust(it, 1);
  }

  update() {
    UI.set([]); // the menu handles its own pointer; nothing underneath may react
    const v = this.visible();
    if (Input.hit('up')) this.move(-1);
    if (Input.hit('down')) this.move(1);
    const it = this.items[this.sel];
    if (Input.hit('left')) this.adjust(it, -1);
    if (Input.hit('right')) this.adjust(it, 1);
    if (Input.hit('a')) this.activate(it);
    if (Input.hit('b') && this.onBack) { this.sound('ui_back'); this.onBack(); return; }
    // pointer: hover selects, press activates, dragging a slider sets it
    const m = Input.mouse;
    if (m.x >= 0) {
      const inX = m.x >= this.x && m.x < this.x + this.w;
      const row = inX ? Math.floor((m.y - this.rowY(this.top)) / 13) + this.top : -1;
      const hov = row >= this.top && row < this.top + this.rows && row < v.length ? v[row] : null;
      if (m.moved && hov && this.pickable(hov) && this.items.indexOf(hov) !== this.sel) { this.select(this.items.indexOf(hov)); this.sound('ui_hover'); }
      if (m.pressed && hov && this.pickable(hov)) {
        this.select(this.items.indexOf(hov));
        if (hov.kind === 'slider') this.drag = hov; else this.activate(hov);
      }
      if (m.pressed && inX && m.y < this.y + 14 + 2 && this.top > 0) this.top--; // click the ▲
      if (m.pressed && inX && m.y > this.rowY(this.top + this.rows) - 2 && this.top + this.rows < v.length && m.y < this.rowY(this.top + this.rows) + 12) this.top++; // click the ▼
    }
    if (this.drag) {
      if (m.down) { const k = clamp((m.x - (this.x + this.w - 84)) / 60, 0, 1); const nv = Math.round(k * 10) / 10; if (nv !== this.drag.get()) { this.drag.set(nv); this.sound('ui_hover', { pitch: 0.8 + nv * 0.6 }); } }
      else this.drag = null;
    }
  }

  draw(ctx) {
    const v = this.visible(), h = 26 + Math.min(this.rows, v.length) * 13 + (this.footer ? 12 : 0);
    Draw.panel(ctx, this.x - 8, this.y - 6, this.w + 16, h + 6, 'slate');
    Font.draw(ctx, this.title, this.x + this.w / 2, this.y, { align: 'center', color: '#fff6e3', shadow: PAL.k });
    if (this.top > 0) Font.draw(ctx, '↑', this.x + this.w - 4, this.y + 4, { font: 'small', color: '#7a6a9a', align: 'right' });
    const sel = this.items[this.sel];
    for (let i = this.top; i < Math.min(v.length, this.top + this.rows); i++) {
      const it = v[i], y = this.rowY(i), on = it === sel, off = it.disabled && it.disabled();
      if (it.kind === 'header') { Font.draw(ctx, it.label, this.x, y + 3, { font: 'small', color: '#ff8ac6' }); Draw.rect(ctx, this.x + Font.measure(it.label, 'small') + 4, y + 6, this.w - Font.measure(it.label, 'small') - 4, 1, '#3b3654'); continue; }
      if (on) { Draw.rect(ctx, this.x - 2, y - 1, this.w + 4, 12, '#2d3344'); Draw.frame(ctx, this.x - 2, y - 1, this.w + 4, 12, '#ff8ac6'); Font.draw(ctx, '▶', this.x + 1, y + 2, { color: '#fff6e3' }); }
      const col = off ? '#5b4a78' : on ? '#fff6e3' : '#cdb892';
      Font.draw(ctx, it.label, this.x + 11, y + 2, { color: col, shadow: on ? PAL.k : null });
      if (it.kind === 'slider') {
        const bx = this.x + this.w - 84, k = it.get();
        Draw.rect(ctx, bx, y + 4, 62, 4, PAL.k); Draw.rect(ctx, bx + 1, y + 5, 60, 2, '#33274a');
        Draw.rect(ctx, bx + 1, y + 5, Math.round(60 * k), 2, off ? '#5b4a78' : '#9be38f');
        Draw.rect(ctx, bx + Math.round(60 * k) - 1, y + 2, 3, 8, '#fff6e3');
        Font.draw(ctx, Math.round(k * 100) + '%', this.x + this.w - 2, y + 3, { font: 'small', color: col, align: 'right' });
      } else if (it.kind === 'toggle') {
        Font.draw(ctx, this.valueText(it), this.x + this.w - 2, y + 2, { color: it.get() ? '#9be38f' : '#7a6a9a', align: 'right' });
      } else if (it.kind === 'choice') {
        Font.draw(ctx, (on ? '◀ ' : '') + this.valueText(it) + (on ? ' ▶' : ''), this.x + this.w - 2, y + 2, { color: '#9be38f', align: 'right' });
      } else if (it.text) Font.draw(ctx, it.text(), this.x + this.w - 2, y + 2, { color: '#7a6a9a', align: 'right' });
    }
    if (this.top + this.rows < v.length) Font.draw(ctx, '↓', this.x + this.w - 4, this.rowY(this.top + this.rows) + 1, { font: 'small', color: '#7a6a9a', align: 'right' });
    // the hint for the highlighted row, then the key reminder
    const foot = this.y + 18 + Math.min(this.rows, v.length) * 13;
    if (sel && sel.hint) Font.drawWrapped(ctx, sel.hint, this.x, foot - 1, this.w, { font: 'small', color: '#a6aec2' });
    else if (this.footer) Font.draw(ctx, typeof this.footer === 'function' ? this.footer() : this.footer, this.x + this.w / 2, foot, { font: 'small', color: '#7a6a9a', align: 'center' });
  }
}

const dimBackdrop = (ctx, a = 0.72) => { ctx.fillStyle = `rgba(14,11,22,${a})`; ctx.fillRect(0, 0, W, H); };
const keyLine = () => `${Settings.hint('up')} ${Settings.hint('down')} select   ${Settings.hint('left')} ${Settings.hint('right')} change   ${Settings.hint('a')} ok   ${Settings.hint('b')} back`;

// -------------------------------------------------------------------- overlays
const Overlays = (() => {
  const persist = () => { Settings.apply(); Save.soon(); };
  const S = () => Settings.v;

  // A message with two choices. Default is the SAFE one (No), so a stray Enter cannot delete a run.
  function confirm(text, yes, { yesLabel = 'YES', noLabel = 'NO', danger = false } = {}) {
    const menu = new ListMenu({ title: '', x: 150, y: 128, w: 180, rows: 2, onBack: () => Engine.close(), items: [
      { label: noLabel, kind: 'button', onClick: () => Engine.close() },
      { label: yesLabel, kind: 'button', onClick: () => { Engine.close(); yes(); } },
    ] });
    menu.sel = 0;
    Engine.open({
      update() { menu.update(); },
      draw(ctx) {
        dimBackdrop(ctx, 0.55);
        Draw.panel(ctx, 110, 84, 260, 40, danger ? 'red' : 'slate');
        Font.drawWrapped(ctx, text, 122, 94, 236, { color: '#fff6e3' });
        menu.draw(ctx);
      },
    });
    if (typeof Announce !== 'undefined') Announce.say(text);
  }

  function help() {
    const menu = new ListMenu({ title: '', x: 0, y: 0, w: 0, rows: 0, onBack: () => Engine.close(), items: [] });
    Engine.open({
      update() { menu.update(); if (Input.mouse.pressed || Input.hit('a')) Engine.close(); },
      draw(ctx) {
        dimBackdrop(ctx, 0.82);
        Draw.panel(ctx, 40, 14, 400, 242, 'slate');
        Font.draw(ctx, 'HOW TO PLAY', 240, 22, { align: 'center', color: '#fff6e3', shadow: PAL.k });
        const K = (a) => Settings.hint(a);
        const lines = [
          ['THE IDEA', '#ff8ac6'],
          ['Win body parts from the claw machine. Stitch them into monsters on the slab. Send them to fight the shades in the graveyard. Every part they lose goes back in the machine.', '#ecdcbc'],
          ['THE CLAW', '#ff8ac6'],
          [`${K('left')} ${K('right')} steer.  ${K('a')} drops the claw, and again to let go over the chute.  Hold the mouse or a finger on the glass to steer toward it. Carrying: hold a direction to speed up, ease off to steady it. Fast carries swing, and swinging parts slip.`, '#ecdcbc'],
          ['THE FIGHT', '#ff8ac6'],
          [`Once you press FIGHT it is live. ZAP heals and hastes (it recharges). RETREAT keeps everyone alive and pays for the damage you did. ${K('pause')} pauses, and nothing can be done while paused.`, '#ecdcbc'],
          ['THE RUN', '#ff8ac6'],
          ['Fifteen stages in three acts. Every fifth is a boss; the last one is the Landlord. The Reaper tells you what is coming: build for it.', '#ecdcbc'],
        ];
        let y = 34;
        for (const [t, c] of lines) {
          if (c === '#ff8ac6') { Font.draw(ctx, t, 54, y, { font: 'small', color: c }); y += 10; }
          else { const r = Font.drawWrapped(ctx, t, 54, y, 372, { color: c }); y += Math.max(1, (Font.wrap(t, 372).length)) * 10 + 6; }
        }
        Font.draw(ctx, 'press any key or click to close', 240, 244, { font: 'small', color: '#7a6a9a', align: 'center' });
      },
    });
    if (typeof Announce !== 'undefined') Announce.say('How to play. Win parts from the claw, stitch monsters, fight. Press any key to close.');
  }

  // ---------------------------------------------------------------- controls
  function controls() {
    let row = 0, slot = 0, capturing = null, msg = '';
    const rows = KEY_ACTIONS.length + 1; // + reset
    const open = (r, s) => {
      capturing = { r, s };
      msg = '';
      Input.capture = (code) => {
        capturing = null;
        const a = KEY_ACTIONS[r];
        if (code === 'Escape') { Sfx.play('ui_back'); return; }
        if (code === 'Backspace' || code === 'Delete') { msg = Settings.unbind(a.id, s) ? a.label + ' cleared.' : 'Every action needs at least one key.'; Sfx.play(msg.endsWith('.') && msg !== 'Every action needs at least one key.' ? 'ui_click' : 'ui_deny'); persist(); return; }
        if (/^F\d+$|^Tab$|^ContextMenu$|^Meta|^Control|^Alt|^Shift/.test(code)) { msg = 'That key is not available.'; Sfx.play('ui_deny'); return; }
        const stolen = Settings.bind(a.id, s, code);
        const from = stolen && stolen !== a.id ? KEY_ACTIONS.find((x) => x.id === stolen).label : null;
        msg = Settings.keyName(code) + ' → ' + a.label + (from ? ' (was ' + from + ')' : '');
        Sfx.play('ui_click');
        persist();
      };
    };
    Engine.open({
      update() {
        UI.set([]);
        if (capturing) return;
        if (Input.hit('up')) { row = (row + rows - 1) % rows; Sfx.play('ui_hover'); }
        if (Input.hit('down')) { row = (row + 1) % rows; Sfx.play('ui_hover'); }
        if (Input.hit('left')) { slot = 0; Sfx.play('ui_hover'); }
        if (Input.hit('right')) { slot = 1; Sfx.play('ui_hover'); }
        if (Input.hit('a')) { if (row === KEY_ACTIONS.length) { Settings.resetKeys(); msg = 'Keys reset to their defaults.'; Sfx.play('ui_click'); persist(); } else open(row, slot); }
        if (Input.hit('b')) { Sfx.play('ui_back'); Engine.close(); return; }
        const m = Input.mouse;
        if (m.x >= 0) {
          const r = Math.floor((m.y - 44) / 15);
          if (r >= 0 && r <= KEY_ACTIONS.length && m.x > 100 && m.x < 380) {
            const s = m.x > 290 ? 1 : 0;
            if (m.moved && (r !== row || (r < KEY_ACTIONS.length && s !== slot))) { row = r; if (r < KEY_ACTIONS.length && m.x > 210) slot = s; }
            if (m.pressed) { row = r; if (r === KEY_ACTIONS.length) { Settings.resetKeys(); msg = 'Keys reset to their defaults.'; Sfx.play('ui_click'); persist(); } else if (m.x > 210) { slot = s; open(r, s); } }
          }
        }
      },
      exit() { Input.capture = null; },
      draw(ctx) {
        dimBackdrop(ctx, 0.85);
        Draw.panel(ctx, 90, 14, 300, 242, 'slate');
        Font.draw(ctx, 'KEY BINDINGS', 240, 22, { align: 'center', color: '#fff6e3', shadow: PAL.k });
        Font.draw(ctx, 'Two keys per action. Gamepad: d-pad, A and B.', 240, 32, { align: 'center', font: 'small', color: '#7a6a9a' });
        KEY_ACTIONS.forEach((a, i) => {
          const y = 44 + i * 15, on = i === row;
          if (on) { Draw.rect(ctx, 98, y - 2, 284, 14, '#2d3344'); Draw.frame(ctx, 98, y - 2, 284, 14, '#ff8ac6'); }
          Font.draw(ctx, a.label, 106, y + 1, { color: on ? '#fff6e3' : '#cdb892' });
          for (let s = 0; s < 2; s++) {
            const x = 214 + s * 82, sel = on && slot === s, cap = capturing && capturing.r === i && capturing.s === s;
            Draw.panel(ctx, x, y - 2, 76, 14, cap ? 'red' : sel ? 'green' : 'dark');
            Font.draw(ctx, cap ? 'PRESS A KEY' : Settings.keyName(Settings.v.keys[a.id][s]), x + 38, y + 1, { align: 'center', color: cap ? '#fff6e3' : sel ? '#fff6e3' : '#ecdcbc' });
          }
        });
        const ry = 44 + KEY_ACTIONS.length * 15, ron = row === KEY_ACTIONS.length;
        if (ron) { Draw.rect(ctx, 98, ry - 2, 284, 14, '#2d3344'); Draw.frame(ctx, 98, ry - 2, 284, 14, '#ff8ac6'); }
        Font.draw(ctx, 'RESET TO DEFAULTS', 240, ry + 1, { align: 'center', color: ron ? '#fff6e3' : '#cdb892' });
        Font.drawWrapped(ctx, capturing ? 'Press the new key. ESC cancels, BACKSPACE clears this slot.' : msg || `${Settings.hint('left')} ${Settings.hint('right')} pick a slot   ${Settings.hint('a')} rebind   ${Settings.hint('b')} back`, 106, 226, 268, { font: 'small', color: capturing ? '#ff8ac6' : '#a6aec2' });
      },
    });
    if (typeof Announce !== 'undefined') Announce.say('Key bindings. Up and down choose an action, then press to rebind.');
  }

  // ---------------------------------------------------------------- settings
  function settings() {
    const on = (k) => ({ get: () => S()[k], set: (v) => { S()[k] = v; persist(); } });
    const menu = new ListMenu({ title: 'SETTINGS', x: 100, y: 20, w: 280, rows: 14, onBack: () => { Save.flush(); Engine.close(); }, footer: keyLine, items: [
      { label: 'AUDIO', kind: 'header' },
      { label: 'Master volume', kind: 'slider', ...on('master') },
      { label: 'Music volume', kind: 'slider', ...on('music') },
      { label: 'Effects volume', kind: 'slider', ...on('sfx') },
      { label: 'Mute', kind: 'toggle', get: () => S().muted, set: (v) => { S().muted = v; persist(); }, hint: `Also on the ${Settings.hint('mute')} key.` },
      { label: 'COMFORT', kind: 'header' },
      { label: 'Screen shake', kind: 'choice', choices: [[0, 'Off'], [0.5, 'Low'], [1, 'Full']], ...on('shake') },
      { label: 'Reduce flashing', kind: 'toggle', ...on('reduceFlash'), hint: 'No full-screen flashes, and nothing blinks faster than 1.5 times a second.' },
      { label: 'Slow-motion on rare catches', kind: 'toggle', ...on('slowmo') },
      { label: 'THE CLAW', kind: 'header' },
      { label: 'Drop guide', kind: 'toggle', ...on('dropGuide'), hint: 'The dotted line that shows where the claw will land.' },
      { label: 'Auto-carry assist', kind: 'toggle', ...on('autoCarry'), hint: 'The machine carries a part to the chute for you at a steady speed. Where you drop the claw is still up to you.' },
      { label: 'Carry time', kind: 'choice', choices: [[8, '8 s'], [16, '16 s'], [0, 'No limit']], ...on('carryTime'), hint: 'How long you get to bring a part to the chute.' },
      { label: 'Steering', kind: 'choice', choices: [['hold', 'Hold key'], ['toggle', 'Tap to toggle']], ...on('steering'), hint: 'Tap to toggle: tap a direction to start moving, tap again to stop. Nothing needs holding.' },
      { label: 'CONTROLS', kind: 'header' },
      { label: 'Key bindings…', kind: 'button', onClick: () => controls(), hint: 'Change any key. Every action has two slots.' },
      { label: 'THIS DEVICE', kind: 'header' },
      { label: 'Saving', kind: 'info', text: () => (Store.persistent ? 'on' : 'off in this window') },
      { label: 'Copy debug info', kind: 'button', onClick: () => { Platform.copy(CrashLog.text('Debug info'), (ok) => Overlays.toast(ok ? 'Copied. Paste it into a bug report.' : 'Could not copy: it is shown in the report window.')); }, hint: 'Version, browser and the last few errors, ready to paste into a bug report.' },
      { label: 'Report a problem…', kind: 'button', onClick: () => Platform.open(BUILD.issues), hint: BUILD.issues.replace('https://', '') },
      { label: 'Delete saved run and records…', kind: 'button', onClick: () => confirm('Delete your saved run, records and settings? This cannot be undone.', () => { Save.wipe(); Settings.apply(); Engine.overlays.length = 0; Game.newGame(); Engine.go('shop', { title: true }); Overlays.title(); }, { yesLabel: 'DELETE EVERYTHING', noLabel: 'KEEP', danger: true }) },
      { label: 'About', kind: 'info', text: () => BUILD.name + ' ' + BUILD.version },
    ] });
    Engine.open({ update() { menu.update(); }, draw(ctx) { dimBackdrop(ctx, 0.85); menu.draw(ctx); } });
    if (typeof Announce !== 'undefined') Announce.say('Settings.');
  }

  // ------------------------------------------------------------------- pause
  function pause() {
    const back = () => { Sfx.play('ui_back'); Engine.close(); };
    const menu = new ListMenu({ title: 'PAUSED', x: 160, y: 84, w: 160, rows: 4, onBack: back, footer: () => `${Settings.hint('pause')} or ${Settings.hint('b')} to resume`, items: [
      { label: 'RESUME', kind: 'button', onClick: back },
      { label: 'SETTINGS', kind: 'button', onClick: settings },
      { label: 'HOW TO PLAY', kind: 'button', onClick: help },
      { label: 'QUIT TO TITLE', kind: 'button', onClick: () => confirm('Back to the title screen? Your run is saved.', () => { Save.flush(); Engine.overlays.length = 0; Engine.go('shop', { title: true }); Overlays.title(); }, { yesLabel: 'QUIT', noLabel: 'STAY' }) },
    ] });
    Engine.open({
      pausePanel: true,
      update() {
        menu.update();
        if (Input.hit('pause') && Engine.top === this) back();
      },
      resume() { UI.set([]); },
      draw(ctx) {
        dimBackdrop(ctx, 0.6);
        menu.draw(ctx);
        Font.draw(ctx, 'The clock is stopped. Nothing can be done while paused.', 240, 176, { font: 'small', color: '#a6aec2', align: 'center' });
      },
    });
    if (typeof Announce !== 'undefined') Announce.say('Paused.');
  }

  // ------------------------------------------------------------------- title
  function title() {
    const cont = () => { Engine.close(); Game.fromSave(Save.data.run); Scenes.shop.open(true); };
    const fresh = () => { Engine.close(); Game.newGame(); Save.data.records.runs++; Save.reset(); Scenes.shop.open(false); };
    let t = 0;
    const has = Save.hasRun();
    const summary = has ? (() => { const r = Save.data.run; return 'Stage ' + r.stage + ' · ' + (r.party || []).length + ' creature' + ((r.party || []).length === 1 ? '' : 's') + ' · ' + (r.inventory || []).length + ' parts'; })() : '';
    const items = [];
    if (has) items.push({ label: 'CONTINUE', kind: 'button', onClick: cont, hint: summary });
    items.push({ label: has ? 'NEW RUN' : 'START', kind: 'button', onClick: has ? () => confirm('Start a new run? The run you have saved will be lost.', fresh, { yesLabel: 'NEW RUN', noLabel: 'KEEP MY RUN', danger: true }) : fresh });
    items.push({ label: 'SETTINGS', kind: 'button', onClick: settings });
    items.push({ label: 'HOW TO PLAY', kind: 'button', onClick: help });
    const menu = new ListMenu({ title: '', x: 170, y: 150, w: 140, rows: 5, items, footer: () => `${Settings.hint('a')} to choose` });
    Engine.open({
      live: true,
      update(dt) {
        t += dt;
        menu.update();
      },
      draw(ctx) {
        ctx.fillStyle = 'rgba(14,11,22,0.5)'; ctx.fillRect(0, 0, W, H);
        const k = clamp(t / 0.8, 0, 1);
        Font.draw(ctx, 'THE GOOD PARTS', 240, 60 - Math.round((1 - easeOutBack(k)) * 30), { scale: 4, color: '#fff1d6', outline: '#3a0c20', shadow: '#b0224a', align: 'center', alpha: k });
        Font.draw(ctx, 'Collect · Reanimate · Conquer', 240, 100, { color: '#cdb892', align: 'center', alpha: k, outline: PAL.k });
        menu.draw(ctx);
        // things the player should know before they invest in a run
        let ny = 236;
        const note = (s, c) => { Font.draw(ctx, s, 240, ny, { font: 'small', color: c, align: 'center', outline: PAL.k }); ny -= 9; };
        if (Save.problem === 'corrupt') note('Your save could not be read. A copy is kept, and this is a fresh start.', '#ff7d8a');
        if (Save.problem === 'newer') note('This save is from a newer version. It will not be overwritten.', '#f6c64b');
        if (!Store.persistent) note('Progress cannot be saved in this window (storage is blocked).', '#f6c64b');
        for (const n of Save.notes) note(n, '#f6c64b');
        Font.draw(ctx, BUILD.version, W - 4, H - 8, { font: 'small', color: '#5b4a78', align: 'right' });
      },
    });
    if (typeof Announce !== 'undefined') Announce.say('The Good Parts. ' + (has ? 'Continue, or start a new run.' : 'Start.'));
  }

  // --------------------------------------------------------- a line of feedback
  let toastText = '', toastT = 0;
  function toast(s) { toastText = s; toastT = 3; if (typeof Announce !== 'undefined') Announce.say(s); }
  function drawToast(ctx, dt) {
    if (toastT <= 0) return;
    toastT -= dt;
    Draw.panel(ctx, 240 - Font.measure(toastText) / 2 - 8, 246, Font.measure(toastText) + 16, 16, 'dark');
    Font.draw(ctx, toastText, 240, 251, { align: 'center', color: '#fff6e3' });
  }

  return { confirm, help, controls, settings, pause, title, toast, drawToast };
})();
