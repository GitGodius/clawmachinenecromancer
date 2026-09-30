// One way to load the real game code into Node, for every bot and test.
//
// The game is plain scripts sharing one global scope (see tools/build.mjs). This runs those same files, in
// filename order, inside a vm context, so a bot exercises exactly the code the browser runs.
//
//   const game = loadGame();                    // everything except the DOM-only files
//   game.seed(7);                               // reproducible gameplay AND cosmetic randomness
//   game.get('CONFIG').startTokens              // read any top-level const/class/let
//   game.run('Game.newGame()')                  // run code in the game's scope
//
// Top-level `const`/`class`/`let` are visible to later vm.runInContext calls in the same context, so `get`
// works for them even though they are not properties of globalThis.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SRC = new URL('../../src/js/', import.meta.url);

// Files that need a real page (DOM overlays, boot). Everything else is written to load headless.
export const DOM_ONLY = ['99_main.js', '41_debug.js', '42_dom.js'];

export function sourceFiles({ only, skip = DOM_ONLY } = {}) {
  const all = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  return only ? all.filter((f) => only.includes(f)) : all.filter((f) => !skip.includes(f));
}

export function loadGame(opts = {}) {
  const files = opts.files || sourceFiles(opts);
  const planck = require('planck');
  const store = new Map(); // stand-in for localStorage so save code can be tested
  const ctx = {
    planck, console, performance, setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: {}, window: null, ...(opts.globals || {}),
  };
  ctx.window = ctx;
  if (!(opts.globals && opts.globals.localStorage)) ctx.localStorage = opts.storage === false ? undefined : {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  vm.createContext(ctx);
  vm.runInContext(files.map((f) => fs.readFileSync(new URL(f, SRC), 'utf8')).join('\n'), ctx, { filename: 'game.js' });
  const run = (code) => vm.runInContext(code, ctx);
  if (files.includes('09_store.js')) run('Save.enabled = false'); // bots and tests never write a save unless a test turns it on
  const api = {
    ctx, run, files, storage: store,
    get: (name) => run(name),
    has: (name) => run(`typeof ${name} !== 'undefined'`),
    // both streams: gameplay (RNG) and cosmetic (VRNG)
    seed(n) { run(`RNG = mulberry32(${n >>> 0}); VRNG = mulberry32(${(n * 2654435761 + 1) >>> 0})`); },
    seedGameplay(n) { run(`RNG = mulberry32(${n >>> 0})`); },
    // defaults back on every tunable (bots that sweep CONFIG call this between sets)
    resetConfig(extra) { run('Object.assign(CONFIG, CONFIG_DEFAULTS)'); if (extra) for (const k in extra) run(`CONFIG[${JSON.stringify(k)}] = ${+extra[k]}`); },
  };
  return api;
}
