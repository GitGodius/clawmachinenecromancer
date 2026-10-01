// Build: inline planck + all src/js/*.js (in filename order) into single-file pages.
//   node tools/build.mjs
//     index.html          the game as players get it: one self-contained file, works offline / from file://.
//                         No tuning panel, no cheats, no URL flags (see 41_debug.js and BUILD.dev).
//     dev.html            loads the source files directly (edit + refresh) with every developer tool switched on
//     dist/artifact.html  the release page as a fragment, for hosts that wrap it in their own <html>
//     dist/itch/          what to upload to itch.io: index.html at the root of the zip
//     dist/the-good-parts-<version>-itch.zip
// The version comes from package.json and is stamped into the release page.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const DEV_ONLY = ['41_debug.js']; // files a player's page must not contain
const files = fs.readdirSync(path.join(root, 'src/js')).filter((f) => f.endsWith('.js')).sort();
const releaseFiles = files.filter((f) => !DEV_ONLY.includes(f));
const planck = read('vendor/planck.min.js');
const style = read('src/style.css');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const stamp = (src) => src.replace("'0.0.0-dev', /*@version*/", `'${pkg.version}', /*@version*/`);
const gameSrc = (list) => list.map((f) => `// ==== ${f} ====\n` + read('src/js/' + f)).join('\n');
const inline = () => `<script>\n${safe(planck)}\n</script>\n<script>\n"use strict";\n${safe(stamp(gameSrc(releaseFiles)))}\n</script>`;
const dev = ['<script>window.__DEV__ = true;</script>', '<script src="vendor/planck.min.js"></script>', ...files.map((f) => `<script src="src/js/${f}"></script>`)].join('\n');
const strip = (html) => html.replace(/<!--DEV-->[\s\S]*?<!--\/DEV-->\n?/g, '');
const keepDev = (html) => html.replace(/<!--\/?DEV-->/g, '');
const fill = (tpl, scripts) => tpl.replace('/*STYLE*/', () => style).replace('<!--SCRIPTS-->', () => scripts);

fs.writeFileSync(path.join(root, 'index.html'), strip(fill(read('src/shell.html'), inline())));
fs.writeFileSync(path.join(root, 'dev.html'), keepDev(fill(read('src/shell.html'), dev)));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/artifact.html'), strip(fill(read('src/artifact.html'), inline())));

// A deterministic zip (fixed timestamps, so the same source gives the same bytes). Node has no zip writer.
function zipBuffer(entries) {
  const dt = { date: ((2026 - 1980) << 9) | (1 << 5) | 1, time: 0 };
  const locals = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nm = Buffer.from(name), raw = zlib.deflateRawSync(data, { level: 9 }), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dt.time, 10); lh.writeUInt16LE(dt.date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, raw);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dt.time, 12); ch.writeUInt16LE(dt.date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += lh.length + nm.length + raw.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
fs.mkdirSync(path.join(root, 'dist/itch'), { recursive: true });
const release = fs.readFileSync(path.join(root, 'index.html'));
fs.writeFileSync(path.join(root, 'dist/itch/index.html'), release);
const zipName = `dist/the-good-parts-${pkg.version}-itch.zip`;
fs.writeFileSync(path.join(root, zipName), zipBuffer([{ name: 'index.html', data: release }]));
const kb = (p) => (fs.statSync(path.join(root, p)).size / 1024).toFixed(0) + ' KB';
console.log(`v${pkg.version}  index.html ${kb('index.html')} · ${zipName} ${kb(zipName)} · ${releaseFiles.length} release files (${files.length} in dev)`);
