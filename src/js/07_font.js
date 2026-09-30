// ---------------------------------------------------------------------------
// FONT — two hand-drawn bitmap fonts. ALL game text goes through here (never
// ctx.fillText): glyphs are baked once into a white atlas, tinted per color
// (cached), and blitted at integer positions so text stays crisp at any
// integer scale on the nearest-neighbour upscaled canvas.
//
//   Font.draw(ctx, text, x, y, opts)               -> drawn width (px, widest line)
//   Font.drawWrapped(ctx, text, x, y, maxW, opts)  -> total height (px)
//   Font.measure(text, font = 'main', scale = 1)   -> width of the widest line (px)
//   Font.wrap(text, maxW, font = 'main', scale = 1) -> array of lines
//   Font.lineHeight(font = 'main', scale = 1)      -> px
//
// opts: font 'main' | 'small'       color '#fff' (any CSS color)
//       align 'left'|'center'|'right'  scale 1 (integer)   alpha 1
//       shadow null | color   1px drop shadow straight DOWN, offset (0, 1) * scale.
//                             (1, 1) was tried too: it fills the 1px gaps between
//                             letters and smears small text; (0, 1) keeps every
//                             letter separate. Override: shadowOffset [dx, dy].
//       outline null | color  1px ring in all 8 directions (* scale); with a
//                             shadow too, the shadow is the outlined shape
//       maxChars              typewriter: draw only the first N characters of
//                             `text` (indices into the full string, '\n' and the
//                             spaces eaten by wrapping count as one each). Lines
//                             are laid out from the FULL text, so words never
//                             jump and centred lines never slide while typing.
//       lineHeight            override the font's line height (font pixels)
// (x, y) = top-left of the text box = top of the capitals. For 'center' x is
// the middle, for 'right' the right edge. '\n' starts a new line.
//
// Widths are ink widths: the tracking column after the last glyph is not
// counted, but trailing spaces are, so `x += Font.draw(ctx, 'HP ', x, y)` is
// a valid way to chain differently coloured runs on one line.
//
// 'main'  proportional. cap 7, x-height 5, descender 2 (g j p q y ,), line 11.
//         advance = glyph width + 1, space 3. Printable ASCII plus
//         • ← → ↑ ↓ ▶ ◀ ♥ ★ × … · — ; anything else draws as '?'.
// 'small' 3x5 capitals (lowercase is drawn as capitals), digits, punctuation,
//         arrows/▶◀♥★×•·…—. advance 4 (N O Q 5; M W # arrows ♥ ★ 6), digits
//         all 4 (tabular), line 7, space 3.
//
// Speed: a line drawn with the same look twice is baked into a cached sprite
// (identical pixels) and then costs one drawImage; see lineSprite().
// Extras: Font.metrics(font), Font.chars(font), Font.addGlyph(font, ch, rows)
// (e.g. inline icons: rows are '#'/'.' strings starting at the cap top).
// Loads fine without a DOM (Node): measuring/wrapping work, drawing no-ops.
// ---------------------------------------------------------------------------
const Font = (() => {
  const HAS_DOM = typeof document !== 'undefined';
  const TRACK = 1;             // blank column after every glyph
  const SHADOW = [0, 1];       // default drop-shadow offset in font pixels
  const MAX_TINTS = 48;        // tinted atlas copies kept per font (LRU)
  const MAX_WRAPS = 96;        // cached wrap layouts (dialogue redraws every frame)

  // Header names for glyphs that are awkward inside the sheets or not ASCII.
  const NAMES = {
    bslash: '\\', grave: '`',
    bullet: '\u2022', middot: '\u00B7', ellipsis: '\u2026', mdash: '\u2014', times: '\u00D7',
    larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193',
    tri_r: '\u25B6', tri_l: '\u25C0', heart: '\u2665', star: '\u2605',
  };

  // Look-alikes that reuse an existing glyph instead of falling back to '?'.
  const ALIAS = {
    '\u2018': "'", '\u2019': "'", '\u201A': ',', '\u201C': '"', '\u201D': '"', '\u2032': "'",
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2212': '-', '\u2015': '\u2014',
    '\u00A0': ' ', '\t': ' ', '\u2027': '\u00B7', '\u22C5': '\u00B7', '\u2219': '\u2022',
    '\u25BA': '\u25B6', '\u25B8': '\u25B6', '\u25C4': '\u25C0', '\u25C2': '\u25C0',
    '\u2764': '\u2665', '\u2661': '\u2665', '\u2606': '\u2605', '\u2715': '\u00D7', '\u2716': '\u00D7',
  };
  // Zero-width: CR, zero-width space/joiners, variation selectors, low surrogates
  // (so an emoji becomes a single '?').
  const ZERO_WIDTH = /[\r\u200B-\u200D\u2060\uFE00-\uFE0F\uDC00-\uDFFF]/;

  // Glyph sheets. Each block is a header line naming the glyphs (a single
  // character, a name from NAMES, or U+XXXX) followed by one line per pixel row;
  // the n-th token of every row belongs to the n-th glyph ('#' ink, '.' blank).
  // Row 0 is the top of the capitals; the glyph width is the token width.
  const MAIN_SHEET = String.raw`
    A    B    C    D    E    F    G    H    I   J    K    L    M     N     O    P    Q    R    S
    .##. ###. .##. ###. #### #### .##. #..# ### ...# #..# #... #...# #...# .##. ###. .##. ###. .##.
    #..# #..# #..# #..# #... #... #..# #..# .#. ...# #..# #... ##.## #...# #..# #..# #..# #..# #..#
    #..# #..# #... #..# #... #... #... #..# .#. ...# #.#. #... #.#.# ##..# #..# #..# #..# #..# #...
    #### ###. #... #..# ###. ###. #.## #### .#. ...# ##.. #... #.#.# #.#.# #..# ###. #..# ###. .##.
    #..# #..# #... #..# #... #... #..# #..# .#. ...# #.#. #... #...# #..## #..# #... #..# #.#. ...#
    #..# #..# #..# #..# #... #... #..# #..# .#. #..# #..# #... #...# #...# #..# #... #..# #..# #..#
    #..# ###. .##. ###. #### #... .### #..# ### .##. #..# #### #...# #...# .##. #... .##. #..# .##.
    .... .... .... .... .... .... .... .... ... .... .... .... ..... ..... .... .... ..## .... ....
    .... .... .... .... .... .... .... .... ... .... .... .... ..... ..... .... .... .... .... ....

    T     U    V     W     X     Y     Z
    ##### #..# #...# #...# #...# #...# #####
    ..#.. #..# #...# #...# #...# #...# ....#
    ..#.. #..# #...# #...# .#.#. .#.#. ...#.
    ..#.. #..# #...# #.#.# ..#.. ..#.. ..#..
    ..#.. #..# .#.#. #.#.# .#.#. ..#.. .#...
    ..#.. #..# .#.#. #.#.# #...# ..#.. #....
    ..#.. .##. ..#.. .#.#. #...# ..#.. #####
    ..... .... ..... ..... ..... ..... .....
    ..... .... ..... ..... ..... ..... .....

    a    b    c    d    e    f   g    h    i j  k    l  m     n    o    p    q    r   s    t   u
    .... #... .... ...# .... .## .... #... # .# #... #. ..... .... .... .... .... ... .... ... ....
    .... #... .... ...# .... .#. .... #... . .. #... #. ..... .... .... .... .... ... .... .#. ....
    .##. ###. .### .### .##. ### .### ###. # .# #..# #. ####. ###. .##. ###. .### #.# .### ### #..#
    ...# #..# #... #..# #..# .#. #..# #..# # .# #.#. #. #.#.# #..# #..# #..# #..# ##. #... .#. #..#
    .### #..# #... #..# #### .#. #..# #..# # .# ##.. #. #.#.# #..# #..# #..# #..# #.. .##. .#. #..#
    #..# #..# #... #..# #... .#. #..# #..# # .# #.#. #. #.#.# #..# #..# #..# #..# #.. ...# .#. #..#
    .### ###. .### .### .### .#. .### #..# # .# #..# .# #.#.# #..# .##. ###. .### #.. ###. ..# .###
    .... .... .... .... .... ... ...# .... . .# .... .. ..... .... .... #... ...# ... .... ... ....
    .... .... .... .... .... ... .##. .... . #. .... .. ..... .... .... #... ...# ... .... ... ....

    v     w     x     y    z
    ..... ..... ..... .... ....
    ..... ..... ..... .... ....
    #...# #...# #...# #..# ####
    #...# #...# .#.#. #..# ..#.
    .#.#. #.#.# ..#.. #..# .#..
    .#.#. #.#.# .#.#. #..# #...
    ..#.. .#.#. #...# .### ####
    ..... ..... ..... ...# ....
    ..... ..... ..... .##. ....

    0    1   2    3    4    5    6    7    8    9
    .##. .#. .##. .##. ...# #### .##. #### .##. .##.
    #..# ##. #..# #..# ..## #... #... ...# #..# #..#
    #..# .#. ...# ...# .#.# ###. #... ...# #..# #..#
    #.## .#. ..#. .##. #..# ...# ###. ..#. .##. .###
    ##.# .#. .#.. ...# #### ...# #..# .#.. #..# ...#
    #..# .#. #... #..# ...# #..# #..# .#.. #..# ...#
    .##. ### #### .##. ...# .##. .##. .#.. .##. .##.
    .... ... .... .... .... .... .... .... .... ....
    .... ... .... .... .... .... .... .... .... ....

    ! "   #     $     %     &     ' (  )  *     +     ,  -   . /   : ;  <   =    >   ?    @     [
    # #.# ..... ..#.. ##... .##.. # .# #. ..... ..... .. ... . ..# . .. ... .... ... .##. .###. ##
    # #.# .#.#. .#### ##..# #..#. # #. .# #.#.# ..#.. .. ... . ..# . .. ..# .... #.. #..# #...# #.
    # ... ##### #.#.. ...#. #.#.. . #. .# .###. ..#.. .. ... . .#. # .# .#. #### .#. ...# #.### #.
    # ... .#.#. .###. ..#.. .#... . #. .# #.#.# ##### .. ### . .#. . .. #.. .... ..# ..#. #.#.# #.
    # ... ##### ..#.# .#... #.#.# . #. .# ..... ..#.. .. ... . .#. . .. .#. #### .#. .#.. #.### #.
    . ... .#.#. ####. #..## #..#. . #. .# ..... ..#.. .. ... . #.. . .. ..# .... #.. .... #.... #.
    # ... ..... ..#.. ...## .##.# . #. .# ..... ..... .# ... # #.. # .# ... .... ... .#.. .###. #.
    . ... ..... ..... ..... ..... . .# #. ..... ..... .# ... . ... . .# ... .... ... .... ..... ##
    . ... ..... ..... ..... ..... . .. .. ..... ..... #. ... . ... . #. ... .... ... .... ..... ..

    bslash ]  ^   _    grave {   | }   ~
    #..    ## .#. .... #.    ..# # #.. .....
    #..    .# #.# .... .#    .#. # .#. .....
    .#.    .# ... .... ..    .#. # .#. .....
    .#.    .# ... .... ..    #.. # ..# .##.#
    .#.    .# ... .... ..    .#. # .#. #..#.
    ..#    .# ... .... ..    .#. # .#. .....
    ..#    .# ... .... ..    .#. # .#. .....
    ...    ## ... #### ..    ..# # #.. .....
    ...    .. ... .... ..    ... . ... .....

    bullet middot ellipsis mdash   times larr  rarr  uarr  darr  tri_r tri_l heart star
    ..     .      .....    ....... ...   ..... ..... ..... ..... ...   ...   ..... .....
    ..     .      .....    ....... ...   ..#.. ..#.. ..#.. ..#.. #..   ..#   ##.## ..#..
    ..     .      .....    ....... #.#   .#... ...#. .###. ..#.. ##.   .##   ##### ..#..
    ##     #      .....    ####### .#.   ##### ##### #.#.# #.#.# ###   ###   ##### #####
    ##     .      .....    ....... #.#   .#... ...#. ..#.. .###. ##.   .##   .###. .###.
    ..     .      .....    ....... ...   ..#.. ..#.. ..#.. ..#.. #..   ..#   ..#.. .#.#.
    ..     .      #.#.#    ....... ...   ..... ..... ..... ..... ...   ...   ..... .....
    ..     .      .....    ....... ...   ..... ..... ..... ..... ...   ...   ..... .....
    ..     .      .....    ....... ...   ..... ..... ..... ..... ...   ...   ..... .....
`;

  const SMALL_SHEET = String.raw`
    A   B   C   D   E   F   G   H   I   J   K   L   M     N    O    P   Q    R   S   T   U   V   W
    .#. ##. .## ##. ### ### .## #.# ### ..# #.# #.. #...# #..# .##. ##. .##. ##. .## ### #.# #.# #...#
    #.# #.# #.. #.# #.. #.. #.. #.# .#. ..# #.# #.. ##.## ##.# #..# #.# #..# #.# #.. .#. #.# #.# #...#
    ### ##. #.. #.# ##. ##. #.# ### .#. ..# ##. #.. #.#.# #.## #..# ##. #..# ##. .#. .#. #.# #.# #.#.#
    #.# #.# #.. #.# #.. #.. #.# #.# .#. #.# #.# #.. #...# #..# #..# #.. #.#. #.# ..# .#. #.# #.# ##.##
    #.# ##. .## ##. ### #.. .## #.# ### .#. #.# ### #...# #..# .##. #.. .#.# #.# ##. .#. ### .#. #...#
    ... ... ... ... ... ... ... ... ... ... ... ... ..... .... .... ... .... ... ... ... ... ... .....

    X   Y   Z
    #.# #.# ###
    #.# #.# ..#
    .#. .#. .#.
    #.# .#. #..
    #.# .#. ###
    ... ... ...

    0   1   2   3   4   5   6   7   8   9
    ### .#. ##. ##. #.# ### .## ### ### ###
    #.# ##. ..# ..# #.# #.. #.. ..# #.# #.#
    #.# .#. .#. .#. ### ##. ### .#. ### ###
    #.# .#. #.. ..# ..# ..# #.# .#. #.# ..#
    ### ### ### ##. ..# ##. ### .#. ### ##.
    ... ... ... ... ... ... ... ... ... ...

    . ,  : ;  ! ?   ' "   -   +   /   (  )  %   <   >   =   #     *   _   [  ]
    . .. . .. # ##. # #.# ... ... ..# .# #. #.# ..# #.. ... .#.#. #.# ... ## ##
    . .. # .# # ..# # #.# ... .#. ..# #. .# ..# .#. .#. ### ##### .#. ... #. .#
    . .. . .. # .#. . ... ### ### .#. #. .# .#. #.. ..# ... .#.#. #.# ... #. .#
    . .. # .# . ... . ... ... .#. #.. #. .# #.. .#. .#. ### ##### ... ... #. .#
    # .# . #. # .#. . ... ... ... #.. .# #. #.# ..# #.. ... .#.#. ... ... ## ##
    . #. . .. . ... . ... ... ... ... .. .. ... ... ... ... ..... ... ### .. ..

    larr  rarr  uarr  darr  tri_r tri_l heart star  times bullet middot ellipsis mdash
    ..#.. ..#.. ..#.. ..#.. #..   ..#   ..... ..#.. ...   ..     .      .....    .....
    .#... ...#. .###. ..#.. ##.   .##   ##.## ..#.. #.#   ..     .      .....    .....
    ##### ##### #.#.# #.#.# ###   ###   ##### ##### .#.   ##     #      .....    #####
    .#... ...#. ..#.. .###. ##.   .##   .###. .###. #.#   ##     .      .....    .....
    ..#.. ..#.. ..#.. ..#.. #..   ..#   ..#.. .#.#. ...   ..     .      #.#.#    .....
    ..... ..... ..... ..... ...   ...   ..... ..... ...   ..     .      .....    .....
`;

  const DEFS = {
    main: {
      sheet: MAIN_SHEET, rows: 9, cap: 7, xHeight: 5, descender: 2, lineHeight: 11, space: 3, upper: false,
      // [left glyphs, right glyphs, adjust] — only pairs whose shapes interlock
      // without touching (checked pixel-by-pixel when the table was written).
      kern: [
        ['T', 'acegmnopqrsuvwxyz.,', -1],
        ['F', 'acegmnopqrsuvwxyz.,', -1],
        ['Y', 'acegoqs.,', -1],
        ['PV', '.,', -1],
        ['L', 'TVY\'"', -1],
        ['r', '.,', -1],
      ],
    },
    small: {
      sheet: SMALL_SHEET, rows: 6, cap: 5, xHeight: 5, descender: 1, lineHeight: 7, space: 3, upper: true,
      kern: [],
    },
  };

  const ZERO = { ch: '', w: 0, adv: 0, blank: true, bits: null, sx: 0, sy: 0 };
  const NO_OPTS = {};
  const fonts = Object.create(null);

  function warn(msg) { if (typeof console !== 'undefined') console.warn('Font: ' + msg); }

  // ---- building ------------------------------------------------------------
  function nameToChar(tok) {
    if (tok.length === 1) return tok;
    if (NAMES[tok]) return NAMES[tok];
    if (/^U\+[0-9A-Fa-f]{2,6}$/.test(tok)) return String.fromCodePoint(parseInt(tok.slice(2), 16));
    return null;
  }

  function makeGlyph(f, ch, rowStrs) {
    const rows = f.rows;
    let w = 0;
    for (const r of rowStrs) w = Math.max(w, r.length);
    const bits = new Uint8Array(w * rows);
    for (let y = 0; y < rows; y++) {
      const r = rowStrs[y] || '';
      if (y < rowStrs.length && r.length !== w) warn(`${f.name} '${ch}' row ${y} is ${r.length} wide, expected ${w}`);
      for (let x = 0; x < r.length; x++) if (r[x] === '#') bits[y * w + x] = 1;
    }
    return { ch, w, adv: w + TRACK, blank: false, bits, sx: 0, sy: 0 };
  }

  function parseSheet(f, src) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length;) {
      const head = lines[i].trim();
      if (!head) { i++; continue; }
      const names = head.split(/\s+/);
      const grid = [];
      for (let r = 1; r <= f.rows; r++) grid.push((lines[i + r] || '').trim().split(/\s+/));
      for (let k = 0; k < names.length; k++) {
        const ch = nameToChar(names[k]);
        if (ch == null) { warn(`${f.name}: unknown glyph name '${names[k]}'`); continue; }
        f.glyphs.set(ch, makeGlyph(f, ch, grid.map((toks) => toks[k] || '')));
      }
      i += f.rows + 1;
    }
  }

  function build(name) {
    const d = DEFS[name];
    const f = {
      name, rows: d.rows, lh: d.lineHeight, upper: d.upper, d,
      glyphs: new Map(), look: new Map(), kern: {},
      atlas: null, ring: null, tints: new Map(), fallback: null,
    };
    parseSheet(f, d.sheet);
    f.glyphs.set(' ', { ch: ' ', w: 0, adv: d.space, blank: true, bits: null, sx: 0, sy: 0 });
    f.fallback = f.glyphs.get('?');
    for (const [ls, rs, v] of d.kern) {
      for (const a of ls) {
        const row = f.kern[a] || (f.kern[a] = {});
        for (const b of rs) row[b] = v;
      }
    }
    return f;
  }

  function font(name) {
    const key = typeof name === 'string' && Object.prototype.hasOwnProperty.call(DEFS, name) ? name : 'main';
    return fonts[key] || (fonts[key] = build(key));
  }

  function glyphOf(f, ch) {
    let g = f.look.get(ch);
    if (g !== undefined) return g;
    g = f.glyphs.get(ch);
    if (!g) {
      if (ZERO_WIDTH.test(ch)) g = ZERO;
      else {
        let c = ALIAS[ch] || ch;
        if (f.upper) { const u = c.toUpperCase(); if (u.length === 1) c = u; }
        g = f.glyphs.get(c) || f.fallback;
      }
    }
    f.look.set(ch, g);
    return g;
  }

  function scaleOf(v) {
    const s = Math.round(v || 1);
    return s > 1 ? s : 1;
  }

  function str(t) { return t == null ? '' : String(t); }

  // ---- atlas + tints (DOM only, built on first draw) -------------------------
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    return c;
  }

  function maskCanvas(mask, W, H) {
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < mask.length; i++) if (mask[i]) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = d[i * 4 + 3] = 255;
    g.putImageData(img, 0, 0);
    return c;
  }

  // Every glyph gets a cell with a 1px moat: the plain atlas holds the glyph,
  // the ring atlas the glyph dilated by 1px in 8 directions (outline pass: one
  // blit per glyph instead of eight, identical result at any integer scale).
  function buildAtlas(f) {
    const cellH = f.rows + 2;
    const list = [];
    for (const g of f.glyphs.values()) if (!g.blank) list.push(g);
    let x = 0, y = 0, W = 1;
    for (const g of list) {
      const cw = g.w + 2;
      if (x + cw > 256) { x = 0; y += cellH; }
      g.sx = x + 1; g.sy = y + 1;
      x += cw; if (x > W) W = x;
    }
    const H = y + cellH;
    const main = new Uint8Array(W * H), ring = new Uint8Array(W * H);
    for (const g of list) {
      for (let py = 0; py < f.rows; py++) {
        for (let px = 0; px < g.w; px++) {
          if (!g.bits[py * g.w + px]) continue;
          const ax = g.sx + px, ay = g.sy + py;
          main[ay * W + ax] = 1;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ring[(ay + dy) * W + ax + dx] = 1;
        }
      }
    }
    f.atlas = maskCanvas(main, W, H);
    f.ring = maskCanvas(ring, W, H);
  }

  function tint(f, color, ring) {
    const key = (ring ? 'r' : 'g') + color;
    const m = f.tints;
    let c = m.get(key);
    if (c !== undefined) { m.delete(key); m.set(key, c); return c; }
    const src = ring ? f.ring : f.atlas;
    c = canvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    m.set(key, c);
    if (m.size > MAX_TINTS) m.delete(m.keys().next().value);
    return c;
  }

  // ---- measuring -------------------------------------------------------------
  function kernOf(f, prev, g) {
    const row = f.kern[prev.ch];
    return row === undefined ? 0 : row[g.ch] || 0;
  }

  // Width (font px) of text[s, e): rightmost ink, or the full advance of a trailing space.
  function lineWidth(f, text, s, e) {
    let pen = 0, w = 0, prev = null;
    for (let i = s; i < e; i++) {
      const g = glyphOf(f, text[i]);
      if (g === ZERO) continue;
      if (prev !== null) pen += kernOf(f, prev, g);
      const right = pen + (g.blank ? g.adv : g.w);
      if (right > w) w = right;
      pen += g.adv;
      prev = g;
    }
    return w;
  }

  // Line ranges as a flat [start, end, start, end, ...] array of indices into text.
  const LINES = [];
  function splitLines(text) {
    let n = 0, p = 0;
    for (;;) {
      let e = text.indexOf('\n', p);
      if (e < 0) e = text.length;
      LINES[n++] = p; LINES[n++] = e;
      if (e >= text.length) break;
      p = e + 1;
    }
    return n >> 1;
  }

  // Greedy word wrap of one paragraph text[s, e) into `out`. Breaks at spaces
  // (the spaces are dropped), after a '-' inside a word, and splits words that
  // are wider than the whole line.
  function wrapPara(f, text, s, e, maxW, out) {
    if (s >= e) { out.push(s, s); return; }
    let ls = s;
    while (ls < e) {
      let pen = 0, prev = null, brk = -1, i = ls;
      for (; i < e; i++) {
        const ch = text[i];
        const g = glyphOf(f, ch);
        if (g === ZERO) continue;
        const k = prev !== null ? kernOf(f, prev, g) : 0;
        if (ch === ' ' || ch === '\t') {
          const pc = text[i - 1];
          if (i > ls && pc !== ' ' && pc !== '\t') brk = i;
        } else if (!g.blank) {
          if (i > ls && pen + k + g.w > maxW) break;
          if ((ch === '-' || ch === '\u2014') && i > ls && i + 1 < e && text[i + 1] !== ' ' && text[i - 1] !== ' ') brk = i + 1;
        }
        pen += k + g.adv;
        prev = g;
      }
      if (i >= e) { out.push(ls, e); return; }
      let end = i, next = i;
      if (brk > ls) {
        end = next = brk;
        while (next < e && (text[next] === ' ' || text[next] === '\t')) next++;
      }
      out.push(ls, end);
      ls = next;
    }
  }

  const WRAPS = new Map();
  function wrapRanges(f, text, maxW) {
    const key = f.name + '\u0001' + maxW + '\u0001' + text;
    let r = WRAPS.get(key);
    if (r !== undefined) { WRAPS.delete(key); WRAPS.set(key, r); return r; }
    r = [];
    if (text) {
      let p = 0;
      for (;;) {
        let e = text.indexOf('\n', p);
        if (e < 0) e = text.length;
        wrapPara(f, text, p, e, maxW, r);
        if (e >= text.length) break;
        p = e + 1;
      }
    }
    WRAPS.set(key, r);
    if (WRAPS.size > MAX_WRAPS) WRAPS.delete(WRAPS.keys().next().value);
    return r;
  }

  // ---- drawing -------------------------------------------------------------
  // Glyph placement buffers (reused, no per-call garbage): Q holds the glyphs
  // queued by the current call, B a line being baked into a sprite, so baking
  // never clobbers glyphs that are already queued.
  const Q = { g: [], x: [], y: [], n: 0 };
  const B = { g: [], x: [], y: [], n: 0 };
  const NO_SHIFT = [0, 0];

  // Append the glyphs of text[s, e) to buf with the pen starting at (x0, y0).
  function place(buf, f, text, s, e, x0, y0, sc) {
    let pen = 0, prev = null, n = buf.n;
    for (let i = s; i < e; i++) {
      const g = glyphOf(f, text[i]);
      if (g === ZERO) continue;
      if (prev !== null) pen += kernOf(f, prev, g);
      if (!g.blank) { buf.g[n] = g; buf.x[n] = x0 + pen * sc; buf.y[n] = y0; n++; }
      pen += g.adv;
      prev = g;
    }
    buf.n = n;
  }

  function blit(ctx, buf, img, s, rows, ring, ox, oy) {
    const G = buf.g, X = buf.x, Y = buf.y, n = buf.n;
    if (ring) {
      const h = (rows + 2) * s;
      for (let k = 0; k < n; k++) {
        const g = G[k];
        ctx.drawImage(img, g.sx - 1, g.sy - 1, g.w + 2, rows + 2, X[k] - s + ox, Y[k] - s + oy, (g.w + 2) * s, h);
      }
    } else {
      const h = rows * s;
      for (let k = 0; k < n; k++) {
        const g = G[k];
        ctx.drawImage(img, g.sx, g.sy, g.w, rows, X[k] + ox, Y[k] + oy, g.w * s, h);
      }
    }
  }

  // Back to front: shadow (of the outlined shape when outlined), outline, fill.
  function paint(ctx, f, buf, s, o, ox, oy) {
    const ring = !!o.outline;
    if (o.shadow) {
      const so = o.shadowOffset || SHADOW;
      blit(ctx, buf, tint(f, o.shadow, ring), s, f.rows, ring, ox + so[0] * s, oy + so[1] * s);
    }
    if (ring) blit(ctx, buf, tint(f, o.outline, true), s, f.rows, true, ox, oy);
    blit(ctx, buf, tint(f, o.color || '#fff', false), s, f.rows, false, ox, oy);
  }

  // Pixel bounds of everything paint() would touch for buf: [x0, y0, x1, y1).
  function bounds(f, buf, s, o) {
    const pad = o.outline ? s : 0;
    const so = o.shadow ? (o.shadowOffset || SHADOW) : NO_SHIFT;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < buf.n; k++) {
      const X = buf.x[k], Y = buf.y[k];
      if (X < x0) x0 = X;
      if (Y < y0) y0 = Y;
      if (X + buf.g[k].w * s > x1) x1 = X + buf.g[k].w * s;
      if (Y + f.rows * s > y1) y1 = Y + f.rows * s;
    }
    return [x0 + Math.min(0, so[0] * s) - pad, y0 + Math.min(0, so[1] * s) - pad,
      x1 + Math.max(0, so[0] * s) + pad, y1 + Math.max(0, so[1] * s) + pad];
  }

  // Layered text (outline/shadow) drawn with alpha < 1 is flattened offscreen
  // first, otherwise the overlapping layers would show through each other.
  let fadeBuf = null, fadeCtx = null;
  function paintFaded(ctx, f, buf, s, o, alpha) {
    const [x0, y0, x1, y1] = bounds(f, buf, s, o);
    const w = x1 - x0, h = y1 - y0;
    if (!fadeBuf || fadeBuf.width < w || fadeBuf.height < h) {
      fadeBuf = canvas(Math.max(w, fadeBuf ? fadeBuf.width : 0), Math.max(h, fadeBuf ? fadeBuf.height : 0));
      fadeCtx = fadeBuf.getContext('2d');
    }
    fadeCtx.clearRect(0, 0, w, h);
    fadeCtx.imageSmoothingEnabled = false;
    paint(fadeCtx, f, buf, s, o, -x0, -y0);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    ctx.drawImage(fadeBuf, 0, 0, w, h, x0, y0, w, h);
    ctx.globalAlpha = a0;
  }

  // Line sprites: a line drawn with the same look twice gets baked into its
  // own small canvas (every pass flattened) and from then on costs a single
  // drawImage instead of one to three per glyph. Pixels are identical to
  // drawing glyph by glyph. Lines seen once (ticking timers, the line being
  // typed) never allocate. Alpha is applied when the sprite is drawn.
  const SPRITES = new Map(), SEEN = new Map();
  const MAX_SPRITES = 256, MAX_SEEN = 512, SPRITE_MIN = 3;

  function lineSprite(f, text, ls, le, s, o) {
    const key = f.name + '|' + s + '|' + (o.color || '#fff') + '|' + (o.outline || '') + '|' +
      (o.shadow ? o.shadow + '@' + (o.shadowOffset || SHADOW) : '') + '|' + text.slice(ls, le);
    let e = SPRITES.get(key);
    if (e !== undefined) { SPRITES.delete(key); SPRITES.set(key, e); return e; }
    if (!SEEN.has(key)) {
      SEEN.set(key, 1);
      if (SEEN.size > MAX_SEEN) SEEN.delete(SEEN.keys().next().value);
      return null;
    }
    SEEN.delete(key);
    B.n = 0;
    place(B, f, text, ls, le, 0, 0, s);
    const [x0, y0, x1, y1] = bounds(f, B, s, o);
    const c = canvas(x1 - x0, y1 - y0);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (B.n) paint(g, f, B, s, o, -x0, -y0);
    e = { c, x0: B.n ? x0 : 0, y0: B.n ? y0 : 0 };
    SPRITES.set(key, e);
    if (SPRITES.size > MAX_SPRITES) SPRITES.delete(SPRITES.keys().next().value);
    return e;
  }

  function render(ctx, f, text, ranges, nLines, x, y, o) {
    const s = scaleOf(o.scale);
    const lh = (o.lineHeight || f.lh) * s;
    const limit = o.maxChars == null ? Infinity : o.maxChars;
    const alpha = o.alpha == null ? 1 : o.alpha;
    const live = !!ctx && HAS_DOM && alpha > 0;
    const align = o.align;
    let widest = 0, smooth = false, a0 = 1;
    if (live) {
      if (!f.atlas) buildAtlas(f);
      smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      a0 = ctx.globalAlpha;
    }
    Q.n = 0;
    for (let li = 0; li < nLines; li++) {
      const ls = ranges[li * 2], le = ranges[li * 2 + 1];
      const w = lineWidth(f, text, ls, le);
      if (w > widest) widest = w;
      if (!live || ls >= limit) continue;
      const x0 = Math.round(align === 'center' ? x - (w * s) / 2 : align === 'right' ? x - w * s : x);
      const y0 = Math.round(y + li * lh);
      if (le <= limit && le - ls >= SPRITE_MIN) {
        const e = lineSprite(f, text, ls, le, s, o);
        if (e !== null) {
          ctx.globalAlpha = a0 * alpha;
          ctx.drawImage(e.c, x0 + e.x0, y0 + e.y0);
          continue;
        }
      }
      place(Q, f, text, ls, le < limit ? le : limit, x0, y0, s);
    }
    if (live) {
      ctx.globalAlpha = a0;
      if (Q.n) {
        // Translucent layered text (the caller's globalAlpha counts too) is
        // flattened first, exactly like a baked sprite.
        if ((o.outline || o.shadow) && a0 * alpha < 1) paintFaded(ctx, f, Q, s, o, alpha);
        else {
          ctx.globalAlpha = a0 * alpha;
          paint(ctx, f, Q, s, o, 0, 0);
          ctx.globalAlpha = a0;
        }
      }
      ctx.imageSmoothingEnabled = smooth;
    }
    return widest * s;
  }

  // ---- public API ------------------------------------------------------------
  function draw(ctx, text, x, y, opts) {
    const o = opts || NO_OPTS;
    const f = font(o.font);
    text = str(text);
    return render(ctx, f, text, LINES, splitLines(text), x, y, o);
  }

  function drawWrapped(ctx, text, x, y, maxWidth, opts) {
    const o = opts || NO_OPTS;
    const f = font(o.font);
    const s = scaleOf(o.scale);
    text = str(text);
    const r = wrapRanges(f, text, Math.floor(maxWidth / s));
    render(ctx, f, text, r, r.length >> 1, x, y, o);
    return (r.length >> 1) * (o.lineHeight || f.lh) * s;
  }

  // measure / wrap / lineHeight also accept the draw opts object in place of
  // (font, scale), e.g. Font.measure('HP', { font: 'small', scale: 2 }).
  function measure(text, fontName = 'main', scale = 1) {
    if (fontName && typeof fontName === 'object') { scale = fontName.scale; fontName = fontName.font; }
    const f = font(fontName);
    text = str(text);
    const n = splitLines(text);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const lw = lineWidth(f, text, LINES[i * 2], LINES[i * 2 + 1]);
      if (lw > w) w = lw;
    }
    return w * scaleOf(scale);
  }

  function wrap(text, maxWidth, fontName = 'main', scale = 1) {
    if (fontName && typeof fontName === 'object') { scale = fontName.scale; fontName = fontName.font; }
    const f = font(fontName);
    text = str(text);
    const r = wrapRanges(f, text, Math.floor(maxWidth / scaleOf(scale)));
    const out = [];
    for (let i = 0; i < r.length; i += 2) out.push(text.slice(r[i], r[i + 1]));
    return out;
  }

  function lineHeight(fontName = 'main', scale = 1) {
    if (fontName && typeof fontName === 'object') {
      const o = fontName;
      return (o.lineHeight || font(o.font).lh) * scaleOf(o.scale);
    }
    return font(fontName).lh * scaleOf(scale);
  }

  function metrics(fontName = 'main') {
    const d = font(fontName).d;
    return { cap: d.cap, xHeight: d.xHeight, descender: d.descender, lineHeight: d.lineHeight, space: d.space, rows: d.rows };
  }

  function chars(fontName = 'main') {
    let out = '';
    for (const ch of font(fontName).glyphs.keys()) if (ch !== ' ') out += ch;
    return out;
  }

  // Define or replace a glyph, e.g. an inline icon: Font.addGlyph('main', '\\uE000', ['.##.', ...]).
  function addGlyph(fontName, ch, rows) {
    const f = font(fontName);
    f.glyphs.set(ch, makeGlyph(f, ch, rows));
    if (ch === '?') f.fallback = f.glyphs.get('?');
    f.look.clear();
    f.tints.clear();
    f.atlas = f.ring = null;
    WRAPS.clear();
    SPRITES.clear();
    SEEN.clear();
  }

  return { draw, drawWrapped, measure, wrap, lineHeight, metrics, chars, addGlyph };
})();
