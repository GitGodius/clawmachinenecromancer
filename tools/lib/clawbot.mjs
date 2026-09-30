// A bot that plays one grab on a real ClawSim: aim (with human-ish noise), drop, carry to the chute, release.
// Used by tools/tune.mjs, tools/test.mjs, tools/run_sim.mjs and tools/balance.mjs.
//
// carry styles (what a human hand does with the arrow keys while the part swings):
//   'gentle'  eases toward the chute and stops before releasing: the careful player
//   'jerky'   full speed, releases the moment it is roughly over the chute: the button masher
//   'auto'    leaves it to the machine (CONFIG.carryManual = 0)
import { clamp } from './stats.mjs';

// Box-Muller with the caller's uniform source
export function gaussian(u) { let a = 0, b = 0; while (!a) a = u(); while (!b) b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }

// Parts a claw could actually reach, i.e. not already in the chute, and nothing lying right on top of them.
export function exposedParts(sim, M) {
  const cand = sim.parts.filter((p) => { const [x] = sim.partPos(p); return !p.won && x > M.carMin && x < M.guardX - 9; });
  const exposed = cand.filter((p) => {
    const [x, y] = sim.partPos(p);
    return !cand.some((q) => q !== p && Math.abs(sim.partPos(q)[0] - x) < 8 && sim.partPos(q)[1] < y - 4);
  });
  return exposed.length ? exposed : cand;
}

// One full grab. Returns what happened. `target` is a part from sim.parts (or null to aim at nothing).
export function playGrab(sim, M, { target, aimNoise = 2.5, carry = 'gentle', u = Math.random, maxT = 30, hooks = {}, start } = {}) {
  let ended = null, slips = 0, lifted = false;
  const prev = sim.onEvent;
  sim.onEvent = (t, d) => {
    if (t === 'turnEnd') ended = d;
    if (t === 'slip') slips++;
    if (t === 'lift' && d.grips.length) lifted = true;
    if (hooks.onEvent) hooks.onEvent(t, d);
    prev(t, d);
  };
  try {
    if (target) {
      const [tx] = sim.partPos(target);
      sim.teleportClaw(clamp(tx + gaussian(u) * aimNoise, M.carMin, M.carMax));
    }
    for (let i = 0; i < 30; i++) sim.step(1 / 60);
    if (start) start(); else sim.startDrop();
    if (sim.state === 'idle') return { result: 'refused', won: [], wonParts: [], slips, lifted, time: 0 };
    let t = 0;
    while (!ended && t < maxT) {
      if (sim.state === 'carry') {
        const d = M.home - sim.carX;
        if (carry === 'jerky') {
          sim.input.move = Math.abs(d) < 4 ? 0 : Math.sign(d);
          if (Math.abs(d) < 8) sim.press();
        } else {
          sim.input.move = Math.abs(d) < 1.5 ? 0 : Math.sign(d) * Math.min(1, Math.abs(d) / 12);
          if (Math.abs(d) < 2 && Math.abs(sim.carV) < 5) sim.press();
        }
      }
      sim.step(1 / 60);
      t += 1 / 60;
    }
    if (!ended) { sim.input.move = 0; return { result: 'timeout', won: [], slips, lifted, time: t }; }
    return { result: ended.result, won: ended.won.map((p) => p.type), wonParts: ended.won, slips, lifted, time: t };
  } finally {
    sim.onEvent = prev;
    sim.input.move = 0;
  }
}
