// ---------------------------------------------------------------------------
// DEBUG PANEL — dev.html only (the shipped page does not include this file). Press ` (backquote) or the
// button to tune CONFIG live. "Copy values" puts the current CONFIG (diff from defaults) on the clipboard.
// Also: cheats for fast iteration and the playtest report. Anything here a player could want (shake, the
// drop guide, the carry timer, auto-carry) is a real setting in Settings, not a slider.
// ---------------------------------------------------------------------------
const Debug = {
  el: null, open: false, reportEl: null,
  build() {
    const el = (this.el = document.getElementById('debug'));
    if (!el) return;
    const groups = {};
    for (const m of CONFIG_META) (groups[m[0]] ||= []).push(m);
    let html = `<div class="dbg-head"><b>TUNING</b><span>live — changes apply instantly</span><button data-act="close">×</button></div>
      <div class="dbg-btns">
        <button data-act="copy">Copy values</button><button data-act="reset">Reset</button><button data-act="report">Playtest report</button>
      </div>
      <div class="dbg-btns">
        <button data-act="tokens">+5 tokens</button><button data-act="refill">Refill machine</button><button data-act="rare">Drop a legendary in</button>
        <button data-act="parts">+6 random parts</button><button data-act="win">Win battle</button><button data-act="stage">Stage +1</button>
      </div>
      <div class="dbg-btns">
        <button data-act="luck">+5 luck</button><button data-act="quake">Quake now</button><button data-act="free">Free levers</button>
      </div>`;
    for (const g in groups) {
      html += `<details ${g === 'Claw' || g === 'Grip' ? 'open' : ''}><summary>${g}</summary>`;
      for (const [, key, def, min, max, step, label] of groups[g]) {
        html += `<label title="${key}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${CONFIG[key]}" data-key="${key}"><output data-out="${key}">${CONFIG[key]}</output></label>`;
      }
      html += '</details>';
    }
    el.innerHTML = html;
    el.addEventListener('input', (e) => {
      const k = e.target.dataset.key;
      if (!k) return;
      CONFIG[k] = parseFloat(e.target.value);
      el.querySelector(`[data-out="${k}"]`).textContent = CONFIG[k];
    });
    el.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      this.action(act, e.target);
    });
    const tog = document.getElementById('dbgToggle');
    if (tog) tog.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+F (find), Ctrl+P (print), Cmd+M (minimize) are not ours
      if (e.code === 'Backquote') { this.toggle(); e.preventDefault(); }
    });
  },
  toggle() { this.open = !this.open; this.el.classList.toggle('open', this.open); },
  sync() { for (const inp of this.el.querySelectorAll('input[data-key]')) { inp.value = CONFIG[inp.dataset.key]; this.el.querySelector(`[data-out="${inp.dataset.key}"]`).textContent = CONFIG[inp.dataset.key]; } },
  action(act, btn) {
    if (act === 'close') this.toggle();
    if (act === 'copy') {
      const diff = {};
      for (const k in CONFIG) if (CONFIG[k] !== CONFIG_DEFAULTS[k]) diff[k] = CONFIG[k];
      const txt = JSON.stringify(Object.keys(diff).length ? diff : CONFIG, null, 1);
      const ok = () => { btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = 'Copy values'), 1200); };
      try { navigator.clipboard.writeText(txt).then(ok, () => this.showText(txt)); } catch (err) { this.showText(txt); }
    }
    if (act === 'reset') { Object.assign(CONFIG, CONFIG_DEFAULTS); this.sync(); }
    if (act === 'report') this.showReport();
    if (act === 'tokens') Game.tokens += 5;
    if (act === 'refill') { Game.sim.clearParts(); Game.sim.fillPile(CONFIG.partCount); }
    if (act === 'rare') Game.sim.queueSpawn(randomPartType({ rarity: 'legendary' }));
    if (act === 'parts') for (let i = 0; i < 6; i++) Game.addPart(randomPartType());
    if (act === 'win' && Engine.sceneName === 'battle') Scenes.battle.cheatWin();
    if (act === 'stage') Game.stage++;
    if (act === 'luck') Rig.luck = Math.min(CONFIG.luckMax, Rig.luck + 5);
    if (act === 'quake') Game.sim.quake();
    if (act === 'free') { CONFIG.rigFree = CONFIG.rigFree ? 0 : 1; this.sync(); btn.textContent = CONFIG.rigFree ? 'Free levers: ON' : 'Free levers'; }
  },
  // clipboard blocked (embedded page)? show the text selected, ready for Ctrl+C
  showText(txt) {
    let ta = document.getElementById('dbgText');
    if (!ta) {
      ta = document.createElement('textarea');
      ta.id = 'dbgText'; ta.readOnly = true;
      this.el.querySelector('.dbg-btns').after(ta);
    }
    ta.value = txt;
    ta.focus(); ta.select();
  },
  fullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    } catch (err) { /* not allowed here: fine */ }
  },
  showReport() {
    let r = this.reportEl;
    if (!r) {
      r = this.reportEl = document.createElement('div');
      r.id = 'report';
      r.innerHTML = '<div class="rep-head"><b>Playtest report</b><button data-r="copy">Copy</button><button data-r="close">×</button></div><pre></pre>';
      document.body.appendChild(r);
      r.addEventListener('click', (e) => {
        if (e.target.dataset.r === 'close') r.classList.remove('open');
        if (e.target.dataset.r === 'copy') {
          const pre = r.querySelector('pre');
          const select = () => { const sel = getSelection(), rg = document.createRange(); rg.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(rg); };
          try { navigator.clipboard.writeText(pre.textContent).catch(select); } catch (err) { select(); }
        }
      });
    }
    r.querySelector('pre').textContent = Telemetry.report();
    r.classList.toggle('open');
  },
  update() {},
};
