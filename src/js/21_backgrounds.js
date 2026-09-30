// ---------------------------------------------------------------------------
// BACKGROUNDS — full-screen 480x270 pixel-art backdrops (Canvas2D, integer px).
//   BG.graveyard(ctx, t, opts)   battle backdrop. Units stand with feet on y = 214;
//                                x 40..440 / y 150..232 is kept clear for them.
//                                opts: fog, stars, critters (bats)  — all default true
//   BG.lab(ctx, t, opts)         the Slab. Top face y 203..212 (feet on y = 208), x 165..315,
//                                centred on x = 240; lamp hangs at x = 240, y 0..28.
//                                opts: surge (0..1 "bring to life" lamp flash), flicker (true)
//   BG.shop(ctx, t, opts)        shop interior. Counter top edge y = 196 (x 196..480).
//                                opts: layer 'back' | 'front' | (default) both, neon (0..1,
//                                default 1), flicker (true). For the Reaper: draw 'back'
//                                (wall + counter top face), then the Reaper (anchor y 202),
//                                then 'front' (counter edge + front panel + candle).
//   BG.dither(ctx, level, color) ordered-dither fade overlay, level 0 (none)..16 (solid);
//                                color = hex or PAL key, default PAL.k.
//   BG.prebuild()                rasterise every static layer now (avoids a first-use hitch).
//   BG.A                         anchor coordinates the scenes align to (see bottom).
// t is time in seconds. Every call saves/restores ctx state and paints the full screen
// (except shop 'front'). Static layers are rasterised lazily on first use by a tiny
// software pixel buffer (seeded PRNG, so identical on every load) into offscreen canvases;
// each frame blits them and draws only the animated bits. No DOM access at load time.
// ---------------------------------------------------------------------------
const BG = (() => {
  const W = 480, H = 270;

  // ---- colour helpers ------------------------------------------------------
  // Colours are PAL keys ('k', '2', ...) or '#rrggbb'. Pixel buffers store packed
  // little-endian RGBA as uint32 (0 = transparent).
  const _rgb = new Map();
  function rgb(c) {
    let v = _rgb.get(c);
    if (!v) {
      const hex = c[0] === '#' ? c : PAL[c];
      if (!hex) throw new Error('BG: unknown colour ' + c);
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      _rgb.set(c, v);
    }
    return v;
  }
  const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  function mix(a, b, f) { const A = rgb(a), B = rgb(b); return '#' + hex2(A[0] + (B[0] - A[0]) * f) + hex2(A[1] + (B[1] - A[1]) * f) + hex2(A[2] + (B[2] - A[2]) * f); }
  const _u32 = new Map();
  function C(c) { // colour -> opaque uint32
    let v = _u32.get(c);
    if (v === undefined) { const [r, g, b] = rgb(c); v = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; _u32.set(c, v); }
    return v;
  }
  const M = (a, b, f) => C(mix(a, b, f));
  const withA = (c, a) => (((c & 0xffffff) | ((a & 255) << 24)) >>> 0);
  const css = (u) => '#' + hex2(u & 255) + hex2((u >>> 8) & 255) + hex2((u >>> 16) & 255);
  function mixU(a, b, f) { // blend two packed colours (opaque result)
    const r = (a & 255) + (((b & 255) - (a & 255)) * f), g = ((a >>> 8) & 255) + ((((b >>> 8) & 255) - ((a >>> 8) & 255)) * f), bb = ((a >>> 16) & 255) + ((((b >>> 16) & 255) - ((a >>> 16) & 255)) * f);
    return ((255 << 24) | (Math.round(bb) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  }

  // ---- deterministic randomness ---------------------------------------------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct = 3) {
    let v = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { v += amp * vnoise(x * f, y * f, s + i * 31); n += amp; amp *= 0.5; f *= 2; }
    return v / n;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sharpen = (f, k) => clamp01((f - 0.5) * k + 0.5);

  // ---- ordered dithering ------------------------------------------------------
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  const th4 = (x, y) => (B4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  const th8 = (x, y) => (B8[((y & 7) << 3) | (x & 7)] + 0.5) / 64;

  // ---- colour ramps (for pixel-art lighting: shift a colour n steps along its ramp)
  class Ramps {
    constructor() { this.m = new Map(); }
    add(list) {
      const arr = list.map((c) => (typeof c === 'number' ? c : C(c)));
      arr.forEach((c, i) => { if (!this.m.has(c)) this.m.set(c, [arr, i]); });
      return arr;
    }
    shift(c, n) {
      if (!n) return c;
      const e = this.m.get(c);
      if (!e) return c;
      const a = e[0], i = e[1] + n;
      return a[i < 0 ? 0 : i >= a.length ? a.length - 1 : i];
    }
  }

  // ---- software pixel buffer ----------------------------------------------------
  class PB {
    constructor(w = W, h = H) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); }
    set(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.d[y * this.w + x] = c; }
    get(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; return this.d[y * this.w + x]; }
    rect(x, y, w, h, c) {
      x = Math.round(x); y = Math.round(y);
      const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.w, x + Math.round(w)), y1 = Math.min(this.h, y + Math.round(h));
      if (x1 <= x0) return;
      for (let j = y0; j < y1; j++) this.d.fill(c, j * this.w + x0, j * this.w + x1);
    }
    hl(x0, x1, y, c) { if (x1 < x0) { const q = x0; x0 = x1; x1 = q; } this.rect(x0, y, x1 - x0 + 1, 1, c); }
    vl(x, y0, y1, c) { if (y1 < y0) { const q = y0; y0 = y1; y1 = q; } this.rect(x, y0, 1, y1 - y0 + 1, c); }
    line(x0, y0, x1, y1, c) { // Bresenham
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.set(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    tline(x0, y0, x1, y1, w0, w1, c) { // tapered thick line (round brush; 1 and 2 px handled crisply)
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t), w = w0 + (w1 - w0) * t;
        if (w < 1.6) this.set(x, y, c);
        else if (w < 2.6) { this.set(x, y, c); if (steep) this.set(x + 1, y, c); else this.set(x, y + 1, c); }
        else this.disc(x, y, (w - 1) / 2, c);
      }
    }
    disc(cx, cy, r, c) {
      const rr = r * r + r * 0.8, R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= rr) this.set(cx + dx, cy + dy, c);
    }
    ell(cx, cy, rx, ry, c) {
      const ax = rx + 0.5, ay = ry + 0.5;
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        if ((dx * dx) / (ax * ax) + (dy * dy) / (ay * ay) <= 1) this.set(cx + dx, cy + dy, c);
      }
    }
    poly(pts, c) { // scanline fill, pixel-centre sampling; vertices are pixel-corner coords
      let y0 = Infinity, y1 = -Infinity;
      for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        const yc = y + 0.5, xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i], b = pts[j];
          if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]);
          if (xb > xa) this.rect(xa, y, xb - xa, 1, c);
        }
      }
    }
    fn(x0, y0, x1, y1, f) { // per-pixel shader over [x0,x1) x [y0,y1); f returns a colour or undefined
      x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(this.w, x1 | 0); y1 = Math.min(this.h, y1 | 0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * this.w + x, v = f(x, y, this.d[i]);
        if (v !== undefined) this.d[i] = v;
      }
    }
    // Shift colours along their ramps by f(x,y) steps. Fractions are ordered-dithered, but
    // sharpened (k) so dithering only appears in narrow bands between flat light levels.
    light(ramps, x0, y0, x1, y1, f, k = 2.6) {
      this.fn(x0, y0, x1, y1, (x, y, c) => {
        if (!c) return undefined;
        const I = f(x, y);
        if (!I) return undefined;
        const fi = Math.floor(I), n = fi + (sharpen(I - fi, k) > th8(x, y) ? 1 : 0);
        return n ? ramps.shift(c, n) : undefined;
      });
    }
    stamp(rows, x, y, map) { // rows of PAL keys, '.' = transparent
      for (let j = 0; j < rows.length; j++) {
        const r = rows[j];
        for (let i = 0; i < r.length; i++) {
          const ch = r[i];
          if (ch === '.' || ch === ' ') continue;
          const c = map && map[ch] !== undefined ? map[ch] : C(ch);
          if (c) this.set(x + i, y + j, c);
        }
      }
    }
    over(src, ox = 0, oy = 0) {
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const c = src.d[y * src.w + x];
        if (c >>> 24) this.set(x + ox, y + oy, c);
      }
    }
    canvas() {
      const cv = document.createElement('canvas');
      cv.width = this.w; cv.height = this.h;
      const g = cv.getContext('2d');
      const img = g.createImageData(this.w, this.h);
      new Uint32Array(img.data.buffer).set(this.d);
      g.putImageData(img, 0, 0);
      return cv;
    }
  }

  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // soft radial glow sprite (the only smooth gradients; drawn additively, sparingly)
  function glowSprite(rx, ry, color, a0 = 1) {
    const c = newCanvas(rx * 2, ry * 2), g = c.getContext('2d');
    const [r, gg, b] = rgb(color);
    g.translate(rx, ry); g.scale(1, ry / rx);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grd.addColorStop(0, `rgba(${r},${gg},${b},${a0})`);
    grd.addColorStop(0.35, `rgba(${r},${gg},${b},${a0 * 0.45})`);
    grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
    return c;
  }
  // flicker helper: smooth wobble + occasional short dips (deterministic in t)
  function flicker(t, seed, rate = 9, dipChance = 0.035) {
    let v = 1 + 0.05 * Math.sin(t * 11.3 + seed) + 0.04 * Math.sin(t * 17.9 + seed * 2.1) + 0.03 * Math.sin(t * 5.1 + seed * 0.7);
    if (hash(Math.floor(t * rate), seed | 0, 91) < dipChance) v -= 0.35;
    return v;
  }
  // PB drawing sugar shared by scenes
  function roof(L, x0, x1, baseY, apexY, c, skew = 0) { L.poly([[x0, baseY + 1], [x1 + 1, baseY + 1], [(x0 + x1 + 1) / 2 + skew, apexY]], c); }
  function crenels(L, x0, x1, topY, c, mw = 3, gap = 2, mh = 3) { for (let x = x0; x <= x1; x += mw + gap) L.rect(x, topY - mh, Math.min(mw, x1 - x + 1), mh, c); }
  function archCut(L, x, y, w, h, c = 0) { // round-topped window (cleared, or filled with c)
    const r = w / 2, cy = y + r;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const px = x + i + 0.5, py = y + j + 0.5;
      if (py < cy) { const dx = px - (x + r), dy = py - cy; if (dx * dx + dy * dy > r * r + 0.3) continue; }
      L.set(x + i, y + j, c);
    }
  }

  // ===========================================================================
  // GRAVEYARD — "Graveyard of Second Chances"
  // ===========================================================================
  const MOON = { x: 300, y: 58, r: 24 };
  const GY = { S: null };
  const gradIdx = (y, st) => {
    if (y <= st[0]) return 0;
    for (let i = 1; i < st.length; i++) if (y < st[i]) return i - 1 + (y - st[i - 1]) / (st[i] - st[i - 1]);
    return st.length - 1;
  };

  function buildGraveyard() {
    const R = rng(0x5eed01);
    const pb = new PB();
    const ramps = new Ramps();

    // --- sky: deep indigo at the top -> dusky purple glow at the horizon
    const SKY = ramps.add([M('K', 'V', .06), M('K', 'V', .18), M('1', 'V', .22), M('2', 'V', .16), M('2', '3', .55), M('3', 'G', .12), M('4', 'G', .22), M('4', 'G', .45)]);
    const skyStops = [0, 16, 40, 68, 94, 114, 132, 150];
    pb.fn(0, 0, W, H, (x, y) => {
      const f = gradIdx(y, skyStops), i = Math.floor(f);
      return SKY[Math.min(SKY.length - 1, i + (sharpen(f - i, 2.2) > th8(x, y) ? 1 : 0))];
    });
    // moon halo: the sky one step lighter around the moon
    pb.light(ramps, MOON.x - 80, MOON.y - 80, MOON.x + 80, MOON.y + 80, (x, y) => {
      const d = Math.hypot(x - MOON.x, y - MOON.y);
      if (d <= MOON.r || d > MOON.r + 44) return 0;
      return 1.25 * Math.pow(1 - (d - MOON.r) / 44, 1.2);
    });

    // --- the moon: pink-red, lit from the upper left, soft maria + craters
    const MR = ramps.add([C('h'), M('h', 'G', .5), C('G'), M('G', 'r', .26), M('G', 'r', .5), M('r', 'F', .3)]);
    const L = [-0.42, -0.5, 0.76];
    const onMoon = (x, y) => (x - MOON.x) * (x - MOON.x) + (y - MOON.y) * (y - MOON.y) <= MOON.r * MOON.r + MOON.r * 0.8;
    for (let dy = -MOON.r; dy <= MOON.r; dy++) for (let dx = -MOON.r; dx <= MOON.r; dx++) {
      const x = MOON.x + dx, y = MOON.y + dy;
      if (!onMoon(x, y)) continue;
      const nx = dx / (MOON.r + 0.5), ny = dy / (MOON.r + 0.5), nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const s = nx * L[0] + ny * L[1] + nz * L[2];
      const f = 0.7 + (s + 0.6) * 2.3, i = Math.floor(f);
      pb.set(x, y, MR[Math.max(0, Math.min(5, i + (sharpen(f - i, 5) > th8(x, y) ? 1 : 0)))]);
    }
    pb.light(ramps, MOON.x - MOON.r, MOON.y - MOON.r, MOON.x + MOON.r + 1, MOON.y + MOON.r + 1, (x, y) => {
      if ((x - MOON.x) ** 2 + (y - MOON.y) ** 2 > (MOON.r - 2) ** 2) return 0;
      const n = fbm(x * 0.12, y * 0.12, 7, 3);
      return n > 0.55 ? -Math.min(1, (n - 0.55) * 8) : 0;
    }, 3);
    const craters = [[-9, -4, 3], [5, -11, 2], [9, 6, 4], [-5, 11, 2], [-15, 4, 1], [3, 16, 1], [15, -6, 2], [-1, -16, 1], [-2, 3, 1]];
    for (const [ox, oy, r] of craters) {
      const cx = MOON.x + ox, cy = MOON.y + oy;
      const inC = (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + r * 0.8;
      pb.fn(cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2, (x, y, c) => {
        if (!inC(x, y)) return undefined;
        if (!inC(x - 1, y - 1)) return ramps.shift(c, -2); // shadowed upper-left inner wall
        if (!inC(x + 1, y + 1)) return ramps.shift(c, 1); // lit lower-right inner wall
        return ramps.shift(c, -1);
      });
    }
    // cloud wisps: lens-shaped, darker than the moon where they cross it, lit edges
    const wisp = (x0, x1, y, th) => {
      for (let x = x0; x <= x1; x++) {
        const u = (x - x0) / (x1 - x0), h = Math.max(1, Math.round(th * Math.pow(Math.sin(Math.PI * u), 0.7)));
        for (let j = 0; j < h; j++) {
          const yy = y - (h >> 1) + j, c = pb.get(x, yy);
          if (onMoon(x, yy)) pb.set(x, yy, j === 0 ? MR[2] : MR[1]);
          else pb.set(x, yy, ramps.shift(c, j === 0 && Math.hypot(x - MOON.x, yy - MOON.y) < MOON.r + 26 ? 2 : 1));
        }
      }
    };
    wisp(268, 334, 73, 3); wisp(292, 350, 79, 2); wisp(322, 350, 66, 2);
    wisp(138, 206, 42, 2); wisp(404, 452, 96, 2); wisp(12, 52, 112, 2);

    // --- silhouette layers (own buffers; rim-lit toward the moon; bases dissolve in haze)
    const far = new PB(), mid = new PB(), near = new PB(), tree = new PB();
    const cf = M('1', '2', .42), cm = M('K', '1', .45), cg = M('K', '1', .6), cn = M('k', 'K', .55);
    // far: rolling land, castle ruin, colonnade
    for (let x = 0; x < W; x++) far.vl(x, Math.round(132 + 3 * Math.sin(x * 0.035) + 2 * Math.sin(x * 0.09 + 2)), H - 1, cf);
    far.rect(96, 112, 146, 40, cf); crenels(far, 96, 241, 112, cf);
    far.rect(104, 84, 13, 60, cf); roof(far, 102, 118, 83, 64, cf); far.vl(110, 58, 64, cf);
    archCut(far, 109, 92, 3, 5); archCut(far, 109, 104, 3, 5);
    far.rect(128, 94, 40, 50, cf); crenels(far, 128, 167, 94, cf);
    archCut(far, 134, 102, 5, 9); archCut(far, 146, 102, 5, 9); archCut(far, 158, 102, 5, 9);
    far.poly([[174, 150], [174, 86], [177, 80], [180, 82], [182, 75], [185, 79], [187, 84], [188, 150]], cf);
    archCut(far, 179, 93, 3, 6);
    far.rect(194, 98, 7, 40, cf); roof(far, 193, 201, 97, 87, cf);
    far.poly([[200, 150], [200, 114], [207, 111], [211, 115], [218, 112], [224, 116], [231, 113], [242, 117], [242, 150]], cf);
    for (const ax of [204, 215, 226]) archCut(far, ax, 123, 7, 14);
    far.rect(334, 112, 90, 6, cf);
    for (let x = 336; x <= 420; x += 21) far.rect(x, 112, 6, 44, cf);
    for (let x = 342; x < 420; x += 21) archCut(far, x, 118, 15, 30);
    far.poly([[334, 113], [339, 108], [345, 111], [351, 109], [357, 113]], cf); far.rect(378, 103, 4, 10, cf); far.rect(377, 102, 6, 2, cf);
    // mid: small chapel ruin (left, lit window), crooked houses, the church whose spire crosses the moon
    mid.rect(36, 112, 44, 60, cm); roof(mid, 32, 70, 111, 94, cm); mid.rect(56, 86, 7, 10, cm); roof(mid, 55, 63, 85, 79, cm); archCut(mid, 58, 88, 3, 5);
    mid.poly([[80, 172], [80, 114], [84, 118], [87, 115], [91, 121], [94, 172]], cm);
    mid.poly([[202, 172], [202, 122], [224, 119], [226, 172]], cm); mid.poly([[198, 124], [212, 101], [229, 121]], cm);
    mid.poly([[216, 111], [219, 104], [223, 105], [221, 113]], cm);
    mid.rect(230, 128, 26, 44, cm); roof(mid, 227, 258, 127, 110, cm, -2);
    mid.rect(272, 120, 23, 52, cm); roof(mid, 270, 296, 119, 110, cm);
    mid.rect(294, 98, 13, 74, cm); roof(mid, 293, 307, 97, 70, cm); mid.vl(300, 60, 70, cm); mid.hl(298, 302, 63, cm);
    archCut(mid, 298, 101, 5, 7);
    mid.rect(307, 116, 26, 56, cm); roof(mid, 305, 334, 115, 104, cm);
    mid.poly([[388, 172], [389, 114], [414, 112], [416, 172]], cm); mid.poly([[384, 116], [397, 92], [419, 114]], cm);
    mid.rect(406, 96, 4, 12, cm); mid.rect(405, 95, 6, 2, cm);
    mid.rect(416, 124, 22, 48, cm); roof(mid, 413, 440, 123, 108, cm);
    // small dead trees in the middle distance
    function scrub(Lr, x, y, h, seed, c, w0 = 2) {
      const r = rng(seed);
      const br = (x0, y0, ang, len, w, depth) => {
        const segs = Math.max(2, Math.round(len / 5));
        let cx = x0, cy = y0, a = ang;
        for (let s = 0; s < segs; s++) {
          a += (r() - 0.5) * 0.45;
          const nx = cx + Math.cos(a) * (len / segs), ny = cy + Math.sin(a) * (len / segs);
          Lr.tline(cx, cy, nx, ny, w, w * 0.8, c);
          cx = nx; cy = ny;
        }
        if (depth <= 0 || len < 3) return;
        for (let k = 0; k < 2; k++) br(cx, cy, a + (k ? 1 : -1) * (0.35 + r() * 0.5), len * (0.55 + r() * 0.2), Math.max(1, w * 0.6), depth - 1);
      };
      br(x, y, -Math.PI / 2 + (r() - 0.5) * 0.2, h * 0.42, w0, 3);
    }
    scrub(mid, 172, 142, 30, 17, cm);
    scrub(mid, 352, 140, 24, 23, cm);

    const rimLayer = (Lr, col, yMax, top = true) => {
      const out = new Uint32Array(Lr.d);
      for (let y = 1; y < Math.min(H, yMax); y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!(Lr.d[i] >>> 24)) continue;
        const side = x < MOON.x - 3 ? 1 : x > MOON.x + 3 ? -1 : 0;
        if ((side && !(Lr.d[i + side] >>> 24)) || (top && !(Lr.d[i - W] >>> 24))) out[i] = col;
      }
      Lr.d.set(out);
    };
    const comp = (src, y0, y1, hz, maxF) => { // copy layer into pb; its base dissolves into haze
      const cache = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = src.d[y * W + x];
        if (!(c >>> 24)) continue;
        const f = y > y0 ? Math.min(1, (y - y0) / (y1 - y0)) * maxF : 0;
        if (!f) { pb.d[y * W + x] = c; continue; }
        let st = cache.get(c);
        if (!st) { st = [c, mixU(c, hz, 0.3), mixU(c, hz, 0.6), mixU(c, hz, 0.85)]; cache.set(c, st); }
        const fi = f * 3, i0 = Math.floor(fi);
        pb.d[y * W + x] = st[Math.min(3, i0 + (sharpen(fi - i0, 2.2) > th8(x, y) ? 1 : 0))];
      }
    };
    rimLayer(far, M('2', '3', .5), 140);
    comp(far, 126, 142, SKY[6], 1);
    rimLayer(mid, M('2', '3', .35), 140);
    comp(mid, 136, 152, SKY[5], 0.9);
    // dim lit windows (one flickers per frame)
    const win0 = M('M', 'h', .35), win1 = C('m'), win2 = M('m', 'A', .6);
    pb.rect(48, 118, 4, 6, win1); pb.hl(48, 51, 118, win0); pb.set(48, 118, cm); pb.set(51, 118, cm); pb.set(49, 122, win2);
    pb.rect(399, 121, 4, 5, win1); pb.vl(401, 121, 125, win0); pb.hl(399, 402, 123, win0); pb.set(400, 124, win2);
    pb.rect(243, 136, 3, 4, win0); pb.set(244, 138, win1);

    // --- hill crest + ground plane (the combat lane)
    const GR = ramps.add([M('K', 'I', .2), M('1', 'I', .3), M('2', 'I', .35), M('3', 'I', .3), M('3', 'i', .3), M('4', 'i', .3), M('5', 'i', .2), M('5', 'E', .4)]);
    const hillY = (x) => {
      let y = 150 + 1.2 * Math.sin(x * 0.045) + 0.8 * Math.sin(x * 0.11 + 1.3);
      if (x < 84) y -= 24 * Math.pow(1 - x / 84, 1.4);
      if (x > 392) y -= 19 * Math.pow((x - 392) / 88, 1.25);
      return Math.round(y);
    };
    const hy = new Int16Array(W);
    for (let x = 0; x < W; x++) hy[x] = hillY(x);
    const interp = (pts, v) => {
      if (v <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (v < pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]); }
      return pts[pts.length - 1][1];
    };
    const gBase = [[150, 4.1], [157, 3.75], [170, 3.1], [194, 3.1], [206, 3.45], [222, 3.4], [228, 2.9], [236, 2.0]];
    const gAmp = [[150, 0.5], [168, 1.7], [196, 1.4], [206, 0.9], [224, 0.9], [232, 0.8]];
    pb.fn(0, 100, W, H, (x, y) => {
      if (y < hy[x]) return undefined;
      const n = fbm(x * 0.018, y * 0.07, 5, 2);
      let f;
      if (y < 150) f = 2.2 + (n - 0.5) * 1.0 + (y - hy[x] < 2 ? 1.4 : 0); // side mounds (in shade)
      else f = interp(gBase, y) + (n - 0.5) * interp(gAmp, y);
      f += 0.55 * Math.max(0, 1 - Math.abs(x - MOON.x) / 120) * Math.max(0, Math.sin(Math.PI * clamp01((y - 150) / 80))); // moonlit swath
      const i = Math.floor(f);
      return GR[Math.max(0, Math.min(GR.length - 1, i + (sharpen(f - i, 7) > th8(x, y) ? 1 : 0)))];
    });
    for (let x = 84; x <= 392; x++) if (hash(x, 3, 5) < 0.6) pb.set(x, hy[x], GR[5]); // misty crest line
    // fissures and moonlit stones, scaled by depth
    for (let i = 0; i < 26; i++) {
      let x = Math.floor(R() * W), y = Math.round(168 + R() * 56);
      const p = (y - 150) / 80, len = Math.round(4 + R() * 10 * (0.5 + p));
      for (let s = 0; s < len; s++) { pb.set(x, y, ramps.shift(pb.get(x, y), -1)); x += 1; if (R() < 0.3) y += R() < 0.5 ? -1 : 1; }
    }
    const pebble = (x, y, big) => {
      const c = pb.get(x, y);
      pb.set(x, y, ramps.shift(c, 2)); if (big) { pb.set(x + 1, y, ramps.shift(c, 1)); pb.set(x - 1, y, ramps.shift(c, 1)); pb.set(x, y - 1, ramps.shift(c, 1)); }
      pb.set(x + 1, y + 1, ramps.shift(c, -1)); if (big) pb.set(x + 2, y + 1, ramps.shift(c, -1));
    };
    for (let i = 0; i < 70; i++) { const y = Math.round(160 + Math.pow(R(), 0.8) * 66), x = Math.floor(R() * W); if (y > hy[x] + 3) pebble(x, y, R() < 0.35 * ((y - 150) / 80)); }
    // grass: small tufts in clusters (sparse in the lane centre so units read)
    const gr0 = M('x', '2', .62), gr1 = M('Y', '3', .62), gr2 = M('Y', '4', .45);
    const TUFTS = [['a.a', '.a.'], ['b.b', 'aba'], ['.c..', 'b.b.', '.ab.'], ['c...c', '.b.b.', '.aba.'], ['..c..', 'c.b.c', '.bab.', '..a..'], ['c..c..', '.b.b.c', '.abab.']];
    const tuftMap = { a: gr0, b: gr1, c: gr2 };
    for (let i = 0; i < 46; i++) {
      const cy = Math.round(158 + Math.pow(R(), 0.75) * 68), cx = Math.floor(R() * W);
      const lane = cx > 50 && cx < 430 && cy > 194 && cy < 226;
      if (cy < hy[cx] + 4 || (lane && R() < 0.8)) continue;
      const p = (cy - 150) / 80, n = lane ? 1 : 2 + Math.floor(R() * 5);
      for (let k = 0; k < n; k++) {
        const x = cx + Math.round((R() - 0.5) * 18 * (0.5 + p)), y = cy + Math.round((R() - 0.5) * 6 * (0.5 + p));
        if (y < hy[Math.max(0, Math.min(W - 1, x))] + 4) continue;
        const sz = Math.min(TUFTS.length - 1, Math.floor(p * 3.2 + R() * 2.2)), rows = TUFTS[sz];
        pb.stamp(rows, x - (rows[0].length >> 1), y - rows.length + 1, tuftMap);
      }
    }
    // puddle catching the moon + flat ledger stones (low detail that doesn't clutter the lane)
    const PUD = { x: 300, y: 177 };
    pb.ell(PUD.x, PUD.y, 14, 2, GR[1]); pb.ell(PUD.x, PUD.y, 12, 1, SKY[3]); pb.hl(PUD.x - 9, PUD.x + 9, PUD.y + 1, SKY[4]);
    pb.hl(PUD.x - 12, PUD.x + 12, PUD.y - 2, GR[2]); pb.hl(PUD.x - 11, PUD.x + 12, PUD.y + 3, GR[5]);
    const ledger = (x, y, w) => { pb.poly([[x + 2, y], [x + w + 2, y], [x + w, y + 4], [x, y + 4]], GR[2]); pb.hl(x + 2, x + w + 1, y, GR[5]); pb.hl(x, x + w - 1, y + 4, GR[1]); pb.set(x + (w >> 1), y + 2, GR[1]); pb.set(x + (w >> 1) + 1, y + 2, GR[1]); };
    ledger(90, 164, 16); ledger(172, 170, 13); ledger(372, 167, 15);
    // scattered bones at the lane edges
    pb.stamp(['.WWW.', 'WkWkW', 'WWWWW', '.WbW.'], 18, 202, { W: GR[6], k: GR[1], b: GR[5] });
    pb.hl(455, 461, 206, GR[6]); pb.set(454, 205, GR[6]); pb.set(454, 207, GR[6]); pb.set(462, 205, GR[6]); pb.set(462, 207, GR[6]); pb.hl(455, 461, 207, GR[3]);
    // fresh grave: dirt mound, shovel and a wooden marker (right edge, outside the lane)
    pb.poly([[442, 190], [449, 180], [461, 177], [473, 180], [481, 190]], GR[2]); pb.line(449, 180, 461, 177, GR[4]); pb.line(461, 177, 472, 180, GR[3]);
    pb.hl(443, 480, 190, GR[1]);
    for (let i = 0; i < 16; i++) pb.set(447 + Math.floor(R() * 30), 181 + Math.floor(R() * 8), R() < 0.5 ? GR[3] : GR[1]);
    pb.line(472, 160, 468, 181, C('u')); pb.line(473, 160, 469, 181, C('U')); pb.hl(470, 475, 159, C('u')); pb.set(470, 159, C('T'));
    pb.poly([[465, 181], [471, 181], [471, 186], [468, 188], [465, 186]], C('I')); pb.vl(465, 181, 185, C('i'));
    pb.rect(452, 166, 2, 16, C('U')); pb.vl(452, 166, 181, C('u')); pb.rect(448, 170, 10, 2, C('U')); pb.hl(448, 457, 170, C('u'));
    // --- near: graves along the crest, crypt + iron fence on the right mound
    const gravePos = [[46, 'cross'], [60, 'round'], [75, 'obelisk'], [96, 'round'], [109, 'slab'], [133, 'cross'], [152, 'round'], [163, 'round'], [186, 'celtic'],
      [222, 'round'], [240, 'cross'], [262, 'obelisk'], [311, 'round'], [327, 'slab'], [350, 'cross'], [371, 'round'], [385, 'round']];
    for (const [gx, type] of gravePos) {
      const by = hy[gx] + 1, v = R();
      if (type === 'round') { const w = 7 + (v < 0.5 ? 0 : 2), h = 7 + Math.floor(v * 4); near.rect(gx - (w >> 1), by - h + 3, w, h - 2, cg); near.disc(gx, by - h + 3, (w - 1) / 2, cg); }
      else if (type === 'cross') { const h = 11 + Math.floor(v * 3); near.rect(gx - 1, by - h, 3, h + 1, cg); near.rect(gx - 4, by - h + 3, 9, 3, cg); }
      else if (type === 'obelisk') { near.poly([[gx - 2.5, by + 1], [gx - 2, by - 12], [gx + 0.5, by - 16], [gx + 3, by - 12], [gx + 3.5, by + 1]], cg); near.rect(gx - 4, by - 2, 9, 3, cg); }
      else if (type === 'slab') { near.poly([[gx - 5, by + 1], [gx - 3, by - 8], [gx + 4, by - 10], [gx + 5, by + 1]], cg); }
      else if (type === 'celtic') { near.rect(gx - 1, by - 15, 3, 16, cg); near.rect(gx - 5, by - 11, 11, 3, cg); near.disc(gx, by - 10, 3, cg); near.set(gx - 1, by - 11, 0); near.set(gx + 1, by - 11, 0); near.set(gx - 1, by - 9, 0); near.set(gx + 1, by - 9, 0); }
    }
    const cy0 = hy[455] + 2;
    near.rect(440, 106, 30, cy0 - 106, cg); roof(near, 437, 472, 105, 94, cg); near.rect(436, 105, 37, 2, cg);
    near.vl(455, 84, 94, cg); near.hl(452, 458, 87, cg);
    archCut(near, 451, 113, 9, cy0 - 113, C('k'));
    near.hl(452, 458, cy0 - 1, M('x', 'k', .3)); near.hl(453, 457, cy0 - 2, M('x', 'k', .5)); near.set(455, cy0 - 3, M('x', 'k', .6));
    near.rect(443, 110, 2, cy0 - 110, M('K', '1', .3)); near.rect(465, 110, 2, cy0 - 110, M('K', '1', .3));
    const fx0 = 398;
    for (let x = fx0; x < W; x++) {
      const b = hy[x] - 1, gap = x > 427 && x < 436;
      if (!gap && (x - fx0) % 4 === 0) { near.vl(x, b - 14, b, cn); near.set(x, b - 16, cn); near.hl(x - 1, x + 1, b - 15, cn); }
      if (!gap) { near.set(x, b - 11, cn); near.set(x, b - 3, cn); }
    }
    near.rect(fx0 - 5, hy[fx0] - 19, 5, 20, cg); near.rect(fx0 - 6, hy[fx0] - 21, 7, 2, cg); near.rect(fx0 - 4, hy[fx0] - 23, 3, 2, cg);
    near.line(430, hy[430] - 1, 434, hy[434] - 15, cn);
    rimLayer(near, M('3', '4', .4), 152);
    pb.over(near);

    // --- the big dead tree on the left mound, one long arm reaching toward the moon
    const TREE = [
      [[[22, 138], [23, 124], [21, 110], [24, 96], [23, 84]], 11, 6],
      [[[20, 136], [12, 139], [6, 141]], 3, 1], [[[25, 136], [32, 139], [38, 141]], 3, 1], [[[22, 137], [19, 142]], 2, 1],
      [[[23, 86], [33, 78], [45, 75], [58, 69], [72, 67], [86, 61], [97, 63], [104, 61]], 5.5, 1.2],
      [[[45, 75], [49, 64], [56, 54], [58, 46]], 3, 1], [[[72, 67], [77, 59], [85, 54]], 2, 1], [[[86, 61], [92, 67], [95, 73]], 1.5, 1],
      [[[58, 69], [63, 74], [65, 80]], 1.5, 1], [[[97, 63], [101, 68]], 1, 1],
      [[[23, 84], [26, 70], [24, 58], [29, 46], [33, 34], [39, 26]], 5.5, 1.2],
      [[[25, 64], [16, 52], [12, 42], [7, 36]], 3, 1], [[[29, 46], [21, 38], [19, 30]], 2, 1], [[[33, 34], [44, 28], [52, 28]], 1.5, 1],
      [[[39, 26], [42, 20]], 1, 1], [[[16, 52], [8, 50]], 1, 1], [[[12, 42], [14, 34]], 1, 1],
      [[[22, 100], [13, 92], [6, 90], [1, 84]], 4, 1], [[[6, 90], [3, 98]], 1, 1],
    ];
    for (const [pts, w0, w1] of TREE) {
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const sl = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        tree.tline(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], w0 + (w1 - w0) * (acc / len), w0 + (w1 - w0) * ((acc + sl) / len), cn);
        acc += sl;
      }
      const e = pts[pts.length - 1], p = pts[pts.length - 2];
      if (w0 > 1.2) for (let k = 0; k < 2; k++) { const a = Math.atan2(e[1] - p[1], e[0] - p[0]) + (k ? 0.7 : -0.6); tree.line(e[0], e[1], e[0] + Math.cos(a) * 4, e[1] + Math.sin(a) * 4, cn); }
    }
    // a knot hole and a crow on the long arm
    tree.set(22, 110, C('k')); tree.set(23, 111, C('k'));
    tree.stamp(['..kk...', '.kkkk..', 'kkkkkkk', '..kkkkkk', '..kkk...', '..k.k...'], 78, 55, { k: cn });
    rimLayer(tree, M('2', '3', .45), H, false);
    tree.set(79, 56, C('R'));
    pb.over(tree);

    // --- foreground: dark grass bank and corner stones (mostly under the UI boxes)
    const fg = new PB();
    const fk = C('k'), fK = C('K');
    const bankTop = (x) => Math.round(229 + 2 * Math.sin(x * 0.09) + 1.5 * Math.sin(x * 0.23 + 1));
    for (let x = 0; x < W; x++) { fg.vl(x, bankTop(x), H - 1, fK); fg.vl(x, bankTop(x) + 5, H - 1, fk); }
    for (let i = 0; i < 190; i++) {
      const x = Math.floor(R() * W), top = bankTop(x), h = 2 + Math.floor(R() * 6), lean = R() < 0.5 ? -1 : 1;
      for (let j = 0; j < h; j++) fg.set(x + (j > h / 2 ? lean : 0), top - j, fK);
    }
    fg.poly([[-2, 270], [-2, 200], [3, 193], [12, 190], [21, 194], [25, 201], [26, 270]], fK);
    fg.rect(10, 199, 3, 13, M('K', '1', .6)); fg.rect(7, 202, 9, 3, M('K', '1', .6));
    fg.rect(30, 208, 3, 26, fK); fg.rect(26, 212, 11, 3, fK);
    fg.poly([[447, 270], [447, 206], [452, 200], [462, 197], [472, 200], [477, 207], [477, 270]], fK);
    fg.rect(460, 204, 3, 12, M('K', '1', .6)); fg.rect(456, 207, 11, 3, M('K', '1', .6));
    for (let i = 0; i < 14; i++) { const x = 440 + Math.floor(R() * 40), h = 4 + Math.floor(R() * 9); for (let j = 0; j < h; j++) fg.set(x + (j > h * 0.6 ? 1 : 0), 229 - j, fK); }
    rimLayer(fg, M('1', '2', .7), H, true);
    pb.over(fg);

    // --- stars (only where open sky shows)
    const skySet = new Set(SKY);
    const stars = [];
    for (let i = 0; i < 600 && stars.length < 120; i++) {
      const x = Math.floor(R() * W), y = Math.floor(Math.pow(R(), 1.4) * 118);
      if (!skySet.has(pb.get(x, y)) || Math.hypot(x - MOON.x, y - MOON.y) < MOON.r + 14) continue;
      const topRight = x > 300 && y < 30;
      if (topRight && R() < 0.65) continue;
      const bright = topRight ? 0 : R() < 0.1 ? 2 : R() < 0.45 ? 1 : 0;
      stars.push({ x, y, b: bright - (y > 80 ? 0.7 : 0), a: 0.6 + R() * 0.9, sp: 0.8 + R() * 2.6, ph: R() * 6.28, big: bright === 2 && R() < 0.5 && !topRight });
    }

    // --- fog bands (tileable horizontally)
    function fogBand(seed, w, h, color, density) {
      const r = rng(seed), band = new PB(w, h), col = C(color), lumps = [];
      const n = Math.round(w / 26);
      for (let i = 0; i < n; i++) lumps.push({ x: (i + r() * 0.9) * (w / n), y: h * (0.45 + (r() - 0.5) * 0.3), rx: 16 + r() * 36, ry: h * (0.18 + r() * 0.2), a: 0.5 + r() * 0.7 });
      band.fn(0, 0, w, h, (x, y) => {
        let d = 0;
        for (const l of lumps) {
          let dx = Math.abs(x + 0.5 - l.x); dx = Math.min(dx, w - dx);
          const q = (dx / l.rx) ** 2 + ((y + 0.5 - l.y) / l.ry) ** 2;
          if (q < 1) d += l.a * (1 - q) * (1 - q);
        }
        const v = clamp01(d * density), k = Math.floor(v * 3 + th4(x, y));
        return k > 0 ? withA(col, Math.min(3, k) * 85) : undefined;
      });
      return band.canvas();
    }
    const fogs = [
      { c: fogBand(11, W, 30, '4', 1.0), y: 118, speed: 2.5, alpha: 0.3 },
      { c: fogBand(22, W, 26, '5', 0.9), y: 138, speed: 5.5, alpha: 0.24 },
      { c: fogBand(33, W, 34, '5', 0.8), y: 190, speed: 9, alpha: 0.1 },
    ];

    const batRows = [
      ['k.........k', 'kk.......kk', '.kkk.k.kkk.', '..kkkkkkk..', '....kkk....', '.....k.....'],
      ['...........', '....k.k....', 'kkkkkkkkkkk', '.kk.kkk.kk.', '....kkk....', '.....k.....'],
      ['...........', '....k.k....', '...kkkkk...', '..kkkkkkk..', '.kk.kkk.kk.', 'k....k....k'],
    ];
    const bats = batRows.map((rows) => { const b = new PB(11, 6); b.stamp(rows, 0, 0); return b.canvas(); });

    return {
      base: pb.canvas(), stars, fogs, bats,
      starCols: [css(M('3', '4', .6)), css(C('5')), css(M('5', 'e', .55)), css(C('e'))],
      moonGlow: glowSprite(64, 64, 'r', 0.55),
      win: { x: 48, y: 118, c0: css(win1), c1: css(win2), c2: css(win0) },
      pud: PUD, refl: [css(MR[1]), css(MR[3]), css(MR[4])],
      winGlow: glowSprite(9, 9, 'A', 0.6), windows: [[50, 121], [401, 123], [244, 138]], cryptGlow: glowSprite(14, 12, 'd', 0.5),
    };
  }

  function graveyard(ctx, t, opts = {}) {
    t = +t || 0;
    const S = GY.S || (GY.S = buildGraveyard());
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(S.base, 0, 0);
    if (opts.stars !== false) { // twinkling stars
      const buckets = [[], [], [], []];
      for (const s of S.stars) {
        const k = Math.round(s.b + s.a * Math.sin(t * s.sp + s.ph));
        if (k >= 0) buckets[Math.min(3, k)].push(s);
      }
      for (let k = 0; k < 4; k++) {
        if (!buckets[k].length) continue;
        ctx.fillStyle = S.starCols[k];
        for (const s of buckets[k]) {
          ctx.fillRect(s.x, s.y, 1, 1);
          if (s.big && k >= 3) { ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3); }
        }
      }
    }
    // soft moon bloom
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.2 + 0.04 * Math.sin(t * 0.7);
    ctx.drawImage(S.moonGlow, MOON.x - 64, MOON.y - 64);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // the moon's reflection shimmering in the puddle
    const sh = Math.round(Math.sin(t * 2.3) * 1.2), P0 = S.pud;
    ctx.fillStyle = S.refl[1]; ctx.fillRect(P0.x - 2 + sh, P0.y, 5, 1);
    ctx.fillStyle = S.refl[2]; ctx.fillRect(P0.x - 1 + sh, P0.y, 2, 1);
    ctx.fillStyle = S.refl[0]; ctx.fillRect(P0.x - 1 - sh, P0.y + 1, 3, 1);
    // warm halos around the lit windows, a faint green glow seeping from the crypt
    ctx.globalCompositeOperation = 'lighter';
    S.windows.forEach(([wx, wy], i) => { ctx.globalAlpha = 0.22 + 0.06 * Math.sin(t * (2.1 + i) + i * 2); ctx.drawImage(S.winGlow, wx - 9, wy - 9); });
    ctx.globalAlpha = 0.18 + 0.1 * Math.sin(t * 0.9);
    ctx.drawImage(S.cryptGlow, 455 - 14, 131 - 12);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // candle-lit window flicker
    const f = flicker(t, 3, 6, 0.08);
    ctx.fillStyle = f > 0.97 ? S.win.c1 : f > 0.8 ? S.win.c0 : S.win.c2;
    ctx.fillRect(S.win.x + 1, S.win.y + 2, 2, 3);
    // an occasional bat (or two) crossing the sky
    if (opts.critters !== false) {
      const P = 17, n = Math.floor(t / P), u = t - n * P, dur = 8;
      if (u < dur) {
        const dir = hash(n, 1, 7) < 0.5 ? 1 : -1, y0 = 46 + hash(n, 2, 7) * 50, count = hash(n, 3, 7) < 0.45 ? 2 : 1;
        for (let b = 0; b < count; b++) {
          const p = (u - b * 0.5) / dur;
          if (p < 0 || p > 1) continue;
          const x = dir > 0 ? -12 + p * (W + 24) : W + 12 - p * (W + 24);
          const y = y0 + b * 7 + Math.sin(u * 3.1 + b) * 6 + Math.sin(u * 1.3) * 5;
          ctx.drawImage(S.bats[[0, 1, 2, 1][Math.floor(u * 12 + b * 2) & 3]], Math.round(x) - 5, Math.round(y) - 3);
        }
      }
    }
    if (opts.fog !== false) { // drifting fog bands, wrapping horizontally
      for (const fb of S.fogs) {
        const off = Math.floor((((t * fb.speed) % W) + W) % W);
        ctx.globalAlpha = fb.alpha;
        ctx.drawImage(fb.c, off - W, fb.y);
        ctx.drawImage(fb.c, off, fb.y);
      }
    }
    ctx.restore();
  }

  // ===========================================================================
  // LAB — "the Slab"
  // ===========================================================================
  const LB = { S: null };
  // Slab: top face from the back edge (y 203) to the front lip (y 212); creature feet at y 208.
  const SLAB = { cx: 240, top: 208, backY: 203, frontY: 212, x0: 165, x1: 315, faceY1: 222, baseY: 241 };
  const LAMP = { x: 240, y0: 0, y1: 28 };
  const DRIP = { x: 151, y: 40, floor: 231 };

  function buildLab() {
    const R = rng(0x1ab);
    const pb = new PB();
    const ramps = new Ramps();
    // stone: black -> deep green-grey -> lamp-lit green
    const ST = ramps.add([C('k'), M('k', 'x', .38), M('K', 'x', .55), M('1', 'x', .78), M('x', 'Y', .3), M('x', 'Y', .7), M('Y', 'y', .45), M('y', 'd', .25), M('y', 'd', .65), C('d')]);
    const MT = ramps.add([C('k'), M('k', 'I', .55), C('I'), M('I', 'i', .5), C('i'), C('E'), C('e')]);
    ramps.add([C('k'), C('U'), C('u'), C('T'), C('t')]);
    ramps.add([C('Q'), C('q'), C('R'), C('r')]);
    ramps.add([C('N'), C('n'), C('B'), C('b'), C('W')]);
    const MOSS = [M('x', 'k', .25), C('x'), M('x', 'Y', .6), M('Y', 'y', .5)];
    ramps.add(MOSS);
    ramps.add([C('k'), M('x', 'k', .3), M('x', 'k', .2), C('x'), C('Y'), C('y'), C('D'), C('d'), C('z')]);
    ramps.add([C('h'), C('G'), C('g'), C('F'), C('f')]);
    ramps.add([C('N'), M('b', 'x', .45), M('b', 'x', .4), M('b', 'x', .35)]);
    ramps.add([C('w'), C('j')]);
    // vignette (steps, <= 0): dark toward the side panels and the ceiling
    const vig = (x, yy) => -Math.min(2.4, (Math.max(0, Math.abs(x - 240) - 92) / 60) * 1.3 + (yy < 44 ? ((44 - yy) / 44) * 0.9 : 0));

    // --- stone-brick wall, uneven courses
    pb.rect(0, 0, W, 224, ST[1]);
    let y = -3, row = 0;
    while (y < 224) {
      const rh = 8 + (hash(row, 0, 3) < 0.35 ? 1 : 0) + (hash(row, 1, 3) < 0.15 ? -1 : 0);
      let x = -Math.floor(hash(row, 2, 3) * 20), k = 0;
      while (x < W) {
        const bw = 13 + Math.floor(hash(row, k, 4) * 13), v = hash(row, k, 5);
        const base = ramps.shift(v < 0.22 ? ST[2] : v < 0.86 ? ST[3] : ST[4], Math.round(vig(x + bw / 2, y + rh / 2) + (hash(row, k, 10) - 0.5) * 0.9));
        pb.rect(x, y, bw - 1, rh - 1, base);
        pb.hl(x, x + bw - 2, y, ramps.shift(base, 1));                // top lip catches light
        pb.hl(x + 1, x + bw - 2, y + rh - 2, ramps.shift(base, -1)); // underside shadow
        if (hash(row, k, 6) < 0.3) pb.set(x, y + rh - 2, ST[1]);        // chipped corners
        if (hash(row, k, 7) < 0.25) pb.set(x + bw - 2, y, ST[1]);
        if (hash(row, k, 8) < 0.14) { // hairline crack
          let cx = x + 3 + Math.floor(hash(row, k, 9) * (bw - 7));
          for (let s = 1; s < rh - 2; s++) { pb.set(cx, y + s, ramps.shift(base, -2)); if (hash(cx, y + s, 1) < 0.4) cx += hash(cx, s, 2) < 0.5 ? -1 : 1; }
        }
        x += bw; k++;
      }
      y += rh; row++;
    }

    // --- arched niche behind the slab: calm dressed stone, so the creature reads against it
    const NX0 = 178, NX1 = 302, NCY = 112, NR = 62;
    const inNiche = (x, yy) => x >= NX0 && x <= NX1 && yy <= 222 && (yy >= NCY || Math.hypot(x + 0.5 - 240.5, yy + 0.5 - NCY) <= NR + 0.5);
    pb.fn(NX0, NCY - NR - 1, NX1 + 1, 223, (x, yy) => {
      if (!inNiche(x, yy)) return undefined;
      const r = Math.floor((yy - 18) / 12), course = (yy - 18) % 12 === 0;
      const joint = ((x + (r & 1) * 17) % 34) === 0 && hash(r, Math.floor((x + (r & 1) * 17) / 34), 5) < 0.8;
      if (course || joint) return ST[1];
      return hash(r, Math.floor((x + (r & 1) * 17) / 34), 6) < 0.3 ? ST[3] : ST[2];
    });
    pb.light(ramps, NX0, NCY - NR, NX1 + 1, 223, (x, yy) => { // inner shadow near the arch and jambs
      if (!inNiche(x, yy)) return 0;
      const dTop = NR - Math.hypot(x + 0.5 - 240.5, Math.min(0, yy - NCY)), dSide = Math.min(x - NX0, NX1 - x);
      return -Math.max(0, 1.6 - Math.min(dTop, dSide) / 4);
    }, 4);
    // voussoirs, keystone, pilasters
    const nv = 13;
    for (let i = 0; i < nv; i++) {
      const a0 = (i / nv) * Math.PI + 0.012, a1 = ((i + 1) / nv) * Math.PI - 0.012, col = i === 6 ? ST[5] : hash(i, 1, 1) < 0.5 ? ST[4] : ST[3];
      pb.fn(160, NCY - NR - 12, 322, NCY + 1, (x, yy) => {
        const dx = x + 0.5 - 240.5, dy = yy + 0.5 - NCY, r = Math.hypot(dx, dy), a = Math.atan2(-dy, dx);
        if (r < NR + 1 || r > NR + 8 || a < a0 || a > a1) return undefined;
        return r > NR + 7 ? ramps.shift(col, 1) : r < NR + 2 ? ramps.shift(col, -1) : col;
      });
    }
    pb.rect(234, NCY - NR - 12, 13, 5, ST[4]); pb.hl(234, 246, NCY - NR - 12, ST[5]);
    for (const px of [NX0 - 8, NX1 + 1]) for (let yy = NCY; yy < 222; yy += 11) {
      pb.rect(px, yy, 8, 10, ST[3]); pb.hl(px, px + 7, yy, ST[4]); pb.vl(px + 7, yy, yy + 9, ST[2]); pb.hl(px, px + 7, yy + 10, ST[1]);
    }

    // --- damp: water streak under the leaky joint, moss clumps along the low mortar lines
    for (let yy = DRIP.y + 2, x = DRIP.x; yy < 222; yy++) {
      pb.set(x, yy, ramps.shift(pb.get(x, yy), -1)); pb.set(x + 1, yy, ramps.shift(pb.get(x + 1, yy), -1));
      if (hash(x, yy, 31) < 0.1) pb.set(x, yy, ramps.shift(pb.get(x, yy), 2));
      if (hash(yy, 3, 32) < 0.06) x += hash(yy, 4, 33) < 0.5 ? -1 : 1;
    }
    const ob = new PB(); // props layer (vignetted per pixel, then composited)
    // --- pipes, valve, gauge, chains, shelves + jars, tanks, control boxes
    const pipeH = (x0, x1, yy, r = 2) => {
      for (let x = x0; x <= x1; x++) { ob.set(x, yy - r, MT[3]); for (let j = -r + 1; j < r; j++) ob.set(x, yy + j, j < 0 ? MT[4] : j === 0 ? MT[3] : MT[2]); ob.set(x, yy + r, MT[1]); }
    };
    const pipeV = (x, y0, y1, r = 2) => {
      for (let yy = y0; yy <= y1; yy++) { ob.set(x - r, yy, MT[2]); for (let j = -r + 1; j < r; j++) ob.set(x + j, yy, j < 0 ? MT[4] : j === 0 ? MT[3] : MT[2]); ob.set(x + r, yy, MT[1]); }
    };
    const flangeV = (x, yy, r = 2) => { ob.rect(x - r - 1, yy, 2 * r + 3, 3, MT[3]); ob.hl(x - r - 1, x + r + 1, yy, MT[5]); ob.hl(x - r - 1, x + r + 1, yy + 2, MT[1]); ob.set(x - r, yy + 1, MT[1]); ob.set(x + r, yy + 1, MT[1]); };
    const flangeH = (x, yy, r = 2) => { ob.rect(x, yy - r - 1, 3, 2 * r + 3, MT[3]); ob.vl(x, yy - r - 1, yy + r + 1, MT[5]); ob.vl(x + 2, yy - r - 1, yy + r + 1, MT[1]); };
    pipeH(0, 170, 36); pipeV(130, 36, 222); flangeV(130, 72); flangeV(130, 168); flangeH(DRIP.x - 1, 36); flangeH(96, 36);
    ob.rect(166, 32, 6, 9, MT[2]); ob.vl(166, 32, 40, MT[4]); ob.vl(171, 32, 40, MT[1]);
    ob.set(DRIP.x - 2, 39, MT[1]); ob.set(DRIP.x + 2, 39, ST[5]); // rusty weep at the leaky joint
    // gate valve: body on the pipe + handwheel (seen edge-on)
    ob.rect(126, 116, 9, 10, MT[3]); ob.vl(126, 116, 125, MT[4]); ob.vl(134, 116, 125, MT[1]); ob.hl(126, 134, 125, MT[1]); ob.hl(126, 134, 116, MT[5]);
    ob.rect(129, 110, 3, 6, MT[2]); ob.vl(129, 110, 115, MT[4]);
    ob.rect(123, 107, 15, 3, C('q')); ob.hl(124, 136, 107, C('R')); ob.hl(123, 137, 109, C('Q')); ob.set(123, 107, C('Q')); ob.set(137, 107, C('Q')); ob.set(130, 108, C('k'));
    pipeH(306, W - 1, 36); flangeH(340, 36); flangeH(420, 36);
    ob.rect(308, 32, 6, 9, MT[2]); ob.vl(308, 32, 40, MT[4]); ob.vl(313, 32, 40, MT[1]);
    pipeV(356, 36, 222, 3); flangeV(356, 90, 3); flangeV(356, 180, 3);
    // pressure gauge hanging off the right pipe
    ob.vl(326, 39, 43, MT[2]); ob.disc(326, 50, 6, MT[1]); ob.disc(326, 50, 5, MT[4]); ob.disc(326, 50, 4, M('b', 'x', .35));
    for (let a = 0; a < 5; a++) { const ta = Math.PI * (0.85 + a * 0.33); ob.set(Math.round(326 + Math.cos(ta) * 3), Math.round(50 + Math.sin(ta) * 3), MT[1]); }
    ob.line(326, 50, 328, 47, C('q')); ob.set(326, 50, C('k')); ob.set(323, 47, C('e'));
    const chain = (x, y0, y1, hook) => {
      for (let yy = y0; yy <= y1; yy++) { const ph = (yy - y0) % 4; if (ph === 0 || ph === 2) ob.set(x, yy, MT[3]); else { ob.set(x - 1, yy, MT[2]); ob.set(x + 1, yy, MT[2]); } }
      if (hook) { ob.vl(x, y1, y1 + 5, MT[3]); ob.set(x + 1, y1 + 6, MT[3]); ob.set(x + 2, y1 + 5, MT[3]); ob.set(x + 3, y1 + 4, MT[4]); ob.set(x - 1, y1 + 6, MT[2]); ob.set(x, y1 + 7, MT[2]); ob.set(x + 1, y1 + 7, MT[2]); }
    };
    chain(336, 0, 112, true); chain(198, 0, 22, true); chain(283, 0, 16, true); chain(24, 0, 60, true); chain(456, 0, 78, true);
    const shelf = (x0, x1, yy) => { ob.rect(x0, yy, x1 - x0 + 1, 3, C('u')); ob.hl(x0, x1, yy, C('T')); ob.hl(x0, x1, yy + 2, C('U')); ob.rect(x0 + 2, yy + 3, 2, 4, C('U')); ob.rect(x1 - 3, yy + 3, 2, 4, C('U')); ob.hl(x0 + 1, x1 - 1, yy + 3, ST[1]); };
    const jars = [];
    const specimen = (kind, cx, cy) => {
      if (kind === 'eye') { ob.disc(cx, cy, 2, C('W')); ob.set(cx + 1, cy, C('q')); ob.set(cx + 1, cy - 1, C('k')); ob.set(cx - 1, cy - 1, C('w')); }
      if (kind === 'hand') { ob.rect(cx - 2, cy, 4, 4, C('g')); ob.vl(cx - 2, cy - 2, cy, C('g')); ob.vl(cx, cy - 3, cy, C('g')); ob.vl(cx + 1, cy - 2, cy, C('F')); ob.set(cx - 1, cy + 4, C('G')); }
      if (kind === 'brain') { ob.ell(cx, cy, 4, 3, C('F')); ob.hl(cx - 3, cx + 3, cy, C('g')); ob.set(cx - 2, cy - 2, C('g')); ob.set(cx + 1, cy + 2, C('g')); ob.set(cx - 2, cy - 1, C('f')); ob.vl(cx, cy + 4, cy + 6, C('g')); }
    };
    const jar = (x, yb, w, h, liquid, content) => { // glass jar standing on y = yb
      const y0 = yb - h;
      ob.rect(x + 1, y0, w - 2, 2, MT[3]); ob.hl(x + 1, x + w - 2, y0, MT[5]);
      ob.rect(x, y0 + 2, w, h - 2, C('k'));
      ob.rect(x + 1, y0 + 3, w - 2, h - 4, M('x', 'k', .3));
      const ly = y0 + 5;
      ob.rect(x + 1, ly, w - 2, yb - 1 - ly, liquid[0]); ob.hl(x + 1, x + w - 2, ly, liquid[1]);
      if (content) specimen(content, x + (w >> 1), ly + ((yb - ly) >> 1) - (content === 'hand' ? 1 : 0));
      ob.vl(x + 1, y0 + 3, yb - 3, C('E')); ob.set(x + 2, y0 + 4, C('e'));
      ob.hl(x, x + w - 1, yb - 1, C('k'));
      jars.push({ x: x + 2, y0: ly + 1, x1: x + w - 2, y1: yb - 2 });
    };
    const G1 = [C('Y'), C('D')], G2 = [C('D'), C('d')], G3 = [M('x', 'Y', .5), C('Y')];
    shelf(10, 112, 96); jar(16, 96, 11, 18, G1, 'eye'); jar(31, 96, 9, 14, G3); jar(44, 96, 13, 20, G2, 'hand'); jar(62, 96, 8, 12, G1); jar(75, 96, 12, 17, G3, 'brain'); jar(92, 96, 10, 15, G1);
    shelf(10, 112, 160); jar(18, 160, 12, 16, G3); jar(35, 160, 9, 12, G1, 'eye'); jar(50, 160, 14, 19, G1); jar(70, 160, 10, 14, G2); jar(86, 160, 12, 18, G3, 'hand');
    shelf(136, 166, 178); jar(139, 178, 11, 16, G2, 'eye'); jar(153, 178, 10, 12, G1);
    shelf(372, 472, 110); jar(378, 110, 12, 18, G1, 'brain'); jar(395, 110, 9, 13, G3); jar(409, 110, 12, 16, G2, 'eye'); jar(428, 110, 10, 12, G1); jar(444, 110, 13, 19, G3, 'hand'); jar(462, 110, 8, 11, G1);
    const tank = (x, yt, w, h, content) => {
      ob.rect(x, yt, w, 4, MT[2]); ob.hl(x, x + w - 1, yt, MT[4]); ob.rect(x, yt + h - 5, w, 5, MT[2]); ob.hl(x, x + w - 1, yt + h - 5, MT[4]);
      ob.rect(x + 1, yt + 4, w - 2, h - 9, M('x', 'k', .2));
      ob.rect(x + 2, yt + 8, w - 4, h - 14, C('Y')); ob.hl(x + 2, x + w - 3, yt + 8, C('D'));
      if (content === 'brain') { const cx = x + (w >> 1), cy = yt + (h >> 1); ob.ell(cx, cy, 5, 4, C('F')); ob.hl(cx - 4, cx + 4, cy, C('g')); ob.vl(cx, cy - 3, cy - 1, C('g')); ob.set(cx - 3, cy - 2, C('g')); ob.set(cx + 3, cy + 2, C('g')); ob.set(cx - 2, cy - 2, C('f')); ob.vl(cx, cy + 5, cy + 10, C('g')); }
      if (content === 'body') { const cx = x + (w >> 1), cy = yt + 22, bc = M('x', 'k', .3); ob.disc(cx, cy, 4, bc); ob.rect(cx - 4, cy + 5, 9, 18, bc); ob.rect(cx - 7, cy + 7, 3, 12, bc); ob.rect(cx + 5, cy + 7, 3, 12, bc); ob.rect(cx - 3, cy + 23, 3, 14, bc); ob.rect(cx + 1, cy + 23, 3, 14, bc); ob.set(cx - 2, cy, C('d')); ob.set(cx + 2, cy, C('d')); }
      ob.vl(x + 2, yt + 9, yt + h - 7, C('z')); ob.vl(x + 3, yt + 9, yt + h - 7, M('Y', 'z', .4));
      jars.push({ x: x + 4, y0: yt + 10, x1: x + w - 3, y1: yt + h - 7 });
    };
    tank(320, 184, 20, 39, 'brain');
    tank(384, 120, 44, 103, 'body');
    ob.rect(436, 136, 34, 44, MT[1]); ob.rect(437, 137, 32, 42, MT[2]); ob.hl(437, 468, 137, MT[3]);
    for (let i = 0; i < 3; i++) { ob.disc(446 + i * 10, 150, 3, C('k')); ob.disc(446 + i * 10, 150, 2, M('b', 'x', .4)); ob.set(446 + i * 10 + (i - 1), 149, C('q')); }
    ob.rect(440, 162, 26, 6, C('k'));
    ob.rect(444, 172, 3, 5, MT[4]); ob.rect(452, 170, 3, 7, MT[4]); ob.rect(460, 173, 3, 4, MT[4]);
    ob.rect(24, 184, 40, 30, MT[1]); ob.rect(25, 185, 38, 28, MT[2]); ob.hl(25, 62, 185, MT[3]); ob.disc(36, 198, 6, C('k')); ob.disc(36, 198, 5, M('b', 'x', .45)); ob.line(36, 198, 33, 194, C('q'));
    ob.rect(48, 192, 10, 3, C('k')); ob.rect(48, 200, 10, 3, C('k'));
    // drooping cables behind the side panels
    const cable = (x0, y0, x1, y1, sag, col) => { let px = x0, py = y0; for (let i = 1; i <= 40; i++) { const u = i / 40, cx = x0 + (x1 - x0) * u, cy = y0 + (y1 - y0) * u + sag * 4 * u * (1 - u); ob.line(px, py, cx, cy, col); px = cx; py = cy; } };
    cable(0, 58, 112, 44, 26, C('k')); cable(40, 40, 128, 40, 14, MT[1]); cable(360, 44, 480, 66, 22, C('k')); cable(436, 136, 470, 40, 10, MT[1]);

    const mossClump = (x, yy, w) => {
      for (let i = 0; i < w; i++) {
        const h = 1 + Math.floor(hash(x + i, yy, 41) * 3);
        ob.set(x + i, yy - 1, hash(x + i, yy, 42) < 0.5 ? MOSS[2] : MOSS[3]);
        for (let j = 0; j < h; j++) ob.set(x + i, yy + j, j === h - 1 ? MOSS[0] : MOSS[1]);
      }
    };
    for (let i = 0; i < 34; i++) {
      const x = Math.floor(R() * W), yy = 120 + Math.floor(Math.pow(R(), 0.6) * 100);
      if (inNiche(x, yy) || (x > NX0 - 10 && x < NX1 + 10 && yy > 100)) continue;
      if (pb.get(x, yy) !== ST[1] && pb.get(x, yy + 1) !== ST[1]) continue;
      mossClump(x, pb.get(x, yy) === ST[1] ? yy : yy + 1, 3 + Math.floor(R() * 7));
    }

    // --- lighting: vignette toward the edges, then the lamp's cone on the wall
    const LT = { x: 240, y: 27 };
    const coneHalf = (yy) => 14 + (yy - LT.y) * (86 - 14) / (212 - LT.y);
    ob.light(ramps, 0, 0, W, 224, vig, 3.5);
    pb.over(ob);
    pb.light(ramps, 140, LT.y, 341, 224, (x, yy) => {
      const u = Math.abs(x + 0.5 - 240.5) / coneHalf(yy);
      if (u > 1.05) return 0;
      const edge = u < 0.8 ? 1 : Math.max(0, 1 - (u - 0.8) / 0.25);
      const core = yy < 56 ? 1 : yy < 72 ? 1 - (yy - 56) / 16 : 0; // brighter just under the lamp
      return edge * (1 + core * 0.95);
    }, 3.5);

    // --- floor: flagstones in perspective + the lamp's light pool
    pb.rect(0, 222, W, 2, C('k')); pb.hl(0, W - 1, 224, ST[3]);
    const rows = [225, 228, 232, 237, 243, 250, 258, 267, 270];
    pb.fn(0, 225, W, H, (x, yy) => {
      let r = 0; while (rows[r + 1] <= yy) r++;
      const vpY = 150, sc = (270 - vpY) / (yy - vpY), sx = 240 + (x - 240) * sc;
      const off = sx + 1000 + (r % 2) * 22, lx = off % 44;
      if (yy === rows[r] || lx < sc * 0.9) return ST[1];
      const v = hash(Math.floor(off / 44), r, 44);
      return v < 0.35 ? ST[2] : v < 0.9 ? ST[3] : ST[4];
    });
    pb.light(ramps, 0, 225, W, H, (x, yy) => {
      const d = Math.hypot((x - 240) / 150, (yy - 246) / 24);
      const pool = d < 1 ? 2.2 * Math.pow(1 - d, 0.6) : 0;
      return pool - Math.min(2.2, Math.max(0, Math.abs(x - 240) - 110) / 55) - (yy > 258 ? 0.6 : 0);
    }, 3.5);
    pb.hl(DRIP.x - 5, DRIP.x + 5, DRIP.floor, ST[4]); pb.hl(DRIP.x - 3, DRIP.x + 4, DRIP.floor + 1, ST[4]); pb.hl(DRIP.x - 2, DRIP.x + 1, DRIP.floor, ST[6]);

    // --- the lamp: cable, cap, conical green shade, bright rim
    const lx = LAMP.x;
    pb.vl(lx, 0, 11, MT[3]); pb.vl(lx + 1, 0, 11, MT[1]);
    pb.rect(lx - 3, 11, 7, 3, MT[2]); pb.hl(lx - 3, lx + 3, 11, MT[4]);
    const shadeC = [M('x', 'k', .4), C('x'), M('x', 'Y', .5), C('Y')];
    for (let yy = 14; yy <= 25; yy++) {
      const hw = 6 + ((yy - 14) * 12) / 11;
      for (let x = Math.round(lx - hw); x <= Math.round(lx + hw); x++) {
        const u = (x - (lx - hw)) / (2 * hw);
        pb.set(x, yy, u < 0.12 ? shadeC[1] : u < 0.3 ? shadeC[3] : u < 0.42 ? shadeC[2] : u < 0.9 ? shadeC[1] : shadeC[0]);
      }
    }
    pb.hl(lx - 18, lx + 18, 25, MT[4]); pb.hl(lx - 18, lx + 18, 26, MT[2]); pb.hl(lx - 6, lx + 6, 14, shadeC[3]);
    pb.hl(lx - 7, lx + 7, 27, C('d')); pb.hl(lx - 5, lx + 5, 28, C('z'));

    // --- the slab (drawn lit)
    const S0 = SLAB;
    pb.fn(150, 238, 331, 246, (x, yy, c) => { const d = Math.hypot((x - 240) / 82, (yy - 241) / 4); return d < 1 && th8(x, yy) < 1.2 - d ? ramps.shift(c, -2) : undefined; });
    // plinth
    pb.rect(178, 235, 125, 6, ST[4]); pb.hl(178, 302, 235, ST[7]); pb.hl(179, 301, 236, ST[5]); pb.hl(179, 301, 240, ST[2]); pb.vl(178, 235, 240, ST[5]); pb.vl(302, 235, 240, ST[3]);
    // pedestal with a carved skull boss
    pb.rect(188, 223, 105, 12, ST[3]);
    pb.hl(188, 292, 223, ST[1]); pb.hl(188, 292, 224, ST[2]);
    pb.vl(188, 225, 234, ST[4]); pb.vl(292, 225, 234, ST[2]);
    for (const px of [198, 280]) { pb.rect(px, 226, 3, 8, ST[2]); pb.vl(px, 226, 233, ST[5]); }
    for (const [x0, x1] of [[206, 228], [252, 274]]) { pb.hl(x0, x1, 227, ST[2]); pb.hl(x0, x1, 231, ST[4]); pb.vl(x0, 227, 231, ST[2]); pb.vl(x1, 227, 231, ST[4]); }
    pb.stamp(['.bbbbb.', 'bcccccb', 'caacaac', 'caacaac', 'bcccccb', '.cacac.', '.bcbcb.'], 237, 225, { a: ST[1], b: ST[4], c: ST[6] });
    // front face of the table top
    pb.rect(S0.x0, 213, S0.x1 - S0.x0 + 1, 10, ST[4]);
    pb.hl(S0.x0, S0.x1, 213, ST[6]); pb.hl(S0.x0, S0.x1, 214, ST[5]); pb.hl(S0.x0, S0.x1, 222, ST[2]);
    pb.fn(S0.x0, 215, S0.x1 + 1, 222, (x, yy) => (yy > 218 && th8(x, yy) < (yy - 218) / 4 ? ST[3] : undefined));
    for (const sx of [214, 266]) { pb.vl(sx, 215, 221, ST[2]); pb.vl(sx + 1, 215, 221, ST[5]); }
    pb.vl(S0.x0, 213, 222, ST[6]); pb.vl(S0.x0 + 1, 214, 222, ST[5]); pb.vl(S0.x1, 213, 222, ST[3]);
    // leather restraint straps hanging over the front edge
    for (const sx of [186, 291]) {
      pb.rect(sx, 212, 4, 15, C('U')); pb.vl(sx, 212, 226, C('u')); pb.hl(sx, sx + 3, 227, C('k'));
      pb.rect(sx - 1, 216, 6, 4, C('I')); pb.rect(sx, 217, 4, 2, C('U')); pb.hl(sx - 1, sx + 4, 216, C('E')); pb.set(sx + 1, 217, C('i'));
      pb.set(sx + 1, 222, C('k')); pb.set(sx + 1, 224, C('k'));
    }
    // top surface (seen from above): back edge y 203 .. front lip y 212
    pb.poly([[S0.x0 + 7, 203], [S0.x1 - 6, 203], [S0.x1 + 1, 213], [S0.x0, 213]], ST[6]);
    pb.fn(S0.x0, 203, S0.x1 + 1, 213, (x, yy, c) => {
      if (c !== ST[6]) return undefined;
      const u = Math.abs(x - 240) / 75, f = 1.25 - u * 1.1 - (212 - yy) * 0.04;
      if (sharpen(f, 6) > th8(x, yy)) return ST[7];
      return u > 0.84 ? ST[5] : undefined;
    });
    pb.hl(S0.x0 + 12, S0.x1 - 11, 205, ST[5]); pb.hl(S0.x0 + 9, S0.x1 - 8, 210, ST[5]);
    pb.vl(S0.x0 + 11, 206, 209, ST[5]); pb.vl(S0.x1 - 10, 206, 209, ST[5]);
    pb.set(S0.x0 + 10, 210, ST[1]); pb.set(S0.x1 - 9, 210, ST[1]);
    for (let i = 0; i < 26; i++) { const x = 180 + Math.floor(R() * 120), yy = 206 + Math.floor(R() * 4); if (pb.get(x, yy) === ST[7]) pb.set(x, yy, ST[6]); }
    pb.hl(S0.x0 + 7, S0.x1 - 6, 203, ST[5]);
    pb.hl(S0.x0, S0.x1, 212, C('d')); pb.hl(S0.x0 + 1, S0.x1 - 1, 213, ST[8]);
    pb.line(S0.x0, 212, S0.x0 + 7, 203, ST[8]); pb.line(S0.x1, 212, S0.x1 - 6, 203, ST[7]);

    // --- soft light sprites (additive, animated)
    const cone = newCanvas(W, H), g = cone.getContext('2d');
    const grd = g.createLinearGradient(0, 26, 0, 222);
    grd.addColorStop(0, 'rgba(155,227,143,0.55)'); grd.addColorStop(1, 'rgba(79,174,108,0.1)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(228, 27); g.lineTo(252, 27); g.lineTo(326, 214); g.lineTo(154, 214); g.closePath(); g.fill();
    const motes = [];
    for (let i = 0; i < 22; i++) motes.push({ x: 200 + R() * 80, y: 40 + R() * 160, sp: 2 + R() * 4, ph: R() * 6.28, amp: 3 + R() * 6 });
    return {
      base: pb.canvas(), cone, motes, jars,
      lampGlow: glowSprite(46, 30, 'd', 0.6), poolGlow: glowSprite(120, 16, 'D', 0.5), jarGlow: glowSprite(12, 14, 'D', 0.5),
      cols: { drop: css(C('z')), drop2: css(M('d', 'Y', .4)), bub: css(C('z')), mote: css(C('d')), bulb: css(C('j')), bulb2: css(C('d')), bulbDim: css(M('Y', 'd', .5)), led: [css(C('a')), css(C('D')), css(C('L'))], ledOff: css(C('k')), puddle: css(ST[6]) },
      leds: [[443, 164], [447, 164], [451, 164], [455, 164], [459, 164], [463, 164], [51, 193], [54, 201]],
    };
  }

  function lab(ctx, t, opts = {}) {
    t = +t || 0;
    const S = LB.S || (LB.S = buildLab());
    const surge = opts.surge || 0;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(S.base, 0, 0);
    const fl = opts.flicker === false ? 1 : flicker(t, 11, 9, 0.03);
    // lamp light: additive cone + bulb glow + floor pool (surge = "bring to life" flash, 0..1)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, 0.09 * fl + 0.4 * surge);
    ctx.drawImage(S.cone, 0, 0);
    ctx.globalAlpha = Math.max(0, 0.45 * fl + 0.5 * surge);
    ctx.drawImage(S.lampGlow, LAMP.x - 46, 27 - 30);
    ctx.globalAlpha = Math.max(0, 0.16 * fl + 0.3 * surge);
    ctx.drawImage(S.poolGlow, 240 - 120, 244 - 16);
    S.jars.forEach((j, i) => { // jar glows, gently out of phase
      ctx.globalAlpha = 0.1 + 0.05 * Math.sin(t * 1.3 + i * 1.7);
      ctx.drawImage(S.jarGlow, ((j.x + j.x1) >> 1) - 12, ((j.y0 + j.y1) >> 1) - 14);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = fl < 0.8 ? S.cols.bulbDim : S.cols.bulb;
    ctx.fillRect(LAMP.x - 4, 27, 9, 1);
    ctx.fillStyle = fl < 0.8 ? S.cols.bulbDim : S.cols.bulb2;
    ctx.fillRect(LAMP.x - 2, 28, 5, 1);
    // dust motes drifting down through the cone
    ctx.fillStyle = S.cols.mote;
    for (const m of S.motes) {
      const yy = 40 + ((m.y - 40 + t * m.sp) % 170), xx = m.x + Math.sin(t * 0.6 + m.ph) * m.amp;
      if (Math.abs(xx - 240) > (14 + (yy - 27) * (72 / 185)) * 0.8) continue;
      ctx.globalAlpha = Math.max(0, 0.25 + 0.25 * Math.sin(t * 1.7 + m.ph));
      ctx.fillRect(Math.round(xx), Math.round(yy), 1, 1);
    }
    ctx.globalAlpha = 1;
    // bubbles rising in the jars
    ctx.fillStyle = S.cols.bub;
    S.jars.forEach((j, i) => {
      const h = j.y1 - j.y0;
      if (h < 4) return;
      for (let b = 0; b < 2; b++) {
        const sp = 5 + ((i * 7 + b * 3) % 5), yy = j.y1 - ((t * sp + hash(i, b, 3) * h) % h);
        const xx = j.x + Math.floor(hash(i, b, 4) * (j.x1 - j.x)) + (Math.sin(t * 3 + b + i) > 0.6 ? 1 : 0);
        if (xx < j.x1) ctx.fillRect(xx, Math.round(yy), 1, 1);
      }
    });
    // leaky joint: a drop swells, falls, splashes in the puddle
    const P = 2.3, u = ((t % P) + P) % P;
    ctx.fillStyle = S.cols.drop;
    if (u < 1.2) { ctx.fillRect(DRIP.x, DRIP.y, 1, 1); if (u > 0.6) ctx.fillRect(DRIP.x, DRIP.y + 1, 1, 1); }
    else {
      const fall = u - 1.2, yy = DRIP.y + 2 + 0.5 * 420 * fall * fall;
      if (yy < DRIP.floor) { ctx.fillRect(DRIP.x, Math.round(yy), 1, 2); ctx.fillStyle = S.cols.drop2; ctx.fillRect(DRIP.x, Math.round(yy) - 2, 1, 2); }
      else {
        const s = (yy - DRIP.floor) / 60;
        if (s < 1) {
          const sp = Math.round(1 + s * 4), up = Math.round(Math.sin(s * Math.PI) * 3);
          ctx.fillRect(DRIP.x - sp, DRIP.floor - up, 1, 1); ctx.fillRect(DRIP.x + sp, DRIP.floor - up, 1, 1);
          ctx.fillStyle = S.cols.puddle; ctx.fillRect(DRIP.x - sp - 2, DRIP.floor + 1, 1, 1); ctx.fillRect(DRIP.x + sp + 2, DRIP.floor + 1, 1, 1);
        }
      }
    }
    // indicator lamps on the control boxes
    S.leds.forEach(([x, y2], i) => {
      const on = Math.sin(t * (1.1 + (i % 4) * 0.7) + i * 2.3) > (i % 3 === 0 ? -0.2 : 0.4);
      ctx.fillStyle = on ? S.cols.led[i % 3] : S.cols.ledOff;
      ctx.fillRect(x, y2, 1, 1);
    });
    ctx.restore();
  }

  // ===========================================================================
  // SHOP — "The Good Parts"
  // ===========================================================================
  const SH = { S: null };
  const COUNTER_Y = 196;
  const LANTERN = { x: 360, y: 26 };

  function buildShop() {
    const R = rng(0x5409);
    const pb = new PB();
    const ramps = new Ramps();
    // plum-brown wood wall (dark -> lantern-warm)
    const PW = ramps.add([C('k'), C('K'), M('1', 'U', .45), M('2', 'U', .45), M('2', 'u', .45), M('3', 'u', .5), M('4', 'T', .45), M('T', 'g', .4), M('t', 'A', .4)]);
    // warm wood (shelves, counter, beam)
    const WD = ramps.add([C('k'), C('U'), M('U', 'u', .5), C('u'), M('u', 'T', .5), C('T'), C('t'), M('t', 'l', .35)]);
    // paper (muted, so the scene's dark text reads)
    const PP = ramps.add([M('n', 'h', .35), M('B', '5', .45), M('b', '5', .4), M('b', '5', .22), M('W', '5', .12)]);
    ramps.add([C('N'), C('n'), C('B'), C('b'), C('W'), C('w')]);
    ramps.add([C('k'), C('I'), C('i'), C('E'), C('e')]);
    ramps.add([C('Q'), C('q'), C('R'), C('r')]);
    ramps.add([C('O'), C('o'), C('P'), C('p')]);
    ramps.add([C('x'), C('Y'), C('y'), C('Z')]);
    ramps.add([C('V'), C('v'), C('C'), C('c')]);
    ramps.add([C('M'), C('m'), C('L'), C('l')]);

    // --- plank wall: beam, vertical boards, chair rail, wainscot, baseboard
    pb.rect(0, 0, W, 250, PW[3]);
    const calm = (x, y) => x > 244 && x < 356 && y > 96; // behind the Reaper: keep it plain
    let x = 0, k = 0;
    while (x < W) {
      const pw = 12 + Math.floor(hash(k, 0, 1) * 5);
      const v = hash(k, 1, 1), base = v < 0.3 ? PW[3] : v < 0.85 ? PW[4] : PW[3];
      pb.rect(x, 7, pw, 161, base);
      pb.vl(x, 7, 167, PW[1]); pb.vl(x + 1, 7, 167, ramps.shift(base, 1));
      for (let s = 0; s < 6; s++) { // grain streaks
        const gx = x + 3 + Math.floor(hash(k, s, 2) * (pw - 4)), gy = 9 + Math.floor(hash(k, s, 3) * 150), gl = 4 + Math.floor(hash(k, s, 4) * 16);
        if (calm(gx, gy)) continue;
        pb.vl(gx, gy, Math.min(166, gy + gl), ramps.shift(base, hash(k, s, 5) < 0.65 ? -1 : 1));
      }
      if (hash(k, 9, 6) < 0.45) { // knot
        const kx = x + 3 + Math.floor(hash(k, 9, 7) * (pw - 6)), ky = 16 + Math.floor(hash(k, 9, 8) * 140);
        if (!calm(kx, ky)) { pb.ell(kx, ky, 1, 2, ramps.shift(base, -1)); pb.set(kx, ky - 3, ramps.shift(base, 1)); pb.set(kx, ky + 3, ramps.shift(base, -1)); }
      }
      pb.set(x + 3, 10, PW[5]); pb.set(x + 3, 11, PW[1]); pb.set(x + pw - 3, 164, PW[5]); pb.set(x + pw - 3, 165, PW[1]);
      x += pw; k++;
    }
    pb.rect(0, 0, W, 6, WD[1]); pb.hl(0, W - 1, 3, WD[2]); pb.hl(0, W - 1, 5, WD[3]); pb.hl(0, W - 1, 6, PW[0]);
    for (let bx = 14; bx < W; bx += 41) { pb.set(bx, 4, WD[4]); pb.set(bx + 1, 4, WD[1]); }
    pb.rect(0, 168, W, 4, WD[2]); pb.hl(0, W - 1, 168, WD[4]); pb.hl(0, W - 1, 171, PW[0]); pb.hl(0, W - 1, 172, PW[1]);
    pb.rect(0, 173, W, 71, PW[2]);
    for (let px = 4; px < W; px += 48) {
      pb.rect(px, 180, 40, 58, PW[3]); pb.hl(px, px + 39, 180, PW[1]); pb.vl(px, 180, 237, PW[1]); pb.hl(px + 1, px + 39, 237, PW[4]); pb.vl(px + 39, 181, 237, PW[4]);
    }
    pb.rect(0, 244, W, 6, WD[1]); pb.hl(0, W - 1, 244, WD[3]); pb.hl(0, W - 1, 249, C('k'));
    // corner post between the shelves and the poster
    pb.rect(393, 7, 7, 161, WD[2]); pb.vl(393, 7, 167, WD[4]); pb.vl(394, 7, 167, WD[3]); pb.vl(399, 7, 167, WD[1]);
    for (const py of [20, 90, 150]) { pb.set(396, py, WD[5]); pb.set(397, py + 1, WD[1]); }
    // floor boards (under the claw machine)
    const frow = [250, 253, 257, 262, 268, 270];
    pb.fn(0, 250, W, H, (xx, yy) => {
      let r = 0; while (frow[r + 1] <= yy) r++;
      if (yy === frow[r] || ((xx + r * 29) % 61) === 0) return C('k');
      const base = hash(Math.floor((xx + r * 29) / 61), r, 12) < 0.5 ? WD[1] : WD[2];
      return yy === frow[r] + 1 ? ramps.shift(base, 1) : base;
    });

    // --- bunting: sagging strings with alternating pennants
    const flagCols = [[C('q'), C('R'), C('Q')], [C('o'), C('P'), C('O')], [C('B'), C('b'), C('n')], [C('Y'), C('y'), C('x')]];
    const bunt = (x0, y0, x1, y1, sag, off) => {
      const yAt = (xx) => { const u = (xx - x0) / (x1 - x0); return y0 + (y1 - y0) * u + sag * 4 * u * (1 - u); };
      for (let xx = x0; xx <= x1; xx++) pb.set(xx, Math.round(yAt(xx)), C('N'));
      let n = off;
      for (let fx = x0 + 6; fx < x1 - 4; fx += 13) {
        if (Math.abs(fx + 3 - LANTERN.x) < 9) continue;
        const [c0, c1, c2] = flagCols[n++ % flagCols.length], ty = Math.round(yAt(fx + 3)) + 1;
        for (let j = 0; j < 8; j++) {
          const hw = 3.5 * (1 - j / 8);
          for (let i = Math.round(-hw); i <= Math.round(hw) - 1; i++) pb.set(fx + 3 + i, ty + j, i === Math.round(-hw) ? c1 : i === Math.round(hw) - 1 ? c2 : c0);
        }
        pb.set(fx + 3, ty + 2, c2); pb.set(fx + 2, ty + 2, c2);
      }
    };
    bunt(0, 10, 206, 8, 10, 0); bunt(206, 8, W - 1, 11, 12, 2);
    // --- lighting: warm lantern pool (right), candle glow at the counter's left end, a soft
    //     back-light behind the Reaper; the machine's wall on the left stays dark
    pb.light(ramps, 0, 0, W, H, (xx, yy) => {
      const dl = Math.hypot(xx - LANTERN.x, (yy - 30) * 1.15);
      let I = dl < 112 ? 2.3 * Math.pow(1 - dl / 112, 1.1) : 0;
      const dr = Math.hypot((xx - 300) / 64, (yy - 150) / 52);
      if (dr < 1) I += 0.9 * (1 - dr);
      const dc = Math.hypot(xx - 214, (yy - 184) * 1.2);
      if (dc < 46) I += 0.9 * (1 - dc / 46);
      if (xx < 198) I -= 0.9 + ((198 - xx) / 198) * 0.5;
      if (yy > 200) I -= Math.min(1.2, (yy - 200) / 40);
      return I;
    }, 3.2);


    // --- shelf unit with wares (x 202..390, y 28..110)
    const SX0 = 202, SX1 = 390;
    pb.rect(SX0 + 3, 31, SX1 - SX0 - 5, 76, PW[2]);
    pb.light(ramps, SX0 + 3, 31, SX1 - 2, 107, (xx, yy) => (yy < 36 || (yy > 62 && yy < 68) ? -1 : 0));
    const board = (yy) => { pb.rect(SX0, yy, SX1 - SX0 + 1, 4, WD[3]); pb.hl(SX0, SX1, yy, WD[5]); pb.hl(SX0, SX1, yy + 1, WD[4]); pb.hl(SX0, SX1, yy + 3, WD[1]); pb.hl(SX0 + 3, SX1 - 3, yy + 4, PW[0]); };
    pb.rect(SX0, 28, 4, 82, WD[2]); pb.vl(SX0, 28, 109, WD[4]); pb.rect(SX1 - 3, 28, 4, 82, WD[2]); pb.vl(SX1, 28, 109, WD[1]); pb.vl(SX1 - 3, 28, 109, WD[3]);
    board(28); board(60); board(94); pb.rect(SX0, 106, SX1 - SX0 + 1, 4, WD[2]); pb.hl(SX0, SX1, 106, WD[4]); pb.hl(SX0, SX1, 109, WD[0]);
    // item painters (base line yb = top of board, items occupy y < yb)
    const glassJar = (xx, yb, w, h, liq, content) => {
      const y0 = yb - h;
      pb.rect(xx + 1, y0, w - 2, 3, C('n')); pb.hl(xx + 1, xx + w - 2, y0, C('b')); pb.hl(xx + 1, xx + w - 2, y0 + 2, C('N'));
      pb.rect(xx, y0 + 3, w, h - 3, C('k'));
      pb.rect(xx + 1, y0 + 4, w - 2, h - 5, liq[0]);
      pb.hl(xx + 1, xx + w - 2, y0 + 4, M('k', 'i', .5));
      pb.hl(xx + 1, xx + w - 2, y0 + 6, liq[1]);
      const cx = xx + (w >> 1), cy = y0 + 6 + ((h - 7) >> 1);
      if (content === 'eye') { pb.disc(cx, cy, 2, C('w')); pb.set(cx, cy, C('v')); pb.set(cx + 1, cy, C('k')); pb.set(cx - 1, cy - 1, C('j')); }
      if (content === 'heart') { pb.disc(cx - 1, cy - 1, 1, C('R')); pb.disc(cx + 1, cy - 1, 1, C('R')); pb.hl(cx - 2, cx + 2, cy, C('q')); pb.hl(cx - 1, cx + 1, cy + 1, C('q')); pb.set(cx, cy + 2, C('Q')); pb.set(cx - 2, cy - 2, C('r')); }
      if (content === 'hand') { pb.rect(cx - 2, cy, 4, 4, C('F')); pb.vl(cx - 2, cy - 3, cy, C('F')); pb.vl(cx - 1, cy - 4, cy, C('f')); pb.vl(cx + 1, cy - 3, cy, C('F')); pb.set(cx + 2, cy + 1, C('F')); pb.hl(cx - 2, cx + 1, cy + 4, C('g')); }
      if (content === 'fish') { pb.hl(cx - 2, cx + 2, cy, C('E')); pb.hl(cx - 1, cx + 1, cy - 1, C('E')); pb.set(cx + 3, cy - 1, C('i')); pb.set(cx + 3, cy + 1, C('i')); pb.set(cx - 1, cy, C('k')); }
      pb.vl(xx + 1, y0 + 5, yb - 3, M('i', 'e', .3)); pb.set(xx + 2, y0 + 5, C('e'));
      pb.hl(xx, xx + w - 1, yb - 1, C('k'));
    };
    const flask = (cx, yb, r, liq) => { // round potion
      const cy = yb - r - 1;
      pb.disc(cx, cy, r + 1, C('k')); pb.disc(cx, cy, r, liq[0]); pb.fn(cx - r, cy - r, cx + r + 1, cy + 1, (xx, yy, c) => (c === liq[0] && yy < cy - r * 0.2 ? M('k', 'i', .35) : undefined));
      pb.hl(cx - r + 1, cx + r - 1, Math.round(cy - r * 0.2), liq[1]);
      pb.rect(cx - 1, cy - r - 4, 3, 4, C('k')); pb.vl(cx, cy - r - 4, cy - r, M('i', 'e', .3)); pb.rect(cx - 1, cy - r - 6, 3, 2, C('n')); pb.set(cx - 1, cy - r - 6, C('b'));
      pb.set(cx - Math.round(r * 0.5), cy - Math.round(r * 0.1), C('j'));
    };
    const bottle = (xx, yb, w, h, liq) => {
      const y0 = yb - h;
      pb.rect(xx, y0 + 6, w, h - 6, C('k')); pb.rect(xx + 1, y0 + 7, w - 2, h - 8, liq[0]); pb.hl(xx + 1, xx + w - 2, y0 + 10, liq[1]);
      pb.rect(xx + (w >> 1) - 1, y0 + 1, 3, 6, C('k')); pb.vl(xx + (w >> 1), y0 + 2, y0 + 6, liq[0]);
      pb.rect(xx + (w >> 1) - 1, y0, 3, 2, C('n')); pb.vl(xx + 1, y0 + 8, yb - 3, M(liq[0] === C('x') ? 'Y' : 'i', 'e', .4));
    };
    const bookUp = (xx, yb, w, h, c) => {
      pb.rect(xx, yb - h, w, h, c[0]); pb.vl(xx, yb - h, yb - 1, c[1]); pb.vl(xx + w - 1, yb - h, yb - 1, c[2]);
      pb.hl(xx, xx + w - 1, yb - h + 2, C('m')); pb.hl(xx, xx + w - 1, yb - 4, C('m')); pb.hl(xx, xx + w - 1, yb - h, c[1]);
    };
    const bookFlat = (xx, yb, w, h, c) => { pb.rect(xx, yb - h, w, h, c[0]); pb.hl(xx, xx + w - 1, yb - h, c[1]); pb.vl(xx + w - 1, yb - h, yb - 1, C('W')); pb.vl(xx + w - 2, yb - h + 1, yb - 1, C('b')); pb.hl(xx, xx + w - 1, yb - 1, c[2]); };
    const skullRows = ['..kkkkk..', '.kWWWWWk.', 'kWwwWWWbk', 'kWwWWWWbk', 'kkkWbkkbk', 'kkkWbkkBk', 'kWWbkbWBk', '.kWbWbBk.', '..kbkbk..', '...kkk...'];
    const candle = (cx, yb, h) => { pb.rect(cx - 1, yb - h, 3, h, C('W')); pb.vl(cx + 1, yb - h, yb - 1, C('b')); pb.set(cx - 1, yb - h + 2, C('w')); pb.set(cx - 2, yb - h + 1, C('W')); pb.hl(cx - 2, cx + 2, yb - 1, C('n')); pb.set(cx, yb - h - 1, C('k')); };
    const CB = [C('q'), C('R'), C('Q')], CV = [C('V'), C('v'), M('V', 'k', .4)], CG = [C('Y'), C('y'), C('x')], CM = [C('M'), C('m'), C('U')], CO = [C('O'), C('o'), M('O', 'k', .4)], CN = [C('n'), C('B'), C('N')];
    const LG = [C('x'), C('Y')], LP = [C('O'), C('o')], LR = [C('Q'), C('q')], LC = [C('V'), C('v')], LB2 = [M('x', 'D', .4), C('D')];
    // top shelf (items stand on y = 60)
    glassJar(210, 60, 12, 17, LG, 'eye');
    bookUp(226, 60, 4, 15, CB); bookUp(230, 60, 3, 13, CV); bookUp(233, 60, 4, 16, CG);
    bookFlat(239, 60, 14, 3, CM); bookFlat(240, 57, 12, 3, CO);
    pb.stamp(skullRows, 256, 50);
    candle(271, 60, 8);
    flask(283, 60, 5, LP);
    bottle(292, 60, 6, 20, LG);
    // hourglass
    pb.hl(302, 310, 45, C('u')); pb.hl(302, 310, 59, C('u')); pb.vl(302, 46, 58, C('U')); pb.vl(310, 46, 58, C('U'));
    for (let j = 0; j < 6; j++) { pb.hl(304 + (j >> 1), 308 - (j >> 1), 47 + j, j < 2 ? C('b') : M('k', 'i', .4)); pb.hl(304 + (j >> 1), 308 - (j >> 1), 57 - j, j < 3 ? C('b') : M('k', 'i', .4)); }
    pb.set(306, 53, C('b'));
    glassJar(314, 60, 13, 18, LB2, 'hand');
    bottle(330, 60, 5, 12, LC);
    bookUp(337, 60, 4, 14, CN); bookUp(341, 60, 3, 16, CB); bookUp(344, 60, 4, 12, CO);
    // mortar & pestle under the lantern
    pb.rect(352, 54, 11, 6, C('i')); pb.hl(352, 362, 54, C('E')); pb.rect(353, 59, 9, 1, C('I')); pb.line(360, 47, 364, 53, C('b'));
    glassJar(372, 60, 12, 16, LR, 'heart');
    // bottom shelf (items stand on y = 94)
    bookFlat(210, 94, 16, 3, CV); bookFlat(211, 91, 14, 3, CB); bookFlat(213, 88, 11, 3, CG);
    flask(233, 94, 4, LR);
    glassJar(242, 94, 12, 16, LG, 'fish');
    // rolled scroll
    pb.rect(258, 88, 14, 5, C('b')); pb.hl(258, 271, 88, C('W')); pb.hl(258, 271, 92, C('B')); pb.vl(258, 88, 92, C('W')); pb.vl(271, 88, 92, C('n')); pb.rect(264, 88, 2, 5, C('q'));
    // small skull
    pb.stamp(['.kkkkk.', 'kWWWWbk', 'kkWkkbk', 'kkWkkBk', 'kWbkbBk', '.kbbbk.', '..kkk..'], 275, 87);
    bottle(286, 94, 5, 14, LB2); bottle(292, 94, 4, 10, LP);
    // femur
    pb.hl(300, 316, 91, C('W')); pb.hl(300, 316, 92, C('b')); pb.disc(300, 91, 1, C('W')); pb.disc(316, 91, 1, C('b')); pb.set(299, 90, C('w')); pb.set(317, 93, C('B'));
    flask(324, 94, 4, LC);
    candle(334, 94, 6); candle(338, 94, 9); candle(342, 94, 5);
    glassJar(348, 94, 11, 15, LB2, 'eye');
    bookUp(364, 94, 4, 17, CG); bookUp(368, 94, 3, 15, CM); bookUp(371, 94, 4, 16, CV); bookUp(376, 94, 3, 12, CB);
    pb.poly([[380, 94], [380, 82], [385, 79], [385, 94]], C('n')); pb.line(380, 82, 385, 79, C('b')); // leaning book
    // candle flame positions (animated)
    const flames = [[271, 51], [334, 87], [338, 84], [342, 88]];

    // --- cobwebs in the corners
    const web = (cx, cy, dx, dy, r, col) => {
      const at = (rr, a) => [Math.round(cx + dx * Math.cos(a) * rr), Math.round(cy + dy * Math.sin(a) * rr)];
      for (let a = 0; a <= 4; a++) { const [ex, ey] = at(r, (a / 4) * Math.PI / 2); pb.line(cx, cy, ex, ey, col); }
      for (const rr of [r * 0.4, r * 0.72, r]) for (let a = 0; a < 4; a++) {
        const [x0, y0] = at(rr, (a / 4) * Math.PI / 2), [x1, y1] = at(rr * 0.9, ((a + 0.5) / 4) * Math.PI / 2), [x2, y2] = at(rr, ((a + 1) / 4) * Math.PI / 2);
        pb.line(x0, y0, x1, y1, col); pb.line(x1, y1, x2, y2, col);
      }
    };
    web(205, 32, 1, 1, 11, M('4', 'b', .25)); web(386, 66, -1, 1, 7, M('4', 'b', .35)); web(W - 1, 7, -1, 1, 13, M('3', 'b', .2));
    // --- poster (x 404..470, y 44..116): aged paper, nails, stains, torn + curled corners
    const PX0 = 404, PX1 = 470, PY0 = 44, PY1 = 116;
    pb.rect(PX0 + 2, PY0 + 2, PX1 - PX0 + 1, PY1 - PY0 + 1, PW[1]); // drop shadow
    const torn = (xx, yy) => xx > PX1 - 9 && yy > PY1 - 9 && (xx - (PX1 - 9)) + (yy - (PY1 - 9)) > 8;
    pb.fn(PX0, PY0, PX1 + 1, PY1 + 1, (xx, yy) => {
      if (torn(xx, yy)) return undefined;
      const ex = Math.min(xx - PX0, PX1 - xx, yy - PY0, PY1 - yy);
      const n = fbm(xx * 0.06, yy * 0.06, 55, 2);
      const f = 2.4 + (n - 0.5) * 0.55 + (1 - (xx - PX0) / 66) * 0.4 - (ex < 2 ? 1 : 0);
      const i = Math.floor(f);
      return PP[Math.max(0, Math.min(PP.length - 1, i + (sharpen(f - i, 5) > th8(xx, yy) ? 1 : 0)))];
    });
    // stains kept to the corners so the scene's text area (x 408..466, y 50..112) stays clean
    const onPaper = (xx, yy) => xx > PX0 && xx < PX1 && yy > PY0 && yy < PY1 && !torn(xx, yy);
    for (let a = 0; a < 70; a++) {
      const ta = (a / 70) * Math.PI * 2, sx = Math.round(PX1 - 9 + Math.cos(ta) * 5), sy = Math.round(PY0 + 7 + Math.sin(ta) * 4);
      if (hash(a, 1, 9) < 0.7 && onPaper(sx, sy)) pb.set(sx, sy, PP[1]);
    }
    pb.vl(PX0 + 2, PY1 - 16, PY1 - 8, PP[1]); pb.vl(PX0 + 3, PY1 - 13, PY1 - 10, PP[1]);
    pb.hl(PX0 + 20, PX0 + 26, PY1 - 1, PP[1]); pb.set(PX0 + 23, PY1 - 2, PP[1]);
    pb.hl(PX0 + 2, PX1 - 2, PY0 + 1, PP[4]);
    pb.poly([[PX0, PY1 - 5], [PX0 + 6, PY1 + 1], [PX0, PY1 + 1]], PW[1]); pb.line(PX0, PY1 - 5, PX0 + 5, PY1, PP[4]); pb.line(PX0 + 1, PY1 - 3, PX0 + 3, PY1 - 1, PP[3]);
    pb.line(PX1 - 9, PY1, PX1, PY1 - 9, PP[0]);
    for (const [nx, ny] of [[PX0 + 3, PY0 + 3], [PX1 - 3, PY0 + 3], [PX1 - 3, PY1 - 14]]) { pb.rect(nx - 1, ny - 1, 2, 2, C('i')); pb.set(nx - 1, ny - 1, C('e')); pb.set(nx, ny, C('I')); pb.set(nx + 1, ny + 1, PP[0]); }

    // --- hanging lantern (housing; flame animated per frame)
    const LX = LANTERN.x;
    for (let yy = 7; yy <= 12; yy++) pb.set(LX, yy, yy % 2 ? C('i') : C('I'));
    pb.set(LX - 1, 13, C('I')); pb.set(LX + 1, 13, C('I')); pb.set(LX, 14, C('i'));
    pb.poly([[LX - 6, 20], [LX - 3, 15], [LX + 4, 15], [LX + 7, 20]], C('I')); pb.hl(LX - 2, LX + 2, 15, C('i')); pb.hl(LX - 6, LX + 6, 19, C('i'));
    pb.rect(LX - 6, 20, 13, 14, C('k'));
    pb.rect(LX - 5, 21, 11, 12, M('m', 'M', .3));
    pb.rect(LX - 3, 22, 7, 10, C('m'));
    pb.vl(LX - 6, 20, 33, C('I')); pb.vl(LX + 6, 20, 33, C('I')); pb.vl(LX, 20, 33, C('I'));
    pb.vl(LX - 5, 21, 32, C('A'));
    pb.rect(LX - 7, 33, 15, 3, C('I')); pb.hl(LX - 7, LX + 7, 33, C('i')); pb.rect(LX - 3, 36, 7, 2, C('I')); pb.set(LX, 38, C('I'));

    // --- barrel of spare bones behind the counter (far right)
    const BX0 = 441, BX1 = 477, BY0 = 160;
    for (let yy = BY0 + 2; yy < 212; yy++) { // (continues behind the counter)
      const bulge = Math.round(1.6 * Math.sin(((yy - BY0) / 52) * Math.PI));
      const x0 = BX0 - bulge, x1 = BX1 + bulge;
      for (let xx = x0; xx <= x1; xx++) {
        const u = (xx - x0) / (x1 - x0), sv = u * 7;
        let c = u < 0.1 ? WD[1] : u < 0.25 ? WD[3] : u < 0.5 ? WD[4] : u < 0.8 ? WD[3] : u < 0.92 ? WD[2] : WD[1];
        if (sv - Math.floor(sv) < 0.12 && u > 0.05 && u < 0.95) c = ramps.shift(c, -1);
        pb.set(xx, yy, c);
      }
    }
    for (const hy of [167, 184, 202]) { pb.hl(BX0 - 2, BX1 + 2, hy, C('i')); pb.hl(BX0 - 2, BX1 + 2, hy + 1, C('I')); pb.hl(BX0 - 1, BX1 + 1, hy + 2, WD[1]); pb.set(BX0 + 6, hy, C('e')); }
    // bones sticking out of the open top
    const bone = (x0, y0, x1, y1) => { // 2px shaft + double-knobbed end
      pb.line(x0, y0, x1, y1, C('W')); pb.line(x0 + 1, y0, x1 + 1, y1, C('b')); pb.line(x0 + 2, y0 + 1, x1 + 2, y1 + 1, C('B'));
      pb.stamp(['.ww.', 'wWWb', 'WWbB', '.bB.'], x1 - 1, y1 - 3);
    };
    bone(469, 160, 473, 146); bone(444, 160, 441, 149);
    pb.line(462, 160, 464, 152, C('b')); pb.line(463, 160, 465, 152, C('B')); pb.stamp(['.W.', 'WbB'], 463, 150);
    pb.stamp(['..kkkkk..', '.kWWWWWk.', 'kWwWWWWbk', 'kWWWWWbBk', 'kkkWbkkBk', 'kkkWbkkBk', '.kWbkbWk.', '..kbbbk..'], 450, 153);
    pb.ell(459, BY0 + 1, 19, 2, WD[4]); pb.ell(459, BY0 + 1, 17, 1, C('k')); pb.hl(441, 477, BY0 + 3, WD[2]);
    pb.hl(451, 457, BY0 + 1, C('B')); pb.set(454, BY0, C('b'));

    // --- the claw machine's pink neon spilling onto the wall/floor around the cabinet
    const pinkT = new Map();
    const tintPink = (c, f) => { const key = c * 8 + Math.round(f * 7); let v = pinkT.get(key); if (v === undefined) { v = mixU(c, C('R'), f); pinkT.set(key, v); } return v; };
    pb.fn(0, 0, 222, H, (xx, yy, c) => {
      const vy = clamp01((yy - 8) / 40) * clamp01((252 - yy) / 30);
      let f = 0;
      if (xx >= 190) f = Math.pow(Math.max(0, 1 - (xx - 190) / 30), 1.4) * vy;
      else if (xx < 10) f = Math.max(0, 1 - (10 - xx) / 12) * 0.7 * vy;
      if (yy >= 250 && xx < 206) f = Math.max(f, (0.7 - (yy - 250) / 36) * clamp01((206 - xx) / 14));
      if (f <= 0.02) return undefined;
      return tintPink(c, 0.05 + 0.28 * f);
    });
    // machine floor shadow (the scene draws the cabinet at x 10..190)
    pb.fn(0, 248, 202, H, (xx, yy, c) => {
      const d = Math.hypot((xx - 100) / 98, (yy - 256) / 8);
      return d < 1 && th8(xx, yy) < 1.35 - d ? C('k') : undefined;
    });

    // --- counter top face (y 189..195) belongs to the BACK layer: the Reaper's hands rest on it
    pb.rect(196, 189, W - 196, 7, WD[5]);
    pb.fn(196, 189, W, 196, (xx, yy) => { const n = fbm(xx * 0.03, yy * 0.6, 71, 2); return n > 0.6 ? WD[6] : n < 0.36 ? WD[4] : undefined; });
    pb.hl(196, W - 1, 189, WD[3]); pb.vl(196, 189, 195, WD[4]); pb.vl(197, 190, 195, WD[3]);
    pb.light(ramps, 196, 189, W, 196, (xx, yy) => Math.max(0, 1 - Math.hypot(xx - 214, yy - 194) / 44) * 0.9, 3.2);

    // --- front layer: the counter from its top edge (y 196) down — edge, lip, front panel, candle
    const fr = new PB();
    fr.hl(196, W - 1, 196, WD[7]);
    fr.rect(196, 197, W - 196, 4, WD[4]); fr.hl(196, W - 1, 197, WD[5]); fr.hl(196, W - 1, 200, WD[2]); fr.vl(196, 196, 200, WD[4]); fr.vl(197, 197, 200, WD[3]);
    fr.rect(199, 201, W - 199, 3, C('k')); fr.hl(199, W - 1, 203, WD[1]);
    let px = 199, pk = 0;
    while (px < W) {
      const pw = 15 + Math.floor(hash(pk, 0, 21) * 5), base = hash(pk, 1, 21) < 0.5 ? WD[3] : WD[2];
      fr.rect(px, 204, pw, 66, base); fr.vl(px, 204, H - 1, WD[1]); fr.vl(px + 1, 204, H - 1, ramps.shift(base, 1));
      for (let s = 0; s < 5; s++) { const gx = px + 3 + Math.floor(hash(pk, s, 22) * (pw - 4)), gy = 206 + Math.floor(hash(pk, s, 23) * 56); fr.vl(gx, gy, Math.min(H - 1, gy + 3 + Math.floor(hash(pk, s, 24) * 8)), ramps.shift(base, -1)); }
      fr.set(px + 3, 207, WD[5]); fr.set(px + 3, 208, WD[1]); fr.set(px + pw - 3, 263, WD[5]); fr.set(px + pw - 3, 264, WD[1]);
      px += pw; pk++;
    }
    fr.vl(199, 204, H - 1, WD[4]); fr.vl(200, 204, H - 1, WD[2]);
    const drawer = (dx, dy, dw, dh) => {
      fr.rect(dx - 1, dy - 1, dw + 2, dh + 2, C('k'));
      fr.rect(dx, dy, dw, dh, WD[4]); fr.hl(dx, dx + dw - 1, dy, WD[5]); fr.vl(dx, dy, dy + dh - 1, WD[5]); fr.hl(dx, dx + dw - 1, dy + dh - 1, WD[2]); fr.vl(dx + dw - 1, dy, dy + dh - 1, WD[2]);
      const kx = dx + (dw >> 1), ky = dy + (dh >> 1);
      fr.rect(kx - 4, ky - 1, 9, 3, C('M')); fr.hl(kx - 4, kx + 4, ky - 1, C('L')); fr.set(kx - 4, ky + 1, C('U')); fr.set(kx + 4, ky + 1, C('U')); fr.set(kx, ky, C('l'));
    };
    drawer(214, 212, 52, 16); drawer(276, 212, 52, 16);
    for (const [x0, x1] of [[214, 266], [276, 328], [338, 388]]) {
      fr.rect(x0, 236, x1 - x0, 22, WD[2]); fr.hl(x0, x1 - 1, 236, WD[1]); fr.vl(x0, 236, 257, WD[1]); fr.hl(x0, x1 - 1, 257, WD[4]); fr.vl(x1 - 1, 236, 257, WD[4]);
    }
    fr.rect(338, 212, 50, 16, WD[2]); fr.hl(338, 387, 212, WD[1]); fr.vl(338, 212, 227, WD[1]); fr.hl(338, 387, 227, WD[4]); fr.vl(387, 212, 227, WD[4]);
    fr.light(ramps, 196, 196, W, H, (xx, yy) => -Math.min(1.6, Math.max(0, (yy - 222) / 24)) + Math.max(0, 1 - Math.hypot(xx - 214, yy - 194) / 44) * 0.9 - (xx < 204 ? 0.4 : 0), 7);
    // candle on the counter (left end)
    const CX = 214;
    fr.ell(CX, 194, 6, 1, C('M')); fr.hl(CX - 6, CX + 6, 194, C('m')); fr.hl(CX - 5, CX + 5, 195, C('M')); fr.set(CX - 6, 195, C('U')); fr.set(CX + 6, 195, C('U'));
    fr.rect(CX - 2, 183, 5, 11, C('W')); fr.vl(CX + 2, 183, 193, C('b')); fr.vl(CX - 2, 183, 193, C('w'));
    fr.set(CX - 3, 186, C('W')); fr.set(CX - 3, 187, C('W')); fr.set(CX + 3, 184, C('b')); fr.set(CX, 182, C('k')); fr.hl(CX - 1, CX + 1, 183, C('w'));

    return {
      back: pb.canvas(), front: fr.canvas(), flames,
      counterFlame: [CX, 181],
      motes: Array.from({ length: 14 }, (_, i) => ({ x: 322 + hash(i, 1, 77) * 80, y: hash(i, 2, 77) * 90, sp: 1.5 + hash(i, 3, 77) * 3, ph: hash(i, 4, 77) * 6.28 })),
      lanternGlow: glowSprite(96, 80, 'A', 0.5), candleGlow: glowSprite(28, 24, 'A', 0.55), neonGlow: glowSprite(130, 150, 'r', 0.5), neonFloor: glowSprite(110, 16, 'p', 0.45),
      cols: { f0: css(C('w')), f1: css(C('l')), f2: css(C('A')), f3: css(C('m')), mote: css(M('l', 'A', .4)) },
    };
  }

  function drawFlame(ctx, S, x, y, t, seed, big) {
    // 3-frame candle flame; (x, y) = the flame's tip-most pixel base column
    const fr = Math.floor(t * 9 + seed * 3.7) % 3;
    const sway = fr === 1 ? 1 : fr === 2 ? -1 : 0;
    ctx.fillStyle = S.cols.f2; ctx.fillRect(x, y - 1, 1, 2);
    ctx.fillStyle = S.cols.f1; ctx.fillRect(x, y - 2, 1, 1);
    if (big) { ctx.fillStyle = S.cols.f2; ctx.fillRect(x - 1, y, 3, 1); ctx.fillStyle = S.cols.f1; ctx.fillRect(x, y - 1, 1, 1); ctx.fillStyle = S.cols.f0; ctx.fillRect(x, y, 1, 1); }
    ctx.fillStyle = S.cols.f3; ctx.fillRect(x + sway, y - 3 - (big ? 1 : 0), 1, 1);
  }

  function shop(ctx, t, opts = {}) {
    t = +t || 0;
    const S = SH.S || (SH.S = buildShop());
    const layer = opts.layer || 'all';
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (layer !== 'front') {
      ctx.drawImage(S.back, 0, 0);
      // lantern flame + glass
      const fl = opts.flicker === false ? 1 : flicker(t, 5, 10, 0.03);
      ctx.fillStyle = fl > 1.02 ? S.cols.f1 : S.cols.f2;
      ctx.fillRect(LANTERN.x - 1, 27, 3, 4);
      ctx.fillStyle = S.cols.f1; ctx.fillRect(LANTERN.x, 25, 1, 5);
      ctx.fillStyle = S.cols.f0; ctx.fillRect(LANTERN.x, 28, 1, 2);
      ctx.fillStyle = S.cols.f1; ctx.fillRect(LANTERN.x + ((Math.floor(t * 8) % 3) - 1), 24, 1, 1);
      for (let i = 0; i < S.flames.length; i++) drawFlame(ctx, S, S.flames[i][0], S.flames[i][1], t, i, false);
      // dust drifting through the lantern light
      ctx.fillStyle = S.cols.mote;
      for (const m of S.motes) {
        const my = 16 + ((m.y + t * m.sp) % 96), mx = m.x + Math.sin(t * 0.5 + m.ph) * 5;
        const d = Math.hypot(mx - LANTERN.x, my - 30) / 70;
        if (d >= 1) continue;
        ctx.globalAlpha = (1 - d) * (0.35 + 0.25 * Math.sin(t * 1.3 + m.ph));
        ctx.fillRect(Math.round(mx), Math.round(my), 1, 1);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, 0.2 * fl);
      ctx.drawImage(S.lanternGlow, LANTERN.x - 96, LANTERN.y - 80);
      for (let i = 0; i < S.flames.length; i++) { ctx.globalAlpha = 0.12 + 0.03 * Math.sin(t * 7 + i * 2); ctx.drawImage(S.candleGlow, S.flames[i][0] - 28, S.flames[i][1] - 24); }
      // pink neon spill from the claw machine (mostly hidden behind the cabinet)
      const neon = opts.neon == null ? 1 : opts.neon;
      const buzz = hash(Math.floor(t * 14), 7, 3) < 0.03 ? 0.55 : 1;
      ctx.globalAlpha = Math.max(0, neon * buzz * (0.2 + 0.03 * Math.sin(t * 2.2)));
      ctx.drawImage(S.neonGlow, 100 - 130, 150 - 150);
      ctx.globalAlpha = Math.max(0, neon * buzz * (0.3 + 0.04 * Math.sin(t * 2.2)));
      ctx.drawImage(S.neonFloor, 100 - 110, 262 - 16);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (layer !== 'back') {
      ctx.drawImage(S.front, 0, 0);
      const [cx, cy] = S.counterFlame;
      drawFlame(ctx, S, cx, cy, t, 9, true);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + 0.04 * Math.sin(t * 8.3) + 0.02 * Math.sin(t * 13.1);
      ctx.drawImage(S.candleGlow, cx - 28, cy - 24);
    }
    ctx.restore();
  }

  // ===========================================================================
  // DITHER — ordered 4x4 fade overlay (17 levels), patterns cached per colour
  // ===========================================================================
  const DITH = new Map();
  function dither(ctx, level, color) {
    if (color == null) color = PAL.k;
    if (color.length === 1 && PAL[color]) color = PAL[color];
    const lv = Math.max(0, Math.min(16, Math.round(level)));
    if (lv <= 0) return;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (lv >= 16) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); ctx.restore(); return; }
    let set = DITH.get(color);
    if (!set) { set = new Array(17).fill(null); DITH.set(color, set); }
    if (!set[lv]) {
      const c = newCanvas(4, 4), g = c.getContext('2d');
      g.fillStyle = color;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (B4[y * 4 + x] < lv) g.fillRect(x, y, 1, 1);
      set[lv] = ctx.createPattern(c, 'repeat');
    }
    ctx.fillStyle = set[lv];
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function prebuild() {
    if (!GY.S) GY.S = buildGraveyard();
    if (!LB.S) LB.S = buildLab();
    if (!SH.S) SH.S = buildShop();
  }

  // Anchors the scenes align to (all in 480x270 screen px; rects are [x0, y0, x1, y1]).
  const A = {
    graveyard: {
      groundY: 214,                 // units' feet
      lane: [40, 150, 440, 232],    // kept free of tall clutter
      horizonY: 150,                // hill crest / far edge of the ground
      moon: { x: MOON.x, y: MOON.y, r: MOON.r },
      titleArea: [300, 0, 480, 30], // plain dark sky for the stage title
    },
    lab: {
      slab: { cx: SLAB.cx, top: SLAB.top, backY: SLAB.backY, frontY: SLAB.frontY, x0: SLAB.x0, x1: SLAB.x1, faceBottom: SLAB.faceY1, baseBottom: SLAB.baseY },
      lamp: { x: LAMP.x, y0: LAMP.y0, y1: LAMP.y1, bulbY: 27 },
      niche: [178, 50, 302, 222],   // calm arched alcove behind the creature
      wallFloorY: 223,
    },
    shop: {
      counterY: COUNTER_Y,          // top edge line of the counter (top face spans y 189..196)
      counterX: [196, 480], counterFrontY: 204,
      lantern: { x: LANTERN.x, y0: 0, y1: 40, flameY: 27 },
      shelves: [202, 28, 390, 110], shelfItemsStandOn: [60, 94],
      poster: [404, 44, 470, 116],
      machine: [10, 190], floorY: 250,
      candle: { x: 214, y: 181 },   // counter candle flame (front layer)
    },
  };

  return { W, H, graveyard, lab, shop, dither, prebuild, A };
})();
