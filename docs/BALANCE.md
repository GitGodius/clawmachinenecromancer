# Balance

Every number that decides how the game plays is measured here, by code that plays the game, so the next person can retune without guessing. Nothing in this file is opinion except the **targets**, and those are enforced.

```sh
node tools/balance.mjs           # measure everything (about 10 minutes, all cores) and rewrite this file + balance.json
node tools/balance.mjs --quick   # everything except the slow real-physics parts (about 90 s)
node tools/balance.mjs --check   # CI: fails if a number changed without this file, or a target is missed
node tools/test.mjs              # rules regression: fixed-seed fights and grabs must not move
```

The blocks between `BEGIN` and `END` markers are generated. Do not edit them; change the game, then run the tool.

## What the numbers are for

<!-- BEGIN targets -->
<!-- END targets -->

## The numbers

<!-- BEGIN numbers -->
<!-- END numbers -->

## Evidence

### The claw

<!-- BEGIN claw -->
<!-- END claw -->

*Grabs won* is the chance a drop ends with a part in the chute. *Kept once lifted* is the number the carry moves: of the grabs that lifted something, how many got it all the way. Aim decides whether you lift anything; the carry decides whether you keep it. The bots that stand for a careful player and a masher differ only in how they steer while carrying.

### Fights

<!-- BEGIN battles -->
<!-- END battles -->

Random parts show how far luck alone gets you. The best-of-3 rows are closer to a player, who picks what to aim at. The final stage is meant to be a real wall for a random party and a fair fight for a good one.

### Who asks what

<!-- BEGIN matchups -->
<!-- END matchups -->

Three copies of one build against one enemy type at stage 6 strength. Wisps swarm, Shades are armoured (armour 2 takes a flat 2 off every hit, so small hits barely count), and the Wraith is a bag of health. The point of the table is that its best cell is not always in the same row.

### Whole runs

<!-- BEGIN econ -->
<!-- END econ -->

*farm15* and *farm50* are adversaries: they fight, retreat as soon as they have done 15% (or 50%) of the enemy's health, and spend what the failure ladder pays. If they ever out-earn honest play the ladder is an exploit. They do not, which is why the ladder is capped where it is.

<!-- BEGIN econPhysics -->
<!-- END econPhysics -->

## How we got here

Kept so nobody re-runs the same experiments. Numbers in this section are from the day they were measured and are not regenerated.

**1. The first late-game test found three things the early game hid.** Twenty-four real-physics runs to stage 30 (8 each of a careful, an average and a masher bot) under the prototype's rules:

- *A poverty trap at stages 3 to 5.* About a quarter of runs stalled there, often after 14 to 17 lost fights in a row. A defeat paid 1 token and scattered the party's parts back into the machine, and winning them back costs about 30 tokens. Runs that got stuck had ~30 parts in the world against ~110 in healthy runs.
- *An endless wall late.* Stage 25 saw 78 losses against 12 wins across the runs that got there. Nothing ever ended the run, so the wall was just a treadmill. Fix: a run is 15 stages and the last boss ends it. We considered an endless mode and cut it (see DESIGN.md, things we said no to).
- *No skill in the carry.* Grab win rate was 51.6% for the careful bot, 54.1% average, 55.3% for the masher. Pillar 3 was false.
- Good news: across those 24 runs, **zero parts physically fell out of the machine**. "Nothing is wasted" held.

**2. The economy was a cliff, not a slope.** With a fast no-physics model of the grab, a drop from 46% to 40% grab success took the finish rate from 88% to 25%. A player with slightly worse hands could not recover, however long they tried. Things that did not fix it: easing the first boss alone (35% to 53% for a masher, but the late game stayed a wall); a flat failure ladder (worked, and was exploitable, see below). Things that did: growth per stage 0.20 to 0.18 (the strongest single lever: 0.16 lifts a masher to ~65%), Wraith HP 90 to 70, Shade armour 3 to 2, partial pay for failed fights, retreat heals everyone, and the ladder scaled by damage dealt.

**3. The ladder had to be made unfarmable.** A flat "+1 token per consecutive failed fight" pays for pressing FIGHT then RETREAT. The farm bots showed it: at a cap of 8 they out-earned honest play. Scaling the ladder by the damage you did, and capping it at 4, puts them at about 85-90% of honest income, which is the point of the target.

**4. Making the carry a skill took two tries.** Momentum on the carriage and slip odds that grow with carry speed moved the gap only from 4 to 8 points. Sweeping `swingSlip` from 0.4 to 2.2 did nothing more, and that was the clue: a lost grip removed the grip spring, but the prongs form a cup and kept holding the part anyway. 30 swing "slips" cost only 13 dropped parts. When the last grip is lost the jaws now sag open for half a second (`slipOpen`), so a slip is a drop. After that the gap became measurable, and the base slip odds were re-tuned so a steady carry is nearly safe.

**5. The assist first beat careful play** (46% against 44%), which made the skill pointless. It now cruises at 60% of the steady speed, so it costs a little time, and a careful human doing the quick steady line does slightly better.

## Retuning guide

| To change | Turn | Watch |
|---|---|---|
| How hard the run is overall | `enemyGrowth` | finish rate for masher and assisted; it is the strongest lever |
| How much a lost fight hurts | `partialPay`, `ladderMax` | the farm rows in *Whole runs* must stay under honest play |
| How much the carry matters | `swingSlip`, `swingSafe`, `carryAccel` | the careful-minus-masher gap in *The claw* |
| The assist | `assistSpeed` | assisted must stay between masher and careful |
| Who beats whom | `ENEMY_KINDS` (armour, HP, speed) | *Who asks what*: no row may win every column |
| Pace | `winTokens`, `startTokens`, `restockParts` | median minutes and the "past boss 1" column |

After any change: `node tools/balance.mjs`, read the targets block, commit the regenerated files with the change.

## What this does not tell you

- **Bots are not people.** They aim with Gaussian noise and steer with two fixed habits. A human's carry is somewhere between the careful and masher rows and varies from grab to grab. No human has played this build.
- **The grab model in *Whole runs* is a model.** It keeps recycling, depletion and top-ups and drops the physics. The small real-physics table is there to catch it lying. Both bots choose their own targets and stitch by a fixed rule; a human will do worse and better.
- **Times are bot times.** Bots aim instantly. A person takes longer per grab.
- **Nothing here says it is fun.** That is what the playtest section of PROTOTYPE.md is for.
