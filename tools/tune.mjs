// Headless claw tuner: plays real grabs on the real ClawSim with bots of different carry style and reports
// the odds. Use it to tune CONFIG (or to see what a change did) before a human ever touches it.
//
//   node tools/tune.mjs [trials=200] [overridesJSON] [sweep key=v1,v2,...]
//   node tools/tune.mjs 300 '{"gripAssist":0.2}' strainSpeed=0.4,0.8,1.2      (also hookPull=1,2,3 ...)
//   AIM_NOISE=4 node tools/tune.mjs 100
//   APPROACH=1 node tools/tune.mjs 100     the claw drives to the aim point at full speed and drops on arrival
//
// Each trial: a fresh pile, aim at a random reachable part (Gaussian aim error), drop, carry, release.
// Carry styles: gentle (feathers to a steady cruise), okay (feathers, a bit fast), keys (holds, then lets the coast
// land it), nervous (taps every way, often the wrong one), jerky (holds the key, lets go on arrival), auto (the assist).
// The gap between gentle and jerky is what pillar 3 ("the carry is the skill") is made of.
import { loadGame } from './lib/headless.mjs';
import { playGrab, exposedParts } from './lib/clawbot.mjs';
import { pct, ci95, mean } from './lib/stats.mjs';
import { PROFILES } from './lib/runbot.mjs';

const trials = +(process.argv[2] || 200);
const overrides = process.argv[3] && process.argv[3][0] === '{' ? JSON.parse(process.argv[3]) : {};
const sweepArg = process.argv.find((a, i) => i > 2 && /^\w+=[-\d.,]+$/.test(a));
const AIM_NOISE = +(process.env.AIM_NOISE || 2.5);
const STYLES = (process.env.STYLES || 'gentle,okay,keys,nervous,jerky,auto').split(',');
const PROFILE_MODE = process.argv.includes('--profiles');
const APPROACH = !!process.env.APPROACH; // APPROACH=1: drive to the aim point at full speed and drop on arrival (see lib/clawbot.mjs)

export function measure(game, { trials, style, aimNoise = AIM_NOISE, config = {} }) {
  const M = game.get('MACHINE'), CONFIG = game.get('CONFIG'), PPM = game.get('PPM'), cavityDepth = game.get('cavityDepth');
  game.resetConfig({ ...overrides, ...config, ...(style === 'auto' ? { carryManual: 0 } : {}) });
  const rs = [];
  const whys = {};
  for (let i = 0; i < trials; i++) {
    game.seed(1000 + i);
    const sim = game.run('new ClawSim({})');
    sim.fillPile(CONFIG.partCount);
    let s = 7919 * (i + 1) + 13;
    const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 1) / 4294967297; };
    const pool = exposedParts(sim, M);
    const target = pool[Math.floor(u() * pool.length)];
    // claw quality: where everything sat when the claw finished closing (inside its mouth or not), and what came up
    let atLift = null, topHeld = [], aimErr = 0;
    const onEvent = (t, d) => {
      if (t === 'gripLost') whys[d.why] = (whys[d.why] || 0) + 1;
      if (t === 'drop') aimErr = sim.carX - target.body.getWorldCenter().x * PPM;
      if (t === 'top') topHeld = d.held || [];
      if (t === 'lift') {
        const poly = sim.cavity();
        atLift = new Map(sim.parts.filter((p) => !p.won).map((p) => [p, {
          lx: sim.toHub(p.body.getWorldCenter())[0],
          depth: Math.max(...p.bodies.map((b) => { const q = b.getWorldCenter(); return cavityDepth(poly, q.x * PPM, q.y * PPM); })),
        }]));
      }
    };
    const r = playGrab(sim, M, { target, aimNoise, carry: style === 'auto' ? 'gentle' : style, u, cfg: CONFIG, hooks: { onEvent }, approach: APPROACH });
    const ti = atLift && atLift.get(target);
    const phantom = [...new Set([...(r.wonParts || []), ...topHeld])].some((p) => { const a = atLift && atLift.get(p); return a && a.depth < -CONFIG.gripSlack - 1; });
    rs.push({ ...r, target: r.won.includes(target.type) && r.wonParts.includes(target), aimErr, phantom,
      tInside: !!ti && ti.depth > 0, tCentred: !!ti && ti.depth > 0 && Math.abs(ti.lx) < 5 });
  }
  return { rs, whys };
}

// what the claw does with what it closes around (the numbers behind "what the prongs close around is what you get")
export function quality(rs) {
  const inside = rs.filter((r) => r.tInside), centred = rs.filter((r) => r.tCentred);
  const buckets = [[0, 2], [2, 4], [4, 7], [7, 11], [11, 99]].map(([a, b]) => { const g = rs.filter((r) => Math.abs(r.aimErr) >= a && Math.abs(r.aimErr) < b); return [`${a}-${b}px`, g.length ? pct(g.filter((r) => r.target).length, g.length) : null, g.length]; });
  return { inside: pct(inside.length, rs.length), insideWon: pct(inside.filter((r) => r.target).length, Math.max(1, inside.length)),
    centredLost: pct(centred.filter((r) => !r.target).length, Math.max(1, centred.length)), phantom: pct(rs.filter((r) => r.phantom).length, rs.length), buckets };
}

export function summarize(rs) {
  const n = rs.length, win = rs.filter((r) => r.won.length).length;
  return { n, win: pct(win, n), winCI: ci95(win, n), lifted: pct(rs.filter((r) => r.lifted).length, n), slip: pct(rs.filter((r) => r.result === 'slip').length, n),
    miss: pct(rs.filter((r) => r.result === 'miss').length, n), multi: pct(rs.filter((r) => r.won.length > 1).length, n),
    exact: pct(rs.filter((r) => r.target).length, n), timeouts: rs.filter((r) => r.result === 'timeout').length, seconds: +mean(rs.map((r) => r.time)).toFixed(1),
    // of the parts that were lifted, how many made it to the chute: the number the carry skill moves
    kept: pct(rs.filter((r) => r.won.length).length, Math.max(1, rs.filter((r) => r.lifted).length)) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && PROFILE_MODE) {
  // the grab odds of each bot profile, with its own aim noise: the numbers the no-physics economy model uses
  const game = loadGame();
  console.log(`grab odds by bot profile (${trials} trials each)`);
  for (const [name, P] of Object.entries(PROFILES)) {
    if (process.env.PROFILE && process.env.PROFILE !== name) continue;
    const { rs } = measure(game, { trials, style: P.carry === 'auto' ? 'auto' : P.carry, aimNoise: P.aimNoise });
    const S = summarize(rs);
    console.log(`  ${name.padEnd(9)} aim ${P.aimNoise}px  ${P.carry.padEnd(6)}  win ${S.win}% ±${S.winCI}   kept-when-lifted ${S.kept}%   (model uses p=${P.p})`);
  }
} else if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const game = loadGame();
  const sets = sweepArg ? sweepArg.split('=')[1].split(',').map((v) => ({ label: sweepArg.split('=')[0] + '=' + v, config: { [sweepArg.split('=')[0]]: +v } })) : [{ label: 'current config', config: {} }];
  for (const set of sets) {
    console.log(`\n== ${set.label}  (${trials} trials per style, aim noise ${AIM_NOISE}px)`);
    console.log('  style     win%   ±   lifted  kept-when-lifted  slipped  miss  multi  exact-target  avg s  slip causes');
    let gentle = null, jerky = null;
    for (const style of STYLES) {
      const { rs, whys } = measure(game, { trials, style, config: set.config });
      const S = summarize(rs);
      if (style === 'gentle') gentle = S; if (style === 'jerky') jerky = S;
      console.log(`  ${style.padEnd(8)} ${String(S.win).padStart(4)}%  ${String(S.winCI).padStart(2)}  ${String(S.lifted).padStart(5)}%  ${String(S.kept).padStart(12)}%  ${String(S.slip).padStart(7)}%  ${String(S.miss).padStart(3)}%  ${String(S.multi).padStart(4)}%  ${String(S.exact).padStart(9)}%  ${String(S.seconds).padStart(6)}  ${JSON.stringify(whys)}${S.timeouts ? '  TIMEOUTS ' + S.timeouts : ''}`);
    }
    if (gentle && jerky) console.log(`  skill gap (gentle - jerky): ${gentle.win - jerky.win} points of win%, ${gentle.kept - jerky.kept} points of kept-when-lifted`);
    const Q = quality(measure(game, { trials, style: 'gentle', config: set.config }).rs);
    console.log(`  the claw (gentle): target in its mouth when it closed ${Q.inside}% -> won ${Q.insideWon}%   centred catches lost ${Q.centredLost}%   carried from outside ${Q.phantom}%`);
    console.log('  exact target won by aim error: ' + Q.buckets.map(([k, v, n]) => `${k} ${v == null ? '-' : v + '%'} (${n})`).join('  '));
  }
}
