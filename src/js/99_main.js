// ---------------------------------------------------------------------------
// BOOT — ?scene=claw|slab|battle|shop jumps straight in; ?seed=123 for a fixed
// pile; ?parts=1 starts with a bag of parts; ?party=1 with a ready creature;
// ?luck=8 sets Luck; ?rig=0 turns the Rig (RNG layer) off.
// ---------------------------------------------------------------------------
(function boot() {
  const start = () => {
    const Q = new URLSearchParams(location.search);
    if (Q.get('seed')) RNG = mulberry32(+Q.get('seed'));
    if (Q.get('rig') === '0') CONFIG.rigOn = CONFIG_DEFAULTS.rigOn = 0; // the original claw, for A/B playtests (also survives the tuning panel's Reset)
    Engine.init();
    Debug.build();
    if (BG.prebuild) BG.prebuild();
    Game.newGame();
    for (const k in Scenes) Engine.add(k, Scenes[k]);
    if (Q.get('parts')) for (const t of ['skull', 'ribcage', 'bonearm', 'fleshArm', 'boneleg', 'goatleg', 'heart', 'wolfskull', 'tentacle', 'wings', 'ogrearm', 'pegleg']) Game.addPart(t);
    if (Q.get('party')) {
      Game.party.push(new Creature({ head: 'skull', torso: 'ribcage', armL: 'swordarm', armR: 'bonearm', legL: 'boneleg', legR: 'boneleg', heart: 'heart' }));
      Game.party.push(new Creature({ head: 'wolfskull', torso: 'ogregut', armL: 'ogrearm', armR: 'clawarm', legL: 'goatleg', legR: 'pegleg' }));
    }
    if (Q.get('tokens')) Game.tokens = +Q.get('tokens');
    if (Q.get('luck')) Rig.luck = clamp(+Q.get('luck') || 0, 0, CONFIG.luckMax);
    const first = Q.get('scene') || 'shop';
    Engine.go(Scenes[first] ? first : 'shop', { skipIntro: !!Q.get('scene') }, 'cut');
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
    requestAnimationFrame((n) => Engine.loop(n));
    window.__game = { Game, Engine, CONFIG, Scenes, Telemetry, Input };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
