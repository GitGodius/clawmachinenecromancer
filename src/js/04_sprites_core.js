// ---------------------------------------------------------------------------
// SPRITES — tiny pixel-art system. Sprites are arrays of strings using PAL keys.
//   SPR.def('name', { rows:[...], anchor:[x,y], points:{neck:[x,y], ...} })
//   SPR.draw(ctx, 'name', x, y, { rot, flip, scale, alpha, variant })
// Works headless too (no canvas) so the physics tuner can read sprite masks.
// ---------------------------------------------------------------------------
const SPR = (() => {
  const defs = {};
  const built = {};
  const HAS_DOM = typeof document !== 'undefined';

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function def(name, d) {
    if (Array.isArray(d)) d = { rows: d };
    defs[name] = d;
    delete built[name];
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function get(name) {
    let s = built[name];
    if (s) return s;
    const d = defs[name];
    if (!d) throw new Error('Unknown sprite: ' + name);
    const rows = d.rows;
    const h = rows.length;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    const mask = new Uint8Array(w * h);
    const cols = new Array(w * h).fill(null);
    for (let y = 0; y < h; y++) {
      const r = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = r[x];
        if (!ch || ch === '.' || ch === ' ') continue;
        const col = PAL[ch];
        if (!col) { if (typeof console !== 'undefined') console.warn('Sprite ' + name + ' bad color key ' + ch); continue; }
        mask[y * w + x] = 1;
        cols[y * w + x] = col;
      }
    }
    s = {
      name, w, h, mask, cols,
      ax: d.anchor ? d.anchor[0] : w / 2,
      ay: d.anchor ? d.anchor[1] : h / 2,
      pts: d.points || {},
      c: null,
      v: {},
    };
    if (HAS_DOM) {
      s.c = makeCanvas(w, h);
      const g = s.c.getContext('2d');
      const img = g.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        if (!mask[i]) continue;
        const [r, gg, b] = hexToRgb(cols[i]);
        img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    built[name] = s;
    return s;
  }

  // Solid-color copy (hit flash, silhouettes). Same size as the sprite.
  function solid(name, color) {
    const s = get(name);
    const key = 'solid' + color;
    if (s.v[key]) return s.v[key];
    const c = makeCanvas(s.w, s.h);
    const g = c.getContext('2d');
    g.drawImage(s.c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, s.w, s.h);
    s.v[key] = c;
    return c;
  }

  // Outline ring (mask dilated by `t` px, minus nothing — draw it *behind* the sprite).
  // Returned canvas is (w+2t, h+2t); draw at offset -t.
  function outline(name, color, t = 1) {
    const s = get(name);
    const key = 'ol' + color + t;
    if (s.v[key]) return s.v[key];
    const W = s.w + t * 2, H = s.h + t * 2;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const [r, gg, b] = hexToRgb(color);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let hit = false;
        for (let dy = -t; dy <= t && !hit; dy++) {
          for (let dx = -t; dx <= t && !hit; dx++) {
            if (Math.abs(dx) + Math.abs(dy) > t + (t > 1 ? 1 : 0)) continue;
            const sx = x - t + dx, sy = y - t + dy;
            if (sx >= 0 && sy >= 0 && sx < s.w && sy < s.h && s.mask[sy * s.w + sx]) hit = true;
          }
        }
        if (hit) {
          const i = (y * W + x) * 4;
          img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    s.v[key] = c;
    return c;
  }

  // Draw sprite with its anchor at (x, y).
  // opts: rot (radians), flip (bool, mirror X), scale, alpha, solid (color string), outline ({color, t})
  function draw(ctx, name, x, y, opts) {
    const s = get(name);
    if (!opts) {
      ctx.drawImage(s.c, Math.round(x - s.ax), Math.round(y - s.ay));
      return s;
    }
    const scale = opts.scale || 1;
    const img = opts.solid ? solid(name, opts.solid) : s.c;
    const oldA = ctx.globalAlpha;
    if (opts.alpha != null) ctx.globalAlpha = oldA * opts.alpha;
    if (!opts.rot && scale === 1 && !opts.flip) {
      const dx = Math.round(x - s.ax), dy = Math.round(y - s.ay);
      if (opts.outline) {
        const t = opts.outline.t || 1;
        ctx.drawImage(outline(name, opts.outline.color, t), dx - t, dy - t);
      }
      ctx.drawImage(img, dx, dy);
    } else {
      ctx.save();
      ctx.translate(opts.rot ? x : Math.round(x), opts.rot ? y : Math.round(y));
      if (opts.rot) ctx.rotate(opts.rot);
      ctx.scale(opts.flip ? -scale : scale, scale);
      if (opts.outline) {
        const t = opts.outline.t || 1;
        ctx.drawImage(outline(name, opts.outline.color, t), -s.ax - t, -s.ay - t);
      }
      ctx.drawImage(img, -s.ax, -s.ay);
      ctx.restore();
    }
    ctx.globalAlpha = oldA;
    return s;
  }

  // Convex hull of opaque pixels (pixel corners), relative to the sprite center.
  // Used to build physics shapes that match the art. Returns [[x,y],...] CCW-ish.
  function hull(name, maxVerts = 8, inset = 0.5) {
    const s = get(name);
    const pts = [];
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (!s.mask[y * s.w + x]) continue;
        // only edge pixels matter
        pts.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
      }
    }
    let H = convexHull(pts);
    // simplify: drop the vertex that removes the least area until <= maxVerts
    while (H.length > maxVerts) {
      let best = -1, bestA = Infinity;
      for (let i = 0; i < H.length; i++) {
        const a = H[(i + H.length - 1) % H.length], b = H[i], c = H[(i + 1) % H.length];
        const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
        if (area < bestA) { bestA = area; best = i; }
      }
      H.splice(best, 1);
    }
    const cx = s.w / 2, cy = s.h / 2;
    return H.map(([x, y]) => {
      // pull each vertex toward the center a touch so resting parts don't float
      const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1;
      return [dx - (dx / L) * inset, dy - (dy / L) * inset];
    });
  }

  function convexHull(points) {
    const P = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const uniq = [];
    for (const p of P) if (!uniq.length || uniq[uniq.length - 1][0] !== p[0] || uniq[uniq.length - 1][1] !== p[1]) uniq.push(p);
    if (uniq.length < 3) return uniq;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of uniq) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = uniq.length - 1; i >= 0; i--) {
      const p = uniq[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  return { def, get, draw, solid, outline, hull, defs, has: (n) => !!defs[n], makeCanvas: HAS_DOM ? makeCanvas : null };
})();
