// ---------------------------------------------------------------------------
// ENGINE — 480x270 pixel canvas, input (keys, pointer/touch, gamepad), scenes
// with dither transitions, and the juice: shake, hit-pause, slow-mo, flash,
// particles, floating text. Plus tiny pixel UI widgets.
// ---------------------------------------------------------------------------
const W = 480, H = 270;

// ------------------------------------------------------------------- input
const Input = {
  down: {}, pressed: {}, released: {},
  mouse: { x: -1, y: -1, down: false, pressed: false, released: false, moved: false },
  pad: { left: false, right: false, a: false, b: false, prev: {} },
  anyPressed: false,
  lastDevice: 'mouse',
  KEYMAP: {}, // key code -> action, built from the player's bindings (Settings.v.keys)
  capture: null, // while set, the next key press goes here instead of the game (the remap screen)
  setBindings(keys) {
    const map = {};
    for (const a of KEY_ACTIONS) for (const c of keys[a.id] || []) if (c) map[c] = a.id;
    this.KEYMAP = map;
    this.down = {}; this.pressed = {};
  },
  // Ctrl/Cmd/Alt held with another key is the browser's (or the OS's), never the game's. A modifier pressed on
  // its own is an ordinary key, so a player can still bind one (Left Ctrl to drop, say) on the remap screen.
  shortcut(e) {
    const c = e.code || '';
    return (e.ctrlKey && !c.startsWith('Control')) || (e.metaKey && !c.startsWith('Meta') && !c.startsWith('OS')) || (e.altKey && !c.startsWith('Alt'));
  },
  init(canvas) {
    this.setBindings(Settings.v.keys);
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' && e.code === 'Space')) return;
      if (this.shortcut(e)) return; // browser shortcuts (Ctrl+1 switches tab, Ctrl+E, Cmd+Q...) are not game keys
      if (this.capture) { e.preventDefault(); if (!e.repeat) { const f = this.capture; this.capture = null; f(e.code); } return; }
      const act = this.KEYMAP[e.code];
      if (act || e.code === 'Space') e.preventDefault();
      if (!e.repeat) {
        this.pressed[e.code] = true;
        if (act) this.pressed[act] = true;
        this.anyPressed = true;
      }
      this.down[e.code] = true;
      if (act) this.down[act] = true;
      this.lastDevice = 'keys';
      AudioSys.init();
    });
    window.addEventListener('keyup', (e) => {
      const act = this.KEYMAP[e.code];
      this.down[e.code] = false;
      if (act) {
        // only release the action if no other key mapped to it is held
        const still = Object.keys(this.KEYMAP).some((k) => this.KEYMAP[k] === act && this.down[k]);
        if (!still) { this.down[act] = false; this.released[act] = true; }
      }
    });
    window.addEventListener('blur', () => { this.down = {}; this.mouse.down = false; });
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * W;
      this.mouse.y = ((e.clientY - r.top) / r.height) * H;
      this.mouse.moved = true;
    };
    canvas.addEventListener('pointerdown', (e) => {
      pos(e);
      this.mouse.down = true; this.mouse.pressed = true; this.anyPressed = true;
      this.lastDevice = e.pointerType === 'touch' ? 'touch' : 'mouse';
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      try { window.focus(); canvas.focus({ preventScroll: true }); } catch (err) { /* embedded page: best effort */ }
      AudioSys.init();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => { pos(e); if (e.pointerType !== 'touch') this.lastDevice = 'mouse'; });
    const up = (e) => { pos(e); if (this.mouse.down) this.mouse.released = true; this.mouse.down = false; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { this.mouse.x = -1; this.mouse.y = -1; } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    const P = this.pad;
    if (!gp) { P.left = P.right = P.a = P.b = P.x = P.y = P.lb = P.rb = false; return; }
    const ax = gp.axes[0] || 0;
    const now = {
      left: ax < -0.4 || (gp.buttons[14] && gp.buttons[14].pressed),
      right: ax > 0.4 || (gp.buttons[15] && gp.buttons[15].pressed),
      up: (gp.axes[1] || 0) < -0.5 || (gp.buttons[12] && gp.buttons[12].pressed),
      down: (gp.axes[1] || 0) > 0.5 || (gp.buttons[13] && gp.buttons[13].pressed),
      a: gp.buttons[0] && gp.buttons[0].pressed,
      b: gp.buttons[1] && gp.buttons[1].pressed,
      x: gp.buttons[2] && gp.buttons[2].pressed, // quake
      y: gp.buttons[3] && gp.buttons[3].pressed, // iron grip
      lb: gp.buttons[4] && gp.buttons[4].pressed, // nudge left
      rb: gp.buttons[5] && gp.buttons[5].pressed, // nudge right
    };
    for (const k in now) {
      if (now[k] && !P.prev[k]) { this.pressed[k] = true; this.anyPressed = true; this.lastDevice = 'pad'; }
      if (!now[k] && P.prev[k]) this.released[k] = true;
      P[k] = now[k];
    }
    P.prev = now;
  },
  held(act) { return !!(this.down[act] || this.pad[act]); },
  // which key currently does this, for on-screen prompts (follows the player's bindings)
  keyFor(act) { return Settings.hint(act); },
  hit(act) { return !!this.pressed[act]; },
  endFrame() {
    this.pressed = {}; this.released = {}; this.anyPressed = false;
    this.mouse.pressed = false; this.mouse.released = false; this.mouse.moved = false;
  },
  over(x, y, w, h) { const m = this.mouse; return m.x >= x && m.y >= y && m.x < x + w && m.y < y + h; },
};

// ------------------------------------------------------------------ engine
const Engine = {
  canvas: null, ctx: null, scale: 1,
  t: 0, realT: 0, frame: 0,
  scenes: {}, scene: null, sceneName: '',
  trans: null,
  shakeMag: 0, shakeT: 0, shakeX: 0, shakeY: 0,
  pauseT: 0, slowT: 0, slowScale: 1,
  flashT: 0, flashDur: 0, flashColor: '#fff',
  paused: false,
  overlays: [], // menus stacked over the game; the top one gets input. A non-live overlay freezes the scene under it.
  errorRun: 0,  // consecutive frames whose scene code threw

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    Input.init(this.canvas);
    const resize = () => {
      // fit the canvas inside whatever the page leaves free (gutters, safe areas, the hint line)
      const px = (cs, k) => parseFloat(cs[k]) || 0;
      const de = document.documentElement, bs = getComputedStyle(document.body), rs = getComputedStyle(de);
      const hint = document.getElementById('under');
      const avW = de.clientWidth - px(bs, 'paddingLeft') - px(bs, 'paddingRight') - px(rs, 'paddingLeft') - px(rs, 'paddingRight');
      const avH = de.clientHeight - px(bs, 'paddingTop') - px(bs, 'paddingBottom') - px(rs, 'paddingTop') - px(rs, 'paddingBottom')
        - (hint && hint.offsetParent ? hint.offsetHeight + 6 : 0);
      let s = Math.min(avW / W, avH / H);
      if (s >= 2 && s - Math.floor(s) < 0.34) s = Math.floor(s); // snap to whole pixels when it costs little
      s = Math.max(0.5, s);
      this.scale = s;
      this.canvas.style.width = Math.floor(W * s) + 'px';
      this.canvas.style.height = Math.floor(H * s) + 'px';
    };
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(document.documentElement);
    resize();
  },

  add(name, scene) { this.scenes[name] = scene; scene.name = name; },

  // A scene threw. Report it (once per distinct error, see CrashLog) and keep the game alive: if the same
  // scene keeps failing, drop back to the shop rather than freezing on a broken screen.
  fault(e, where) {
    this.errorRun++;
    if (typeof CrashLog !== 'undefined') CrashLog.report(e, where + ' in ' + (this.sceneName || '?')); else console.error(e);
    if (this.errorRun >= 30 && this.sceneName !== 'shop' && this.scenes.shop) { this.errorRun = 0; this.closeAll(); this.trans = null; this._switch(this.scenes.shop, { skipIntro: true }); }
  },

  // style: 'dither' (pixel fade through black) | 'cut'
  go(name, params, style = 'dither') {
    if (this.trans) return;
    const to = this.scenes[name];
    if (style === 'cut' || !this.scene) { this._switch(to, params); return; }
    this.trans = { to, params, t: 0, dur: 0.22, phase: 'out' };
    if (typeof Sfx !== 'undefined') Sfx.play('transition');
  },
  _switch(to, params) {
    const from = this.scene;
    if (from && from.exit) from.exit(to);
    this.scene = to;
    this.sceneName = to.name;
    Telemetry.scene(to.name);
    if (to.enter) to.enter(params || {}, from);
    Save.soon();
  },

  shake(mag, dur = 0.25) {
    mag *= CONFIG.shake;
    if (mag >= this.shakeMag * (this.shakeT > 0 ? 1 : 0)) { this.shakeMag = mag; this.shakeT = dur; this.shakeDur = dur; }
  },
  hitPause(sec) { this.pauseT = Math.max(this.pauseT, sec * CONFIG.hitPause); },
  slowmo(scale, sec) { if (!CONFIG.slowmo) return; this.slowScale = scale; this.slowT = sec; },
  flash(color = '#fff', dur = 0.15) { if (Settings.v.reduceFlash) return; this.flashColor = color; this.flashT = dur; this.flashDur = dur; },

  // ---- overlays (pause, settings, title...): the game holds its breath while one is open
  open(overlay, params) {
    this.overlays.push(overlay);
    overlay.parent = this.overlays.length > 1 ? this.overlays[this.overlays.length - 2] : null;
    if (overlay.enter) overlay.enter(params || {});
    if (!overlay.live) { Sfx.motor(0, 0); Music.dim(true); }
    // the press that opened a menu belongs to the opener: without this the menu's own update, later in the
    // same frame, sees it too (P opened pause and immediately closed it)
    Input.mouse.down = false; Input.mouse.pressed = false; Input.pressed = {}; Input.anyPressed = false;
  },
  close() {
    const o = this.overlays.pop();
    if (o && o.exit) o.exit();
    UI.set([]);
    Input.mouse.down = false; Input.pressed = {};
    if (!this.overlays.some((x) => !x.live)) Music.dim(false);
    if (this.overlays.length) { const t = this.overlays[this.overlays.length - 1]; if (t.resume) t.resume(); }
  },
  // Close everything properly (exit hooks, key capture, dimmed music). Never write `overlays.length = 0`: it
  // skips all of that and leaves the music dim and the next key press swallowed by a rebind.
  closeAll() {
    while (this.overlays.length) { const o = this.overlays.pop(); if (o.exit) { try { o.exit(); } catch (e) { /* closing must not fail */ } } }
    Input.capture = null; Input.mouse.down = false; Input.pressed = {};
    UI.set([]);
    Music.dim(false);
  },
  get top() { return this.overlays.length ? this.overlays[this.overlays.length - 1] : null; },
  // true while something is frozen the world: the pause menu says "no game actions" and means it
  get frozen() { return this.overlays.some((o) => !o.live); },


  loop(now) {
    const realDt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    this.realT += realDt;
    Input.pollPad();
    // keys that work everywhere, and follow the player's bindings
    if (Input.hit('mute')) { Settings.v.muted = AudioSys.toggleMute(); Save.soon(); }
    if (Input.hit('fullscreen') && typeof Platform !== 'undefined') Platform.fullscreen();
    if (Input.hit('pause') && this.scene && !this.overlays.length && this.scene.pausable !== false && !this.trans && typeof Overlays !== 'undefined') Overlays.pause();
    let dt = realDt;
    if (this.pauseT > 0) { this.pauseT -= realDt; dt = 0; }
    if (this.slowT > 0) { this.slowT -= realDt; dt *= this.slowScale; }
    if (this.paused || this.frozen) dt = 0;
    if (!this.frozen && this.scene && this.scene.tracksTime !== false) Game.playTime += realDt;
    this.t += dt;
    this.dt = dt;
    this.frame++;

    // transition
    if (this.trans) {
      const tr = this.trans;
      tr.t += realDt;
      if (tr.phase === 'out' && tr.t >= tr.dur) { this._switch(tr.to, tr.params); tr.phase = 'in'; tr.t = 0; }
      else if (tr.phase === 'in' && tr.t >= tr.dur) this.trans = null;
    }

    if (this.scene && (!this.trans || this.trans.phase === 'in') && !this.frozen) {
      try { this.scene.update(dt, realDt); this.errorRun = 0; } catch (e) { this.fault(e, 'update'); }
    }
    const ov = this.top;
    if (ov) { try { ov.update(realDt); } catch (e) { this.fault(e, 'overlay'); this.closeAll(); } }
    UI.update(realDt);
    if (typeof Debug !== 'undefined' && Debug.update) Debug.update(realDt);

    // shake
    if (this.shakeT > 0) {
      this.shakeT -= realDt;
      const k = Math.max(0, this.shakeT / this.shakeDur);
      const m = this.shakeMag * k;
      this.shakeX = Math.round(vrand(-m, m));
      this.shakeY = Math.round(vrand(-m, m));
    } else { this.shakeX = this.shakeY = 0; }

    // draw
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = PAL.k;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(this.shakeX, this.shakeY);
    try { if (this.scene) this.scene.draw(ctx); } catch (e) { this.fault(e, 'draw'); }
    ctx.restore();
    if (this.flashT > 0) {
      this.flashT -= realDt;
      ctx.globalAlpha = clamp(this.flashT / this.flashDur, 0, 1) * 0.85;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    for (const o of this.overlays.slice()) { try { o.draw(ctx); } catch (e) { this.fault(e, 'overlay draw'); this.closeAll(); break; } }
    if (typeof Overlays !== 'undefined') Overlays.drawToast(ctx, realDt);
    UI.drawOverlay(ctx);
    if (this.trans) {
      const tr = this.trans;
      const k = tr.phase === 'out' ? tr.t / tr.dur : 1 - tr.t / tr.dur;
      BG.dither(ctx, Math.round(clamp(k, 0, 1) * 16), PAL.k);
    }
    Input.endFrame();
    requestAnimationFrame((n) => this.loop(n));
  },
};

// --------------------------------------------------------------- particles
// One pool per scene; coordinates are whatever space the scene draws in.
class Particles {
  constructor() { this.list = []; }
  add(p) {
    const q = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ay: 0, drag: 0, life: 0.6, size: 1, color: '#fff', rot: 0, vr: 0, floor: null, bounce: 0.35, t: 0, fade: true }, p);
    q.max = q.life;
    this.list.push(q);
    return q;
  }
  burst(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = opts.angle != null ? opts.angle + vrand(-opts.spread || 0, opts.spread || 0) : vrand(0, Math.PI * 2);
      const sp = vrand(opts.speed * 0.4, opts.speed);
      this.add(Object.assign({}, opts, {
        x: x + vrand(-(opts.jitter || 0), opts.jitter || 0), y: y + vrand(-(opts.jitter || 0), opts.jitter || 0),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        color: Array.isArray(opts.color) ? vpick(opts.color) : opts.color,
        life: vrand((opts.life || 0.6) * 0.6, opts.life || 0.6),
        size: opts.sizes ? vpick(opts.sizes) : opts.size || 1,
      }));
    }
  }
  text(x, y, str, color, opts = {}) {
    return this.add(Object.assign({ kind: 'text', x, y, vy: -28, drag: 3, life: 0.9, text: str, color, font: 'small', outline: PAL.k }, opts));
  }
  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      p.life -= dt;
      p.vy += p.ay * dt;
      if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.floor != null && p.y > p.floor) {
        p.y = p.floor;
        p.vy = -Math.abs(p.vy) * p.bounce;
        p.vx *= 0.7; p.vr *= 0.6;
        if (Math.abs(p.vy) < 12) { p.vy = 0; p.ay = 0; p.vr = 0; }
      }
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = p.fade ? clamp(p.life / (p.max * 0.5), 0, 1) : 1;
      if (p.kind === 'proj') continue;
      if (p.kind === 'text') {
        const pop = p.t < 0.12 ? 1 + (1 - p.t / 0.12) * 0.0 : 1;
        Font.draw(ctx, p.text, Math.round(p.x), Math.round(p.y), { font: p.font, color: p.color, outline: p.outline, align: 'center', alpha: a, scale: p.scale || pop });
      } else if (p.kind === 'spr') {
        SPR.draw(ctx, p.spr, p.x, p.y, { rot: p.rot, alpha: a, flip: p.flip, solid: p.solid });
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        const r = p.r0 + (p.r1 - p.r0) * (1 - p.life / p.max);
        ctx.beginPath(); ctx.arc(Math.round(p.x), Math.round(p.y), r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        const s = p.size;
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
        ctx.globalAlpha = 1;
      }
    }
  }
}

// ------------------------------------------------------------ pixel drawing
const Draw = {
  rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
  frame(ctx, x, y, w, h, c) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  },
  // Bevelled pixel panel like the reference UI (dark slate with a light rim).
  panel(ctx, x, y, w, h, style = 'dark') {
    const S = {
      dark: ['#0e0b16', '#1d1a2c', '#3b3654', '#26223a'],
      slate: ['#0e0b16', '#222634', '#4b556b', '#2d3344'],
      green: ['#0e0b16', '#1d3a2a', '#5fb86a', '#2e5c3f'],
      paper: ['#43382a', '#efe3c8', '#fff6e3', '#d4c19c'],
      wood: ['#1e120b', '#6a4026', '#b07a4a', '#4e2e1b'],
      neon: ['#0e0b16', '#241230', '#b84a7c', '#3a1a44'],
      red: ['#0e0b16', '#3a1424', '#e8405a', '#5a1a30'],
    }[style];
    const [ol, fill, hi, lo] = S;
    // outline with cut corners
    this.rect(ctx, x + 1, y, w - 2, h, ol);
    this.rect(ctx, x, y + 1, w, h - 2, ol);
    this.rect(ctx, x + 1, y + 1, w - 2, h - 2, fill);
    this.rect(ctx, x + 2, y + 1, w - 4, 1, hi);
    this.rect(ctx, x + 1, y + 2, 1, h - 4, hi);
    this.rect(ctx, x + 2, y + h - 2, w - 4, 1, lo);
    this.rect(ctx, x + w - 2, y + 2, 1, h - 4, lo);
  },
  // hard-edged pixel line (Bresenham)
  line(ctx, x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    ctx.fillStyle = c;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    for (;;) {
      ctx.fillRect(x0, y0, 1, 1);
      if ((x0 === x1 && y0 === y1) || n++ > 2000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  },
  // soft additive glow (used sparingly for lights)
  glow(ctx, x, y, r, color, alpha = 0.5) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = op;
  },
  // jagged lightning bolt
  bolt(ctx, x0, y0, x1, y1, color, jag = 8, seed = 1) {
    const r = mulberry32(seed);
    const pts = [[x0, y0]];
    const n = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 10));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([lerp(x0, x1, t) + (r() - 0.5) * jag * 2, lerp(y0, y1, t) + (r() - 0.5) * jag * 0.6]);
    }
    pts.push([x1, y1]);
    for (let i = 0; i < pts.length - 1; i++) {
      this.line(ctx, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color);
      this.line(ctx, pts[i][0] + 1, pts[i][1], pts[i + 1][0] + 1, pts[i + 1][1], color);
    }
    return pts;
  },
};

// ------------------------------------------------------------------ widgets
// Buttons are plain objects owned by scenes; UI.update() handles hover/click
// for the buttons registered this frame by the current scene.
const UI = {
  buttons: [],
  tooltip: null,
  hoverId: null,
  focusAt: [0, 0],
  focusId: null, // keyboard / gamepad focus, for scenes that opt in with `uiNav` (the slab): arrows move it, confirm presses it
  set(buttons) { this.buttons = buttons; },
  focusable() { return this.buttons.filter((b) => !b.hidden && b.kind !== 'hot' && b.w > 0); },
  focused() { return this.focusId ? this.buttons.find((b) => b.id === this.focusId) : null; },
  // move focus to the nearest button in a direction (centre to centre; sideways drift counts double)
  moveFocus(dx, dy) {
    const list = this.focusable();
    if (!list.length) return;
    const cur = this.focused();
    if (!cur) { this.focusId = list[0].id; return; }
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = null, bs = 1e9;
    for (const b of list) {
      if (b === cur) continue;
      const ax = b.x + b.w / 2 - cx, ay = b.y + b.h / 2 - cy;
      const along = ax * dx + ay * dy, across = Math.abs(ax * dy) + Math.abs(ay * dx);
      if (along <= 1) continue;
      const sc = along + across * 2;
      if (sc < bs) { bs = sc; best = b; }
    }
    if (best) { this.focusId = best.id; Sfx.play('ui_hover'); } else Sfx.play('ui_deny');
  },
  update() {
    const m = Input.mouse;
    if (Engine.scene && Engine.scene.uiNav && !Engine.overlays.length && !Engine.trans) {
      if (m.moved) this.focusId = null; // the mouse takes over
      const dir = [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]].find(([a]) => Input.hit(a));
      if (dir) this.moveFocus(dir[1], dir[2]);
      let f = this.focused();
      if (f) this.focusAt = [f.x + f.w / 2, f.y + f.h / 2];
      else if (this.focusId) { // the focused button is gone (a part was stitched): carry on from the nearest one
        const near = this.focusable().map((b) => [Math.hypot(b.x + b.w / 2 - this.focusAt[0], b.y + b.h / 2 - this.focusAt[1]), b]).sort((a, b) => a[0] - b[0])[0];
        this.focusId = near ? near[1].id : null; f = this.focused();
      }
      if (f && Input.hit('a')) {
        if (f.disabled) { Sfx.play('ui_deny'); if (f.onDeny) f.onDeny(); }
        else if (f.onClick) { f.pressT = 1; if (!f.silent) Sfx.play(f.sound || 'ui_click'); f.onClick(); }
      }
    } else if (this.focusId && !(Engine.scene && Engine.scene.uiNav)) this.focusId = null;
    let hover = null;
    for (const b of this.buttons) {
      if (b.hidden) continue;
      const over = m.x >= 0 && Input.over(b.x, b.y, b.w, b.h);
      b.hover = over && !b.disabled;
      b.held = over && m.down;
      if (over) hover = b;
      b.pressT = Math.max(0, (b.pressT || 0) - 0.05);
    }
    const hid = hover && !hover.disabled ? hover.id || hover.label : null;
    if (hid && hid !== this.hoverId && Input.lastDevice === 'mouse' && !(hover && hover.silent)) Sfx.play('ui_hover');
    this.hoverId = hid;
    if (m.pressed && hover && !Engine.trans) {
      if (hover.disabled) { Sfx.play('ui_deny'); if (hover.onDeny) hover.onDeny(); }
      else if (hover.onClick) {
        hover.pressT = 1;
        if (!hover.silent) Sfx.play(hover.sound || 'ui_click');
        hover.onClick();
      }
    }
    this.tooltip = hover && hover.tip ? hover.tip : null;
  },
  drawButton(ctx, b) {
    if (b.hidden) return;
    const style = b.disabled ? 'dark' : b.style || 'dark';
    const down = b.held || b.pressT > 0.5 ? 1 : 0;
    Draw.panel(ctx, b.x, b.y + down, b.w, b.h, style);
    if (b.hover && !b.disabled) Draw.frame(ctx, b.x - 1, b.y - 1 + down, b.w + 2, b.h + 2, b.hoverColor || '#fff6e3');
    const col = b.disabled ? '#5b4a78' : b.textColor || (style === 'paper' ? PAL.N : style === 'wood' ? '#fff1c8' : '#ecdcbc');
    if (b.icon) {
      SPR.draw(ctx, b.icon, b.x + 8, b.y + b.h / 2 + down);
      Font.draw(ctx, b.label, b.x + 16, b.y + Math.floor((b.h - 7) / 2) + down, { color: col, shadow: style === 'paper' ? null : PAL.k });
    } else {
      Font.draw(ctx, b.label, b.x + b.w / 2, b.y + Math.floor((b.h - 7) / 2) + down, { color: col, align: 'center', font: b.font || 'main', shadow: style === 'paper' ? null : PAL.k });
    }
  },
  drawOverlay(ctx) {
    if (AudioSys.muted) Font.draw(ctx, 'MUTED (' + Settings.hint('mute') + ')', W - 3, H - 9, { font: 'small', color: '#7a6a9a', align: 'right' });
    const fb = Engine.overlays.length ? null : this.focused();
    if (fb) {
      Draw.frame(ctx, fb.x - 2, fb.y - 2, fb.w + 4, fb.h + 4, '#000000');
      Draw.frame(ctx, fb.x - 1, fb.y - 1, fb.w + 2, fb.h + 2, '#fff6e3');
      if (fb.tip) this.drawTip(ctx, fb.tip, fb.x + fb.w + 4, fb.y);
    }
    if (this.tooltip && Input.mouse.x >= 0 && !fb) this.drawTip(ctx, this.tooltip, Input.mouse.x + 8, Input.mouse.y + 10, Input.mouse.y);
  },
  drawTip(ctx, tip, tx, ty, flipY) {
    const lines = Array.isArray(tip) ? tip : [tip];
    const w = Math.max(...lines.map((l) => Font.measure(typeof l === 'string' ? l : l.t))) + 10;
    const h = lines.length * 10 + 6;
    let x = Math.round(tx), y = Math.round(ty);
    if (x + w > W - 2) x = Math.max(2, Math.round(W - 2 - w));
    if (y + h > H - 2) y = flipY != null ? Math.round(flipY - h - 4) : H - 2 - h;
    Draw.panel(ctx, x, y, w, h, 'dark');
    lines.forEach((l, i) => {
      const o = typeof l === 'string' ? { t: l, c: '#ecdcbc' } : l;
      Font.draw(ctx, o.t, x + 5, y + 4 + i * 10, { color: o.c, shadow: PAL.k });
    });
  },
};

// Typewriter speech for the Reaper (and friends). One active line at a time.
class Talker {
  constructor(opts = {}) { this.text = ''; this.shown = 0; this.t = 0; this.hold = 0; this.voice = opts.voice || 0.6; this.cps = opts.cps || 38; this.queue = []; }
  say(text, hold = 2.6, force = true) {
    if (!force && (this.busy() || this.queue.length)) { this.queue.push([text, hold]); return; }
    this.queue = [];
    this.text = text; this.shown = 0; this.t = 0; this.hold = hold;
    if (typeof Announce !== 'undefined') Announce.say(text);
  }
  busy() { return this.text && this.shown < this.text.length; }
  update(dt) {
    if (!this.text) { if (this.queue.length) this.say(...this.queue.shift()); return; }
    const before = Math.floor(this.shown);
    this.shown = Math.min(this.text.length, this.shown + this.cps * dt);
    const after = Math.floor(this.shown);
    for (let i = before; i < after; i++) {
      const ch = this.text[i];
      if (ch && /[a-z0-9]/i.test(ch) && i % 2 === 0) Sfx.voice(this.voice);
    }
    if (this.shown >= this.text.length) {
      this.t += dt;
      if (this.t > this.hold) { this.text = ''; if (this.queue.length) this.say(...this.queue.shift()); }
    }
  }
  talking() { return this.text && this.shown < this.text.length; }
  visible() { return !!this.text; }
  // speech bubble with a tail pointing at (tx, ty)
  drawBubble(ctx, x, y, maxW, tx, ty, opts = {}) {
    if (!this.text) return;
    const lines = Font.wrap(this.text, maxW - 12);
    const w = Math.min(maxW, Math.max(...lines.map((l) => Font.measure(l))) + 12);
    const h = lines.length * 10 + 8;
    if (opts.align === 'right') x -= w;
    if (opts.anchorBottom) y -= h;
    x = Math.round(clamp(x, 2, W - w - 2)); y = Math.round(y);
    const pop = Math.min(1, this.shown / 3);
    if (pop < 1) y += 1;
    Draw.panel(ctx, x, y, w, h, 'paper');
    // tail
    if (tx != null) {
      const bx = clamp(tx, x + 6, x + w - 8);
      const below = ty > y + h;
      ctx.fillStyle = '#efe3c8';
      for (let i = 0; i < 4; i++) {
        const yy = below ? y + h - 1 + i : y - i;
        const xx = Math.round(lerp(bx, tx, i / 4));
        ctx.fillStyle = '#43382a';
        ctx.fillRect(xx - (3 - i) - 1, yy, (3 - i) * 2 + 2, 1);
        ctx.fillStyle = '#efe3c8';
        if (3 - i > 0) ctx.fillRect(xx - (3 - i), yy, (3 - i) * 2, 1);
      }
    }
    Font.drawWrapped(ctx, this.text, x + 6, y + 5, maxW - 12, { color: PAL.N, maxChars: Math.floor(this.shown) });
  }
}
