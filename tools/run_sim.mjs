// Plays whole runs with bots of different skill and reports how far they get and how long it takes.
// This is the late-game test: balance that only holds for the first five minutes is not balance.
//
//   node tools/run_sim.mjs                       12 runs per profile, up to stage 30
//   node tools/run_sim.mjs --runs=30 --profile=careful,masher --maxStage=20
//   node tools/run_sim.mjs --json=out.json       also dump every run
//   node tools/run_sim.mjs --set=winTokens=4     override a CONFIG value (repeatable)
//   node tools/run_sim.mjs --fast --runs=200     no-physics grabs: 100x quicker, for tuning the economy
//   node tools/run_sim.mjs --patch='ENEMY_KINDS.shade.def = 2'   try a data change without editing source
//
// Runs are spread over CPU cores (worker_threads) and are reproducible from their seed.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import { playRun, summarize, PROFILES } from './lib/runbot.mjs';

if (!isMainThread) {
  for (const job of workerData.jobs) {
    let r;
    try { r = playRun(job); } catch (e) { r = { seed: job.seed, profile: job.profile, error: String(e && e.stack || e) }; }
    parentPort.postMessage(r);
  }
  process.exit(0);
}

export async function runBatch({ profiles, runs, maxStage, maxGrabs, config, fast, patch, p, jobs = Math.min(os.cpus().length, 8), onProgress }) {
  const all = [];
  for (const profile of profiles) for (let i = 0; i < runs; i++) all.push({ seed: 100 + i, profile, maxStage, maxGrabs, config, fast, patch, p: p && p[profile] });
  const lanes = Array.from({ length: Math.min(jobs, all.length) }, () => []);
  all.forEach((j, i) => lanes[i % lanes.length].push(j));
  const results = [];
  await Promise.all(lanes.map((lane) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { jobs: lane } });
    w.on('message', (r) => { results.push(r); if (onProgress) onProgress(results.length, all.length); });
    w.on('error', reject);
    w.on('exit', resolve);
  })));
  return results;
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === fs.realpathSync(process.argv[1]);
if (isMain) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
  const profiles = arg('profile', Object.keys(PROFILES).join(',')).split(',');
  const runs = +arg('runs', 12), maxStage = +arg('maxStage', 15), maxGrabs = +arg('maxGrabs', 900);
  const config = {};
  for (const a of process.argv.filter((x) => x.startsWith('--set='))) { const [k, v] = a.slice(6).split('='); config[k] = +v; }
  const fast = process.argv.includes('--fast');
  const patch = process.argv.filter((x) => x.startsWith('--patch=')).map((x) => x.slice(8));
  const pArg = arg('p'); // --p=careful:0.5,masher:0.35 overrides the no-physics grab odds
  const p = pArg ? Object.fromEntries(pArg.split(',').map((kv) => { const [k, v] = kv.split(':'); return [k, +v]; })) : null;
  const t0 = Date.now();
  const results = await runBatch({ profiles, runs, maxStage, maxGrabs, config, fast, patch, p, onProgress: (d, n) => process.stderr.write(`\r${d}/${n} runs`) });
  process.stderr.write('\n');
  const errs = results.filter((r) => r.error);
  if (errs.length) { console.log(errs[0].error); process.exit(1); }
  const marks = [3, 5, 8, 10, 12, 15, 20, 25, 30].filter((n) => n <= maxStage);
  console.log(`bots: ${runs} runs per profile, cap stage ${maxStage}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const profile of profiles) {
    const rs = results.filter((r) => r.profile === profile);
    const S = summarize(rs);
    console.log(`\n== ${profile}  (aim noise ${PROFILES[profile].aimNoise}px, ${PROFILES[profile].carry} carry)`);
    console.log('  reached stage    ' + marks.map((n) => String(n).padStart(6)).join(''));
    console.log('  % of runs        ' + marks.map((n) => (S.reach(n) + '%').padStart(6)).join(''));
    console.log('  median grabs     ' + marks.map((n) => String(S.at(n) || '-').padStart(6)).join(''));
    console.log('  median minutes   ' + marks.map((n) => String(S.atMin(n) || '-').padStart(6)).join(''));
    const avg = (f) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1);
    console.log(`  finished the run: ${S.finished}%  (within 30 min ${S.finishedIn(30)}%, 60 min ${S.finishedIn(60)}%, 90 min ${S.finishedIn(90)}%)   median finish time ${S.finishMin} min`);
    console.log(`  median stages cleared ${S.medianCleared}   ended by ${JSON.stringify(S.ended)}`);
    console.log(`  per run: grabs ${avg((r) => r.grabs)}  grab win ${avg((r) => r.winRate)}%  fights won ${avg((r) => r.fightsWon)} lost ${avg((r) => r.fightsLost)} retreats ${avg((r) => r.retreats)}  creatures lost ${avg((r) => r.creaturesLost)}  pity ${avg((r) => r.pity)}  parts fell out of the machine ${avg((r) => r.lostParts)}`);
  }
  const out = arg('json');
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
}
