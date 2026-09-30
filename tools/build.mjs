// Build: inline planck + all src/js/*.js (in filename order) into single-file pages.
//   node tools/build.mjs
//     index.html         self-contained page, works offline / from file://
//     dev.html           loads the source files directly (edit + refresh)
//     dist/artifact.html the same game as a page fragment for hosts that wrap it in their own <html>
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const files = fs.readdirSync(path.join(root, 'src/js')).filter((f) => f.endsWith('.js')).sort();
const planck = read('vendor/planck.min.js');
const style = read('src/style.css');
const game = files.map((f) => `// ==== ${f} ====\n` + read('src/js/' + f)).join('\n');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const inline = () => `<script>\n${safe(planck)}\n</script>\n<script>\n"use strict";\n${safe(game)}\n</script>`;
const dev = ['<script src="vendor/planck.min.js"></script>', ...files.map((f) => `<script src="src/js/${f}"></script>`)].join('\n');
const fill = (tpl, scripts) => tpl.replace('/*STYLE*/', () => style).replace('<!--SCRIPTS-->', () => scripts);

fs.writeFileSync(path.join(root, 'index.html'), fill(read('src/shell.html'), inline()));
fs.writeFileSync(path.join(root, 'dev.html'), fill(read('src/shell.html'), dev));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/artifact.html'), fill(read('src/artifact.html'), inline()));
const kb = (p) => (fs.statSync(path.join(root, p)).size / 1024).toFixed(0) + ' KB';
console.log(`index.html ${kb('index.html')} · dist/artifact.html ${kb('dist/artifact.html')} · ${files.length} source files`);
