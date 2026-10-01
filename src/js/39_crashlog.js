// ---------------------------------------------------------------------------
// CRASH LOG — when something breaks, keep the evidence and keep playing.
//
// Errors are de-duplicated, kept in a short list, written to storage (so the NEXT launch can offer them) and
// formatted as a paste-able report: version, browser, graphics, what the game was doing, the last events.
// There is no server. The player copies the text or opens a prefilled GitHub issue; nothing is sent
// anywhere unless they choose to. No names, no account info, nothing beyond what is listed below.
// The DOM half (the toast, window error hooks) lives in 42_dom.js; this half also runs in Node for tests.
// ---------------------------------------------------------------------------
const CrashLog = {
  list: [],
  max: 6,
  gpu: '', // filled in by 42_dom.js (the WebGL renderer string), so reports say what graphics card ran it
  previous: null, // what the last session left behind, if it crashed
  onReport: null, // set by 42_dom.js to show the toast

  init() { this.previous = Store.get('thegoodparts.crash'); },

  report(err, where) {
    const msg = String((err && err.message) || err || 'unknown error').slice(0, 300);
    const stack = String((err && err.stack) || '').split('\n').slice(0, 6).join('\n').slice(0, 900);
    const key = where + '|' + msg + '|' + (stack.split('\n')[1] || '');
    let e = this.list.find((x) => x.key === key);
    if (e) { e.count++; e.last = Math.round(Telemetry.now()); return e; }
    e = { key, where, msg, stack, count: 1, first: Math.round(Telemetry.now()), last: Math.round(Telemetry.now()) };
    this.list.push(e);
    if (this.list.length > this.max) this.list.shift();
    try { Store.set('thegoodparts.crash', this.text('Crash')); } catch (x) { /* storage is best effort */ }
    if (typeof console !== 'undefined') console.error(err);
    if (this.onReport) { try { this.onReport(e); } catch (x) { /* never let the reporter break the game */ } }
    return e;
  },

  // Everything a bug report needs, in plain text.
  text(heading = 'Report') {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const scr = typeof screen !== 'undefined' ? screen : {};
    const G = typeof Game !== 'undefined' ? Game : null;
    const lines = [
      `${BUILD.name} ${BUILD.version}: ${heading}`,
      `when: ${new Date().toISOString()}   session: ${Math.round(Telemetry.now())}s`,
      `browser: ${nav.userAgent || 'n/a'}`,
      `screen: ${scr.width || '?'}x${scr.height || '?'} @${typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : '?'}x   game scale: ${typeof Engine !== 'undefined' ? Engine.scale.toFixed(2) : '?'}`,
      `graphics: ${this.gpu || 'unknown'}`,
      `in a frame: ${typeof window !== 'undefined' && window.top !== window.self ? 'yes' : 'no'}   storage: ${Store.persistent ? 'works' : 'blocked'}   audio: ${typeof AudioSys !== 'undefined' && AudioSys.ctx ? AudioSys.ctx.state : 'not started'}`,
      G ? `game: scene ${typeof Engine !== 'undefined' ? Engine.sceneName : '?'}, stage ${G.stage}, tokens ${G.tokens}, bag ${G.inventory.length}, party ${G.party.length}, play ${Math.round(G.playTime || 0)}s, won ${!!G.won}` : 'game: not started',
      typeof Settings !== 'undefined' ? `settings: ${JSON.stringify(Object.assign({}, Settings.v, { keys: undefined }))}` : '',
      '',
    ];
    if (this.list.length) {
      lines.push('errors this session:');
      for (const e of this.list) lines.push(`  x${e.count} [${e.where}] ${e.msg}`, ...e.stack.split('\n').slice(1, 4).map((s) => '      ' + s.trim()));
      lines.push('');
    } else lines.push('errors this session: none', '');
    if (this.previous) lines.push('left behind by the previous session:', ...String(this.previous).split('\n').slice(0, 14).map((s) => '  ' + s), '');
    lines.push('last events:', ...Telemetry.events.slice(-14).map((e) => `  ${e.t}s ${e.type} ${Object.entries(e).filter(([k]) => k !== 't' && k !== 'type').map(([k, v]) => k + '=' + v).join(' ')}`));
    return lines.join('\n');
  },

  // a prefilled GitHub issue, kept under URL length limits
  issueUrl() {
    const body = this.text('Bug report').slice(0, 3500);
    return BUILD.issues + '?title=' + encodeURIComponent(`Bug: ${this.list.length ? this.list[this.list.length - 1].msg.slice(0, 70) : 'describe what happened'}`) + '&body=' + encodeURIComponent('**What happened?**\n\n\n<details><summary>Debug info</summary>\n\n```\n' + body + '\n```\n</details>');
  },
};
