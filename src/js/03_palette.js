// ---------------------------------------------------------------------------
// PALETTE — every sprite is written with these single-character color keys.
// '.' (or ' ') is transparent. Keep art inside this palette so it all matches.
// ---------------------------------------------------------------------------
const PAL = {
  // darks / night purples
  k: '#0e0b16', // outline (near-black purple)
  K: '#1b1526',
  1: '#261d35',
  2: '#33274a',
  3: '#45365f',
  4: '#5b4a78',
  5: '#7a6a9a',
  // bone
  w: '#fff6e3', W: '#ecdcbc', b: '#cdb892', B: '#a08962', n: '#6f5c42', N: '#43382a',
  // flesh
  f: '#fbd0b4', F: '#eaa588', g: '#c77c6a', G: '#95525a', h: '#5e2f40',
  // zombie / ogre green
  z: '#c6e3a0', Z: '#93c47d', y: '#66a06a', Y: '#3f6e55', x: '#274536',
  // blood / heart red
  r: '#ff7d8a', R: '#e8405a', q: '#b0224a', Q: '#6d1438',
  // purple (tentacles, demon, magic)
  p: '#e7a6f0', P: '#b56bd6', o: '#7e3fa6', O: '#4c2270',
  // gold (legendary)
  l: '#fff1a6', L: '#f6c64b', m: '#cf8a2e', M: '#80501c',
  // cyan / blue (rare, neon, glass)
  c: '#c2f5ff', C: '#6fd3ff', v: '#3a88d8', V: '#22418c',
  // metal (claw, sword)
  e: '#e4e9f2', E: '#a6aec2', i: '#677089', I: '#3c4257',
  // wood
  t: '#d09a64', T: '#9c6538', u: '#633d24', U: '#3b2418',
  // glows
  a: '#ff4040', // eye red
  A: '#ffb070', // ember / candle
  s: '#3d3450', S: '#231d31', // black fur / cloth
  j: '#ffffff',
  d: '#9be38f', D: '#4fae6c', // slab-lab green
};

// Rarity presentation (shared by claw, slab, battle UI)
const RARITY = {
  common:    { name: 'Common',    color: '#cdb892', glow: null,      order: 0 },
  uncommon:  { name: 'Uncommon',  color: '#93c47d', glow: '#93c47d', order: 1 },
  rare:      { name: 'Rare',      color: '#6fd3ff', glow: '#6fd3ff', order: 2 },
  legendary: { name: 'Legendary', color: '#f6c64b', glow: '#f6c64b', order: 3 },
};
