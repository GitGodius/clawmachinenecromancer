// ---------------------------------------------------------------------------
// BOOT — ?scene=claw|slab|battle|shop jumps straight in; ?seed=123 for a fixed
// pile; ?parts=1 starts with a bag of parts; ?party=1 with a ready creature.
// ---------------------------------------------------------------------------
(function boot() {
  const start = () => {
    const Q = new URLSearchParams(location.search);
    if (Q.get('seed')) RNG = mulberry32(+Q.get('seed'));
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
    const first = Q.get('scene') || 'shop';
    Engine.go(Scenes[first] ? first : 'shop', { skipIntro: !!Q.get('scene') }, 'cut');
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
    requestAnimationFrame((n) => Engine.loop(n));
    window.__game = { Game, Engine, CONFIG, Scenes, Telemetry, Input };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
