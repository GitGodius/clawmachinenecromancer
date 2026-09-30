// Validate sprite defs (row lengths, palette keys) headlessly.
const fs = require('fs'), vm = require('vm');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['03_palette.js', '04_sprites_core.js', '05_sprites_parts.js'];
const src = files.map((f) => fs.readFileSync('src/js/' + f, 'utf8')).join('\n') + '\n;globalThis.__S = SPR; globalThis.__P = PAL;';
const ctx = { console }; vm.createContext(ctx); vm.runInContext(src, ctx);
let bad = 0;
for (const [n, d] of Object.entries(ctx.__S.defs)) {
  const L = d.rows.map((r) => r.length);
  if (L.some((l) => l !== L[0])) { bad++; console.log('ROW LENGTH', n, L.join(',')); }
  for (const r of d.rows) for (const ch of r) if (ch !== '.' && ch !== ' ' && !(ch in ctx.__P)) { bad++; console.log('BAD KEY', n, JSON.stringify(ch)); }
}
console.log('sprites:', Object.keys(ctx.__S.defs).length, 'problems:', bad);
