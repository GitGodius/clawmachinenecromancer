// ---------------------------------------------------------------------------
// TELEMETRY — lightweight playtest log. Watch someone play, then press P (or
// the report button in the debug panel) to see what they actually did:
// grab odds, slips, "one more try" retries, time per scene, battles.
// ---------------------------------------------------------------------------
const Telemetry = {
  t0: (typeof performance !== 'undefined' ? performance.now() : 0),
  events: [],
  sceneTime: {},
  cur: null, curT: 0,
  c: {
    grabs: 0, wins: 0, slips: 0, misses: 0, doubles: 0, freebies: 0, nearMiss: 0, sets: 0, homecomings: 0, speedToggles: 0, fastSecs: 0,
    retryFast: 0, retrySlow: 0, quitAfterFail: 0,
    bySlipWhy: {}, wonRarity: { common: 0, uncommon: 0, rare: 0, legendary: 0 },
    creatures: 0, unstitched: 0, battles: 0, victories: 0, defeats: 0, retreats: 0, zaps: 0,
    bestStage: 0, pity: 0, tokensSpent: 0,
    // the Rig (docs/RNG_LAYER.md)
    luckEarned: 0, luckSpent: 0, luckWasted: 0, luckBy: {},
    quakes: 0, nudges: 0, tilts: 0, irons: 0, ironDisarmed: 0, orders: 0, redos: 0,
    riggedGrabs: 0, riggedWins: 0, plainGrabs: 0, plainWins: 0, ironGrabs: 0, ironWins: 0,
  },
  curRigged: false, curIron: false,
  lastFailT: null,
  now() { return ((typeof performance !== 'undefined' ? performance.now() : 0) - this.t0) / 1000; },
  log(type, data) {
    const e = { t: +this.now().toFixed(1), type };
    if (data) Object.assign(e, data);
    this.events.push(e);
    if (this.events.length > 800) this.events.shift();
  },
  scene(name) {
    const n = this.now();
    if (this.cur) this.sceneTime[this.cur] = (this.sceneTime[this.cur] || 0) + (n - this.curT);
    // leaving the claw right after a failed grab (with tokens left) = frustration signal
    if (this.cur === 'claw' && this.lastFailT != null && n - this.lastFailT < 4 && typeof Game !== 'undefined' && Game.tokens > 0) this.c.quitAfterFail++;
    this.cur = name; this.curT = n;
    this.log('scene', { name });
  },
  // rigged: a lever was used since the last drop. iron: this drop has Iron Grip.
  grabStart(rigged, iron) {
    const n = this.now();
    this.curRigged = !!rigged; this.curIron = !!iron;
    if (iron) this.c.ironGrabs++;
    if (rigged || iron) this.c.riggedGrabs++; else this.c.plainGrabs++;
    this.c.grabs++;
    this.c.tokensSpent++;
    if (this.lastFailT != null) {
      if (n - this.lastFailT < 6) this.c.retryFast++; else this.c.retrySlow++;
    }
    this.lastFailT = null;
    this.log('grab');
  },
  grabEnd(result, won) {
    if (result === 'win') {
      this.c.wins++; if (won.length > 1) this.c.doubles++;
      if (this.curIron) this.c.ironWins++;
      if (this.curRigged || this.curIron) this.c.riggedWins++; else this.c.plainWins++;
    }
    else if (result === 'slip') this.c.slips++;
    else this.c.misses++;
    if (result !== 'win') this.lastFailT = this.now();
    this.log('grabEnd', { result, parts: won.map((p) => p.type).join(',') });
  },
  report() {
    const c = this.c;
    const st = Object.assign({}, this.sceneTime);
    if (this.cur) st[this.cur] = (st[this.cur] || 0) + (this.now() - this.curT);
    const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '-');
    const fails = c.slips + c.misses;
    const lines = [
      'THE GOOD PARTS — playtest report',
      `session ${Math.round(this.now() / 60)} min ${Math.round(this.now() % 60)} s`,
      '',
      `grabs ${c.grabs}   wins ${c.wins} (${pct(c.wins, c.grabs)})   slips ${c.slips}   misses ${c.misses}   doubles ${c.doubles}   free chute drops ${c.freebies}`,
      `won by rarity: ${Object.entries(c.wonRarity).map(([k, v]) => k + ' ' + v).join(', ')}`,
      `near misses (slipped within a claw-length of the chute): ${c.nearMiss}`,
      `slip causes: ${Object.entries(c.bySlipWhy).map(([k, v]) => k + ' ' + v).join(', ') || '-'}`,
      `after a failed grab: retried within 6s ${c.retryFast}, retried later ${c.retrySlow}, left the machine ${c.quitAfterFail}   (one-more-try rate ${pct(c.retryFast, fails)})`,
      `creatures stitched ${c.creatures}   unstitched ${c.unstitched}   sets completed ${c.sets}   remains won back ${c.homecomings}`,
      `battles ${c.battles}   won ${c.victories}   lost ${c.defeats}   retreats ${c.retreats}   zaps used ${c.zaps}   speed toggles ${c.speedToggles}   seconds at x2 ${Math.round(c.fastSecs)}   best stage ${c.bestStage}`,
      `pity tokens given ${c.pity}`,
      `THE RIG: luck earned ${c.luckEarned} (${Object.entries(c.luckBy).map(([k, v]) => k + ' ' + v).join(', ') || '-'})  spent ${c.luckSpent}  wasted at cap ${c.luckWasted}`,
      `  levers: quakes ${c.quakes}  nudges ${c.nudges}  tilts ${c.tilts}  iron grips ${c.irons} (taken back ${c.ironDisarmed})  orders ${c.orders}  redos ${c.redos}`,
      `  grabs after a lever: ${c.riggedGrabs} (wins ${pct(c.riggedWins, c.riggedGrabs)})   plain grabs: ${c.plainGrabs} (wins ${pct(c.plainWins, c.plainGrabs)})   iron grabs: ${c.ironGrabs} (wins ${pct(c.ironWins, c.ironGrabs)})`,
      `time: ${Object.entries(st).map(([k, v]) => k + ' ' + Math.round(v) + 's').join(', ')}`,
      '',
      'last events:',
      ...this.events.slice(-40).map((e) => `  ${e.t}s ${e.type} ${Object.entries(e).filter(([k]) => k !== 't' && k !== 'type').map(([k, v]) => k + '=' + v).join(' ')}`),
    ];
    return lines.join('\n');
  },
};
