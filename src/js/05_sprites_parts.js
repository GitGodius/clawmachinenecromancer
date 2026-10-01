// ---------------------------------------------------------------------------
// BODY PART SPRITES — drawn in "rig" orientation (limbs hang down, anchor at
// the joint). The same art is used in the claw machine (physics hull is built
// from these masks), on the slab and in battle.
// ---------------------------------------------------------------------------

// Tiny grid helpers for procedural sprites (claw parts etc.)
const PX = {
  grid(w, h) { return Array.from({ length: h }, () => new Array(w).fill('.')); },
  set(g, x, y, ch) { x = Math.round(x); y = Math.round(y); if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch; },
  poly(g, pts, ch) {
    const h = g.length, w = g[0].length;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) g[y][x] = ch;
    }
  },
  disc(g, cx, cy, r, ch) {
    for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) g[y][x] = ch;
    }
  },
  rect(g, x0, y0, w, h, ch) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) PX.set(g, x, y, ch); },
  // light from top-left: base pixels touching empty space get light/dark rims
  shade(g, base, light, dark) {
    const h = g.length, w = g[0].length;
    const empty = (x, y) => x < 0 || y < 0 || x >= w || y >= h || g[y][x] === '.';
    const out = g.map((r) => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g[y][x] !== base) continue;
      if (dark && (empty(x + 1, y) || empty(x, y + 1))) out[y][x] = dark;
      else if (light && (empty(x - 1, y) || empty(x, y - 1))) out[y][x] = light;
    }
    return out;
  },
  outline(g, ch = 'k') {
    const h = g.length, w = g[0].length;
    const out = g.map((r) => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g[y][x] !== '.') continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const xx = x + dx, yy = y + dy;
        return xx >= 0 && yy >= 0 && xx < w && yy < h && g[yy][xx] !== '.';
      });
      if (n) out[y][x] = ch;
    }
    return out;
  },
  rows(g) { return g.map((r) => r.join('')); },
  mirror(rows) { return rows.map((r) => r + r.split('').reverse().join('')); },
  flipH(rows) { return rows.map((r) => r.split('').reverse().join('')); },
  recolor(rows, map) { return rows.map((r) => r.split('').map((c) => (map[c] != null ? map[c] : c)).join('')); },
};

// ------------------------------- HEADS ------------------------------------
const SKULL_ROWS = [
  '....kkkkkk....',
  '..kkwwwWWWkk..',
  '.kwwWWWWWWWbk.',
  '.kwWWWWWWWWbk.',
  'kwWWWWWWWWWbBk',
  'kWWWWWWWWWWbBk',
  'kWWkkWWWWkkbBk',
  'kWkkkkWWkkkkBk',
  'kbkkkkWWkkkkBk',
  'kbWkkWWWWkkbBk',
  '.kbWWWkkWWbBk.',
  '.kbbWWkkWbbBk.',
  '..kBbbbbbbBk..',
  '..kWkWkWkWkk..',
  '..kbWbWbWbBk..',
  '...kkkkkkkk...',
];
SPR.def('p_skull', { rows: SKULL_ROWS, anchor: [7, 15], points: { eyeL: [3, 7], eyeR: [9, 7] } });

SPR.def('p_wolfskull', {
  rows: [
    '..kkkk............',
    '.kwwWWkk..........',
    'kwWWWWWWkkkk......',
    'kWWkkkWWWWWWkkk...',
    'kWkkkkkWWWWWWWWkk.',
    'kWWkkkWWWWWWWWWWBk',
    'kbWWWWWWbbbbbbBBBk',
    '.kbBBBBkWkWkWkWkk.',
    '..kBBkkkkkkkkkkk..',
    '..kBkWkWkWkWkWk...',
    '..kBBbbbbbbbBBk...',
    '...kkkkkkkkkkkk...',
  ],
  anchor: [4, 11], points: { eyeL: [3, 4], eyeR: [4, 4] },
});

SPR.def('p_eyeball', {
  rows: [
    '....kkkk....',
    '..kkjjeekk..',
    '.kjjeeeeeRk.',
    '.kjeeeeeeek.',
    'kjeeeeeeeeEk',
    'keeeeeeeeeEk',
    'keeeeeeeeeEk',
    'kReeeeeeeEik',
    '.keeeeeeEik.',
    '.kEeeeEEiRk.',
    '..kkEiiikk..',
    '....kkkk....',
  ],
  anchor: [6, 12], points: { iris: [6, 6] },
});

SPR.def('p_demonskull', {
  rows: [
    'k................k',
    'Pk..............kP',
    'oPk............kPo',
    'kOPk..kkkkkk..kPOk',
    '.kOPkkwwwWWWkkPOk.',
    '.kOkwwWWWWWWWbkOk.',
    '..kkwWWWWWWWWbkk..',
    '..kwWWWWWWWWWbqk..',
    '..kWWWWWWWWWWbqk..',
    '..kWWkkWWWWkkbqk..',
    '..kWkaAkWWkAakqk..',
    '..kbkaakWWkaakqk..',
    '..kbWkkWWWWkkbqk..',
    '...kbWWWkkWWbqk...',
    '...kbbWWkkWbbqk...',
    '....kqbbbbbbqk....',
    '....kWkWkWkWkk....',
    '....kbWbWbWbqk....',
    '.....kkkkkkkk.....',
  ],
  anchor: [9, 18],
});

SPR.def('p_crownskull', {
  rows: [
    '..k...kk...k..',
    '.klk.kllk.klk.',
    '.kLLkLLLLkLLk.',
    '.kLRLLCCLLRLk.',
    '.kmmmmmmmmmmk.',
    '.kwwWWWWWWWbk.',
    'kwWWWWWWWWWbBk',
    'kWWWWWWWWWWbBk',
    'kWWkkWWWWkkbBk',
    'kWkkLkWWkkLkBk',
    'kbkkkkWWkkkkBk',
    'kbWkkWWWWkkbBk',
    '.kbWWWkkWWbBk.',
    '.kbbWWkkWbbBk.',
    '..kBbbbbbbBk..',
    '..kWkWkWkWkk..',
    '..kbWbWbWbBk..',
    '...kkkkkkkk...',
  ],
  anchor: [7, 17], points: { eyeL: [3, 9], eyeR: [9, 9] },
});

// ------------------------------- TORSOS -----------------------------------
SPR.def('p_ribcage', {
  rows: [
    '.......kkkk.......',
    '..kkkkkkWbkkkkkk..',
    '.kwWWWWWWbWWWWWbk.',
    'kwbBBBBBWbBBBBBbBk',
    'kbkkkkkkWbkkkkkknk',
    '.kkWWWWWWbWWWWWkk.',
    '.kWbBBBBWbBBBBbWk.',
    '.kbk....Wb....kbk.',
    '.kbkWWWWWbWWWWkbk.',
    '.kkWbBBBWbBBBbWkk.',
    '..kbk...Wb...kbk..',
    '..kbkWWWWbWWWkbk..',
    '...kWbBBWbBBbWk...',
    '...kbk..Wb..kbk...',
    '...kbkWWWbWWkbk...',
    '....kkbBWbBbkk....',
    '......kkWbkk......',
    '...kkkkkWbkkkkk...',
    '..kWWWWWWbWWWWWk..',
    '..kbBBkkWbkkBBbk..',
    '..kbk..kWbk..kbk..',
    '...k....kk....k...',
  ],
  anchor: [9, 11],
  points: { neck: [9, 1], shL: [2, 3], shR: [15, 3], hipL: [4, 20], hipR: [13, 20], heart: [10, 9], back: [9, 7] },
});

SPR.def('p_stitched', {
  rows: [
    '......kkkkkk......',
    '..kkkkffFFFFkkkk..',
    '.kffFFFFFFFFFFFgk.',
    'kfFFFFFFFFFFFFFFgk',
    'kFFFFFFFhFFFFFFFgk',
    'kFFgggFhFhFgggFFgk',
    'kgFFFFFFhFFFFFFFgk',
    'kgFFFFFhFhFFzZZzgk',
    '.kgFFFFFhFFzZyyZgk',
    '.kgFFFFhFhFzZyyzgk',
    '.kgFFFFFhFFFzzzFgk',
    '.kggFFFhFhFFFFFggk',
    '..kgFFFFhFFFFFFgk.',
    '..kgFFFhFhFFGFFgk.',
    '..kggFFFhFFFFFggk.',
    '..kQQQQQQQQQQQQQk.',
    '..kqqqqqQqqqqqqQk.',
    '..kqRqqqQqqqqqqQk.',
    '..kqqqqQkQqqqqqQk.',
    '..kqqqQk.kQqqqQQk.',
    '...kkkk...kkkkkk..',
  ],
  anchor: [9, 10],
  points: { neck: [9, 1], shL: [2, 4], shR: [15, 4], hipL: [5, 19], hipR: [12, 19], heart: [11, 7], back: [9, 7] },
});


SPR.def('p_ogregut', {
  rows: [
    '.......kkkkkkkkkk.......',
    '....kkkzzZZZZZZZZkkk....',
    '..kkzzZZZZZZZZZZZZZykk..',
    '.kzzZZZZZZZZZZZZZZZZyyk.',
    'kzZZZZZZZZZZZZZZZZZZZyyk',
    'kZZZZyyZZZZZZZZZyyZZZZyk',
    'kZZZyyyyZZZZZZZyyyyZZZyk',
    'kyZZZZZZZZZZZZZZZZZZZZyk',
    'kyZZZZZZZZzzzzZZZZZZZZyk',
    'kyZZZZZZZzzzzzzZZZZZZyyk',
    'kyZZZZZZzzzzzzzzZZZZZyyk',
    'kyZZZZZZzzzzzzzzZZZZZyyk',
    'kyyZZZZZZzzzYzzZZZZZyyyk',
    'kyyZZZZZZZzzzzZZZZZZyyyk',
    '.kyyZZZZZZZZZZZZZZZZyyk.',
    '.kyyyZZZZZZZZZZZZZZyyyk.',
    '..kYyyyZZZZZZZZZZyyyYk..',
    '..kuuuuuuuuuuuuuuuuuuk..',
    '..kTTTTTLmTTTTTTTTTTuk..',
    '..kTtTTTTTTTTTTTTTTTuk..',
    '...kTTTTTTTTTTTTTTTuk...',
    '...kTTTuTTTTTTTuTTTuk...',
    '....kTTukTTTTTkuTTuk....',
    '.....kkk.kTTTk.kkkk.....',
    '.........kkkkk..........',
  ],
  anchor: [12, 12],
  points: { neck: [12, 1], shL: [2, 5], shR: [21, 5], hipL: [7, 22], hipR: [16, 22], heart: [14, 8], back: [12, 8] },
});

// -------------------------------- ARMS ------------------------------------
SPR.def('p_bonearm', {
  rows: [
    '..kkkk..',
    '.kwWWbk.',
    '.kWWbBk.',
    '..kWbk..',
    '..kWbk..',
    '..kWbk..',
    '..kWbk..',
    '..kWbk..',
    '..kWbk..',
    '.kwWbbk.',
    '.kbBBBk.',
    '.kWkWbk.',
    '.kWkWbk.',
    '.kWkWbk.',
    '.kWkWbk.',
    '.kbkbBk.',
    '.kWWbBk.',
    'kWWWWbBk',
    'kWbWbWbk',
    'kWkWkWkk',
    'kWkWkWk.',
    'kbkbkbk.',
    '.k.k.k..',
  ],
  anchor: [4, 2], points: { hand: [4, 19] },
});

SPR.def('p_fleshArm', {
  rows: [
    '..kkkk..',
    '.kffFFk.',
    '.kfFFgk.',
    '.kFFFgk.',
    '.kFFFgk.',
    '.kFFFgk.',
    '.kFFFgk.',
    '.kFFggk.',
    '.kGhGhk.',
    '.khGhGk.',
    '.kFFFgk.',
    '.kFFFgk.',
    '.kFFFgk.',
    '.kFFggk.',
    '.kFFFgk.',
    '.kfFFgk.',
    'kfFFFFgk',
    'kFFFFFgk',
    'kFgFgFgk',
    'kFkFkFgk',
    'kgkgkgk.',
    '.k.k.k..',
  ],
  anchor: [4, 2], points: { hand: [4, 18] },
});

SPR.def('p_clawarm', {
  rows: [
    '..kkkk..',
    '.kzZZyk.',
    '.kZZyYk.',
    '.kZZyYk.',
    '.kZZyYk.',
    '.kZyyYk.',
    '.kZZyYk.',
    '.kZZyYk.',
    '.kZyyYk.',
    '.kYxYxk.',
    '.kZZyYk.',
    '.kZZyYk.',
    '.kZyyYk.',
    '.kZZyYk.',
    '.kZZyYk.',
    'kzZZyyYk',
    'kZZZyyYk',
    'kZyZyZyk',
    'kWkWkWkk',
    'kWkWkWk.',
    'kbkbkbk.',
    'kbkbkbk.',
    '.k.k.k..',
  ],
  anchor: [4, 2], points: { hand: [4, 18] },
});

SPR.def('p_ogrearm', {
  rows: [
    '...kkkkkk...',
    '..kzzZZZyk..',
    '.kzZZZZZyyk.',
    '.kZZZZZZyyk.',
    '.kZZZZZZyyk.',
    '.kZZZZZyyYk.',
    '.kZZZZZyyYk.',
    '..kZZZZyyk..',
    '..kZZZZyyk..',
    '..kZZZyyYk..',
    '..kZZZyyYk..',
    '..kyZZZyYk..',
    '..kZZZZyyk..',
    '..kZZZZyyk..',
    '..kZZZZyyk..',
    '..kZZZyyYk..',
    '..kuuuuuuk..',
    '..kTTtTTuk..',
    '.kzZZZZZyyk.',
    'kzZZZZZZZyyk',
    'kZZZZZZZZyyk',
    'kZZyZZyZZyYk',
    'kZZyZZyZZyYk',
    'kyZyZZyZyYYk',
    '.kyyyyyyyYk.',
    '..kkkkkkkk..',
  ],
  anchor: [6, 2], points: { hand: [6, 22] },
});

SPR.def('p_tentacle', {
  rows: [
    '..kkkkk..',
    '.kpPPPok.',
    '.kPPPPok.',
    '.kPpPPok.',
    '.kPPPPok.',
    '..kPpPok.',
    '..kPPPok.',
    '..kPpPok.',
    '..kPPPOk.',
    '..kPpPok.',
    '.kPPPok..',
    '.kPpPok..',
    '.kPPPok..',
    '.kPpPok..',
    '.kPPoOk..',
    '..kPpok..',
    '..kPPok..',
    '..kPpok..',
    '...kPok..',
    '...kPpk..',
    '...kPok..',
    '...kpOk..',
    '....kPk..',
    '....kpk..',
    '...kPk...',
    '...kok...',
    '..kok....',
    '..kk.....',
  ],
  anchor: [4, 2], points: { hand: [3, 24] },
});

SPR.def('p_swordarm', {
  rows: [
    '..kkkk...',
    '.kwWWbk..',
    '.kWWbBk..',
    '..kWbk...',
    '..kWbk...',
    '..kWbk...',
    '..kWbk...',
    '..kWbk...',
    '.kwWbbk..',
    '.kbBBBk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kbkbBk..',
    '.kWWbBk..',
    'kWWWubBk.',
    'kWbWubWk.',
    'kbkbubkk.',
    'kLlLLmMMk',
    '.kkeEikk.',
    '..keEik..',
    '..keEik..',
    '..keEik..',
    '..keEik..',
    '..keEik..',
    '..keEik..',
    '..keEik..',
    '..keEik..',
    '..keEik..',
    '..kjEik..',
    '...keik..',
    '...kek...',
    '....k....',
  ],
  anchor: [4, 2], points: { hand: [4, 17] },
});

// -------------------------------- LEGS ------------------------------------
SPR.def('p_boneleg', {
  rows: [
    '.kkkkk...',
    'kwWWWbk..',
    'kWWWbBk..',
    '.kWWbk...',
    '.kWWbk...',
    '.kWWbk...',
    '.kWWbk...',
    '.kWWbk...',
    '.kWWbk...',
    '.kWWbk...',
    'kwWWbbk..',
    'kbBBBBk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kWkWbk..',
    '.kbkbBk..',
    '.kWWbBk..',
    '.kWWWbbkk',
    '.kWbWbWbk',
    '.kkkkkkkk',
  ],
  anchor: [3, 1],
});

SPR.def('p_fleshLeg', {
  rows: [
    '.kkkkk...',
    'kfFFFgk..',
    'kFFFFgk..',
    'kFFFFgk..',
    'kFFFggk..',
    '.kFFFgk..',
    '.kFFFgk..',
    '.kFFFgk..',
    '.kFFggk..',
    '.kfFFgk..',
    '.kFFFgk..',
    '.kFFFgk..',
    '.kFFggk..',
    '.kFFFgk..',
    '.kFFFgk..',
    '.kFFggk..',
    '.kFFFgk..',
    '.kFFFgk..',
    '.kFFFFgkk',
    '.kFFFFFFk',
    '.kgFgFgGk',
    '..kkkkkk.',
  ],
  anchor: [3, 1],
});

SPR.def('p_pegleg', {
  rows: [
    '.kkkkk..',
    'kfFFFgk.',
    'kFFFFgk.',
    'kFFFggk.',
    '.kFFFgk.',
    '.kFFggk.',
    '.kuuuuk.',
    '.kTTtTk.',
    '.kTtTuk.',
    '..kTuk..',
    '..kTuk..',
    '..kTuk..',
    '..kTuk..',
    '..kTuk..',
    '..kTuk..',
    '..kTuk..',
    '..kuUk..',
    '..kUUk..',
    '...kk...',
  ],
  anchor: [3, 1],
});

SPR.def('p_goatleg', {
  rows: [
    '.kkkkkk.',
    'ktTTTTuk',
    'kTtTTuuk',
    'kTTTTuuk',
    'kTtTTuk.',
    '.kTTTuk.',
    '.kTTuuk.',
    '..kTTuk.',
    '..kTTuk.',
    '..kTuuk.',
    '...kTuk.',
    '...kTuk.',
    '...kTuk.',
    '...kTuk.',
    '...kTuk.',
    '..kTTuk.',
    '..kTtuk.',
    '..kTTuk.',
    '..kuuuk.',
    '..k2233k',
    '..k2233k',
    '..kkkkkk',
  ],
  anchor: [3, 1],
});

// ------------------------------- HEARTS -----------------------------------
SPR.def('p_heart', {
  rows: [
    '.kkk...kkk.',
    'krrRk.kRRqk',
    'krRRRkRRRqk',
    'kRRQRRRRRqk',
    'kRRRQRRRqqk',
    '.kRRRQRqqk.',
    '..kRRRqqk..',
    '...kRqqk...',
    '....kqk....',
    '.....k.....',
  ],
  anchor: [5, 5],
});
SPR.def('p_blackheart', {
  rows: [
    '.kkk...kkk.',
    'kPoOk.kOOKk',
    'kPOOOkOOOKk',
    'kOOpOOOOOKk',
    'kOOOpOOOKKk',
    '.kOOpOpKKk.',
    '..kOOpKKk..',
    '...kOKKk...',
    '....kKk....',
    '.....k.....',
  ],
  anchor: [5, 5],
});
SPR.def('p_goldheart', {
  rows: [
    '.kkk...kkk.',
    'kllLk.kLLmk',
    'klLLLkLLLmk',
    'kLLLLLLLLmk',
    'kLLLLLLLmmk',
    '.kLLLLLmmk.',
    '..kLLLmMk..',
    '...kLmMk...',
    '....kMk....',
    '.....k.....',
  ],
  anchor: [5, 5],
});

// -------------------------------- BACK ------------------------------------

SPR.def('p_vert', {
  rows: [
    '.kkkk.',
    'kwWWbk',
    'kWbbBk',
    'kbBBnk',
    '.kkkk.',
  ],
  anchor: [3, 2],
});
SPR.def('p_tailtip', {
  rows: [
    '.kkkk',
    'kwWbk',
    'kWbBk',
    '.kbk.',
    '.kbk.',
    '..k..',
  ],
  anchor: [2, 1],
});

// ------------------------- PROCEDURAL PARTS -------------------------------
// Armor breastplate (uncommon torso)
(() => {
  let g = PX.grid(18, 21);
  PX.poly(g, [[3, 3], [15, 3], [14.5, 12], [12, 15.5], [6, 15.5], [3.5, 12]], 'E');
  PX.disc(g, 3.5, 4.5, 3.4, 'E');
  PX.disc(g, 14.5, 4.5, 3.4, 'E');
  g = PX.shade(g, 'E', 'e', 'i');
  for (let y = 5; y < 15; y++) { PX.set(g, 8, y, 'e'); PX.set(g, 10, y, 'i'); }
  PX.rect(g, 7, 2, 5, 2, 'i'); PX.rect(g, 7, 2, 5, 1, 'E');
  [[2, 4], [15, 4], [5, 7], [13, 7]].forEach(([x, y]) => PX.set(g, x, y, 'I'));
  [[12, 9], [13, 10], [6, 12], [11, 13]].forEach(([x, y]) => PX.set(g, x, y, 'T'));
  PX.set(g, 12, 10, 'u');
  PX.rect(g, 5, 15, 9, 2, 'T'); PX.set(g, 9, 15, 'L'); PX.set(g, 9, 16, 'm'); PX.rect(g, 5, 16, 9, 1, 'u'); PX.set(g, 9, 16, 'L');
  PX.poly(g, [[5, 17], [14, 17], [15, 20], [10, 20], [9.5, 18.5], [8.5, 20], [4, 20]], 'q');
  PX.set(g, 5, 18, 'R'); PX.set(g, 6, 18, 'R'); PX.set(g, 13, 18, 'Q'); PX.set(g, 14, 19, 'Q');
  g = PX.outline(g, 'k');
  SPR.def('p_armor', { rows: PX.rows(g), anchor: [9, 10],
    points: { neck: [9, 2], shL: [3, 4], shR: [15, 4], hipL: [6, 19], hipR: [12, 19], heart: [9, 8], back: [9, 7] } });
})();

// Bat wings (rare back part): membrane + finger bones + scalloped edge, mirrored
(() => {
  let g = PX.grid(20, 17);
  PX.poly(g, [[20, 5], [9, 0.5], [0.5, 1.5], [2, 11.5], [7, 15.5], [13, 15.5], [20, 12.5]], 'S');
  PX.disc(g, 4.6, 15, 2.6, '.'); PX.disc(g, 10, 17.2, 2.7, '.'); PX.disc(g, 16.6, 16, 2.7, '.');
  // lighter membrane near the leading edge
  PX.poly(g, [[19, 6], [9, 2], [3, 3], [8, 5], [18, 8]], 's');
  const bone = (x0, y0, x1, y1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) PX.set(g, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 'n'); };
  bone(19, 5, 9, 1); bone(9, 1, 1, 1); bone(9, 1, 2, 11); bone(9, 1, 7, 14); bone(9, 1, 13, 14);
  PX.set(g, 9, 1, 'B'); PX.set(g, 0, 0, 'b'); PX.set(g, 1, 0, 'N');
  g = PX.outline(g, 'k');
  SPR.def('p_wings', { rows: PX.mirror(PX.rows(g)), anchor: [20, 6] });
})();

// ------------------------------- THE CLAW ---------------------------------
// Geometry in art px, hub-local, y down. Physics (clawsim) uses the same numbers.
// Closed pose: two C-shaped prongs around a ~24px cavity; hooks cradle from below.
const CLAW_GEO = {
  hubW: 20, hubH: 12,
  pivotL: [-7, 5], pivotR: [7, 5],
  // left prong polygons in prong-local coords (pivot at origin), closed pose
  prong: [
    [[1.8, 0.85], [-1.8, -0.85], [-8.8, 14.2], [-5.2, 15.9]],
    [[-5.5, 13.6], [-8.5, 16.4], [4.9, 30.0], [7.1, 28.0]],
  ],
  // inner face of the left prong (by the pivot, the elbow, the hook tip). With the right prong's
  // mirror image it outlines the cavity the claw really closes around (ClawSim.cavity).
  inner: [[1.8, 0.85], [-4.6, 14.6], [7.1, 28.0]],
};
(() => {
  // prong sprite: grid offset so the pivot lands at (OX, OY)
  const OX = 11, OY = 3;
  let g = PX.grid(21, 36);
  for (const poly of CLAW_GEO.prong) PX.poly(g, poly.map(([x, y]) => [x + OX, y + OY]), 'E');
  g = PX.shade(g, 'E', 'e', 'i');
  PX.disc(g, OX, OY, 3.1, 'q'); PX.set(g, OX - 1, OY - 1, 'r'); PX.set(g, OX, OY - 1, 'R'); PX.set(g, OX - 1, OY, 'R');
  PX.disc(g, OX - 7, OY + 15, 2.2, 'q'); PX.set(g, OX - 8, OY + 14, 'R');
  g = PX.outline(g, 'k');
  const rows = PX.rows(g);
  SPR.def('claw_prongL', { rows, anchor: [OX, OY] });
  SPR.def('claw_prongR', { rows: PX.flipH(rows), anchor: [21 - OX, OY] });

  // hub: rounded housing with a crimson band, cable mount on top
  let h = PX.grid(24, 17);
  PX.poly(h, [[4, 3.5], [20, 3.5], [22, 6], [22, 13], [19.5, 15.5], [4.5, 15.5], [2, 13], [2, 6]], 'i');
  h = PX.shade(h, 'i', 'E', 'I');
  PX.rect(h, 3, 8, 19, 3, 'q'); PX.rect(h, 3, 8, 19, 1, 'R'); PX.set(h, 4, 8, 'r'); PX.set(h, 5, 8, 'r');
  PX.rect(h, 10, 0, 4, 4, 'E'); PX.set(h, 10, 0, 'e'); PX.rect(h, 13, 0, 1, 4, 'i');
  PX.set(h, 6, 5, 'e'); PX.set(h, 7, 5, 'e'); PX.set(h, 8, 5, 'e');
  PX.set(h, 6, 13, 'I'); PX.set(h, 17, 13, 'I');
  h = PX.outline(h, 'k');
  SPR.def('claw_hub', { rows: PX.rows(h), anchor: [12, 9.5] });

  // carriage: trolley riding on the top rail
  let c = PX.grid(26, 11);
  PX.rect(c, 3, 2, 20, 6, 'i'); c = PX.shade(c, 'i', 'E', 'I');
  PX.rect(c, 4, 4, 18, 2, 'q'); PX.rect(c, 4, 4, 18, 1, 'R'); PX.set(c, 5, 4, 'r');
  PX.disc(c, 7, 1.5, 1.7, 'I'); PX.disc(c, 19, 1.5, 1.7, 'I');
  PX.set(c, 6, 1, 'E'); PX.set(c, 18, 1, 'E');
  PX.rect(c, 11, 8, 4, 2, 'I'); PX.set(c, 12, 8, 'E');
  c = PX.outline(c, 'k');
  SPR.def('claw_carriage', { rows: PX.rows(c), anchor: [13, 2] });
})();
