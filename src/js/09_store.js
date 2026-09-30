// ---------------------------------------------------------------------------
// STORE — everything that outlives a page load: settings, records and the run in progress.
//
//   Store      safe key/value storage. Works when localStorage throws (sandboxed iframes, private windows,
//              blocked site data) by falling back to memory, and says so via Store.persistent.
//   Settings   what the player chose: volumes, accessibility, key bindings. Applied to CONFIG/Audio/Input.
//   Save       the versioned save file: { v, settings, records, run }. Old saves are migrated forward, saves
//              from a NEWER build are never overwritten, and anything unreadable is kept, not destroyed.
//
// Nothing here touches the DOM, so tools/test.mjs can exercise all of it headless.
// ---------------------------------------------------------------------------
const Store = (() => {
  const mem = {};
  let ls = null;
  let persistent = false;
  try {
    ls = typeof localStorage !== 'undefined' ? localStorage : null; // touching it can throw in a sandboxed frame
    if (ls) { ls.setItem('__gp_probe', '1'); ls.removeItem('__gp_probe'); persistent = true; }
  } catch (e) { ls = null; persistent = false; }
  return {
    get persistent() { return persistent; },
    get(key) {
      try { if (ls) { const v = ls.getItem(key); if (v !== null) return v; } } catch (e) { persistent = false; }
      return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
    },
    set(key, val) {
      mem[key] = String(val);
      try { if (ls) { ls.setItem(key, String(val)); return true; } } catch (e) { persistent = false; }
      return false; // kept for this page load only
    },
    remove(key) { delete mem[key]; try { if (ls) ls.removeItem(key); } catch (e) { /* nothing to do */ } },
  };
})();

// ------------------------------------------------------------------ settings
// Actions a key can be bound to. Two slots each. `fixed: true` = can never end up with no key at all.
const KEY_ACTIONS = [
  { id: 'left', label: 'Move left', fixed: true }, { id: 'right', label: 'Move right', fixed: true },
  { id: 'up', label: 'Menu up', fixed: true }, { id: 'down', label: 'Menu down', fixed: true },
  { id: 'a', label: 'Drop / confirm', fixed: true }, { id: 'b', label: 'Back / cancel', fixed: true },
  { id: 'pause', label: 'Pause' }, { id: 'mute', label: 'Mute' }, { id: 'fullscreen', label: 'Fullscreen' },
];
const DEFAULT_KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  a: ['Space', 'Enter'], b: ['Escape', 'KeyX'], pause: ['KeyP', null], mute: ['KeyM', null], fullscreen: ['KeyF', null],
};

const SETTINGS_DEFAULTS = {
  master: 0.8, music: 0.45, sfx: 0.8, muted: false,
  shake: 1,            // screen shake multiplier: 0 off, 0.5 low, 1 full
  reduceFlash: false,  // no full-screen flashes, nothing that blinks faster than 3 times a second
  slowmo: true,        // slow-motion on rare catches
  dropGuide: true,     // the dotted line under the claw
  autoCarry: false,    // assist: the machine carries a part to the chute for you (steady, never clever)
  carryTime: 8,        // seconds you get to carry: 8 normal, 16 extended, 0 unlimited
  steering: 'hold',    // 'hold' the arrow to move, or 'toggle': tap once to start, tap again to stop
  keys: DEFAULT_KEYS,
};

const Settings = {
  v: JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)),

  // merge anything from disk over the defaults, keeping only values of the right type
  load(saved) {
    const d = SETTINGS_DEFAULTS, v = JSON.parse(JSON.stringify(d));
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(d)) {
        if (k === 'keys') continue;
        if (typeof saved[k] === typeof d[k]) v[k] = saved[k];
      }
      for (const k of ['master', 'music', 'sfx']) v[k] = clamp(+v[k] || 0, 0, 1);
      if (![0, 0.5, 1].includes(v.shake)) v.shake = 1;
      if (![0, 8, 16].includes(v.carryTime)) v.carryTime = 8;
      if (!['hold', 'toggle'].includes(v.steering)) v.steering = 'hold';
      v.keys = Settings.cleanKeys(saved.keys);
    }
    Settings.v = v;
    return v;
  },

  // every action gets an array of two codes (or null); a code may belong to only one action
  cleanKeys(saved) {
    const out = {}, used = new Set();
    for (const a of KEY_ACTIONS) {
      const src = saved && Array.isArray(saved[a.id]) ? saved[a.id] : DEFAULT_KEYS[a.id];
      const slots = [null, null];
      for (let i = 0; i < 2; i++) { // one at a time, so the same key twice in one action is caught too
        const c = src[i];
        if (typeof c === 'string' && c.length < 24 && !used.has(c)) { slots[i] = c; used.add(c); }
      }
      if (a.fixed && !slots[0] && !slots[1]) { // never leave a movement key unbound
        const fb = DEFAULT_KEYS[a.id].find((c) => c && !used.has(c)) || DEFAULT_KEYS[a.id][0];
        slots[0] = fb; used.add(fb);
      }
      out[a.id] = slots;
    }
    return out;
  },

  // Put `code` on `action` slot `slot`. A key that was somewhere else moves (the old spot goes empty), and
  // a movement action can never be left with no key. Returns what it took the key away from, if anything.
  bind(action, slot, code) {
    const keys = Settings.v.keys;
    let stolen = null;
    for (const a of KEY_ACTIONS) for (let i = 0; i < 2; i++) if (keys[a.id][i] === code && !(a.id === action && i === slot)) { keys[a.id][i] = null; stolen = a.id; }
    keys[action][slot] = code;
    Settings.v.keys = Settings.cleanKeys(keys);
    return stolen;
  },
  unbind(action, slot) {
    const a = KEY_ACTIONS.find((x) => x.id === action), keys = Settings.v.keys;
    if (a.fixed && !keys[action][1 - slot]) return false; // it is the last key for this action
    keys[action][slot] = null;
    return true;
  },
  resetKeys() { Settings.v.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS)); },

  // Push the settings into the systems that use them. Safe to call any time, headless or not.
  apply() {
    const v = Settings.v;
    if (typeof AudioSys !== 'undefined') { AudioSys.setVolumes({ master: v.master, music: v.music, sfx: v.sfx }); AudioSys.setMuted(v.muted); }
    CONFIG.shake = v.shake;
    CONFIG.slowmo = v.slowmo ? 1 : 0;
    CONFIG.dropGuide = v.dropGuide ? 1 : 0;
    CONFIG.carryManual = v.autoCarry ? 0 : 1;
    CONFIG.carryTime = v.carryTime;
    if (typeof Input !== 'undefined' && Input.setBindings) Input.setBindings(v.keys);
  },
  // "M" for a key code, for on-screen hints ("KeyM" -> "M", "ArrowLeft" -> "←")
  keyName(code) {
    if (!code) return '—';
    const named = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC', Backspace: 'BKSP', Tab: 'TAB', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\' };
    if (named[code]) return named[code];
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NUM ');
  },
  // first bound key for an action, for prompts like "press SPACE to drop"
  hint(action) { const k = Settings.v.keys[action]; return Settings.keyName(k[0] || k[1]); },
};

// ---------------------------------------------------------------------------- save
const SAVE_VERSION = 1;
const SAVE_KEY = 'thegoodparts.save';
// Old part ids that were renamed or retired map to a current one. Add a line here whenever a part id changes,
// or saves that hold it lose the part. (Nothing is wasted: an unknown part becomes a common one of its slot.)
const PART_ALIASES = {};
// One function per version step: MIGRATIONS[n] turns a version-n save into version n+1. Append, never edit.
const MIGRATIONS = {};

const Save = {
  enabled: true,     // tools turn this off so bots never write a save
  runActive: false,  // true once the player has started or continued a run THIS session. Until then the boot-time
                     // blank game must never overwrite the run that is waiting in the file (it once did)
  readOnly: false,   // set when the file came from a newer build: we may read what we understand, never write
  notes: [],         // things to tell the player once ("2 parts from an older version were retired")
  problem: null,     // 'corrupt' | 'newer' | null
  data: null,
  _timer: null,

  blank() { return { v: SAVE_VERSION, settings: null, records: { bestStage: 0, runs: 0, wins: 0, grabs: 0, creatures: 0, bestWinMinutes: 0 }, run: null }; },

  load() {
    Save.notes = []; Save.problem = null; Save.readOnly = false;
    const raw = Store.get(SAVE_KEY);
    let d = null;
    if (raw) {
      try { d = JSON.parse(raw); if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('not an object'); }
      catch (e) { Save.problem = 'corrupt'; Store.set(SAVE_KEY + '.corrupt', raw); d = null; } // keep it: someone may want to recover it
    }
    if (d) {
      const v = Number.isInteger(d.v) ? d.v : 0;
      if (v > SAVE_VERSION) { Save.problem = 'newer'; Save.readOnly = true; Store.set(SAVE_KEY + '.newer', raw); d = Object.assign(Save.blank(), { settings: d.settings || null, records: d.records || Save.blank().records }); }
      else d = Save.migrate(d);
    }
    Save.data = d || Save.blank();
    Save.data.records = Object.assign(Save.blank().records, Save.data.records || {});
    Settings.load(Save.data.settings);
    return Save.data;
  },

  migrate(d) {
    let v = Number.isInteger(d.v) ? d.v : 0;
    while (v < SAVE_VERSION) {
      const step = MIGRATIONS[v];
      if (!step) { d.v = SAVE_VERSION; break; } // no step written for it: the shape did not change
      d = step(d) || d;
      v++; d.v = v;
    }
    d.v = SAVE_VERSION;
    return d;
  },

  // flush the current settings + run to storage (debounced by callers via Save.soon)
  flush() {
    if (!Save.enabled || Save.readOnly || !Save.data) return false;
    if (typeof Game !== 'undefined' && Save.runActive) Save.data.run = Game.won ? null : Game.toSave(); // a finished run is not something to continue
    Save.data.settings = JSON.parse(JSON.stringify(Settings.v));
    Save.data.v = SAVE_VERSION;
    const prev = Store.get(SAVE_KEY);
    if (prev) Store.set(SAVE_KEY + '.bak', prev); // one step of undo if a bug ever writes rubbish
    return Store.set(SAVE_KEY, JSON.stringify(Save.data));
  },
  soon() { // coalesce bursts of changes (a grab, a stitch) into one write
    if (!Save.enabled || Save._timer) return;
    Save._timer = setTimeout(() => { Save._timer = null; Save.flush(); }, 400);
  },
  reset() { // "new run" keeps settings and records, drops only the run
    if (Save.data) Save.data.run = null;
    Save.runActive = true; // from here the game in memory IS the run
    Save.flush();
  },
  wipe() { Save.data = Save.blank(); Save.runActive = false; Settings.load(null); Store.remove(SAVE_KEY); },
  hasRun() { return !!(Save.data && Save.data.run); },
};
