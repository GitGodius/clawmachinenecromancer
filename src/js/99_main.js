// ---------------------------------------------------------------------------
// BOOT — load the save, build the world, show the title. In a dev build (dev.html) the URL can also jump
// straight in: ?scene=claw|slab|battle|shop, ?seed=123 for a fixed pile, ?parts=1, ?party=1, ?tokens=30.
// Those flags, the tuning panel and window.__game do not exist in the page players get (BUILD.dev is false).
// ---------------------------------------------------------------------------
(function boot() {
  const start = () => {
    const Q = new URLSearchParams(location.search);
    const dev = BUILD.dev;
    if (dev && Q.get('seed')) RNG = mulberry32(+Q.get('seed'));
    Save.load();
    CrashLog.init();
    Engine.init();
    Settings.apply();
    if (dev) Debug.build();
    if (BG.prebuild) BG.prebuild();
    Game.newGame();
    for (const k in Scenes) Engine.add(k, Scenes[k]);
    let first = null;
    if (dev) {
      if (Q.get('parts')) for (const t of ['skull', 'ribcage', 'bonearm', 'fleshArm', 'boneleg', 'goatleg', 'heart', 'wolfskull', 'tentacle', 'wings', 'ogrearm', 'pegleg']) Game.addPart(t);
      if (Q.get('party')) {
        Game.party.push(new Creature({ head: 'skull', torso: 'ribcage', armL: 'swordarm', armR: 'bonearm', legL: 'boneleg', legR: 'boneleg', heart: 'heart' }));
        Game.party.push(new Creature({ head: 'wolfskull', torso: 'ogregut', armL: 'ogrearm', armR: 'clawarm', legL: 'goatleg', legR: 'pegleg' }));
      }
      if (Q.get('tokens')) Game.tokens = +Q.get('tokens');
      if (Q.get('stage')) Game.stage = +Q.get('stage');
      first = Q.get('scene');
      Save.enabled = !Q.get('nosave') && !first; // a jump-in URL must never overwrite a real save
      Save.runActive = Save.enabled && false; // a dev page still has to choose a run like anyone else
    }
    Engine.go(first && Scenes[first] ? first : 'shop', { skipIntro: !!first }, 'cut');
    if (!first) Overlays.title();
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
    if (window.refreshHint) window.refreshHint();
    requestAnimationFrame((n) => Engine.loop(n));
    if (dev) window.__game = { Game, Engine, CONFIG, Scenes, Telemetry, Input, Save, Settings, Overlays, CrashLog, BUILD };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
