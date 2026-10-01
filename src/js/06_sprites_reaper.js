// ---------------------------------------------------------------------------
// REAPER (shopkeeper) — built at load time in 1x pixels, in the same palette as the hand-drawn art.
// He is big on purpose: the counter is 284 px wide, so a 96 px wide Reaper (about 78 px of him above
// the counter) reads as a shopkeeper, not a kid peeking over the desk.
//   reaper_idle / reaper_talk  96x76  robe, sleeves, cowl, hood and skull (talk: jaw open). Anchor: bottom centre.
//                                     The shop draws it at y 192 and clips it at the counter's far edge (y 189).
//                                     points.eyeL / eyeR are the sockets' centres: the shop paints the pupils
//                                     so they can follow the mouse, blink and glow.
//   reaper_hands               80x9   bony hands resting on the counter top (y 187..195), drawn over the sleeve cuffs.
// ---------------------------------------------------------------------------
(() => {
  const W = 96, H = 76, CX = 48;
  const darker = { 5: '4', 4: '3', 3: '2', 2: 'S', S: 'K', K: 'k' };
  // lighting value (-1..1, light from the upper left) -> purple ramp / bone ramp
  const cloth = (l) => (l > 0.68 ? '5' : l > 0.3 ? '4' : l > -0.1 ? '3' : l > -0.5 ? '2' : 'S');
  const bone = (l) => (l > 0.5 ? 'w' : l > -0.05 ? 'W' : l > -0.5 ? 'b' : l > -0.85 ? 'B' : 'n');
  // sphere-ish shading for an ellipse (cx, cy, rx, ry)
  const sph = (cx, cy, rx, ry, bias = -0.42, gain = 1.15) => (x, y) => {
    const nx = (x - cx) / rx, ny = (y - cy) / ry, z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    return cloth((-0.55 * nx - 0.62 * ny + 0.56 * z) * gain + bias);
  };
  const inEll = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const inPoly = (pts) => (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const mirrorPts = (pts) => pts.map(([x, y]) => [W - x, y]);

  function buildBody(open) {
    const g = PX.grid(W, H);
    const mask = (fn) => { const m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x + 0.5, y + 0.5)) m[y * W + x] = 1; return m; };
    const paint = (m, color, rim) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) g[y][x] = color(x + 0.5, y + 0.5);
      if (!rim) return;
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
        if (m[y * W + x] && (!m[(y + 1) * W + x] || !m[y * W + x + 1]) && darker[g[y][x]]) g[y][x] = darker[g[y][x]];
      }
    };
    // a 1px crease: darker line with a lighter pixel beside it (only where the target is cloth)
    const crease = (pts, m) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let s = 0; s <= n; s++) {
          const x = Math.round(x0 + ((x1 - x0) * s) / n), y = Math.round(y0 + ((y1 - y0) * s) / n);
          if (x < 1 || y < 0 || x >= W - 1 || y >= H || !m[y * W + x] || !m[y * W + x - 1]) continue;
          if (darker[g[y][x]]) g[y][x] = darker[g[y][x]];
          if (g[y][x - 1] === '3' || g[y][x - 1] === '2') g[y][x - 1] = g[y][x - 1] === '2' ? '3' : '4';
        }
      }
    };

    // --- robe: a bell that flares toward the counter
    const hw = (y) => 34 + (y - 40) * 0.27;
    const robe = mask((x, y) => y >= 40 && Math.abs(x - CX) <= hw(y));
    paint(robe, (x, y) => cloth(-0.7 * ((x - CX) / hw(y)) - 0.34 - (y > 66 ? (y - 66) * 0.012 : 0)));
    crease([[24, 58], [21, 66], [17, 76]], robe); crease([[72, 58], [75, 66], [79, 76]], robe);
    crease([[37, 62], [35, 70], [32, 76]], robe); crease([[59, 62], [61, 70], [64, 76]], robe);
    for (let y = 54; y < H; y++) if (robe[y * W + 48]) g[y][48] = 'S'; // front seam

    // --- sleeves: bell sleeves that hang from the shoulders; bone-trimmed cuffs end just above the counter
    const sleeveL = [[9, 44], [31, 44], [33, 56], [39, 70], [39, 80], [8, 80], [6, 66], [8, 54]];
    for (const pts of [sleeveL, mirrorPts(sleeveL)]) {
      const left = pts === sleeveL;
      const m = mask(inPoly(pts));
      const xc = (y) => (left ? 20 + Math.min(1, Math.max(0, (y - 44) / 26)) * 3.5 : W - 20 - Math.min(1, Math.max(0, (y - 44) / 26)) * 3.5);
      const half = (y) => 11 + Math.min(1, Math.max(0, (y - 50) / 20)) * 5;
      paint(m, (x, y) => {
        if (y >= 68) return 'K'; // the dark opening of the sleeve; the hand comes out of it
        if (y >= 66) return bone(-0.9 * ((x - xc(y)) / half(y)) - 0.5); // cuff trim (two rows of aged bone)
        return cloth(-0.85 * ((x - xc(y)) / half(y)) + 0.12);
      }, true);
      crease(left ? [[25, 50], [27, 57], [30, 64]] : [[70, 50], [68, 57], [65, 64]], m);
      crease(left ? [[18, 56], [17, 61], [16, 64]] : [[77, 56], [78, 61], [79, 64]], m);
    }

    // --- cowl: the cape over the shoulders
    const wave = (x) => 1.3 * Math.sin(x * 0.62) + 0.9 * Math.sin(x * 0.27 + 1);
    const cowl = mask((x, y) => ((x - CX) / 41) ** 2 + ((y - 45) / (y > 45 ? 13 + wave(x) : 13)) ** 2 <= 1);
    paint(cowl, sph(CX, 45, 41, 13, -0.34, 1.05), true);
    crease([[14, 46], [18, 51], [24, 55]], cowl); crease([[82, 46], [78, 51], [72, 55]], cowl);
    crease([[31, 52], [34, 57]], cowl); crease([[65, 52], [62, 57]], cowl);

    // --- hood: dome plus a drape that flares over the cowl
    const dome = inEll(48, 25, 26, 23), drape = inPoly([[23, 30], [73, 30], [77, 45], [71, 51], [25, 51], [19, 45]]);
    const hood = mask((x, y) => dome(x, y) || drape(x, y));
    paint(hood, (x, y) => {
      const nx = (x - 48) / 28, ny = (y - 26) / 27, z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny * 0.6));
      return cloth((-0.55 * nx - 0.62 * ny * 0.8 + 0.56 * z) * 1.15 - 0.4);
    }, true);
    crease([[30, 40], [27, 48]], hood); crease([[66, 40], [69, 48]], hood);

    // --- face opening: deep shadow with a lit lip on the brow
    const cav = mask((x, y) => y <= 44 && inEll(48, 27, 16, 18)(x, y));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!cav[y * W + x]) continue;
      g[y][x] = 'K';
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // brow lip: hood pixels hugging the opening, lit from above
      if (!hood[y * W + x] || cav[y * W + x]) continue;
      const up = !cav[(y + 1) * W + x] ? 0 : 1, down = y > 0 && cav[(y - 1) * W + x];
      if (up && x > 30 && x < 66) g[y][x] = x < 50 ? '4' : '3';
      else if (down) g[y][x] = 'S';
    }

    // --- skull: 24 wide, lit from the left; the lower jaw drops when he talks
    skull(g, 36, 14, open ? 3 : 0);

    // --- gold clasp at the collar
    const clasp = ['.LLL.', 'LlLmL', 'LLmmL', '.mMm.'];
    clasp.forEach((r, j) => [...r].forEach((c, i) => { if (c !== '.') g[52 + j][46 + i] = c; }));
    g[52][48] = 'l';
    return PX.outline(g, 'k');
  }

  function skull(g, ox, oy, drop) {
    const put = (x, y, k) => { const X = ox + x, Y = oy + y; if (X >= 0 && X < W && Y >= 0 && Y < H) g[Y][X] = k; };
    const crani = inEll(12, 10.6, 12, 10.8), mid = inPoly([[2.2, 13], [21.8, 13], [19.6, 22.5], [4.4, 22.5]]);
    const jaw = inPoly([[5.6, 0], [18.4, 0], [16.6, 5.4], [7.4, 5.4]]);
    const shade = (x, y, cy) => {
      const nx = (x - 12) / 12.5, ny = (y - cy) / 13;
      return bone(-0.95 * nx - 0.45 * ny + 0.12 - Math.max(0, nx) * 0.25);
    };
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (crani(x + 0.5, y + 0.5) || mid(x + 0.5, y + 0.5)) put(x, y, shade(x + 0.5, y + 0.5, 11));
    // eye sockets (the shop paints the glowing pupils into them)
    const sock = [inEll(7.2, 12.7, 3.4, 3.7), inEll(16.8, 12.7, 3.4, 3.7)];
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (sock.some((f) => f(x + 0.5, y + 0.5))) put(x, y, 'k');
    // nose
    [[11, 16], [12, 16], [11, 17], [12, 17], [10, 18], [11, 18], [12, 18], [13, 18]].forEach(([x, y]) => put(x, y, 'k'));
    // brow and cheek highlights
    [[4, 8], [5, 8], [6, 8], [3, 9], [3, 10], [4, 7]].forEach(([x, y]) => put(x, y, 'w'));
    // upper teeth
    for (let x = 5; x <= 18; x++) put(x, 20, 'k');
    for (let y = 21; y <= 22; y++) for (let x = 6; x <= 17; x++) put(x, y, (x - 6) % 3 === 2 ? 'n' : x > 13 ? 'b' : 'W');
    put(5, 21, 'k'); put(18, 21, 'k'); put(5, 22, 'k'); put(18, 22, 'k');
    // lower jaw (drops when talking)
    const jy = 23 + drop;
    for (let y = 23; y < jy; y++) for (let x = 6; x <= 17; x++) put(x, y, 'K');
    for (let y = 0; y < 6; y++) for (let x = 0; x < 24; x++) if (jaw(x + 0.5, y + 0.5)) put(x, jy + y, y === 0 ? ((x - 6) % 3 === 2 ? 'n' : x > 13 ? 'b' : 'W') : shade(x + 0.5, y + 14, 11));
    for (let y = 0; y < 6; y++) { // jaw edge
      const xl = Math.round(5.6 + (7.4 - 5.6) * (y / 5.4)) - 1, xr = Math.round(18.4 - (18.4 - 16.6) * (y / 5.4));
      if (y < 5) { put(xl, jy + y, 'k'); put(xr, jy + y, 'k'); }
    }
    for (let x = 7; x <= 16; x++) put(x, jy + 5, 'k');
  }

  const eyes = { eyeL: [36 + 7, 14 + 13], eyeR: [36 + 17, 14 + 13], mouth: [48, 14 + 22], hood: [48, 2] };
  SPR.def('reaper_idle', { rows: PX.rows(buildBody(false)), anchor: [CX, H], points: eyes });
  SPR.def('reaper_talk', { rows: PX.rows(buildBody(true)), anchor: [CX, H], points: eyes });

  // --- hands: static, resting on the counter's top face (y 187..195), under the sleeve cuffs
  const hand = [ // viewer-left hand: fingers toward the viewer, thumb on the inner (right) side
    '..kBWWWWWWWWbk...',
    '..kBWwWWWWWWWbBk.',
    '..kWWWWWWWWWWbBkk',
    '..kWWWWWWWWWbBBWW',
    '.kWWkWWkWWkWbBBWW',
    '.kWWkWWkWWkWbbBWb',
    '.kWbkWbkWbkWbBkkk',
    '.kBBkBBkBBkBBk...',
    '..kk.kk.kk.kk....',
  ].map((r) => r.padEnd(18, '.'));
  const rowsHands = Array.from({ length: 9 }, () => new Array(80).fill('.'));
  const stamp = (rows, x0, y0) => rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== '.') rowsHands[y0 + j][x0 + i] = c; }));
  stamp(hand, 6, 0); stamp(PX.flipH(hand), 56, 0);
  SPR.def('reaper_hands', { rows: rowsHands.map((r) => r.join('')), anchor: [40, 9] });
})();
