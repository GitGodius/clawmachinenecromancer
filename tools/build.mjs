// Build: inline planck + all src/js/*.js (in filename order) into single-file pages.
//   node tools/build.mjs
//     index.html          the game as players get it: one self-contained file, works offline / from file://.
//                         No tuning panel, no cheats, no URL flags (see 41_debug.js and BUILD.dev).
//     dev.html            loads the source files directly (edit + refresh) with every developer tool switched on
//     dist/artifact.html  the release page as a fragment, for hosts that wrap it in their own <html>
// The version comes from package.json and is stamped into the release page.
import fs from 'node:fs';
import path from 'node:path';
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
const kb = (p) => (fs.statSync(path.join(root, p)).size / 1024).toFixed(0) + ' KB';
console.log(`v${pkg.version}  index.html ${kb('index.html')} · dist/artifact.html ${kb('dist/artifact.html')} · ${releaseFiles.length} release files (${files.length} in dev)`);
