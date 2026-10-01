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
|  | Target | Measured |
|---|---:|---:|
| ✅ | The carry is a skill: a careful carrier wins at least 8 points more grabs than a masher | careful 42% vs masher 33% (gap 9) |
| ✅ | The assist is a fair helper: better than mashing, no better than careful play | masher 33% < assisted 45% <= careful 42% (+5 noise) |
| ✅ | A careful player finishes a run (95% or more) | 98% |
| ✅ | An average player finishes a run (90% or more) | 96% |
| ✅ | A masher can still finish (40% or more), an assisted player too | masher 48%, assisted 66% |
| ✅ | A run takes 18 to 35 minutes for careful and average players (bot time, faster than a human) | careful 25 min, average 27 min |
| ✅ | No early wall: 95% of average players clear the first boss | 97% |
| ✅ | Farming cannot beat playing: retreating at the first scratch earns less per minute than honest play | honest 6.68/min, farm15 3.27, farm50 5.6 |
| ✅ | Nothing is wasted: no part physically leaves the machine in a real-physics run | careful 0, average 0, masher 0, assisted 0 |
| ✅ | Build for the graveyard (1): at final-stage strength the best build is not the same against every enemy | wisps  x4: tank; shades x3: tank; wraith x1: bruiser |
| ✅ | Build for the graveyard (2): a specialised build can be unable to beat an enemy at all (under 25%) | plated vs shades x3 23%; skirmish vs shades x3 0%; skirmish vs wraith x1 10% |
| ✅ | A full party built from good picks beats stage 5 reliably and the final stage more often than not | stage 5: 100%, stage 15: 95% |
<!-- END targets -->

## The numbers

<!-- BEGIN numbers -->
| Number | Value |
|---|---:|
| Start tokens / win pay / restock | 7 / 4 + stage / 3 parts |
| Partial pay (lost or retreated fight) | 0.7 x win pay x damage dealt, plus a ladder of up to 4 |
| Enemy growth per stage | +14% HP and ATK |
| Wisp / Shade / Wraith HP | 10 / 24 / 50 |
| Shade armour | 3 |
| Grab: carry momentum / steady speed / carry slip | 60 px/s² / 28 px/s / +1 per s per 30 px/s over |
| Grab: base slip / top jolt / twitch | 0.02/s / 0.12 / 0.4 |
| Assist speed | 60% of steady |
| Stages | 15, bosses every 5th |
| Fingerprint of all balance numbers | `8af94c1ae332` |
<!-- END numbers -->

## Evidence

### The claw

<!-- BEGIN claw -->
| Player | Aim error | Carry | Grabs won | Kept once lifted |
|---|---:|---:|---:|---:|
| careful | 1.5 px | gentle | 42% | 82% |
| average | 3 px | okay | 36% | 68% |
| masher | 5 px | jerky | 33% | 61% |
| assisted | 5 px | auto | 45% | 82% |

300 grabs each on fresh piles, real physics.
<!-- END claw -->

*Grabs won* is the chance a drop ends with a part in the chute. *Kept once lifted* is the number the carry moves: of the grabs that lifted something, how many got it all the way. Aim decides whether you lift anything; the carry decides whether you keep it. The bots that stand for a careful player and a masher differ only in how they steer while carrying.

### Fights

<!-- BEGIN battles -->
| Party (random parts) | S1 | S2 | S3 | S4 | S5 | S6 | S8 | S10 | S12 | S15 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 creature, 3 parts | 100% | 72% | 18% | 10% | 3% | 20% | 0% | 0% | 0% | 0% |
| 1 creature, 5 parts | 100% | 97% | 72% | 42% | 30% | 72% | 3% | 0% | 0% | 0% |
| 2 creatures, 4 parts | 100% | 100% | 85% | 63% | 35% | 73% | 2% | 0% | 0% | 0% |
| 3 creatures, 5 parts | 100% | 100% | 100% | 100% | 92% | 100% | 60% | 42% | 10% | 0% |
| 3 creatures, 7 parts | 100% | 100% | 100% | 100% | 100% | 100% | 95% | 78% | 45% | 5% |

| Party (best of 3 picks per slot) | S1 | S2 | S3 | S4 | S5 | S6 | S8 | S10 | S12 | S15 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 creatures, 8 parts, best of 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 98% | 95% |
| 2 creatures, 8 parts, best of 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 88% | 57% |
<!-- END battles -->

Random parts show how far luck alone gets you. The best-of-3 rows are closer to a player, who picks what to aim at. The final stage is meant to be a real wall for a random party and a fair fight for a good one.

### Who asks what

<!-- BEGIN matchups -->
| Build (x3) | wisps  x4 | shades x3 | wraith x1 |
|---|---:|---:|---:|
| tank | 100% (91% HP left) | 100% (78% HP left) | 100% (53% HP left) |
| plated | 100% (84% HP left) | 23% (33% HP left) | 73% (26% HP left) |
| bruiser | 100% (71% HP left) | 98% (63% HP left) | 100% (74% HP left) |
| skirmish | 100% (65% HP left) | 0% (0% HP left) | 10% (30% HP left) |
<!-- END matchups -->

Three copies of one build against one enemy type at stage 15 strength, each build spending the same budget of rarity (one rare, two uncommons, the rest common; see `tools/matchups.mjs`). Wisps swarm. Shades are armoured, and armour is taken off every arm's strike separately, so a build of small hits does almost nothing to them. The Wraith is a huge, slow boss. The point of the table is that its best cell is not always in the same row and that some cells are empty. It also shows the open problem: the tank is best against Wisps and Shades, and Wisps do not yet ask a question that any build fails.

### Whole runs

<!-- BEGIN econ -->
| Player | Finish | ≤30 min | ≤60 min | ≤90 min | Median (min) | Past boss 1 | Grabs | Fights lost | Retreats | Tokens/min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| careful | 98% | 80% | 97% | 98% | 25 | 98% | 86.8 | 2.6 | 2 | 7.28 |
| average | 96% | 67% | 94% | 96% | 27 | 97% | 96.5 | 4 | 2.9 | 6.68 |
| masher | 48% | 12% | 43% | 47% | 34 | 81% | 149.1 | 38.6 | 30 | 3.04 |
| assisted | 66% | 35% | 65% | 66% | 29 | 89% | 124.3 | 24.4 | 19 | 3.94 |
| farm15 | 0% | 0% | 0% | 0% | - | 0% | 74.1 | 60 | 60 | 3.27 |
| farm50 | 0% | 0% | 0% | 0% | - | 0% | 74.2 | 60.5 | 60.4 | 5.6 |

200 runs each with the no-physics grab model (grab odds from the claw table).
<!-- END econ -->

*farm15* and *farm50* are adversaries: they fight, retreat as soon as they have done 15% (or 50%) of the enemy's health, and spend what the failure ladder pays. If they ever out-earn honest play the ladder is an exploit. They do not, which is why the ladder is capped where it is.

<!-- BEGIN econPhysics -->
| Player | Finish | Median (min) | Past boss 1 | Grabs | Fights lost | Parts lost from machine |
|---|---:|---:|---:|---:|---:|---:|
| careful | 92% | 32 | 92% | 104.2 | 13.1 | 0 |
| average | 92% | 31 | 92% | 106.8 | 7.3 | 0 |
| masher | 67% | 43 | 75% | 156.3 | 27.5 | 0 |
| assisted | 50% | 28 | 58% | 111.8 | 36.4 | 0 |

12 runs each with the real claw. Small samples: read these as "the model is not lying", not as precise rates.
<!-- END econPhysics -->

## How we got here

Kept so nobody re-runs the same experiments. Numbers in this section are from the day they were measured and are not regenerated.

**1. The first late-game test found three things the early game hid.** Twenty-four real-physics runs to stage 30 (8 each of a careful, an average and a masher bot) under the prototype's rules:

- *A poverty trap at stages 3 to 5.* About a quarter of runs stalled there, often after 14 to 17 lost fights in a row. A defeat paid 1 token and scattered the party's parts back into the machine, and winning them back costs about 30 tokens. Runs that got stuck had ~30 parts in the world against ~110 in healthy runs.
- *An endless wall late.* Stage 25 saw 78 losses against 12 wins across the runs that got there. Nothing ever ended the run, so the wall was just a treadmill. Fix: a run is 15 stages and the last boss ends it. We considered an endless mode and cut it (see DESIGN.md, things we said no to).
- *No skill in the carry.* Grab win rate was 51.6% for the careful bot, 54.1% average, 55.3% for the masher. Pillar 3 was false.
- Good news: across those 24 runs, **zero parts physically fell out of the machine**. "Nothing is wasted" held.

**2. The economy was a cliff, not a slope.** With a fast no-physics model of the grab, a drop from 46% to 40% grab success took the finish rate from 88% to 25%. A player with slightly worse hands could not recover, however long they tried. Things that did not fix it: easing the first boss alone (35% to 53% for a masher, but the late game stayed a wall); a flat failure ladder (worked, and was exploitable, see below). Things that did: enemy growth per stage (the strongest single lever: 0.20 to 0.16 lifted a masher from ~35% to ~65% finishing), a lighter first boss, partial pay for failed fights, retreat heals everyone, and the ladder scaled by damage dealt. (Several of the numbers named here were changed again by 6; the table above always has the current ones.)

**3. The ladder had to be made unfarmable.** A flat "+1 token per consecutive failed fight" pays for pressing FIGHT then RETREAT. The farm bots showed it: at a cap of 8 they out-earned honest play. Scaling the ladder by the damage you did, and capping it at 4, puts them at about 85-90% of honest income, which is the point of the target.

**4. Making the carry a skill took two tries.** Momentum on the carriage and slip odds that grow with carry speed moved the gap only from 4 to 8 points. Sweeping `swingSlip` from 0.4 to 2.2 did nothing more, and that was the clue: a lost grip removed the grip spring, but the prongs form a cup and kept holding the part anyway. 30 swing "slips" cost only 13 dropped parts. When the last grip is lost the jaws now sag open for half a second (`slipOpen`), so a slip is a drop. After that the gap became measurable, and the base slip odds were re-tuned so a steady carry is nearly safe.

**5. The assist first beat careful play** (46% against 44%), which made the skill pointless. It now cruises at 60% of the steady speed, so it costs a little time, and a careful human doing the quick steady line does slightly better.

**6. Pillar 4 failed its own test, and the fix moved the whole economy.** "Build for the graveyard" says no single build should be best against everything. The first matchup table had a hand-made "balanced" build topping every column. That was unfair (it simply had better parts), so the builds were rebuilt on an equal budget of rarity, and then the *tank* topped every column, in every one of 96 combinations of Shade armour, Shade HP, Wisp attack, Wisp speed and ogre-gut health that were tried. The damage model was the cause: a creature's arms were added into one hit, so armour of 2 shaved a quarter off an 8-damage hit and health decided everything. Making each arm its own strike (armour is taken off each one) gave armour teeth: at stage 15 strength a build of small hits wins 0% against Shades. A second search (72 combinations, at the strength where builds actually fail) never gave the Wisp column to a specialist, so the pillar is worded to what the evidence supports: specialised builds are punished and the boss rewards burst over bulk, but bulk is still the best answer to Wisps and Shades. Wisps got faster and harder and the ogre gut lost 8 health. That made the game harder overall (careful 88%, average 85%, masher 20% finishing, and a farm adversary out-earning honest play at 118%). The first fix, softer enemies, undid the identity (growth 0.12 with a lighter boss let the small-hit build beat Shades 54% of the time and cut the bruiser's edge on the Wraith to 5 points). So the identity was held up instead, with armour 3 on Shades and on the Wraith, and the economy was bought back with income: win pay 3 to 4, starting purse 6 to 7, partial pay 0.7, and a lighter Wraith (50 health). The two lessons: **growth per stage trades identity for economy, income does not**; and the bots' finish rates were noisy enough at 60 runs (plus or minus 4 points) that a candidate had to pass with margin in a second sample before it was chosen.

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
