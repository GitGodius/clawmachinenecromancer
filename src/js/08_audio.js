// ---------------------------------------------------------------------------
// AUDIO — every sound is synthesized live with WebAudio (no samples, no network).
//   AudioSys.init()      create/resume the context; call on the first user gesture
//   AudioSys.toggleMute() / setMuted(b) / muted / setVolumes({master,music,sfx}) / ctx
//   Sfx.play(name, {intensity, pitch, pan, material, crit})   one-shots (see S below)
//   Sfx.motor(level, pitch)   continuous claw-motor hum — cheap, call every frame
//   Sfx.voice(pitch)          one gibberish dialogue blip (the Reaper talks at ~0.6)
//   Music.play(track|null) / Music.stop() / Music.duck(amount, seconds)
// Everything is a silent no-op until init(), and forever without WebAudio (Node).
// ---------------------------------------------------------------------------
const { AudioSys, Sfx, Music } = (() => {
  const R = Math.random, rr = (a, b) => a + R() * (b - a), pick = (a) => a[(R() * a.length) | 0];
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const vol = { master: 0.8, music: 0.45, sfx: 0.8 };
  const warned = {};
  const warn = (k, msg) => { if (!warned[k]) { warned[k] = 1; console.warn(msg); } };
  let ctx = null;     // the live AudioContext (briefly swapped for an offline one by AudioSys._render)
  let B = null;       // buses, shared buffers and per-context state belonging to ctx
  let paused = false; // tab hidden -> context suspended; don't queue sounds that would burst later
  let want = null;    // requested music track (remembered before init)
  let resumeAt = 0;   // when we last asked the context to resume (it may report 'suspended' briefly)
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // Sounds are dropped (not queued to burst out later) while muted, hidden or blocked by autoplay.
  const ready = () => ctx && !AudioSys.muted && !paused && (ctx !== AudioSys.ctx || ctx.state === 'running' || Date.now() - resumeAt < 1000);

  // ---- mixer graph ---------------------------------------------------------
  //  sfx voices ─► sfx ─────────────────────────┐
  //     └ wet send ─► sfxWet ─► verb ───────────┼─► master ─► compressor ─► out
  //  music notes ─► track ─► duck ─► music ─────┘   (music ─► 0.3 ─► verb)
  function build(c, muted) {
    const G = (g, to) => { const n = c.createGain(); n.gain.value = g; if (to) n.connect(to); return n; };
    const comp = c.createDynamicsCompressor(); // glue + near-limiter so pile-ups of loud sounds never clip
    for (const [k, x] of [['threshold', -8], ['knee', 6], ['ratio', 20], ['attack', 0.001], ['release', 0.2]]) comp[k].value = x;
    comp.connect(c.destination);
    const master = G(muted ? 0 : vol.master, comp);
    const verb = c.createConvolver();
    verb.buffer = impulse(c, 2.2);
    verb.connect(master);
    const music = G(vol.music, master);
    music.connect(G(0.3, verb));
    const noiseBuf = (brown) => {
      const n = c.sampleRate * 2, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0, x = 0; i < n; i++) { const w = R() * 2 - 1; d[i] = brown ? (x = (x + 0.02 * w) / 1.02) * 3.5 : w; }
      return b;
    };
    const re = new Float32Array(32), im = new Float32Array(32); // 25% pulse wave (chiptune lead)
    for (let n = 1; n < 32; n++) { re[n] = Math.sin(Math.PI * n / 2) / (n * Math.PI); im[n] = (1 - Math.cos(Math.PI * n / 2)) / (n * Math.PI); }
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 127.5 - 1) * 5);
    return {
      master, music, duck: G(1, music), sfx: G(vol.sfx, master), sfxWet: G(vol.sfx, verb),
      noise: noiseBuf(0), brown: noiseBuf(1), pulse: c.createPeriodicWave(re, im), curve,
      thr: {}, talk: -1, duckEnd: 0, duckAmt: 0, motor: null,
    };
  }

  // Generated reverb: stereo noise that darkens as it decays (a small stone crypt), bass removed.
  function impulse(c, secs) {
    const n = (c.sampleRate * secs) | 0, buf = c.createBuffer(2, n, c.sampleRate), pre = (c.sampleRate * 0.015) | 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = pre, lp = 0, lo = 0; i < n; i++) {
        const x = i / n;
        lp += (0.7 - 0.6 * x) * (R() * 2 - 1 - lp);
        lo += 0.02 * (lp - lo);
        d[i] = (lp - lo) * Math.pow(1 - x, 3);
      }
    }
    return buf;
  }

  // ---- node plumbing ---------------------------------------------------------
  // A voice groups the nodes of one sound; all are disconnected when its last source ends.
  function grp(dest, x, wet) {
    const out = ctx.createGain(), v = { out, nodes: [out], srcs: [], live: 0, end: 0 };
    out.connect(pan(v, x, dest));
    if (wet) { const w = gain(v, wet); out.connect(w); w.connect(B.sfxWet); }
    return v;
  }
  function pan(v, x, to) {
    if (!x || !ctx.createStereoPanner) return to;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(x, -1, 1);
    p.connect(to); v.nodes.push(p);
    return p;
  }
  const done = (v) => { if (--v.live <= 0) for (const n of v.nodes) n.disconnect(); };
  function run(v, s, t0, t1, off) {
    v.nodes.push(s); v.srcs.push(s); v.live++;
    s.onended = () => done(v);
    s.start(t0, off || 0); s.stop(t1);
    if (t1 > v.end) v.end = t1;
    return s;
  }
  // Build the part of a long sound that starts at t shortly before it plays, so big sounds don't
  // create hundreds of nodes in one frame. Live context only (offline renders run faster than time).
  function defer(v, t, fn) {
    const c = ctx, ms = (t - c.currentTime - 0.15) * 1000;
    if (ms < 20 || c !== AudioSys.ctx) return fn();
    v.live++; if (t > v.end) v.end = t;
    setTimeout(() => {
      if (!v.dead && ctx === c) { try { fn(); } catch (e) { /* audio must never break the game */ } }
      done(v);
    }, ms);
  }
  const gain = (v, g) => { const n = ctx.createGain(); n.gain.value = g; v.nodes.push(n); return n; };
  const filt = (v, type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; v.nodes.push(n); return n; };
  const wire = (...n) => { for (let i = 1; i < n.length; i++) n[i - 1].connect(n[i]); return n[n.length - 1]; };
  const sweep = (p, t, x, ...pts) => { p.setValueAtTime(x, t); for (const [y, dt] of pts) p.exponentialRampToValueAtTime(y, t + dt); };
  function hold(p, t) { // freeze a param at its current value so new ramps start from there
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else { const x = p.value; p.cancelScheduledValues(t); p.setValueAtTime(x, t); }
  }
  const ramp = (p, x, dur) => { const t = ctx.currentTime; hold(p, t); p.linearRampToValueAtTime(x, t + dur); };
  function osc(v, type, f, t0, t1) {
    const o = ctx.createOscillator();
    if (type === 'pulse') o.setPeriodicWave(B.pulse); else o.type = type;
    o.frequency.value = f;
    return run(v, o, t0, t1);
  }
  function noise(v, t0, t1, brown) {
    const s = ctx.createBufferSource();
    s.buffer = brown ? B.brown : B.noise; s.loop = true;
    return run(v, s, t0, t1, R() * 1.5);
  }
  // perc: quick attack then exponential decay to silence at t+d. env: attack, hold to t+d, release r.
  function perc(v, t, a, g, d) {
    const e = gain(v, 0), p = e.gain;
    g = Math.max(g, 2e-4);
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(g, t + a);
    p.exponentialRampToValueAtTime(g * 1e-3, t + Math.max(d, a + 0.005)); // -60 dB at t+d
    return e;
  }
  function env(v, t, a, g, d, r) {
    const e = gain(v, 0), p = e.gain, h = t + Math.max(d, a);
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(g, t + a); p.setValueAtTime(g, h); p.linearRampToValueAtTime(0, h + r);
    return e;
  }
  const lfo = (v, rate, depth, t0, t1, type) => wire(osc(v, type || 'sine', rate, t0, t1), gain(v, depth));

  // Enveloped oscillator.  o: {type, f, f1 (glide target), glide, a, d, g, lp, q, det, to}
  function tone(v, t, o) {
    const d = o.d || 0.2, s = osc(v, o.type || 'sine', o.f, t, t + d + 0.02);
    if (o.f1) sweep(s.frequency, t, o.f, [o.f1, o.glide || d]);
    if (o.det) s.detune.value = o.det;
    const chain = [s];
    if (o.lp) chain.push(filt(v, 'lowpass', o.lp, o.q));
    wire(...chain, perc(v, t, o.a || 0.003, num(o.g, 0.2), d), o.to || v.out);
    return s;
  }
  // Enveloped filtered noise.  o: {type (filter), f, f1, q, a, d, g, brown, to}
  function hiss(v, t, o) {
    const d = o.d || 0.1, f = filt(v, o.type || 'bandpass', o.f || 2000, o.q);
    if (o.f1) sweep(f.frequency, t, o.f || 2000, [o.f1, d]);
    wire(noise(v, t, t + d + 0.02, o.brown), f, perc(v, t, o.a || 0.002, num(o.g, 0.2), d), o.to || v.out);
    return f;
  }
  // Glockenspiel-ish bell: inharmonic partials, higher ones die faster.
  const BELL = [[1, 1, 1], [2.76, 0.45, 0.4], [5.4, 0.25, 0.22], [8.93, 0.12, 0.12]];
  const bell = (v, t, f, g, d, to) => { for (const [r, a, k] of BELL) if (f * r < 16000) tone(v, t, { f: f * r, g: g * a, d: d * k, a: 0.002, to }); };
  const sq = (v, t, m, d, g, p) => tone(v, t, { type: 'square', f: hz(m) * p, d, g, lp: 4500 });

  // A body part hitting something. Shared by bump / chute / restock / creature_die.
  function knock(v, t, m, i, p, to) {
    i = clamp(i, 0.03, 2);
    if (m === 'flesh') {
      tone(v, t, { f: 140 * p, f1: 60 * p, d: 0.11, g: 0.3 * i, to });
      hiss(v, t, { d: 0.07, g: 0.9 * i, type: 'lowpass', f: 700 + 900 * i, to });
      hiss(v, t, { d: 0.04, g: 0.5 * i, f: 900 * p, q: 1.2, to }); // slap
    } else if (m === 'squish') {
      hiss(v, t, { d: 0.13, g: 0.42 * i, type: 'lowpass', f: 2800 * p, f1: 300 * p, q: 8, to });
      tone(v, t + 0.012, { f: 260 * p, f1: 720 * p, d: 0.05, g: 0.24 * i, to });
      if (R() < 0.6) tone(v, t + 0.05 + R() * 0.03, { f: 380 * p, f1: 950 * p, d: 0.035, g: 0.12 * i, to });
    } else if (m === 'metal') {
      const f = rr(900, 1500) * p;
      for (const [r, g, d] of [[1, 0.15, 0.35], [2.32, 0.085, 0.22], [4.25, 0.06, 0.13], [6.63, 0.037, 0.08]]) {
        tone(v, t, { f: f * r, g: g * i, d: d * (0.5 + 0.5 * i), to }); // inharmonic clang partials
      }
      hiss(v, t, { d: 0.012, g: 0.15 * i, type: 'highpass', f: 3000, to });
    } else { // bone: hollow dry woodblock-ish clack
      const f = rr(650, 1250) * p;
      tone(v, t, { type: 'triangle', f, f1: f * 0.9, d: 0.06, g: 0.4 * i, to });
      tone(v, t, { f: f * 2.7, d: 0.025, g: 0.13 * i, to });
      hiss(v, t, { d: 0.035, g: 0.29 * i, f: Math.min(f * 1.7, 9000), q: 7, to });
    }
  }
  // Thread zip: noise chopped by a fast square LFO through a sweeping bandpass.
  function zip(v, t, d, f0, f1, r0, r1, g) {
    const f = filt(v, 'bandpass', f0, 3), gate = gain(v, 0.5), l = osc(v, 'square', r0, t, t + d + 0.02);
    sweep(f.frequency, t, f0, [f1, d]); sweep(l.frequency, t, r0, [r1, d]);
    wire(l, gain(v, 0.5), gate.gain);
    wire(noise(v, t, t + d + 0.02), f, gate, env(v, t, 0.02, g, d - 0.03, 0.03), v.out);
  }
  // Brassy stab: detuned saws through an envelope-swept lowpass.
  function brass(v, t, notes, d, p, g) {
    const f = filt(v, 'lowpass', 600, 3), e = env(v, t, 0.015, 0.05 * (g || 1), d, 0.12);
    sweep(f.frequency, t, 600, [3200, 0.04], [1800, Math.max(d, 0.08)]);
    for (const m of notes) for (const det of [-7, 7]) { const s = osc(v, 'sawtooth', hz(m) * p, t, t + d + 0.15); s.detune.value = det; s.connect(f); }
    wire(f, e, v.out);
  }
  // Soft reed organ (triangle + sub + a little 2nd harmonic), optional vibrato.
  function organ(v, t, m, d, p, g, vib, nosub) {
    const f = filt(v, 'lowpass', 1400), e = env(v, t, 0.04, 0.07 * g, d, 0.25), L = vib ? lfo(v, 5, 14, t + 0.25, t + d + 0.3) : null;
    for (const [type, r, a] of [['triangle', 1, 1], ['sine', 0.5, nosub ? 0 : 0.8], ['sine', 2, 0.2]]) {
      if (!a) continue;
      const s = osc(v, type, hz(m) * p * r, t, t + d + 0.3);
      if (L) L.connect(s.detune);
      wire(s, gain(v, a), f);
    }
    wire(f, e, v.out);
  }

  // ---- sound effects: (voice, startTime, opts{i: intensity, p: pitch, ...}) --------
  const S = {
    ui_hover: (v, t, o) => tone(v, t, { type: 'triangle', f: 2300 * o.p * rr(0.97, 1.03), f1: 1900 * o.p, d: 0.035, g: 0.125 }),
    ui_click: (v, t, o) => {
      tone(v, t, { type: 'square', f: 1100 * o.p, f1: 1500 * o.p, glide: 0.02, d: 0.06, g: 0.16, lp: 4000 });
      hiss(v, t, { d: 0.012, g: 0.23, type: 'highpass', f: 3500 });
    },
    ui_back: (v, t, o) => tone(v, t, { type: 'square', f: 760 * o.p, f1: 430 * o.p, d: 0.09, g: 0.15, lp: 2400 }),
    ui_deny: (v, t, o) => { for (const k of [0, 0.1]) tone(v, t + k, { type: 'sawtooth', f: 230 * o.p, f1: 205 * o.p, d: 0.085, a: 0.004, g: 0.36, lp: 2200, q: 4 }); },
    page: (v, t, o) => {
      hiss(v, t, { d: 0.1, a: 0.03, g: 0.42, f: 800 * o.p, f1: 3200 * o.p, q: 0.9 });
      hiss(v, t + 0.075, { d: 0.05, g: 0.25, f: 4200 * o.p, q: 1.5 });
    },
    transition: (v, t, o) => {
      const d = 0.65, f = filt(v, 'bandpass', 300, 1.2), pn = pan(v, -0.6, v.out);
      sweep(f.frequency, t, 300 * o.p, [1800 * o.p, d * 0.5], [350 * o.p, d]);
      if (pn.pan) { pn.pan.setValueAtTime(-0.6, t); pn.pan.linearRampToValueAtTime(0.6, t + d); }
      const e = gain(v, 0);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.39, t + d * 0.45); e.gain.linearRampToValueAtTime(0, t + d);
      wire(noise(v, t, t + d + 0.02), f, e, pn);
    },
    error: (v, t, o) => {
      for (const [type, f, g] of [['sawtooth', 110, 0.33], ['square', 55, 0.08]]) tone(v, t, { type, f: f * o.p, f1: f * 0.9 * o.p, d: 0.38, a: 0.01, g, lp: 1600, q: 3 });
    },
    coin: (v, t, o) => {
      for (const [r, g, d] of [[1, 0.22, 0.2], [1.47, 0.15, 0.14], [2.09, 0.11, 0.1], [2.83, 0.077, 0.07]]) tone(v, t, { f: 2350 * o.p * r, g, d });
      hiss(v, t, { d: 0.015, g: 0.26, type: 'highpass', f: 4000 });
      sq(v, t + 0.08, 83, 0.07, 0.15, o.p); sq(v, t + 0.15, 88, 0.28, 0.15, o.p); // B5 -> E6
    },

    // --- the claw ---
    claw_drop: (v, t, o) => {
      const p = o.p, d = 0.5, f = filt(v, 'lowpass', 2000, 4), am = gain(v, 0.6);
      sweep(f.frequency, t, 2000, [450, d]);
      for (const [type, f0, f1] of [['sawtooth', 460, 150], ['square', 231, 76]]) {
        const s = osc(v, type, f0 * p, t, t + d + 0.02);
        sweep(s.frequency, t, f0 * p, [f1 * p, d]); s.connect(f);
      }
      lfo(v, 36, 0.4, t, t + d, 'square').connect(am.gain); // gear chatter
      wire(f, am, env(v, t, 0.02, 0.17, d - 0.15, 0.15), v.out);
      hiss(v, t, { d: 0.025, g: 0.22, f: 2600, q: 3 }); // latch release
    },
    claw_land: (v, t, o) => {
      const i = o.i, p = o.p;
      tone(v, t, { f: 140 * p, f1: 42 * p, glide: 0.12, d: 0.25, g: 0.15 + 0.35 * i }); // sub thump
      tone(v, t, { type: 'triangle', f: 260 * p, f1: 150 * p, d: 0.09, g: 0.2 + 0.4 * i }); // body
      hiss(v, t, { d: 0.09, g: 0.25 + 0.55 * i, type: 'lowpass', f: 900 + 2500 * i });
      hiss(v, t, { d: 0.05, g: 0.5 * i, f: 1300 * p, q: 2 }); // clank
      for (const [f, d] of [[347, 0.18], [529, 0.13], [811, 0.09]]) tone(v, t + 0.004, { type: 'triangle', f: f * p, d, g: 0.2 * i });
      for (let k = 0; k < 2; k++) knock(v, t + 0.03 + R() * 0.07, pick(['bone', 'flesh']), 0.35 * i, p, v.out); // the pile shifts
    },
    claw_close: (v, t, o) => {
      const p = o.p;
      [0, 0.06, 0.11, 0.155].forEach((dt, k) => { // ratchet
        hiss(v, t + dt, { d: 0.02, g: 1, f: (2300 + 250 * k) * p, q: 2 });
        tone(v, t + dt, { type: 'square', f: (560 + 60 * k) * p, d: 0.025, g: 0.3, lp: 2000 });
      });
      tone(v, t, { type: 'sawtooth', f: 170 * p, f1: 240 * p, d: 0.24, a: 0.02, g: 0.13, lp: 900 }); // servo
      tone(v, t + 0.2, { f: 300 * p, f1: 120 * p, d: 0.08, g: 0.2 }); // prongs meet
      hiss(v, t + 0.2, { d: 0.03, g: 0.5, f: 1500 * p, q: 2 });
    },
    claw_open: (v, t, o) => {
      const p = o.p;
      hiss(v, t, { d: 0.03, g: 0.55, f: 1800 * p, q: 2 });
      tone(v, t, { type: 'triangle', f: 700 * p, f1: 480 * p, d: 0.05, g: 0.3 });
      const s = tone(v, t + 0.015, { type: 'triangle', f: 520 * p, f1: 380 * p, d: 0.32, g: 0.22 });
      lfo(v, 26, 70 * p, t, t + 0.35).connect(s.frequency); // sproing
    },
    claw_top: (v, t, o) => {
      const p = o.p;
      tone(v, t, { f: 210 * p, f1: 85 * p, glide: 0.06, d: 0.13, g: 0.3 });
      tone(v, t, { type: 'triangle', f: 420 * p, f1: 260 * p, d: 0.08, g: 0.33 });
      hiss(v, t, { d: 0.06, g: 0.45, f: 1000, q: 0.8 });
      tone(v, t, { type: 'square', f: 1180 * p, d: 0.04, g: 0.12, lp: 3000 });
      for (const k of [0.05, 0.09]) tone(v, t + k, { f: rr(2200, 3000) * p, d: 0.05, g: 0.08 }); // chain jingle
    },

    // --- parts & prizes ---
    bump: (v, t, o) => knock(v, t, o.material || 'bone', o.i, o.p, v.out),
    grab: (v, t, o) => { // tension sting: E5 -> Bb5 (tritone) with a nervous tremble
      const p = o.p;
      tone(v, t, { type: 'square', f: 659 * p, d: 0.09, g: 0.135, lp: 2500 }); tone(v, t, { f: 330 * p, d: 0.09, g: 0.18 });
      const s = tone(v, t + 0.09, { type: 'square', f: 932 * p, d: 0.42, a: 0.01, g: 0.135, lp: 2500 });
      tone(v, t + 0.09, { f: 466 * p, d: 0.42, g: 0.18 });
      lfo(v, 9, 20, t + 0.15, t + 0.52).connect(s.detune);
    },
    slip: (v, t, o) => { // "wah-waaah": muted-trombone saws through a wah filter, second note sags
      for (const [dt, d, f0, f1] of [[0, 0.24, 196, 190], [0.28, 0.75, 185, 147]]) {
        const tn = t + dt, f = filt(v, 'lowpass', 300, 8), L = d > 0.5 ? lfo(v, 5.5, 30, tn + 0.2, tn + d) : null;
        sweep(f.frequency, tn, 300, [1700, 0.08], [450, d]);
        for (const det of [-8, 8]) {
          const s = osc(v, 'sawtooth', f0 * o.p, tn, tn + d + 0.02);
          s.detune.value = det;
          s.frequency.setValueAtTime(f0 * o.p, tn + d * 0.35); s.frequency.exponentialRampToValueAtTime(f1 * o.p, tn + d);
          if (L) L.connect(s.detune);
          s.connect(f);
        }
        wire(f, env(v, tn, 0.03, 0.16, d - 0.08, 0.08), v.out);
      }
    },
    creak: (v, t, o) => { // the claw straining: a wobbling metal groan plus ratchet ticks as the part slides
      const p = o.p, d = 0.45;
      const s = tone(v, t, { type: 'sawtooth', f: 150 * p, f1: 112 * p, d, a: 0.05, g: 0.16, lp: 950, q: 6 });
      lfo(v, 21, 28, t, t + d).connect(s.detune);
      hiss(v, t, { d: 0.32, a: 0.06, g: 0.1, f: 2300 * p, q: 5 });
      for (const k of [0.07, 0.18, 0.31]) hiss(v, t + k, { d: 0.02, g: 0.22, f: rr(1800, 3200) * p, q: 3 });
    },
    miss: (v, t, o) => {
      tone(v, t, { type: 'triangle', f: 440 * o.p, d: 0.16, g: 0.29 });
      const s = tone(v, t + 0.17, { type: 'triangle', f: 349 * o.p, f1: 330 * o.p, d: 0.4, g: 0.29 });
      lfo(v, 6, 15, t + 0.2, t + 0.6).connect(s.detune);
    },
    win_common: (v, t, o) => { sq(v, t, 79, 0.07, 0.08, o.p); sq(v, t + 0.07, 84, 0.22, 0.08, o.p); bell(v, t + 0.07, hz(84) * o.p, 0.2, 0.7); },
    win_uncommon: (v, t, o) => {
      [72, 76, 79].forEach((m, k) => sq(v, t + k * 0.065, m, 0.09, 0.085, o.p));
      sq(v, t + 0.2, 84, 0.3, 0.085, o.p);
      bell(v, t + 0.2, hz(84) * o.p, 0.2, 0.9); bell(v, t + 0.33, hz(88) * o.p, 0.17, 0.9);
    },
    win_rare: (v, t, o) => {
      Music.duck(0.4, 1.1);
      [72, 76, 79, 84, 88, 91].forEach((m, k) => sq(v, t + k * 0.05, m, 0.1, 0.11, o.p));
      for (const m of [84, 88, 91]) bell(v, t + 0.3, hz(m) * o.p, 0.16, 1.3);
      defer(v, t + 0.45, () => { for (let k = 0; k < 6; k++) bell(v, t + 0.45 + k * 0.09, hz(pick([96, 100, 103, 108])) * o.p, 0.07, 0.4); });
      hiss(v, t + 0.3, { d: 0.9, a: 0.3, g: 0.07, type: 'highpass', f: 8000 });
    },
    win_legendary: (v, t, o) => {
      const p = o.p;
      Music.duck(0.75, 2.3);
      for (const dt of [0, 0.12, 0.24]) brass(v, t + dt, [67, 64], 0.09, p, 1.8); // ta-ta-ta
      brass(v, t + 0.38, [72, 67, 64, 60], 1.1, p, 1.8); // TAAA
      tone(v, t + 0.38, { f: 110, f1: 38, d: 0.6, g: 0.3 }); // boom
      hiss(v, t + 0.38, { d: 1.6, g: 0.12, type: 'highpass', f: 6000 }); // cymbal
      defer(v, t + 0.45, () => { [84, 88, 91, 96, 100, 103, 108].forEach((m, k) => bell(v, t + 0.45 + k * 0.06, hz(m) * p, 0.09, 0.5)); });
      defer(v, t + 0.9, () => { bell(v, t + 0.9, hz(96) * p, 0.28, 1.6); });
      defer(v, t + 1, () => { for (let k = 0; k < 8; k++) bell(v, t + 1 + k * 0.12 + R() * 0.05, hz(pick([100, 103, 105, 108])) * p, 0.045, 0.35); });
    },
    chute: (v, t, o) => {
      let tk = t;
      for (let k = 0; k < 5; k++) { // tumbling: quicker and lower as it falls
        const tt = tk;
        defer(v, tt, () => knock(v, tt, k === 2 ? 'flesh' : 'bone', 1.2 - k * 0.1, o.p * (1.15 - k * 0.07), v.out));
        tk += 0.085 - k * 0.01 + R() * 0.02;
      }
      defer(v, tk, () => {
        tone(v, tk, { type: 'square', f: 240 * o.p, f1: 140 * o.p, d: 0.06, g: 0.12, lp: 900 }); // flap
        knock(v, tk + 0.03, 'flesh', 1, o.p, v.out); // lands in the tray
      });
    },
    restock: (v, t, o) => {
      for (let k = 0; k < 16; k++) {
        const x = k / 16, m = pick(['bone', 'bone', 'flesh', 'flesh', 'squish', 'metal']);
        const tk = t + x * 0.9 + R() * 0.06, i = 0.45 + 1.0 * Math.sin(Math.PI * x) * rr(0.6, 1), p = o.p * rr(0.9, 1.1), x2 = rr(-0.7, 0.7);
        defer(v, tk, () => knock(v, tk, m, i, p, pan(v, x2, v.out)));
      }
      hiss(v, t, { d: 1, a: 0.3, g: 0.1, type: 'lowpass', f: 400, brown: true });
    },
    twitch: (v, t, o) => {
      const g = 0.07 + 0.17 * o.i;
      for (let k = 0; k < 4; k++) hiss(v, t + k * 0.035 + R() * 0.015, { d: 0.03, g, f: rr(900, 2600), q: 3 });
      tone(v, t + 0.02, { f: 380 * o.p, f1: 900 * o.p, d: 0.04, g: g * 0.8 });
    },
    // --- the soul grip ---
    soul_reach: (v, t, o) => { // the claw reaches for the part below: a breathy swell and a ghostly rising whistle
      const p = o.p;
      hiss(v, t, { d: 0.5, a: 0.18, g: 0.2, f: 450 * p, f1: 2600 * p, q: 5 });
      const s = tone(v, t + 0.05, { f: 520 * p, f1: 830 * p, glide: 0.4, d: 0.5, a: 0.14, g: 0.07 });
      lfo(v, 7, 25, t, t + 0.55).connect(s.detune);
    },
    soul_bind: (v, t, o) => { // the grip takes hold: a hollow thrum, a whoosh up, a minor shimmer (brighter = firmer)
      const p = o.p, i = o.i;
      tone(v, t, { f: 98 * p, f1: 147 * p, glide: 0.12, d: 0.35, a: 0.01, g: 0.22 });
      hiss(v, t, { d: 0.22, a: 0.05, g: 0.18 + 0.2 * i, f: 700 * p, f1: 4200 * p, q: 3 });
      [0, 3, 7, 12].forEach((iv, k) => bell(v, t + 0.04 + k * 0.035, hz(76 + iv) * p, 0.04 + 0.06 * i, 0.3 + 0.4 * i));
    },
    soul_snap: (v, t, o) => { // the grip tears: a brittle crack and a sighing fall
      const p = o.p;
      hiss(v, t, { d: 0.04, g: 0.6, type: 'highpass', f: 3500 });
      tone(v, t, { type: 'triangle', f: 1300 * p, f1: 240 * p, glide: 0.35, d: 0.4, g: 0.16 });
      const s = tone(v, t + 0.01, { f: 880 * p, f1: 180 * p, glide: 0.45, d: 0.5, g: 0.1 });
      lfo(v, 11, 30, t, t + 0.5).connect(s.detune);
    },
    heartbeat: (v, t, o) => {
      const g = 0.2 + 0.25 * o.i;
      for (const [dt, k, f] of [[0, 1, 80], [0.19, 0.7, 92]]) {
        tone(v, t + dt, { type: 'triangle', f: f * o.p, f1: f * 0.6 * o.p, d: 0.15, a: 0.012, g: g * k, lp: 1200 });
        hiss(v, t + dt, { d: 0.08, a: 0.01, g: 1.6 * g * k, type: 'lowpass', f: 600 });
      }
    },

    // --- the slab ---
    stitch: (v, t, o) => {
      const p = o.p;
      hiss(v, t, { d: 0.12, g: 0.45, type: 'lowpass', f: 2200 * p, f1: 280 * p, q: 10 });
      tone(v, t + 0.015, { f: 240 * p, f1: 620 * p, d: 0.06, g: 0.3 });
      zip(v, t + 0.1, 0.2, 1300 * p, 4200 * p, 45, 90, 0.4);
    },
    unstitch: (v, t, o) => {
      const p = o.p;
      zip(v, t, 0.2, 4000 * p, 1100 * p, 90, 40, 0.3);
      tone(v, t + 0.22, { f: 320 * p, f1: 1100 * p, d: 0.05, g: 0.45 });
      hiss(v, t + 0.22, { d: 0.015, g: 0.3, type: 'highpass', f: 2500 });
    },
    zap: (v, t, o) => { // clipped buzz + sizzle, randomly gated into crackles
      const d = 0.42, p = o.p, e = gain(v, 0), f = filt(v, 'bandpass', 2000 * p, 1), sh = ctx.createWaveShaper();
      sh.curve = B.curve; v.nodes.push(sh);
      for (const fr of [110, 117]) osc(v, 'sawtooth', fr * p, t, t + d).connect(sh);
      wire(sh, f, e);
      wire(noise(v, t, t + d), filt(v, 'highpass', 4000), e);
      for (let tk = t; tk < t + d; tk += rr(0.012, 0.03)) {
        e.gain.setValueAtTime(R() < 0.75 ? rr(0.12, 0.42) * (1 - (tk - t) / d) : 0, tk);
        f.frequency.setValueAtTime(rr(800, 4500) * p, tk);
      }
      e.gain.setValueAtTime(0, t + d);
      e.connect(v.out);
    },
    thunder: (v, t, o) => {
      Music.duck(0.35, 2);
      for (let k = 0; k < 5; k++) hiss(v, t + k * rr(0.015, 0.05), { d: rr(0.08, 0.2), g: 0.45, type: 'highpass', f: rr(500, 1400) }); // crack
      tone(v, t, { f: 80 * o.p, f1: 32 * o.p, d: 0.7, g: 0.45 });
      for (const x of [-0.5, 0.5]) { // rolling rumble, a different random swell per side
        const f = filt(v, 'lowpass', 700), e = gain(v, 0);
        sweep(f.frequency, t, 700, [90, 2.7]);
        e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.7, t + 0.08);
        for (let k = 1; k < 12; k++) e.gain.linearRampToValueAtTime(rr(0.25, 0.8) * Math.pow(1 - k / 12, 1.5), t + 0.08 + k * 0.22);
        e.gain.linearRampToValueAtTime(0, t + 2.75);
        wire(noise(v, t, t + 2.8, true), f, e, pan(v, x, v.out));
      }
    },
    alive: (v, t, o) => { // D minor swells, turns D major, sparkles up: IT'S ALIVE
      const p = o.p, f = filt(v, 'lowpass', 250, 6), e = gain(v, 0);
      Music.duck(0.5, 1.7);
      sweep(f.frequency, t, 250, [4500, 1.2]);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.135, t + 1.1); e.gain.linearRampToValueAtTime(0, t + 1.6);
      for (const m of [50, 57, 62, 65, 69, 74]) for (const det of [-10, 10]) {
        const s = osc(v, 'sawtooth', hz(m) * p, t, t + 1.65);
        s.detune.setValueAtTime(det - 300, t); s.detune.linearRampToValueAtTime(det, t + 0.9);
        if (m === 65) s.frequency.setValueAtTime(hz(66) * p, t + 0.75); // F -> F#: the picardy "alive!" moment
        s.connect(f);
      }
      wire(f, e, v.out);
      defer(v, t + 0.6, () => { [74, 78, 81, 86, 90, 93, 98].forEach((m, k) => bell(v, t + 0.6 + k * 0.09, hz(m) * p, 0.095, 0.7)); });
      hiss(v, t + 0.2, { d: 1.3, a: 1, g: 0.07, type: 'highpass', f: 5000, f1: 9000 });
    },

    // --- battle ---
    swing: (v, t, o) => {
      const f = hiss(v, t, { d: 0.22, a: 0.08, g: 0.8 * (0.4 + 0.6 * o.i), f: 450 * o.p, q: 2.2 });
      sweep(f.frequency, t, 450 * o.p, [2800 * o.p, 0.09], [600 * o.p, 0.22]);
    },
    hit: (v, t, o) => {
      const c = !!o.crit, i = o.i, p = o.p * (c ? 1.1 : 1), k = (0.45 + 0.55 * i) * (c ? 1.2 : 1);
      tone(v, t, { f: 180 * p, f1: 50 * p, glide: 0.09, d: 0.16, g: 0.32 * k }); // sub
      tone(v, t, { type: 'triangle', f: 320 * p, f1: 160 * p, d: 0.07, g: 0.3 * k }); // body
      hiss(v, t, { d: 0.07, g: 0.75 * k, type: 'lowpass', f: 1800 + 3000 * i }); // punch
      hiss(v, t, { d: 0.025, g: 0.5 * k, f: 1500, q: 1 }); // slap
      if (c) { // sharper snap + a sword-like ring
        hiss(v, t, { d: 0.035, g: 0.35, type: 'highpass', f: 2800 });
        for (const [r, g, d] of [[1, 0.13, 0.6], [2.41, 0.08, 0.4], [3.93, 0.055, 0.3], [5.2, 0.035, 0.2]]) tone(v, t + 0.008, { f: 1250 * p * r, g, d });
      }
    },
    enemy_hit: (v, t, o) => {
      const k = 0.45 + 0.55 * o.i;
      tone(v, t, { f: 120 * o.p, f1: 38 * o.p, d: 0.22, g: 0.3 * k });
      tone(v, t, { type: 'triangle', f: 200 * o.p, f1: 110 * o.p, d: 0.1, g: 0.3 * k });
      hiss(v, t, { d: 0.14, a: 0.01, g: 1.1 * k, type: 'lowpass', f: 1200, f1: 250 });
      hiss(v, t, { d: 0.2, a: 0.06, g: 0.7 * k, f: 500 * o.p, q: 1.5 }); // shadowy "whuff"
    },
    enemy_die: (v, t, o) => { // ghostly wail sliding down + whoosh + hiss
      const p = o.p, s = tone(v, t, { f: 820 * p, f1: 170 * p, d: 0.85, a: 0.04, g: 0.17 });
      lfo(v, 6.5, 35, t, t + 0.9).connect(s.detune);
      tone(v, t, { type: 'triangle', f: 1230 * p, f1: 250 * p, d: 0.7, a: 0.04, g: 0.06 });
      hiss(v, t, { d: 0.75, a: 0.06, g: 0.31, f: 3200 * p, f1: 280 * p, q: 1.4 });
      hiss(v, t + 0.08, { d: 0.7, a: 0.15, g: 0.11, type: 'highpass', f: 5500 });
    },
    creature_die: (v, t, o) => {
      knock(v, t, 'flesh', 0.9, o.p * 0.8, v.out);
      for (let k = 0, tk = t + 0.05; k < 9; k++) {
        const tt = tk, p = o.p * rr(0.8, 1.2) * (1 - k * 0.03), x = rr(-0.4, 0.4);
        defer(v, tt, () => knock(v, tt, 'bone', 1.3 - k * 0.1, p, pan(v, x, v.out)));
        tk += 0.03 + k * 0.012 + R() * 0.025;
      }
    },
    coins_count: (v, t, o) => { tone(v, t, { type: 'square', f: 1800 * o.p, d: 0.035, g: 0.12, lp: 6000 }); tone(v, t, { f: 3600 * o.p, d: 0.025, g: 0.09 }); },
    victory: (v, t, o) => { // D minor fanfare that resolves to D major
      const p = o.p;
      Music.duck(0.7, 2.3);
      const timp = (dt) => { tone(v, t + dt, { f: 75 * p, f1: 70 * p, d: 0.6, g: 0.25 }); hiss(v, t + dt, { d: 0.12, g: 0.2, type: 'lowpass', f: 900 }); };
      for (const [dt, m, d] of [[0, 69, 0.1], [0.12, 69, 0.1], [0.24, 69, 0.1], [0.36, 74, 0.42]]) brass(v, t + dt, [m], d, p, 3.3);
      brass(v, t + 0.36, [62, 65, 57], 0.42, p, 1.6); timp(0.36);
      defer(v, t + 0.84, () => { for (const [dt, m] of [[0.84, 72], [0.98, 70], [1.12, 72]]) brass(v, t + dt, [m], 0.12, p, 3.3); });
      defer(v, t + 1.26, () => {
        brass(v, t + 1.26, [74], 0.85, p, 3.3); brass(v, t + 1.26, [62, 66, 57, 50], 0.85, p, 1.6); timp(1.26);
        [86, 90, 93, 98].forEach((m, k) => bell(v, t + 1.3 + k * 0.07, hz(m) * p, 0.14, 0.8));
      });
    },
    defeat: (v, t, o) => { // slow organ descent onto a low D, with a funeral bell
      const p = o.p;
      Music.duck(0.7, 2.3);
      [[0, 69], [0.32, 67], [0.64, 65], [0.96, 64]].forEach(([dt, m]) => organ(v, t + dt, m, 0.28, p, 2.8));
      [[0, 50, 0.62], [0.64, 46, 0.3], [0.96, 45, 0.3]].forEach(([dt, m, d]) => organ(v, t + dt, m, d, p, 0.9, false, true));
      defer(v, t + 1.28, () => { organ(v, t + 1.28, 62, 0.9, p, 2.8, true); organ(v, t + 1.28, 38, 0.9, p, 0.9, false, true); bell(v, t + 1.28, hz(50) * p, 0.2, 1.6); });
    },
    meow: (v, t, o) => { // saw with a rise-fall pitch contour through gliding formants (i -> a -> u)
      const p = o.p * rr(0.92, 1.1), d = 0.6 * rr(0.9, 1.15), s = osc(v, 'sawtooth', 430 * p, t, t + d + 0.02), e = gain(v, 0), lp = filt(v, 'lowpass', 700);
      s.frequency.setValueAtTime(430 * p, t); s.frequency.linearRampToValueAtTime(720 * p, t + d * 0.3);
      s.frequency.linearRampToValueAtTime(640 * p, t + d * 0.55); s.frequency.exponentialRampToValueAtTime(400 * p, t + d);
      lfo(v, 6, 12, t, t + d).connect(s.detune);
      for (const [a, b, c, q, g] of [[500, 950, 480, 5, 1], [1900, 1400, 900, 7, 0.6], [3000, 2700, 2500, 9, 0.25]]) {
        const f = filt(v, 'bandpass', a, q);
        f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, t + d * 0.4); f.frequency.linearRampToValueAtTime(c, t + d);
        wire(s, f, gain(v, g), e);
      }
      sweep(lp.frequency, t, 700, [6000, 0.08]); // "m" opening into the vowel
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.43, t + 0.07); e.gain.setValueAtTime(0.43, t + d * 0.6); e.gain.linearRampToValueAtTime(0, t + d);
      wire(e, lp, v.out);
    },
    purr: (v, t, o) => { // brown noise fluttering at ~24 Hz, two breaths
      const d = 1.6, f = filt(v, 'lowpass', 420, 4), am = gain(v, 0.5), e = gain(v, 0), l = lfo(v, 24, 0.5, t, t + d);
      l.connect(am.gain);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.75, t + 0.25); e.gain.linearRampToValueAtTime(0.52, t + 0.7);
      e.gain.linearRampToValueAtTime(0.08, t + 0.8); e.gain.linearRampToValueAtTime(0.6, t + 1); e.gain.linearRampToValueAtTime(0, t + d);
      wire(noise(v, t, t + d, true), f, am, e, v.out);
    },

    // --- the Rig (RNG manipulation layer) ---
    quake: (v, t, o) => { // the whole cabinet shudders: grinding low rumble, sub wobble, crack, rattling bones
      const p = o.p, d = 2, f = filt(v, 'lowpass', 260 * p, 3), e = gain(v, 0);
      Music.duck(0.45, 2.3);
      sweep(f.frequency, t, 260 * p, [90 * p, d]);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.85, t + 0.12);
      for (let k = 1; k < 10; k++) e.gain.linearRampToValueAtTime(rr(0.5, 1) * (1 - k / 11), t + 0.12 + k * 0.17);
      e.gain.linearRampToValueAtTime(0, t + d);
      wire(noise(v, t, t + d + 0.05, true), f, e, v.out);
      const sub = tone(v, t, { f: 46 * p, f1: 34 * p, d, a: 0.05, g: 0.38 });
      lfo(v, 11, 5, t, t + d).connect(sub.frequency); // the floor shudders
      hiss(v, t, { d: 0.12, g: 0.7, type: 'highpass', f: 900 }); // the opening crack
      tone(v, t, { f: 120 * p, f1: 38 * p, d: 0.35, g: 0.5 });
      for (let k = 0; k < 24; k++) { // bones rattle, thinning out as it passes
        const x = Math.pow(R(), 1.4), tk = t + 0.05 + x * (d - 0.25), i = 0.3 + 0.9 * (1 - x) * rr(0.5, 1), m = pick(['bone', 'bone', 'flesh', 'metal', 'squish']), x2 = rr(-0.7, 0.7);
        defer(v, tk, () => knock(v, tk, m, i, p * rr(0.85, 1.15), pan(v, x2, v.out)));
      }
    },
    nudge: (v, t, o) => { // a thump on the glass and the pile jostling
      const p = o.p;
      tone(v, t, { f: 150 * p, f1: 55 * p, glide: 0.1, d: 0.22, g: 0.5 });
      hiss(v, t, { d: 0.09, g: 0.6, type: 'lowpass', f: 1400 });
      hiss(v, t, { d: 0.03, g: 0.3, f: 2600 * p, q: 2 });
      for (let k = 0; k < 4; k++) knock(v, t + 0.03 + k * 0.035 + R() * 0.02, pick(['bone', 'flesh']), 0.5 - k * 0.09, p * rr(0.9, 1.1), v.out);
    },
    tilt: (v, t, o) => { // pinball TILT: a harsh buzzer stab, stab, stab... and a groaning klaxon
      const p = o.p;
      Music.duck(0.5, 1.6);
      for (const [dt, fr] of [[0, 660], [0.14, 660], [0.28, 440]]) {
        tone(v, t + dt, { type: 'square', f: fr * p, f1: fr * 0.96 * p, d: 0.12, a: 0.004, g: 0.17, lp: 2600 });
        tone(v, t + dt, { type: 'sawtooth', f: fr * 0.5 * p, d: 0.12, a: 0.004, g: 0.12, lp: 1200 });
      }
      tone(v, t + 0.45, { type: 'sawtooth', f: 150 * p, f1: 70 * p, d: 0.6, a: 0.01, g: 0.3, lp: 900 });
      hiss(v, t, { d: 0.25, g: 0.6, type: 'lowpass', f: 1500 });
      tone(v, t, { f: 90 * p, f1: 40 * p, d: 0.4, g: 0.4 });
    },
    luck_gain: (v, t, o) => { // a horseshoe clinks into the jar
      const p = o.p;
      bell(v, t, hz(91) * p, 0.14, 0.6);
      bell(v, t + 0.07, hz(95) * p, 0.12, 0.7);
      tone(v, t, { type: 'triangle', f: 1500 * p, f1: 2400 * p, d: 0.08, g: 0.1 });
      hiss(v, t, { d: 0.02, g: 0.22, type: 'highpass', f: 5000 });
    },
    grip_arm: (v, t, o) => { // prongs clunk, a power-up swell, a gold ring
      const p = o.p;
      knock(v, t, 'metal', 1, p * 0.8, v.out);
      tone(v, t + 0.04, { type: 'sawtooth', f: 180 * p, f1: 520 * p, d: 0.3, a: 0.02, g: 0.12, lp: 1800 });
      hiss(v, t + 0.05, { d: 0.3, a: 0.12, g: 0.1, type: 'highpass', f: 5000, f1: 9000 });
      bell(v, t + 0.22, hz(79) * p, 0.14, 0.9);
      bell(v, t + 0.3, hz(86) * p, 0.1, 0.9);
    },
    order: (v, t, o) => { // ding-ding on the service bell, the dumbwaiter rumbles down
      const p = o.p;
      for (const dt of [0, 0.13]) {
        bell(v, t + dt, hz(96) * p, 0.2, 0.9);
        tone(v, t + dt, { f: 2100 * p, d: 0.02, g: 0.14 });
        hiss(v, t + dt, { d: 0.012, g: 0.25, type: 'highpass', f: 4000 });
      }
      hiss(v, t + 0.3, { d: 0.5, a: 0.2, g: 0.1, type: 'lowpass', f: 500, brown: true });
    },
    rewind: (v, t, o) => { // tape whirr sweeping up, tick train, and a clunk as time lands
      const p = o.p, d = 1.1, f = filt(v, 'bandpass', 400 * p, 2.5), e = gain(v, 0), am = gain(v, 0.5);
      Music.duck(0.35, 1.4);
      sweep(f.frequency, t, 400 * p, [2600 * p, d * 0.7], [1200 * p, d]);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.35, t + 0.1); e.gain.setValueAtTime(0.35, t + d - 0.15); e.gain.linearRampToValueAtTime(0, t + d);
      wire(noise(v, t, t + d + 0.02), f, e, v.out);
      const s = osc(v, 'sawtooth', 180 * p, t, t + d + 0.02);
      sweep(s.frequency, t, 180 * p, [900 * p, d * 0.8], [420 * p, d]);
      lfo(v, 28, 0.5, t, t + d).connect(am.gain);
      wire(s, filt(v, 'lowpass', 1800), am, env(v, t, 0.05, 0.12, d - 0.2, 0.15), v.out);
      for (let k = 0; k < 10; k++) tone(v, t + (k * d) / 10, { type: 'square', f: 1400 * p, d: 0.012, g: 0.06, lp: 3500 });
      tone(v, t + d, { f: 140 * p, f1: 60 * p, d: 0.15, g: 0.4 });
      knock(v, t + d, 'metal', 0.5, p, v.out);
    },
    roll_ok: (v, t, o) => { // the dice land well: two bright ticks and a ring
      const p = o.p;
      tone(v, t, { type: 'square', f: 1760 * p, d: 0.05, g: 0.15, lp: 5000 });
      tone(v, t + 0.05, { type: 'square', f: 2350 * p, d: 0.09, g: 0.15, lp: 5000 });
      bell(v, t + 0.05, 2350 * p, 0.12, 0.4);
    },
    roll_no: (v, t, o) => { // the dice land badly: a dull thud
      const p = o.p;
      tone(v, t, { type: 'triangle', f: 330 * p, f1: 180 * p, d: 0.18, g: 0.34 });
      hiss(v, t, { d: 0.08, g: 0.5, type: 'lowpass', f: 700 });
    },
  };
  // Per-name limits [max starts per second, max simultaneous voices (oldest is stolen)].
  const LIM = {
    bump: [12, 4], ui_hover: [15, 2], coins_count: [20, 3], twitch: [8, 2], heartbeat: [3, 2], chute: [6, 3],
    restock: [1.5, 1], thunder: [0.7, 1], alive: [1, 1], victory: [1, 1], defeat: [1, 1], zap: [8, 3],
    win_legendary: [1, 1], win_rare: [2, 1], meow: [3, 1], purr: [1, 1],
    quake: [1, 1], nudge: [6, 2], tilt: [1, 1], luck_gain: [6, 2], grip_arm: [3, 1], order: [2, 1], rewind: [1, 1], roll_ok: [6, 2], roll_no: [6, 2],
    soul_reach: [2, 1], soul_bind: [8, 3], soul_snap: [6, 2], creak: [3, 1],
  };
  // Reverb send per sound.
  const WET = {
    transition: 0.2, coin: 0.12, claw_land: 0.08, claw_top: 0.06, grab: 0.15, slip: 0.12, miss: 0.15, chute: 0.08,
    win_common: 0.2, win_uncommon: 0.22, win_rare: 0.28, win_legendary: 0.32, restock: 0.1, heartbeat: 0.12, bump: 0.05,
    stitch: 0.06, unstitch: 0.06, zap: 0.15, thunder: 0.45, alive: 0.4, enemy_die: 0.4, creature_die: 0.12,
    victory: 0.3, defeat: 0.35, meow: 0.12, page: 0.05, swing: 0.05,
    quake: 0.25, nudge: 0.06, tilt: 0.2, luck_gain: 0.2, grip_arm: 0.15, order: 0.15, rewind: 0.2, roll_ok: 0.1, roll_no: 0.05,
    soul_reach: 0.35, soul_bind: 0.3, soul_snap: 0.25, creak: 0.08,
  };
  // These use intensity themselves; the rest just get a mild loudness scale.
  const RAW = { bump: 1, hit: 1, claw_land: 1, swing: 1, heartbeat: 1, enemy_hit: 1, twitch: 1 };

  function kill(v, t) { // voice stealing: quick fade, then stop everything
    v.dead = true; hold(v.out.gain, t); v.out.gain.linearRampToValueAtTime(0, t + 0.03);
    for (const s of v.srcs) try { s.stop(t + 0.035); } catch (e) { /* already stopped */ }
  }

  function play(name, opts) {
    const fn = has(S, name) && S[name];
    if (!fn) return warn('sfx:' + name, 'Sfx: unknown sound "' + name + '"');
    if (!ready()) return;
    opts = opts || {};
    const now = ctx.currentTime, lim = LIM[name] || [15, 4], i = clamp(num(opts.intensity, 0.7), 0, 1);
    const st = B.thr[name] || (B.thr[name] = { last: -9, li: 0, vs: [] });
    if (now - st.last < 1 / lim[0] && !(name === 'bump' && i > st.li + 0.2)) return; // throttled
    st.vs = st.vs.filter((x) => x.end > now);
    while (st.vs.length >= lim[1]) kill(st.vs.shift(), now);
    st.last = now; st.li = i;
    const p = num(opts.pitch, 1), o = Object.assign({}, opts, { i, p: p > 0 ? clamp(p, 0.1, 8) : 1 });
    const v = grp(B.sfx, num(opts.pan, 0), name === 'hit' && o.crit ? 0.25 : WET[name] || 0);
    v.out.gain.value = RAW[name] ? 1 : 0.55 + 0.65 * i;
    try { fn(v, now + 0.005, o); } catch (e) { warn('err:' + name, 'Sfx "' + name + '" failed: ' + e.message); }
    st.vs.push(v);
  }

  // Continuous claw motor: nodes built once, then only smoothed param targets per frame.
  function motor(level, pitch) {
    if (!ctx) return;
    level = clamp(num(level, 0), 0, 1); pitch = clamp(num(pitch, 0), 0, 1);
    let M = B.motor;
    if (!M) {
      if (!level) return;
      const v = grp(B.sfx, 0, 0), lp = filt(v, 'lowpass', 400, 4), am = gain(v, 0.8), t = ctx.currentTime, END = 1e9;
      M = B.motor = { v, lp, l: -1, p: -1, a: osc(v, 'sawtooth', 60, t, END), b: osc(v, 'pulse', 121, t, END) };
      M.w = osc(v, 'sine', 360, t, END); M.gear = osc(v, 'square', 9, t, END);
      v.out.gain.value = 0;
      M.a.connect(lp); wire(M.b, gain(v, 0.5), lp);
      wire(M.gear, gain(v, 0.2), am.gain); // gear-tooth flutter
      wire(M.w, gain(v, 0.05), am); // electric whine
      wire(noise(v, t, END), filt(v, 'bandpass', 2400, 0.8), gain(v, 0.1), am); // brushes
      wire(lp, am, v.out);
    }
    if (Math.abs(level - M.l) < 0.004 && Math.abs(pitch - M.p) < 0.004) return;
    M.l = level; M.p = pitch;
    const t = ctx.currentTime, f = 55 + 150 * pitch, T = 0.03;
    M.a.frequency.setTargetAtTime(f, t, T); M.b.frequency.setTargetAtTime(f * 2.02, t, T);
    M.w.frequency.setTargetAtTime(f * 6, t, T); M.gear.frequency.setTargetAtTime(6 + 26 * pitch, t, T);
    M.lp.frequency.setTargetAtTime(300 + 1500 * pitch, t, T);
    M.v.out.gain.setTargetAtTime(level * 0.155, t, T);
  }

  // Animal-Crossing-style talk blip: a buzzy pulse through a random vowel's two formants.
  const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1700]];
  function talk(pitch) {
    if (!ready()) return;
    const now = ctx.currentTime;
    if (now - B.talk < 1 / 18) return;
    B.talk = now;
    const P = clamp(num(pitch, 1), 0.2, 4), t = now + 0.005, d = rr(0.05, 0.08), v = grp(B.sfx, 0, 0.04), [F1, F2] = pick(VOWELS);
    const f0 = 220 * P * rr(0.9, 1.12), s = osc(v, 'pulse', f0, t, t + d + 0.02), e = env(v, t, 0.008, 0.6, d - 0.02, 0.02), k = Math.pow(P, 0.3) * rr(0.93, 1.07);
    sweep(s.frequency, t, f0, [f0 * rr(0.85, 1.12), d]);
    for (const [F, q, g] of [[F1, 4, 1], [F2, 6, 0.7]]) wire(s, filt(v, 'bandpass', F * k, q), gain(v, g), e);
    e.connect(v.out);
    if (R() < 0.25) hiss(v, t, { d: 0.015, g: 0.1, type: 'highpass', f: 4000 }); // a consonant now and then
  }

  // ---- music ---------------------------------------------------------------------
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (s) => 12 * (+s[s.length - 1] + 1) + PC[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0);
  const CH = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], mM7: [0, 3, 7, 11], m6: [0, 3, 7, 9] };
  const chord = (s) => { const n = s[1] === '#' || s[1] === 'b' ? 2 : 1; return { r: midi(s.slice(0, n) + '0') % 12, iv: CH[s.slice(n)] }; };
  const fit = (pc, lo) => lo + ((((pc - lo) % 12) + 12) % 12); // pitch class -> midi in [lo, lo+12)
  const upper = (c, lo) => (c.iv.length > 3 ? c.iv.slice(1) : c.iv).map((i) => fit(c.r + i, lo)).sort((a, b) => a - b);
  // "A4 - C5 . E5" -> sparse array by step: {m: midi, len: steps}; '-' holds, '.' rests, '|' is decoration.
  function seq(str, res) {
    const out = []; let last = null;
    str.replace(/\|/g, ' ').trim().split(/\s+/).forEach((tk, k) => {
      if (tk === '-') { if (last) last.len += res; } else if (tk === '.') last = null;
      else out[k * res] = last = { m: midi(tk), len: res };
    });
    return out;
  }

  let ghostF = 0; // theremin glides from its previous note
  const INST = { // (voice, time, freq, duration, velocity)
    box: (v, t, f, d, g) => { // music-box tine: long ring + a glassy overtone "tink"
      tone(v, t, { f, d: 2.6, g: 0.16 * g, det: rr(-6, 6) });
      tone(v, t, { f: f * 2, d: 0.5, g: 0.04 * g });
      if (f * 5.95 < 16000) tone(v, t, { f: f * 5.95, d: 0.1, g: 0.03 * g });
    },
    pluck: (v, t, f, d, g) => tone(v, t, { type: 'triangle', f, d: 0.35, g: 0.07 * g, lp: 1600 }),
    bass: (v, t, f, d, g) => { tone(v, t, { type: 'triangle', f, d: Math.max(d, 0.4), a: 0.006, g: 0.28 * g }); tone(v, t, { f: f * 2, d: 0.12, g: 0.05 * g }); },
    bass2: (v, t, f, d, g) => { tone(v, t, { type: 'sawtooth', f, d, g: 0.085 * g, lp: 650, q: 6 }); tone(v, t, { f, d, g: 0.1 * g }); },
    pulse: (v, t, f, d, g) => tone(v, t, { type: 'pulse', f, d: Math.max(d, 0.08), g: 0.09 * g, lp: 3000 }),
    lead: (v, t, f, d, g) => {
      const lp = filt(v, 'lowpass', 2400, 2), L = d > 0.3 ? lfo(v, 5.5, 12, t + 0.2, t + d + 0.1) : null;
      for (const [type, det] of [['sawtooth', -6], ['square', 6]]) {
        const s = osc(v, type, f, t, t + d + 0.1);
        s.detune.value = det; if (L) L.connect(s.detune); s.connect(lp);
      }
      wire(lp, env(v, t, 0.012, 0.045 * g, d, 0.08), v.out);
    },
    sub: (v, t, f, d, g) => { tone(v, t, { type: 'sawtooth', f, d, g: 0.11 * g, lp: 900, q: 3 }); tone(v, t, { type: 'triangle', f, d, g: 0.1 * g }); },
    pad: (v, t, f, d, g) => {
      const lp = filt(v, 'lowpass', 500, 3);
      lfo(v, 0.15, 200, t, t + d + 2.6).connect(lp.frequency);
      for (const det of [-9, 9]) { const s = osc(v, 'sawtooth', f, t, t + d + 2.6); s.detune.value = det; s.connect(lp); }
      wire(lp, env(v, t, 2.2, 0.05 * g, d, 2.5), v.out);
    },
    ghost: (v, t, f, d, g) => { // theremin
      const s = osc(v, 'sine', ghostF || f, t, t + d + 1);
      sweep(s.frequency, t, ghostF || f, [f, 0.35]); ghostF = f;
      lfo(v, 5, 25, t, t + d + 1).connect(s.detune);
      wire(s, env(v, t, 0.5, 0.045 * g, d, 0.9), v.out);
    },
    drip: (v, t, f, d, g) => tone(v, t, { f: f * 0.55, f1: f, glide: 0.04, d: 0.12, g: 0.1 * g }),
    bubble: (v, t, f, d, g) => tone(v, t, { f: f * 0.7, f1: f * 1.4, glide: 0.05, d: 0.07, g: 0.07 * g }),
    heart: (v, t, f, d, g) => {
      tone(v, t, { type: 'triangle', f: 58, f1: 38, d: 0.2, a: 0.015, g: 0.3 * g, lp: 300 });
      tone(v, t + 0.28, { type: 'triangle', f: 64, f1: 42, d: 0.16, a: 0.015, g: 0.2 * g, lp: 300 });
    },
    kick: (v, t, f, d, g) => { tone(v, t, { f: 150, f1: 45, glide: 0.09, d: 0.3, g: 0.5 * g }); hiss(v, t, { d: 0.01, g: 0.06 * g, type: 'lowpass', f: 3000 }); },
    snare: (v, t, f, d, g) => { hiss(v, t, { d: 0.15, g: 0.2 * g, f: 2000, q: 0.7 }); tone(v, t, { type: 'triangle', f: 210, f1: 160, d: 0.08, g: 0.16 * g }); },
    clap: (v, t, f, d, g) => { for (const k of [0, 0.011, 0.022]) hiss(v, t + k, { d: k > 0.02 ? 0.12 : 0.02, g: 0.16 * g, f: 1200, q: 1.2 }); },
    hat: (v, t, f, d, g) => hiss(v, t, { d: 0.035, g: 0.06 * g, type: 'highpass', f: 7500 }),
    crash: (v, t, f, d, g) => hiss(v, t, { d: 1.3, g: 0.08 * g, type: 'highpass', f: 5500 }),
    tick: (v, t, f, d, g) => tone(v, t, { type: 'triangle', f: 1600, f1: 1400, d: 0.04, g: 0.08 * g }),
  };

  // Tracks: tempo/meter, one chord per bar, note lines as strings, and a step() that plays one grid step.
  const TR = {
    // Spooky music-box waltz, 3/4 D minor. The melody walks the line cliché D-C#-C-B down.
    shop: {
      bpm: 96, beats: 3, spb: 2, bars: 16, gain: 0.75,
      chords: 'Dm DmM7 Dm7 Dm6 Gm A7 Dm A7 Bb F Gm Dm Gm6 A7 Dm A7',
      lines: { mel: [`D6 - - - A5 - | C#6 - - - A5 - | C6 - - - A5 - | B5 - A5 - F5 - |
                      G5 - Bb5 - D6 - | C#6 - - - A5 G5 | F5 - E5 - D5 - | E5 - - - . . |
                      F5 - Bb5 - D6 - | C6 - A5 - F5 - | D6 - - - Bb5 G5 | A5 - - - . . |
                      G5 - Bb5 - E6 - | C#6 - - - A5 - | D6 - A5 - F5 - | E5 - C#5 - A4 -`, 1] },
      step(I, s, t, bar, k) {
        const d = I.d, c = d.ch[bar], m = d.m.mel[s];
        if (m) I.note('box', t, m.m, 0, k ? 0.8 : 1, 0.15);
        if (k === 0) { const r = fit(c.r, 41); I.note('bass', t, bar % 2 && d.ch[bar - 1].r === c.r ? r - 5 : r, d.dt * 5, 0.9); } // oom
        if (k === 2 || k === 4) for (const n of upper(c, 57)) I.note('pluck', t, n, 0, k === 2 ? 0.8 : 0.65, -0.15); // pah-pah
        if ((bar === 7 || bar === 11) && k >= 4) I.note('box', t, fit(c.r + c.iv[k - 3], 81), 0, 0.45, 0.4); // echo in the rests
      },
    },
    // Playful-tense arcade loop, A minor 118 BPM: bouncy octave bass that walks chromatically into each chord.
    claw: {
      bpm: 118, beats: 4, spb: 4, bars: 16, gain: 1.6,
      chords: 'Am F Dm E7 Am F Dm E7 F G Em Am Dm E7 Am E7',
      lines: { mel: [`A4 C5 E5 A5 . G#5 A5 . | C6 . A5 . F5 . A5 . | D5 F5 A5 D6 . C#6 D6 . | B5 . G#5 . E5 . D5 . |
                      A4 C5 E5 A5 . G#5 A5 . | C6 . B5 . A5 . F5 . | D5 . F5 . G#5 . B5 . | G#5 - - - E5 . . . |
                      A5 . . A5 . . G5 . | B5 . . B5 . . D6 . | G5 . . E5 . . B4 . | C5 . E5 . A5 - - . |
                      F5 . . F5 . E5 D5 . | E5 . G#5 . B5 . D6 . | C6 . B5 . A5 . E5 . | G#5 - - - . . . .`, 2] },
      step(I, s, t, bar, k) {
        const d = I.d, c = d.ch[bar], m = d.m.mel[s];
        if (m) I.note('pulse', t, m.m, m.len * d.dt * 0.7, k % 4 ? 1.4 : 1.7, 0.1);
        if (k % 2 === 0) {
          const e = k >> 1, r = fit(c.r, 40), nr = fit(d.ch[(bar + 1) % d.bars].r, 40);
          I.note('bass2', t, e < 6 ? r + [0, 12, 0, 12, 7, 12][e] : nr + (nr >= r ? e - 8 : 8 - e), d.dt * 1.5, e % 2 ? 0.75 : 1);
        }
        if (k === 0 || k === 8 || (k === 10 && bar % 4 === 3)) I.hit('kick', t, 0.4);
        if (k === 4 || k === 12) I.hit('clap', t, 0.8);
        if (k % 2 === 0) I.hit('hat', t, k % 4 ? 0.9 : 0.45, 0.3);
        if (bar >= 8 && k % 4 === 3 && R() < 0.3) I.hit('tick', t, 0.4, -0.3);
      },
    },
    // Dark ambient lab, 60 BPM: slow pad chords, heartbeat, random drips/bubbles, a sparse theremin.
    slab: {
      bpm: 60, beats: 4, spb: 2, bars: 8, gain: 0.6,
      pads: [[50, 57, 64, 65], [46, 53, 57, 62], [43, 50, 57, 58], [45, 52, 55, 58]], // Dm(add9) Bbmaj7 Gm(add9) A7(b9)
      lines: { mel: ['. . | . . | A5 - | - F5 | . . | . . | D6 - | C#6 -', 4] },
      step(I, s, t, bar, k) {
        const d = I.d, m = d.m.mel[s];
        if (s % 16 === 0) for (const n of d.pads[s / 16]) I.note('pad', t, n, 7.6, 0.8);
        if (k === 0 || k === 4) I.hit('heart', t, k ? 0.6 : 0.8);
        if (m) I.note('ghost', t, m.m, m.len * d.dt, 0.8);
        if (R() < 0.09) I.note('drip', t + rr(0, 0.4), pick([86, 89, 91, 93, 98]), 0, rr(0.5, 1), rr(-0.8, 0.8));
        if (k === 6 && R() < 0.3) for (let j = 0, n = 3 + R() * 4; j < n; j++) I.note('bubble', t + j * rr(0.05, 0.12), rr(62, 76), 0, rr(0.4, 0.9), -0.4);
      },
    },
    // Driving battle loop, E minor 140 BPM: i-VI-VII-V, arpeggiated bass, lead doubled in the B section.
    battle: {
      bpm: 140, beats: 4, spb: 4, bars: 16, gain: 1,
      chords: 'Em C D B7 Em C Am B7 C D Bm Em C D B7 B7',
      lines: { mel: [`E5 . E5 B4 E5 . G5 . | G5 . F#5 . E5 . C5 . | D5 . D5 A4 D5 . F#5 . | F#5 . E5 . D#5 . B4 . |
                      E5 . E5 B4 E5 . G5 . | B5 . A5 . G5 . E5 . | A5 . G5 . E5 . C5 . | B4 . D#5 . F#5 . A5 . |
                      G5 - - - E5 - G5 - | A5 - - - F#5 - D5 - | B5 - - - F#5 - D5 - | E5 - - - G5 - B5 - |
                      C6 - - - B5 - A5 - | D6 - - - A5 - F#5 - | F#5 - - - D#5 - B4 - | F#5 - G5 - A5 - B5 -`, 2] },
      step(I, s, t, bar, k) {
        const d = I.d, c = d.ch[bar], m = d.m.mel[s], r = fit(c.r, 40);
        if (m) {
          I.note('lead', t, m.m, m.len * d.dt * 0.85, 1, 0.12);
          if (bar >= 8) I.note('pulse', t, m.m - 12, m.len * d.dt * 0.85, 0.6, -0.2);
        }
        if (k % 2 === 0) { const e = k >> 1; I.note('sub', t, r + [0, 7, 12, 7, 0, 7, 12, c.iv[1] + 12][e], d.dt * 1.7, e ? 0.8 : 1); }
        if (k === 0 || k === 8 || k === 10 || (k === 6 && bar % 2)) I.hit('kick', t, 0.6);
        if (k === 4 || k === 12) I.hit('snare', t, 0.9);
        if (bar % 8 === 7 && k >= 13) I.hit('snare', t, 0.35 + (k - 12) * 0.15); // fill
        if (k % 2 === 0) I.hit('hat', t, k % 4 ? 0.8 : 0.45, 0.25);
        if (k === 0 && bar % 8 === 0) I.hit('crash', t, 0.8);
      },
    },
  };
  function prep(d) {
    if (d.len) return d;
    d.spbar = d.beats * d.spb; d.len = d.bars * d.spbar; d.dt = 60 / d.bpm / d.spb;
    d.ch = d.chords ? d.chords.split(/\s+/).map(chord) : [];
    d.m = {};
    for (const k in d.lines) d.m[k] = seq(d.lines[k][0], d.lines[k][1]);
    return d;
  }

  const AHEAD = 0.12, live = []; // scheduling horizon (s); playing instances (current + fading out)
  let cur = null, timer = null;
  function instance(name, t) {
    const d = prep(TR[name]), g = ctx.createGain(), I = { name, d, g, pos: 0, next: t, stopAt: 0, vs: [] };
    g.connect(B.duck);
    const v = (x) => { const w = grp(g, x, 0); I.vs.push(w); return w; };
    I.note = (ins, tt, m, dur, vel, x) => INST[ins](v(x), tt + rr(0, 0.006), hz(m), dur, vel * rr(0.86, 1.06)); // humanized
    I.hit = (ins, tt, vel, x) => INST[ins](v(x), tt, 0, 0, vel * rr(0.9, 1.05));
    return I;
  }
  function advance(I, until) {
    const d = I.d;
    while (I.next < until && !(I.stopAt && I.next > I.stopAt)) {
      const s = I.pos;
      try { d.step(I, s, I.next, (s / d.spbar) | 0, s % d.spbar); } catch (e) { warn('mus:' + I.name, 'Music "' + I.name + '" failed: ' + e.message); }
      I.pos = (s + 1) % d.len; I.next += d.dt;
    }
  }
  function tick() {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let k = live.length - 1; k >= 0; k--) {
      const I = live[k];
      if (I.stopAt && now > I.stopAt + 0.1) { // faded out: silence long tails (pads) and let go
        live.splice(k, 1); I.g.disconnect();
        for (const w of I.vs) if (w.end > now) kill(w, now);
        continue;
      }
      if (I.vs.length > 96) I.vs = I.vs.filter((w) => w.end > now);
      if (AudioSys.muted || paused) { I.next = -1; continue; } // resync on unmute
      if (I.next < now) I.next = now + 0.05;
      advance(I, now + AHEAD);
    }
    if (!live.length && timer) { clearInterval(timer); timer = null; }
  }

  const Music = {
    play(name) {
      name = name || null;
      if (name && !has(TR, name)) return warn('mus?' + name, 'Music: unknown track "' + name + '"');
      want = name;
      if (!ctx || (cur ? cur.name === name : !name)) return;
      const t = ctx.currentTime;
      if (cur) { ramp(cur.g.gain, 0, 1); cur.stopAt = t + 1; } // crossfade out over ~1s
      cur = null;
      if (name) {
        cur = instance(name, t + 0.06); // crossfade in, starting partway up so its first downbeat still lands
        cur.g.gain.setValueAtTime(live.length ? cur.d.gain * 0.3 : 0, t); cur.g.gain.linearRampToValueAtTime(cur.d.gain, t + (live.length ? 0.8 : 0.3));
        live.push(cur);
      }
      if (!timer) timer = setInterval(tick, 25);
      tick();
    },
    stop() { Music.play(null); },
    duck(amount, secs) { // temporarily lower the music; overlapping ducks merge
      if (!ctx) return;
      const t = ctx.currentTime, p = B.duck.gain;
      let a = clamp(num(amount, 0.5), 0, 1), end = t + Math.max(0, num(secs, 1));
      if (t < B.duckEnd) { a = Math.max(a, B.duckAmt); end = Math.max(end, B.duckEnd); }
      B.duckAmt = a; B.duckEnd = end;
      hold(p, t); p.linearRampToValueAtTime(1 - a, t + 0.08);
      p.setValueAtTime(1 - a, Math.max(end, t + 0.08)); p.linearRampToValueAtTime(1, Math.max(end, t + 0.08) + 0.6);
    },
    // hold the music low while a menu has the game paused; dim(false) brings it back
    dim(on) {
      if (!ctx || !B) return;
      const t = ctx.currentTime, p = B.duck.gain;
      hold(p, t); p.linearRampToValueAtTime(on ? 0.3 : 1, t + 0.15);
      B.duckEnd = 0; B.duckAmt = 0;
    },
    get track() { return want; },
    // test hook: schedule `secs` of a track into the current (offline) context in one go
    _fill(name, secs) { const I = instance(name, ctx.currentTime + 0.05); I.g.gain.value = I.d.gain; advance(I, ctx.currentTime + secs); },
  };

  const AudioSys = {
    ctx: null, muted: false,
    init() {
      try {
        if (!ctx) {
          const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
          if (!AC) return false;
          const c = new AC(), b = build(c, AudioSys.muted);
          ctx = c; B = b; AudioSys.ctx = c;
          if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
              paused = document.hidden;
              if (!paused) resumeAt = Date.now();
              const pr = paused ? ctx.suspend() : ctx.resume();
              if (pr && pr.catch) pr.catch(() => {});
            });
          }
          if (want) Music.play(want);
        }
        if (ctx.state !== 'running' && !paused) {
          resumeAt = Date.now();
          const pr = ctx.resume(); if (pr && pr.catch) pr.catch(() => {});
          const s = ctx.createBufferSource(); // iOS unlock: play one silent sample inside the gesture
          s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); s.connect(ctx.destination);
          s.onended = () => s.disconnect(); s.start(0);
        }
      } catch (e) { warn('init', 'AudioSys: WebAudio unavailable (' + e.message + ')'); }
      return !!ctx;
    },
    setMuted(m) {
      AudioSys.muted = !!m;
      if (ctx) ramp(B.master.gain, AudioSys.muted ? 0 : vol.master, 0.05);
      return AudioSys.muted;
    },
    toggleMute() { return AudioSys.setMuted(!AudioSys.muted); },
    setVolumes(o) {
      for (const k in vol) if (o && typeof o[k] === 'number' && isFinite(o[k])) vol[k] = clamp(o[k], 0, 1);
      if (!ctx) return;
      ramp(B.master.gain, AudioSys.muted ? 0 : vol.master, 0.05);
      ramp(B.music.gain, vol.music, 0.05); ramp(B.sfx.gain, vol.sfx, 0.05); ramp(B.sfxWet.gain, vol.sfx, 0.05);
    },
    get volumes() { return Object.assign({}, vol); },
    // Dev/test hook: render what fn() schedules into an OfflineAudioContext through the full mixer.
    // fn runs after `pre` seconds of silence so the compressor has settled (it dips right after creation).
    _render(secs, fn, pre) {
      const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null;
      if (!OAC) return Promise.resolve(null);
      pre = num(pre, 0.3);
      const off = new OAC(2, Math.ceil((secs + pre) * 44100), 44100), OB = build(off, false);
      const inside = () => {
        const saved = [ctx, B, paused, AudioSys.muted];
        try { ctx = off; B = OB; paused = false; AudioSys.muted = false; fn(); } finally { [ctx, B, paused, AudioSys.muted] = saved; }
      };
      if (pre > 0) off.suspend(pre).then(() => { inside(); off.resume(); }); else inside();
      return off.startRendering();
    },
  };

  const Sfx = { play, motor, voice: talk, names: Object.keys(S) };
  return { AudioSys, Sfx, Music };
})();
