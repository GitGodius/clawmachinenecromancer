// ---------------------------------------------------------------------------
// DOM — the parts of the game that live outside the canvas. Only loaded in a real page (tools/test.mjs skips
// it), and nothing else depends on it: every caller checks `typeof Platform` / `typeof Announce` first.
//
//   Platform   fullscreen, clipboard and links, each written to fail quietly inside a sandboxed frame
//   Announce   an aria-live region so a screen reader hears the Reaper and the menus
//   crash toast, error hooks, save-on-hide, auto-pause when the tab is hidden, the on-page Menu button
// ---------------------------------------------------------------------------
const Platform = {
  fullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    } catch (err) { /* not allowed here (a frame without allow=fullscreen): fine */ }
  },
  // cb(true) if it landed on the clipboard. When the clipboard is blocked, show the text selected instead.
  copy(text, cb) {
    const fallback = () => {
      let ta = document.getElementById('copybox');
      if (!ta) {
        ta = document.createElement('textarea');
        ta.id = 'copybox'; ta.readOnly = true; ta.setAttribute('aria-label', 'Debug info: select all and copy');
        document.body.appendChild(ta);
        ta.addEventListener('blur', () => ta.classList.remove('open'));
      }
      ta.value = text; ta.classList.add('open'); ta.focus(); ta.select();
      cb && cb(false);
    };
    try { navigator.clipboard.writeText(text).then(() => cb && cb(true), fallback); } catch (err) { fallback(); }
  },
  open(url) {
    try { const w = window.open(url, '_blank', 'noopener'); if (w) return; } catch (err) { /* blocked */ }
    Platform.copy(url, () => Overlays.toast('Could not open a tab. The link is on your clipboard.'));
  },
};

const Announce = {
  el: null,
  say(text) {
    if (!this.el) this.el = document.getElementById('sr');
    if (!this.el || !text) return;
    this.el.textContent = ''; // clearing first makes a repeated line get read again
    setTimeout(() => { if (this.el) this.el.textContent = text; }, 30);
  },
};

(function domLayer() {
  if (typeof document === 'undefined') return;

  // ---- a graphics card string for bug reports (what ran it, on which machine)
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    CrashLog.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? 'webgl (renderer hidden)' : 'no webgl';
  } catch (e) { CrashLog.gpu = 'unknown'; }

  // ---- the crash toast: small, dismissable, never blocks play
  let toast = null;
  CrashLog.onReport = (e) => {
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'crash'; toast.setAttribute('role', 'alert');
      toast.innerHTML = '<b>Something broke.</b> <span data-msg></span> The game is still running. <button data-a="copy">Copy report</button> <button data-a="issue">Report on GitHub</button> <button data-a="x" aria-label="Dismiss">×</button>';
      document.body.appendChild(toast);
      toast.addEventListener('click', (ev) => {
        const a = ev.target.dataset && ev.target.dataset.a;
        if (a === 'x') toast.classList.remove('open');
        if (a === 'copy') Platform.copy(CrashLog.text('Crash report'), (ok) => { ev.target.textContent = ok ? 'Copied' : 'Select and copy'; });
        if (a === 'issue') Platform.open(CrashLog.issueUrl());
      });
    }
    toast.querySelector('[data-msg]').textContent = '(' + e.msg.slice(0, 80) + ')';
    toast.classList.add('open');
  };
  window.addEventListener('error', (ev) => CrashLog.report(ev.error || ev.message, 'window'));
  window.addEventListener('unhandledrejection', (ev) => CrashLog.report(ev.reason, 'promise'));

  // ---- the run survives a closed tab, a refresh, a crash: save whenever the page is about to go away
  const flush = () => { try { Save.flush(); } catch (e) { /* nothing more to do */ } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    flush();
    // a hidden tab pauses the game for you: come back to the pause menu, not to a fight that kept going
    if (typeof Engine !== 'undefined' && Engine.scene && !Engine.overlays.length && Engine.scene.pausable !== false && Engine.sceneName !== 'shop') Overlays.pause();
  });

  // ---- the on-page Menu button: the only way to pause on a phone
  const btn = document.getElementById('menuBtn');
  if (btn) btn.addEventListener('click', () => {
    try {
      if (typeof Engine === 'undefined' || !Engine.scene) return;
      if (Engine.overlays.length) { const t = Engine.top; if (t && t.pausePanel) Engine.close(); else if (Input.capture) { Input.capture = null; } return; }
      if (Engine.scene.pausable !== false && !Engine.trans) Overlays.pause();
    } finally {
      btn.blur(); // a focused button would eat the Space key that drops the claw
      const c = document.getElementById('game'); if (c) c.focus({ preventScroll: true });
    }
  });

  // ---- the hint line under the canvas follows the player's own keys
  window.refreshHint = () => {
    const el = document.getElementById('hint');
    if (!el) return;
    const k = (a) => `<kbd>${Settings.hint(a)}</kbd>`;
    el.innerHTML = `Click the game once so it gets your keys. ${k('left')} ${k('right')} steer · ${k('a')} drop · ${k('pause')} pause · ${k('mute')} mute · ${k('fullscreen')} fullscreen. Mouse and touch work too: hold on the glass to steer.`;
  };
})();
